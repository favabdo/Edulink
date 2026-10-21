#!/usr/bin/env bash
# ============================================================================
#  EduLink — تشغيل النشر عند عميل (runbook قابل للتكرار)
#
#  ماذا يفعل: يتحقق من المتطلبات، يُنشئ قاعدة SQL Server ويشغّل مخطط
#  `database/schema.sql`، يبني الواجهة، يُشغّل docker compose، يُنشئ أول حساب
#  مالك، ثم يُشغّل أداتَي التحقق من الإنتاج ويطبع حالة قائمة ما قبل التسليم.
#
#  الاستخدام (من جذر المستودع، على سيرفر العميل):
#      cp apps/api/.env.example deploy/.env && $EDITOR deploy/.env   # املأ الأسرار
#      bash deploy/run.sh
#
#  آمن على التكرار: لا يحذف أي شيء، وكل خطوة تُتخطى لو كانت تمت بالفعل.
#  متطلب: docker + docker compose v2 + sqlcmd (أو شغّل الاسكريبت من SSMS يدويًا).
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="deploy/.env"
DOMAIN="${EDULINK_DOMAIN:-}"          # تصديره قبل التشغيل: EDULINK_DOMAIN=academia.example
API_URL="${EDULINK_API_URL:-https://${DOMAIN:-localhost}}"
# أصلان للتحقق: API_URL هو العام (عبر nginx — اختباره إلزامي لطبقة الوسيط)،
# وAPI_INTERNAL_URL هو الـ API مباشرة (loopback) لأن قياس حدّ الـ IP يحتاج تمويه الترويسة.
API_INTERNAL_URL="${EDULINK_API_INTERNAL_URL:-http://localhost:5279}"
export EDULINK_API_INTERNAL_URL="$API_INTERNAL_URL"
SCHEMA="database/schema.sql"
# أسماء المالك: نقبل `OWNER_*` أو `EDULINK_OWNER_*` ونصدّر القيمة المحلولة للأدوات
# (التصادم بين الاسمين جعل التحققات كلها تدخل بكلمة سر خاطئة).
OWNER_EMAIL="${OWNER_EMAIL:-${EDULINK_OWNER_EMAIL:-owner@edulink.test}}"
OWNER_PASSWORD="${OWNER_PASSWORD:-${EDULINK_OWNER_PASSWORD:-ChangeMe@2026}}"   # غيّرها فورًا من الواجهة بعد أول دخول
export EDULINK_OWNER_EMAIL="$OWNER_EMAIL" EDULINK_OWNER_PASSWORD="$OWNER_PASSWORD"
export EDULINK_API_URL="${EDULINK_API_URL:-$API_URL}"
API_URL="$EDULINK_API_URL"

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  ✓ %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1"; }
die()  { printf '\n  ✗ %s\n\n' "$1"; exit 1; }

# ---------------------------------------------------------------- 1) المتطلبات
say "1/8 التحقق من المتطلبات"
[ -f "$ENV_FILE" ] || die "لا يوجد $ENV_FILE — انسخ apps/api/.env.example واملأ الأسرار ثم أعد التشغيل."

PROVIDER="$(grep -E '^Database__Provider=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
[ -n "$PROVIDER" ] || die "Database__Provider غير محدد في $ENV_FILE (SqlServer أو Postgres)."
ok "المحرّك المحدد: $PROVIDER"

# docker و sqlcmd ليسا إجباريين: خطوة المخطط وبناء الواجهة لا تحتاجان أيًّا منهما،
# وقد يكون سيرفر الشركة Windows بلا Docker. غياب كل أداة يُخطي ما يخصها فقط.
HAVE_DOCKER=1
command -v docker >/dev/null && docker compose version >/dev/null 2>&1 || HAVE_DOCKER=0
HAVE_SQLCMD=1
command -v sqlcmd >/dev/null || HAVE_SQLCMD=0

if [ "$HAVE_DOCKER" = 1 ]; then ok "docker + compose v2 متاحان"; else
  warn "docker غير متاح — ستُخطى خطوة الحاويات؛ شغّل الـ API (وnginx) على هذا السيرفر بأي طريقة أخرى."; fi
if [ "$HAVE_SQLCMD" = 1 ]; then ok "sqlcmd متاح"; else
  warn "sqlcmd غير متاح — شغّل قسم SQL Server من SSMS يدويًا (تطبع الخطوة التالية الأمر والموقع)."; fi

