# النشر على سيرفر واحد — EduLink

> **الشكل المُسلَّم (قرار صاحب المشروع 2026-10-21):** كل شيء على **سيرفر الاستضافة الذي يعمل
> عليه Nile Chat**: الواجهة ملفات ثابتة يخدمها nginx، والـ API **عملية `dotnet` مباشرة**
> (systemd أو PM2 — بلا Docker) تسمع على `127.0.0.1:5279` وحدها، والمنصة كلها تحت **بادئة مسار
> واحدة** على نفس الدومين (`/edulink`)، والقاعدة على **SQL Server** عند العميل.
>
> **ما حُذف من المستودع في هذه الخطوة:** `vercel.json` (الجذر و`apps/web`) و`render.yaml` و
> `docs/12-render-deployment.md`. ترويسات الأمان والكاش التي كانت في `vercel.json` **نُقلت
> حرفيًا** إلى `deploy/nginx-edulink.conf` — حذفها بلا نقل كان يُسقط `nosniff` و
> `Permissions-Policy` (الكاميرا/المايك للحصص) والكاش الدائم للأصول المُوقَّعة ببصمة المحتوى.
>
> **لماذا بادئة لا دومين فرعي؟** نفس سبب `/nilechat`: على استضافة مشتركة لا دومينات ولا منفذات
> جديدة، و**نفس الأصل يلغي CORS من المعادلة** — لا طلب عابر للأصل يحدث، فلا سطرَين متقابلين
> يُنسى أحدهما فيسقط النشر بصمت (كان هذا أكبر مصدر سقوط في الشكل القديم).

---

## 0) قبل أي شيء: قِس العربة، لا تفترضها

الـ runbook كله مبني على شكل Nile Chat (nginx + عملية مستضافة على localhost). لا تُنفّذ أي خطوة
قبل هذه النتيجة، لأن `dotnet` نفسه قد لا يكون موجودًا:

```bash
cat /etc/os-release | head -3                       # AlmaLinux؟ Ubuntu؟ cPanel؟
nginx -v 2>&1; sudo nginx -t 2>&1 | tail -3         # نسخة nginx وأين يقبل التضمين
dotnet --list-runtimes 2>&1 | tail -5 || echo "NO_DOTNET"
command -v pm2 && pm2 -v || echo "NO_PM2"
ss -lntp | grep -E ':80 |:443 |:5279 ' || true      # من يسمع على المنافذ
grep -rl "nilechat" /etc/nginx/ 2>/dev/null | head   # ملف إعداد Nile Chat = rif reference لشكل التضمين
```

- **بلا `dotnet`:** التنصيب من مستودع مايكروسوفت الرسمي حسب توزيعتك —
  `dnf search 'dotnet*'` / `apt-cache search dotnet` واختر **ASP.NET Core Runtime 10.0**
  (لا يحتاج SDK على سيرفر التشغيل، لكن البناء `dotnet publish` قد يتم هنا أو على جهازك وترفع المخرجات).
  لا تُثبّت شيئًا قبل أن تُرجع نتائج البحث الاسم الحرفي للحزمة.
- **`NO_DOTNET` ولا قدرة على تنصيبه** (استضافة لا تسمح بتشغيل عمليات): هذه العربة لا تصلح للـ API،
  ويبقى الـ API على عربة أخرى — وعندئذٍ يرجع **`tools/verify-external-deploy.py`** أداةً مطلوبة
  لأنه يقيس شكل الأصلين (CORS + `wss`)، وتُدرَج أصل الواجهة في `Cors__Origins__n`.

---

## 1) المخطط: ملف واحد يعمل Run على SQL Server

الملف: **`RUN-ON-SQL-SERVER.sql`** في جذر المستودع — قسم T-SQL من `database/schema.sql`
(مُستخرَج، **لا يُحرَّر يدويًا**) مع مقدمة `CREATE DATABASE` + `USE`. تراكمي ومحمي بـ
`IF NOT EXISTS`: مرة أو عشر مرات بنفس النتيجة. **لا يُنشئ EF Migrations أي جدول أبدًا**،
والـ API يرفض الإقلاع خارج Development على `EnsureCreated=true`.