# أسرار بلا قيم افتراضية/فارغة — خطأ شائع يُسقط TURN والدخول معًا
for KEY in Meeting__TurnSecret ConnectionStrings__SqlServer ConnectionStrings__Postgres; do
  VAL="$(grep -E "^${KEY}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  [ -z "$VAL" ] && continue
  case "$VAL" in
    *YOUR-*|*PROJECT-REF*|\[*\]) die "قيمة $KEY ما زالت نصًّا استرشاديًا في $ENV_FILE — املأها قبل التشغيل." ;;
  esac
done

grep -qE '^Network__UseForwardedHeaders=true' "$ENV_FILE" \
  || warn "Network__UseForwardedHeaders غير مُفعّل: كل المؤسسة ستُحسب IPًا واحدًا عند تحديد المعدل."
grep -qE '^Meeting__TurnSecret=..*' "$ENV_FILE" \
  || warn "Meeting__TurnSecret فارغ: الحصص الحيّة ستنجح داخل الشبكة المحلية وتفشل على NAT صارم."

# ---------------------------------------------------------- 2) قاعدة البيانات
say "2/8 مخطط قاعدة البيانات من $SCHEMA (لا EF Migrations إطلاقًا)"
# الملف المستخرَج يبقى داخل المستودع: sqlcmd على Windows (Git Bash) لا يقرأ مسار
# /tmp فيفشل برسالة مضللة عن -E/-U. يُحذف تلقائيًا عند الخروج.
SQL_FILE="deploy/.sqlserver-schema.sql"
OWNER_JSON="deploy/.owner.json"
trap 'rm -f "$SQL_FILE" "$OWNER_JSON" /tmp/owner.json 2>/dev/null || true' EXIT

extract_sqlserver() {
  sed -n '/^-- >>> BEGIN SQL SERVER/,/^-- <<< END SQL SERVER/p' "$SCHEMA" \
    | grep -v '^/\*$' | grep -v '^\*/$' > "$SQL_FILE"
  wc -l < "$SQL_FILE"
}

if [ "${PROVIDER,,}" = "sqlserver" ]; then
  LINES="$(extract_sqlserver)"; ok "استُخرج قسم T-SQL ($LINES سطرًا) → $SQL_FILE"
  CS="$(grep -E '^ConnectionStrings__SqlServer=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
  SERVER="$(printf '%s' "$CS" | sed -E 's/.*Server=([^;]+).*/\1/')"
  DB="$(printf '%s' "$CS" | sed -E 's/.*Database=([^;]+).*/\1/')"

  # دخول Windows (Trusted_Connection / بلا User ID) شائع على سيرفر الشركة —
  # نميطّه بـ -E، و إلا نمرّر المستخدم وكلمة السر.
  USER_ID=""
  if printf '%s' "$CS" | grep -qiE 'User ID='; then
    USER_ID="$(printf '%s' "$CS" | sed -E 's/.*User ID=([^;]+).*/\1/')"
  fi
  if [ -n "$USER_ID" ]; then
    PASS="$(printf '%s' "$CS" | sed -E 's/.*Password=([^;]+).*/\1/')"
    SQLCMD_AUTH=(-S "$SERVER" -U "$USER_ID" -P "$PASS")
    AUTH_LABEL="مستخدم/كلمة سر ($USER_ID)"
  else
    SQLCMD_AUTH=(-S "$SERVER" -E)
    AUTH_LABEL="دخول Windows (Trusted_Connection)"
  fi
  ok "السيرفر: $SERVER | القاعدة: $DB | التوثيق: $AUTH_LABEL"

  if [ "$HAVE_SQLCMD" = 1 ]; then
    sqlcmd "${SQLCMD_AUTH[@]}" -Q "IF DB_ID(N'$DB') IS NULL BEGIN CREATE DATABASE [$DB]; SELECT 'created'; END ELSE SELECT 'exists';" | tail -2
    # الأعلام ليست ترفًا: 65001 للعربية، -I للفهارس المفلترة، -b يوقف الصمت عند الخطأ
    sqlcmd "${SQLCMD_AUTH[@]}" -d "$DB" -f 65001 -I -b -i "$SQL_FILE"
    sqlcmd "${SQLCMD_AUTH[@]}" -d "$DB" -Q "SET NOCOUNT ON;
      SELECT tables=(SELECT COUNT(*) FROM sys.tables),
             triggers=(SELECT COUNT(*) FROM sys.triggers),
             checks=(SELECT COUNT(*) FROM sys.check_constraints),
             fks=(SELECT COUNT(*) FROM sys.foreign_keys);" | tail -4
    ok "البصمة المتوقعة: tables=11 · triggers=0 · checks=21 · fks=9"
  else
    warn "لم يُنفَّذ المخطط تلقائيًا (لا sqlcmd). نفّذه بنفس الأعلام المطلوبة:"
    printf '    sqlcmd -S "%s" -d %s -f 65001 -I -b -i %s   (# أو -U/-P)\n' "$SERVER" "$DB" "$SQL_FILE"
    printf '    أو من SSMS: افتح %s ثم Execute (الملف تراكمي).\n' "$SQL_FILE"
  fi