```bash
sqlcmd -S "SERVER,1433" -U sa -P "PASSWORD" -f 65001 -I -b -i RUN-ON-SQL-SERVER.sql
sqlcmd -S "SERVER,1433" -U sa -P "PASSWORD" -d EdulinkDb -I -Q "SET NOCOUNT ON; SELECT edu_tables=(SELECT COUNT(*) FROM sys.tables WHERE name LIKE 'Edu[_]%'), edu_columns=(SELECT COUNT(*) FROM sys.columns c JOIN sys.tables t ON t.object_id=c.object_id WHERE t.name LIKE 'Edu[_]%'), edu_triggers=(SELECT COUNT(*) FROM sys.triggers tr JOIN sys.tables t ON t.object_id=tr.parent_id WHERE t.name LIKE 'Edu[_]%'), edu_checks=(SELECT COUNT(*) FROM sys.check_constraints cc JOIN sys.tables t ON t.object_id=cc.parent_object_id WHERE t.name LIKE 'Edu[_]%'), edu_fks=(SELECT COUNT(*) FROM sys.foreign_keys fk JOIN sys.tables t ON t.object_id=fk.parent_object_id WHERE t.name LIKE 'Edu[_]%'), edu_phone=(SELECT COUNT(*) FROM sys.columns c JOIN sys.tables t ON t.object_id=c.object_id WHERE t.name LIKE 'Edu[_]%' AND c.name='phone')"
```

- **الفلتر `LIKE 'Edu[_]%'` ليس تحسينًا — مقيس 2026-10-22 على قاعدة العميل:** العدّ بلا فلتر
  أعطى **637 جدولًا و8657 عمودًا** لأن المنصة تسكن قاعدة فيها تطبيق آخر، فالبصمة بلا حصر
  لا تُقارن بشيء وقد تُقرأ خضراء أو حمراء بغير سبب. (الملف نفسه آمن في القاعدة المشتركة
  لأنه محميّ بالأسماء: `IF OBJECT_ID(N'[dbo].[Edu_…]')` و`IF COL_LENGTH(...)`، فلا يلمس
  جدولًا غير `Edu_` ولا يُنشئ ما هو موجود.)

- **الأعلام ليست ترفًا:** `-f 65001` تقرأ الملف UTF-8 (بلاها تُحفَظ العربية `?` حرفيًا)، و`-I`
  تفعّل `QUOTED_IDENTIFIER` (بلاها يرفض المحرّك أي `INSERT/DELETE` يدوي على جداول `Edu_` لأن
  عليها فهارس مفلترة — `Msg 1934`)، و`-b` يجعل أي خطأ يخرج بكود غير صفري بدل الصمت.
- **البصمة المتوقعة:** 11 جدولًا · صفر تريجر · 21 فحصًا · 9 مفاتيح خارجية · 43 قيمة افتراضية ·
  8 قيود تفريد · **107 أعمدة** (منها 3 أعمدة `phone` مع 3 فهارس تفريد مفلترة على
  `Edu_Users`/`Edu_Students`/`Edu_Parents`).
- **مقيس (2026-10-21):** الملف المُسلَّم نفسه (لا مقتطف منه) شُغِّل **مرتين متتاليتين** على
  SQL Server بخروج **0 ثم 0**، والبصمة طابقت العدد كله ما عدا الأعمدة (كانت **104** قبل الهواتف)،
  ثم أُقفلت الحلقة في §4 بتشغيل الـ API على القاعدة التي أنشأها الملف وحده.
- **مقيس (2026-10-22 — وهو مسار التحديث على قاعدة موجودة):** على قاعدة أنشِئت من النسخة القديمة
  (104 أعمدة · صفر `phone`) شُغِّل **نفس الملف مرة واحدة** ⇒ خروج **0**، فأصبحت
  **107 أعمدة · 3 `phone` · 3 فهارس · 11 جدولًا** بلا فقدان بيانات. يعني هذا أن التسليم على
  `nile-old` لا يحتاج إسقاط القاعدة: **شغّل الملف مرة إضافية فقط**.
- **تفرّد الرقم مقيس أحمر/أخضر:** إدراج رقم مستعمل ⇒ `Msg 2601` وخروج **1**، و`NULL` و`''`
  مقبولان (الفهارس مفلترة) — فالحساب القديم بلا رقم لا يرفضه المخطط، أما **الإنشاء الجديد فيرفض
  بلا رقم** (400) ولا يسمح بتكرار رقم حساب آخر (409).