else
  warn "المحرّك $PROVIDER: الصق $SCHEMA كاملًا في Supabase SQL Editor (مرة أو عشر مرات بنفس النتيجة)."
fi

# ------------------------------------------------------------ 3) بناء الواجهة
say "3/8 بناء الواجهة (Vite)"
[ -d apps/web/node_modules ] || npm install
( cd apps/web && npm run build >/dev/null )
[ -f apps/web/dist/index.html ] && ok "apps/web/dist جاهزة — يخدمها nginx" || die "لم يُنتَج apps/web/dist"
grep -qE '^VITE_API_BASE_URL=..' "$ENV_FILE" 2>/dev/null \
  && warn "VITE_API_BASE_URL في $ENV_FILE لا يقرأه بناء الواجهة — متغيّرات الواجهة تُقرأ من apps/web/.env (انظر apps/web/.env.example: VITE_BASE_PATH)"

# ------------------------------------------------------------------ 4) الإقلاع
say "4/8 تشغيل الخدمات (api + nginx + coturn)"
if [ "$HAVE_DOCKER" = 1 ]; then
  ( cd deploy && docker compose up -d --build )
  ok "حاويات runّت"
else
  warn "بلا docker: شغّل الـ API يدويًا على هذا السيرفر (مثال: dotnet EduspaceApi.dll مع ASPNETCORE_ENVIRONMENT=Production)، وخُدّم apps/web/dist من nginx/IIS."
fi

HEALTH=""
for _ in $(seq 1 30); do
  HEALTH="$(curl -fsS "${API_URL}/api/health/db" 2>/dev/null || true)"
  [ -n "$HEALTH" ] && break
  sleep 2
done

if [ -z "$HEALTH" ]; then
  warn "لم يستجب ${API_URL}/api/health/db خلال 60 ث — أكمل التشغيل ثم أعد تنفيذ هذا السكربت (الخطوات 5 و6 تحتاج الـ API يعمل)."
  printf '  تحقق يدوي: curl %s/api/health/db\n' "$API_URL"
  say "انتهى الجزء القابل للتنفيذ — المتبقي رهن تشغيل الـ API"
  exit 0
fi

printf '  %s\n' "$HEALTH"
printf '%s' "$HEALTH" | grep -q '"canConnect":true' \
  || die "الـ API لا يصل للقاعدة — راجع سلسلة الاتصال والمخطط في $ENV_FILE / $SCHEMA"
ok "الـ API يعمل ويقرأ من القاعدة ($(printf '%s' "$HEALTH" | sed -E 's/.*"provider":"([^"]+)".*/\1/'))"

# ------------------------------------------------------------- 5) أول حساب مالك
say "5/8 أول حساب مالك (يعمل مرة واحدة فقط على قاعدة فارغة)"
# الجسم من ملف UTF-8 لا من سطر الأوامر: curl على Windows/Git Bash يُحوِّل الوسائط إلى
# cp1252 فتُستبدل كل حرف عربي بـ `?` وتُخزَّن Name مقطوعة (مقيس: `-d '{"name":"طالب ألفا"}'`
# خزّنت «???? ????» في Edu_Students، و`--data-binary @ملف` بنفس النص خزّنته سليمًا).
# printf أمر داخلي في bash فلا يتحوَّل، والملف يصل كما هو على لينكس وويندوز معًا.
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
printf '{"name":"%s","email":"%s","password":"%s"}' \
  "$(json_escape "${OWNER_NAME:-مالك المنصة}")" \
  "$(json_escape "$OWNER_EMAIL")" "$(json_escape "$OWNER_PASSWORD")" > "$OWNER_JSON"
CODE="$(curl -s -o /tmp/owner.json -w '%{http_code}' -X POST "${API_URL}/api/setup/owner" \
  -H 'Content-Type: application/json' --data-binary "@$OWNER_JSON")"
case "$CODE" in
  200|201) ok "أُنشئ المالك — غيّر كلمة السر من الواجهة فورًا وحذف rows Edu_Tokens القديمة لاحقًا" ;;
  409)     ok "يوجد مالك بالفعل (normal على إعادة التشغيل)" ;;
  *)       warn "حالة $CODE من /api/setup/owner — أنشئ المالك يدويًا ثم أكمل" ;;
esac

# ------------------------------------------------------------------ 6) التحقق
say "6/8 التحقق من الإنتاج (المحدِّلات + الدورة الوظيفية)"
run_check() {
  local script="$1" base="${2:-$API_URL}"
  if [ -f "$script" ]; then
    EDULINK_API_URL="$base" EDULINK_OWNER_EMAIL="$OWNER_EMAIL" EDULINK_OWNER_PASSWORD="$OWNER_PASSWORD" \
      PYTHONIOENCODING=utf-8 python "$script" >/dev/null 2>&1 \
      && ok "$(basename "$script") نجح (عبر $base)" \
      || warn "$(basename "$script") انتهى بغير صفر — اقرأ tools/out-*.txt يدويًا"
  fi
}
# حدّ الـ IP لا يُقاس عبر nginx: الأداة تموّه X-Forwarded-For بعناوين كثيرة، والوسيط
# يستبدلها بعنوانه (هذا هو المطلوب في verify-xff-spoof). فلازم الـ API مباشرة.
if curl -fsS "${API_INTERNAL_URL}/api/health/db" >/dev/null 2>&1; then
  run_check "tools/verify-rate-limits.py" "$API_INTERNAL_URL"
else
  warn "تخطّيت verify-rate-limits.py: الـ API لا يستجيب على $API_INTERNAL_URL — في compose هذا هو المنفذ 127.0.0.1:5279 (مفتوح على loopback فقط، لا على الجمهور)"
fi
run_check "tools/verify-production-flow.py" "$API_URL"

# غرفة اللايف فوق الوسيط نفسه: ترقية WebSocket حقيقية عبر nginx لا على الـ API وحده
# (تسبق فحص التزوير عمدًا: ذلك الفحص يستهلك حزنة الدخول بالكامل لأي عنوان في تلك الدقيقة)
if [ -f tools/hub-through-proxy-check.mjs ]; then
  HUB_CODE=0
  HUB_OUT="$(EDULINK_PROXY_URL="$API_URL" EDULINK_OWNER_EMAIL="$OWNER_EMAIL" EDULINK_OWNER_PASSWORD="$OWNER_PASSWORD" \
    node tools/hub-through-proxy-check.mjs 2>&1)" || HUB_CODE=$?
  if [ "$HUB_CODE" = "0" ]; then
    ok "غرفة اللايف تعمل عبر الوسيط (REST + WebSocket + رسائل)"
    printf '%s\n' "$HUB_OUT" | tail -2
  else
    warn "فحص الغرفة عبر الوسيط فشل — أسباب معروفة: شهادة TLS غير موثوقة على هذا الجهاز، أو حدّ الدخول/قفل الحساب ما زال ساريًا من فحص سابق"
    printf '%s\n' "$HUB_OUT" | tail -6
  fi
fi

# توقيع TURN: هل التوكن الذي يستلمه المتصفح يقبله coturn فعلًا؟ (إعادة حساب HMAC بشكل مستقل)
TURN_SECRET_ENV="$(grep -E '^Meeting__TurnSecret=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
TURN_URLS_ENV="$(grep -E '^Meeting__TurnUrls__[0-9]+=' "$ENV_FILE" | cut -d= -f2- | paste -sd, - || true)"
COTURN_SECRET="$(grep -E '^static-auth-secret=' deploy/turnserver.conf 2>/dev/null | tail -1 | cut -d= -f2- || true)"
if [ -n "$TURN_SECRET_ENV" ] && [ -n "$COTURN_SECRET" ] && [ "$COTURN_SECRET" != "$TURN_SECRET_ENV" ]; then
  warn "سرّ coturn في deploy/turnserver.conf لا يساوي Meeting__TurnSecret في $ENV_FILE — سيرفض coturn كل طلب تحويل"