- **اسم القاعدة:** `EdulinkDb` (سطران في أول الملف يُعدَّلان مرة واحدة). لكل مؤسسة نسختها
  وقاعدتها المستقلة — لا تُشغَّل المنصة على قاعدة نظام آخر قائم.

### حساب دخول للمنصة لا `sa`

ملف المخطط لا يُنشئ Login (يبقى مصدر الأسرار خارج Git). على سيرفر العميل، من SSMS:

```sql
USE [master];
CREATE LOGIN [edulink] WITH PASSWORD = N'<كلمة-قوية>';
USE [EdulinkDb];
CREATE USER [edulink] FOR LOGIN [edulink];
ALTER ROLE [db_datareader] ADD MEMBER [edulink];
ALTER ROLE [db_datawriter] ADD MEMBER [edulink];
```

`db_datareader` + `db_datawriter` تكفيان فعلًا لأن التطبيق **لا يُنشئ ولا يُعدّل جداول**
(Migrations معطّلة بحاجز في `Program.cs`). أما `sa` فحساب على مستوى **النسخة كلها**: كلمة سر واحدة
تفتح كل قواعد العميل لا قاعدتها، والمنفذ 1433 يظل مكشوفًا للإنترنت من عربة Linux.
لا تُعطِ `db_owner` بلا سبب.

---

## 2) بناء الواجهة تحت بادئة النشر

`VITE_BASE_PATH` هو **وقت بناء** لا وقت تشغيل: يُخبَز داخل حزم JS، فتغييره بعد البناء لا يعمل —
يلزم بناء جديد ثم رفع `apps/web/dist`.

```bash
cp apps/web/.env.example apps/web/.env     # VITE_BASE_PATH=/edulink/
npm ci && npm run build                    # → apps/web/dist
```

| المصدر | النتيجة المقيسة (2026-10-21) |
|---|---|
| `apps/web/.env` بـ `VITE_BASE_PATH=/edufile/` | `dist/index.html` يشير `/edufile/assets/…` ✔ (`loadEnv` لا `process.env`) |
| متغيّر بيئة في الصدفة `/edulink/` | `/edulink/assets/…` ✔ ولوج CSS `/edulink/login-showcase.jpg` ✔ |
| بلا أي ضبط | `/assets/…` و`API_BASE_URL = ''` ✔ — التطوير والجذر لم يتغيّرا |

**ما يشتقّ تلقائيًا:** `lib/constants.ts` يبني `API_BASE_URL` من `BASE_URL` إن لم يُضبط
`VITE_API_BASE_URL`، فبناءٌ بـ `/edulink/` ينادي `/edulink/api/…` و`/edulink/hubs/…` بلا أي سطر
ثانٍ. البادئة يجب أن تساوي **حرفيًا** اسم `location` في `deploy/nginx-edulink.conf`.

**رفع المخرجات:** إلى `/home/YOUR-USER/edulink/web/` (مسار `alias` في بلوك nginx). الملفات نفسها
تُرفع كما هي — لا حاجة لأي بناء مختلف لكل وسيط.

⚠️ **على Windows/Git Bash:** المسار المبدوء بشرطة يُحوَّل (`/edulink` → `/Program Files/Git/edulink`)
فيبنى الموقع ببادئة خاطئة. اكتب البادئة في `apps/web/.env` (يُقرأ بلا تحويل)، أو استعمل
`MSYS_NO_PATHCONV=1 VITE_BASE_PATH=/edulink/ npm run build`.

---

## 3) الـ API كعملية مباشرة

```bash
dotnet publish apps/api/EduspaceApi.csproj -c Release -o tmp/publish   # على جهازك أو على العربة
# ثم انسخ tmp/publish/* إلى /opt/edulink/api/ و apps/api/.env إلى نفس المجلد (chmod 600)
sudo cp deploy/edulink-api.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now edulink-api && curl -s http://127.0.0.1:5279/api/health/db
```

- **`ASPNETCORE_URLS=http://127.0.0.1:5279`** في `.env`: الـ API لا يسمع من العامة، nginx هو
  المدخل الوحيد. بلا هذا السطر يرجع Kestrel إلى 5000 فيبدو الـ API ميتًا (مقيس — الخطوة 49).