fi
if [ -f tools/verify-ice-turn.py ] && [ -n "$TURN_SECRET_ENV" ] && [ -n "$TURN_URLS_ENV" ]; then
  TURN_TTL_ENV="$(grep -E '^Meeting__TurnTtlSeconds=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  case "$TURN_TTL_ENV" in ''|*[!0-9]*) TURN_TTL_ENV=86400 ;; esac
  ICE_CODE=0
  ICE_OUT="$(EDULINK_API_URL="$API_URL" EDULINK_OWNER_EMAIL="$OWNER_EMAIL" EDULINK_OWNER_PASSWORD="$OWNER_PASSWORD" \
    EDULINK_TURN_URLS="$TURN_URLS_ENV" EDULINK_TURN_SECRET="$TURN_SECRET_ENV" \
    EDULINK_TURN_TTL="$TURN_TTL_ENV" \
    PYTHONIOENCODING=utf-8 python tools/verify-ice-turn.py green 2>&1)" || ICE_CODE=$?
  if [ "$ICE_CODE" = "0" ]; then
    ok "توقيع TURN مطابق لما يفحصه coturn (base64(HMAC-SHA1)) — والمنفذ مرفوض بلا توكن"
  else
    warn "فحص TURN فشل — راجع tools/out-ice-turn.txt: الأرجح أن Meeting__TurnSecret لا يطابق use-auth-secret في coturn"
    printf '%s\n' "$ICE_OUT" | tail -4
  fi
else
  warn "تخطّيت فحص TURN: Meeting__TurnSecret أو Meeting__TurnUrls فارغ في $ENV_FILE — الحصص ستنجح داخل الشبكة المحلية وتفشل على NAT صارم"
fi

# طبقة الوسيط وحدها: تزوير X-Forwarded-For لا يجوز أن يفتح حزنة جديدة لحدّ الدخول — **آخر خطوة** لأنه يُشبع الحزنة
XFF_CODE=0
XFF_OUT="$(EDULINK_BASE="$API_URL" PYTHONIOENCODING=utf-8 python tools/verify-xff-spoof.py green 2>&1)" || XFF_CODE=$?
if [ "$XFF_CODE" = "0" ]; then
  ok "الحدّ يسري على عنوان العميل الذي أضافه الوسيط — التزوير لا يشتري محاولة"
  printf '%s\n' "$XFF_OUT" | tail -2
else
  warn "تزوير X-Forwarded-For تجاوز حدّ الدخول (عبر $API_URL) — اضبط Network__ForwardedHeadersLimit=1 (و2 فقط خلف CDN)"
  printf '%s\n' "$XFF_OUT" | tail -6
fi

# ------------------------------------------------------------ 7) قياس الحمل (اختياري)
say "7/8 قياس الحمل على هذا السيرفر (اختياري)"
if [ "${EDULINK_RUN_LOADTEST:-0}" = "1" ]; then
  warn "يفتح 2400 اتصال WebSocket على هذا الجهاز — لا تُشغّله فوق تحميل حقيقي قائم."
  if EDULINK_API_URL="$API_URL" EDULINK_OWNER_EMAIL="$OWNER_EMAIL" EDULINK_OWNER_PASSWORD="$OWNER_PASSWORD" \
     node tools/loadtest/meeting-loadtest.mjs --rooms 1200 --peers 2 --hold 60 2>&1 | tail -14; then
    ok "انتهى قياس الحمل — وثّق الأرقام في docs/11 §5-أ لهذه العربة"
  else
    warn "قياس الحمل فشل أو انقطع — الأرقام المرجعية على جهاز التطوير: 2400/2400 و139,200 رسالة بلا فقدان."
  fi
else
  warn "تخطّيت قياس الحمل (مرّر EDULINK_RUN_LOADTEST=1 لتشغيله) — المتطلب: 1000+ حصة متزامنة."
fi

# بوابتا §7 تحتاجان دخولًا إداريًا واحدًا لكل منهما، وفحص تزوير X-Forwarded-For في
# الخطوة 6 يُشبع حزنة الدخول لنفس عنوان الوسيط عمدًا (لذلك يأتي آخرًا). النتيجة حينها
# «429 = لم أُتحقق» — وهي ليست أحمرًا على العميل ولا أخضرًا. ننتظر فتح النافذة ونعيد.
await_login_gate() {
  local script="$1" out code tries=0
  while :; do
    code=0
    out="$(EDULINK_API_URL="$API_URL" PYTHONIOENCODING=utf-8 python "$script" 2>&1)" || code=$?
    if [ "$code" = "0" ] || ! printf '%s' "$out" | grep -q '429'; then break; fi
    tries=$((tries + 1))
    if [ "$tries" -ge 3 ]; then
      warn "$(basename "$script") ما زال محجوبًا بعد ${tries} انتظار — الحكم الحقيقي غير متاح (ليس نجاحًا)"
      break
    fi
    warn "$(basename "$script") محجوب بحزنة الدخول من فحص سابق — أنتظر النافذة التالية ($tries/3)"
    sleep 65
  done
  GATE_OUT="$out"; GATE_CODE="$code"
}