- **`WorkingDirectory` في الـ unit ليس تجميلًا:** `Configuration/DotEnv.cs` يقرأ `.env` من مجلد
  التشغيل أولًا ثم من مجلد الـ dll، و`appsettings*.json` من مجلد المحتوى. بتشغيل الـ dll من مجلد
  آخر تُقرأ إعدادات لا علاقة لها بالملف الذي ملأته (فخّ مقيس في جلسة سابقة).
- **كل الأسرار في `apps/api/.env` وحده** (مستثنى من Git): `ConnectionStrings__SqlServer` بالسطر
  الوحيد الذي تحتاجه، والأولوية `متغيّرات البيئة > .env > appsettings*.json`.
- **مقيس (2026-10-21):** تشغيل `EduspaceApi.dll` من مجلد عمل نظيف **بلا أي `.env`** وبمتغيّرات
  بيئة فقط ⇒ `{"provider":"SqlServer","canConnect":true,"usesMigrations":false}` على قاعدة
  أنشأها `RUN-ON-SQL-SERVER.sql`، مع `appsettings.json` يقول `Sqlite`/`EnsureCreated=true` —
  فالملف/البيئة هما ما يربط، لا الكود.

بديل PM2 بنفس العقد تمامًا (لأن Nile Chat يشتغل بها):

```bash
cd /opt/edulink/api && pm2 start "dotnet EduspaceApi.dll" --name edulink-api && pm2 save
```

---

## 4) nginx: تضمين بلوكات `deploy/nginx-edulink.conf`

داخل بلوك `server {}` الموجود على العربة (نفس المكان الذي يُضمَّن فيه إعداد Nile Chat):

```nginx
include /etc/nginx/edulink.conf;      # = محتوى deploy/nginx-edulink.conf بعد تعديل 3 أشياء
```

الثلاثة: اسم البادئة `/edulink` (مطابق لـ `VITE_BASE_PATH`)، ومجلد `web`، ومنفذ `127.0.0.1:5279`.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**ماذا يحدث في كل بلوك:** `/edulink/api/…` يُجرَّد إلى `/api/…` عند الـ API (فلا `PathBase` في
الكود)، و`/edulink/hubs/…` يُمرَّر بترقية WebSocket حقيقية (`Upgrade`/`Connection` +
`proxy_read_timeout 100s` لأن KeepAlive=15 ث)، وروابط SPA العميقة (`/edulink/reports`) ترجع
`index.html` من التطبيق نفسه لا 404 من nginx، وترويسات الأمان + كاش الأصول انتقلت من
`vercel.json` إلى هنا.

**مع الوسيط يجب أن يبقى في `.env`:**

```
Network__UseForwardedHeaders=true
Network__ForwardedHeadersLimit=1
Network__TrustAllProxies=true
```

`ForwardedHeadersLimit=1` = وسيط واحد مأمون. **ارفعه إلى 2 فقط** لو أضفت CDN أمام nginx؛ رفعه
بلا داعٍ يجعل العميل يفتح حزنة حدّ جديدة بكل `X-Forwarded-For` مزوَّرة — مقيس: حدّ 4 ⇒ **صفر 429**
على 130 محاولة بتزوير مختلف، وحدّ 1 ⇒ **429 عند المحاولة 121**.

### الإثبات الكامل على هذا الشكل (2026-10-21، مقاس لا موصوف)

شغّل `node tools/edge-proxy.mjs --listen 8080 --api http://127.0.0.1:5279 --prefix /edulink`
(يحاكي نفس عقد بلوكات nginx، بما فيها تجريد البادئة وترقية WebSocket):

- أصول ثابتة تحت البادئة كلها **200**: `/edulink/`، `/edulink/reports` و`/edulink/students/12`
  (SPA fallback)، `assets/*.js|css`، `fonts/fonts.css`، `fonts/cairo-arabic.woff2`،
  `manifest.webmanifest`، `icons/icon-192.png`، `login-showcase.jpg`؛ وخارج البادئة **404**.