say "8/8 حالة قائمة ما قبل التسليم (docs/11 §7)"
if [ -f deploy/certs/fullchain.pem ]; then ok "شهادة TLS موجودة"; else warn "لا شهادة في deploy/certs — ضعها أو استخدم certbot"; fi

# بند «تغيير كلمات السر المزروعة» صار مقيسًا: البوابة تُجرّب الكلمات الموثّقة في المستودع
# على مسارات الدخول الثلاثة. **الأحمر متوقَّع على قاعدة لم تُدوَّر كلماتها بعد** — ليس خطأ نشر.
if [ -f tools/verify-default-credentials.py ]; then
  await_login_gate "tools/verify-default-credentials.py"
  CRED_CODE="$GATE_CODE"; CRED_OUT="$GATE_OUT"
  if [ "$CRED_CODE" = "0" ]; then
    ok "لا كلمة افتراضية موثّقة تعمل — التفاصيل في tools/out-default-credentials.txt"
  else
    warn "بند تدوير كلمات السر غير مغلق — راجع tools/out-default-credentials.txt"
    printf '%s\n' "$CRED_OUT" | { grep '✗' || true; } | head -4
    printf '       الدخول بالكلمة الافتراضية أعلاه يعني الحساب لم يُدوَّر. دوِّرها ثم:\n'
    printf '         DELETE FROM dbo.[Edu_Tokens];   # تغيير الكلمة وحده لا يُبطل جلسات الأجهزة القديمة (docs/11 §7)\n'
  fi
else
  warn "لا يوجد tools/verify-default-credentials.py — بقي بند كلمات السر يدويًا"
fi

# بند «تفريغ بيانات التطوير» صار مقيسًا أيضًا: بوابة تبحث عن بصمات الزرع
# (بريد seed_dev.py + أي نطاق @edulink.test عدا حسابك). **الأحمر متوقَّع على قاعدة
# ما زال فيها الزرع** — ليست قاعدة العميل النهائي تُسلَّم هكذا.
if [ -f tools/verify-no-dev-data.py ]; then
  await_login_gate "tools/verify-no-dev-data.py"
  DEV_CODE="$GATE_CODE"; DEV_OUT="$GATE_OUT"
  if [ "$DEV_CODE" = "0" ]; then
    ok "لا بصمات بيانات تطوير باقية — التفاصيل في tools/out-no-dev-data.txt"
  else
    warn "بند تفريغ بيانات التطوير غير مغلق — راجع tools/out-no-dev-data.txt"
    printf '%s\n' "$DEV_OUT" | { grep -E '✗|بصمات' || true; } | head -5
    printf '       الحذف يجب أن يحترم القيود الخارجية (الأبناء أولًا) — الترتيب المُقاس في docs/11 §7،\n'
    printf '       ولا يحذف حساب الإدارة الذي أنشأته في الخطوة 5.\n'
  fi
else
  warn "لا يوجد tools/verify-no-dev-data.py — بقي بند تفريغ التطوير يدويًا"
fi

docker compose -f deploy/docker-compose.yml ps --format '{{.Name}} {{.State}}' 2>/dev/null | sed 's/^/  /' || true
printf '\n  تذكير: TURN يجب اختباره من شبكة موبايل حقيقية (NAT صارم) — الاختبار الآلي يقيس الإشارات فقط.\n'
printf '  والنسخ الاحتياطي ليس دليلًا حتى يخرج `deploy/restore-drill.sql` بصفر:\n'
printf '    sqlcmd -S "SERVER,1433" -E -f 65001 -I -b -i deploy/backup.sql\n'
printf '    sqlcmd -S "SERVER,1433" -E -f 65001 -I -b -i deploy/restore-drill.sql   # ثم StrictLive=1\n'
printf '  وإعادة قياس الحمل على هذا السيرفر: node tools/loadtest/meeting-loadtest.mjs --rooms 1200 --peers 2 --hold 60\n\n'