- `node tools/hub-through-proxy-check.mjs --proxy http://localhost:8080/edulink` ⇒ **خروج 0**:
  تكويد وحصة عبر REST، اتصالان مُرقَّيان إلى WebSocket في نفس الغرفة، رسالة مستقبَلة، والدور
  محسوب من القاعدة (مطالعة `teacher` من غير مدرس الحصة رجعت `observer`).
- **البناء الإنتاجي نفسه في متصفح حقيقي:** من `/edulink/` إلى `/edulink/home`، و`/edulink/api/auth/login`
  ثم `sessions`/`students`/`users`/`parents`/`reports/overview` كلها **200**، والخط يُنزَّل من
  `/edulink/fonts/…`. **بلا أي إعداد CORS** — نفس الأصل.
- ⚠️ الفخّ الذي لازم القياس أول محاولة: `--prefix /edulink` على Git Bash يُحوَّل إلى
  `/Program Files/Git/edulink` فيردّ الوسيط 404 على كل شيء. شغّله بـ `MSYS_NO_PATHCONV=1`.

---

## 5) أول حساب مالك (مرة واحدة على قاعدة فارغة)

```bash
printf '{"name":"مالك المنصة","email":"OWNER@DOMAIN","password":"<كلمة-قوية>"}' > owner.json
curl -sS -X POST https://YOUR-DOMAIN/edulink/api/setup/owner -H "Content-Type: application/json" --data-binary @owner.json
rm owner.json
```

- `POST /api/setup/owner` يعمل **مرة واحدة فقط** على قاعدة فارغة، ثم يُقفل.
- ⚠️ **العربية لا تُرسَل في وسائط الأوامر على Windows/Git Bash:** `curl` يحوّل الوسائط إلى cp1252
  فيُخزَّن الاسم `?`. على Linux curl لا يمسّ الوسائط، لكن الأسلم دائمًا الجسم من ملف UTF-8 بـ
  `--data-binary @owner.json` لا `-d` (وهذا ما يفعله `deploy/run.sh`).

---

## 6) التشفير — مقيس لا مُخمَّن (2026-10-18، على `nile-server.com,1433`)

**`Encrypt=True;TrustServerCertificate=True` أتمّ مصافحة TLS** والفشل الوحيد كان
`Error 18456, State:1 — Login failed for user 'sa'` أي كلمة السر. فالعبارة التي كانت مكتوبة في
ثلاث وثائق («السيرفر يرفض المصافحة ⇒ لازم `Encrypt=False`») **منتَقدة ومُصحَّحة**. الرتبة:

1. **المستهدف للتسليم:** TLS 1.2 على SQL Server + شهادة موثوقة ⇒ `Encrypt=True;TrustServerCertificate=False`.
2. **كما هو الآن:** `Encrypt=True;TrustServerCertificate=True` — مشفَّر **بلا تحقّق** من هوية
   السيرفر (محمي من القراءة لا من الانتحال)، واللوج يطبع `negotiated TLS 1.0 is an insecure protocol`.
3. **بديل مكافئ الأمن:** نفق مُؤمَّن بين الـ API والقاعدة مع إبقاء 1433 بعيدًا عن العامة.
4. **مرفوض:** `Encrypt=False` والقاعدة تعبر الإنترنت — اسم المستخدم وكل صف بلا تشفير.

الـ API لا يضيف أيًّا من هذه الأعلام صمتًا (`ConnectionStringNormalizer` يضبط المهلة وMARS فقط):
**الترخيص الأمني قرار إنسان**. لاحظ أن الـ API الآن على عربة Linux والقاعدة على عربة Windows ⇒
العبور عبر الإنترنت حتمي، فلا تُرخَّص إلا الرتبة 1 أو 2 أو نفق في الرتبة 3.

---

## 7) بوابات ما بعد النشر — الترتيب إلزامي

لا تُقرأ أي بوابة خضراء قبل تشغيل **حالة حمراء واحدة** عليها (القاعدة التي وُلّدت من بوابة
كذّبت نفسها). وشغّلها بالترتيب، لأن التحقق نفسه يترك حسابات اختبار في القاعدة:

```bash
BASE=https://YOUR-DOMAIN/edulink
python tools/verify-xff-spoof.py                 # تزوير X-Forwarded-For لا يفتح حزنة جديدة
python tools/verify-rate-limits.py               # الطبقات الثلاث + القفل لكل حساب
python tools/verify-production-flow.py           # الدورة الوظيفية كاملة على الرابط العام
python tools/verify-ice-turn.py green            # توقيع TURN مطابق لما يفحصه coturn
python tools/verify-default-credentials.py       # كل كلمة سر موثّقة في المستودع ⇒ مرفوضة
python tools/verify-no-dev-data.py               # لا بصمات زرع (@edulink.test / seed_dev)
node tools/hub-through-proxy-check.mjs --proxy $BASE
```

ثم الترتيب المُسلَّم للتسليم النهائي (مقيس في الخطوة 45 — جولة التحقق تترك **14 حساب
`@edulink.test` بنفسها**):

1. البوابات أعلاه ⇒ كلها خضراء.
2. **احذف** حسابات التحقق بـ **`deploy/cleanup-verification-data.sql`** (الترتيب اليدوي عبر
   `sys.foreign_keys` صار داخل الملف: رسائل ⇒ أعضاء ⇒ محادثات ⇒ حضور ⇒ حصص ⇒ إشعارات ⇒ توكنات
   ⇒ علاقات ⇒ أولياء ⇒ طلاب ⇒ موظفون) ثم `DELETE FROM dbo.[Edu_Tokens];`:
   ```bash
   sqlcmd -S "SERVER,1433" -U sa -P "PASSWORD" -d EdulinkDb -f 65001 -I -b \
          -i deploy/cleanup-verification-data.sql
   ```
   **مقيس الوجهين (2026-10-22):** أخضر على قاعدة فيها صفوف حقيقية (المدير والأدوار المحفوظة
   بـ `role <> 3` تعيش، والبصمات تذهب)، وأحمر على حالة مُلفَّقة عمدًا ⇒ `RAISERROR 50000` مع
   **`ROLLBACK` كامل** وصفر تغييرات — فالمدرّس الحقيقي لم يُمَسّ حين أُبطِلت الجولة.
3. **دوّر** كلمة سر المالك وأنشئ حسابات المؤسسة الحقيقية من الشاشات.
4. أعد `verify-default-credentials.py` و`verify-no-dev-data.py` — ويجب أن تكونا **خضراوين**.

بند §7-أ من قائمة التسليم القديمة لا يزال إلزاميًا: تغيير كلمة سر مستخدم يبقي توكن جهازه القديم
صالحًا حتى تُصفّى `Edu_Tokens` (الموضع موثّق في `docs/11` §7)، والإصلاح الأوتوماتيكي ينتظر «ابدأ».

**أين `tools/verify-external-deploy.py`؟** هي بوابة **شكل الأصلين** (واجهة على أصل وAPI على أصل،
تقيس https + شهادة موثَّقة + CORS + ترقية WebSocket محسوبة). على هذا الشكل (نفس الأصل) لا عمل
 لها؛ احتفظ بها ليوم يُنقل الـ API إلى وسيط منفصل، وعندها تُفعَّل مع `Cors__Origins__n`.

---

## 8) ما لا تزال العربة المشتركة لا تعطيه

1. **coturn / الوسائط خلف NAT صارم:** محتاج **مدى بوابات UDP** (3478 + 49160-49200 كما في
   `deploy/turnserver.conf`) مفتوحًا في جدار نار المستضيف. على استضافة مشتركة هذا غالبًا مغلق
   ⇒ عربة مستقلة للـ TURN. `Meeting__TurnUrls__*` و`Meeting__TurnSecret` في `.env`، وسرّ مطابق
   لـ `static-auth-secret`، ثم قياس من **شبكتين مختلفتين** (لا تقدر أي أداة على إثبات وسائط فعلية
   من جهاز واحد). **الغرفة تعرض تنبيهًا صريحًا أنها تعمل بـ STUN العام فقط** إن لم تُقرأ إعدادات TURN.
2. **إعادة قياس الحمل على النشر الحقيقي:** الرقم المرجعي **2000 حصة = 4000 اتصال، صفر فقدان**
   مقيس على جهاز تطوير ⇒ `node tools/loadtest/meeting-loadtest.mjs --rooms 1000 --peers 2 --hold 60`
   ضد `https://YOUR-DOMAIN/edulink` مع مراقبة 301 اتصال قاعدة مفتوح.
3. **النسخ الاحتياطي عند مصدر القاعدة:** `deploy/backup.sql` + `deploy/restore-drill.sql StrictLive=1`
   على سيرفر SQL Server نفسه (الإجراء في `docs/11` §9) — لا نسخة تُقرأ خضراء بلا استعادة مُجرَّبة.
4. **حدود الواجهة المحلية:** هوية white-label (اسم المؤسسة ولوجوها)، التفضيلات، ملاحظات المتابعة،
   والدخول برقم الهاتف — لا نقاط نهاية لها بعد (`docs/04` الخطوة 51).
5. **قاعدة الـ API من عربة Linux إلى SQL Server Windows تعبر الإنترنت:** لا 1433 مكشوف بلا
   Firewall، والتشفير بالرتبة §6. لو أمكن نقل الـ API إلى نفس عربة القاعدة يصير الاتصال `localhost`
   وتقفل تلك العبور كلها — وهذا هو الفرق العملي الذي كان يجعل `deploy/run.sh` على عربة واحدة هو الأكمل.

---

## 9) الأداء والأصول — ما هو مُنفَّذ فعلًا

| البند | قبل | بعد |
|---|---|---|
| الخطوط | طلب خارجي إلى Google Fonts | **3 ملفات محلية** من نفس الأصل، متغيّرة 400–800، `font-display: swap` |
| طلب الخط | 8 ملفات محتملة | **ملف واحد** للغة المستخدمة، عبر `preload` في `<head>` |
| صورة اللوحة على الجوال | تُنزَّل رغم إخفاء اللوحة (125KB هدر) | خلفية CSS داخل لوحة مخفية → **لا تُنزَّل** |
| LCP (صورة اللوحة) | بعد تنزيل JS وترتيب React | `preload` + `fetchpriority=high` بالتوازي مع JS (ديسكتوب فقط) |
| وميض الثيم / انقلاب الاتجاه | بعد التحميل | يُطبَّقان **قبل أول رسم** من سكربت مضمّن |
| أصول ثابتة الاسم | كاش قصير | `Cache-Control: immutable` للأصول الموقّعة ببصمة المحتوى (من `vercel.json` إلى `nginx-edulink.conf`) |
| مسارات الأصول تحت بادئة النشر | `/fonts/…` تخرج من مجلد التطبيق | `base` في Vite + `url()` نسبي في `public/fonts/fonts.css` + `manifest` نسبي (`./`) |

**حجم الصفحة عند أول زيارة (عربي، ديسكتوب):** ≈ 89KB JS + 3.8KB CSS + 1KB CSS خطوط + 64KB خطوط +
125KB صورة + 46KB شعار ≈ **330KB** قبل الضغط. (على nginx فعّل `gzip`/`brotli` للنصوص — لم يكن
Brotli تلقائيًا كما في المضيف السابق.)

## 10) التحقق بعد النشر

1. افتح `https://YOUR-DOMAIN/edulink/` — يجب أن **لا** يُعاد توجيهك إلى جذر الدومين، ويجب أن
   يظهر الخط المستضاف محليًا لا خط النظام.
2. بدّل اللغة والمظهر — يعملان والاتجاه ينقلب فورًا، والرابط يبقى داخل `/edulink/…`.
3. DevTools → Network: `/edulink/fonts/*.woff2` و`/edulink/assets/*` من نفس النطاق؛ أي نداء على
   `/api/…` بلا البادئة = بناء بـ `VITE_BASE_PATH` خاطئ.
4. `curl -I https://YOUR-DOMAIN/edulink/assets/<ملف>.js` — يجب أن ترى `cache-control: … immutable`
   و`x-content-type-options: nosniff` (هذه الترويسات **لم تُقَس على العربة بعد**: نقلناها نصًّا من
   `vercel.json`، فقيسها هناك أول مرة).
5. ادخل بحساب حقيقي وافتح حصة: الغرفة يجب أن تُظهر **2** participant ورسالة الطرف الثاني؛ وإن
   ظهر تنبيه «STUN العام فقط» فذلك §8-1 ولم يُخفَ عنك.
6. `npm run lint` و`npm run check:i18n` و`npm run build` = صفر قبل أي تسليم.
