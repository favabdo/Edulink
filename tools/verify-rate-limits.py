# -*- coding: utf-8 -*-
"""
التحقق من طبقتَي حماية الدخول في الإنتاج (الـ API يعمل في بيئة Production):

  الطبقة 1 — حدّ **لكل IP** (`RateLimit:LoginPermitPerMinute`، افتراضي 120/دقيقة):
    نُجري المحاولات على **بريد مختلف في كل محاولة** حتى لا تتدخل الطبقة 2،
    فيُقاس حدّ الـ IP وحده.

  الطبقة 2 — قفل **لكل حساب** (`LoginFailuresPerAccount=8` داخل `LoginLockoutMinutes=5`):
    نُجري المحاولات على **حساب واحد من عناوين IP مختلفة كثيرة** — لو كانت الحماية
    بالـ IP وحدها لما حدث شيء؛ هنا يظهر أن الحساب نفسه هو المقفول.

  الطبقة 3 — حدّ **لكل جلسة** على بقية `/api` (`ApiPermitPerMinute=600`):
    جلسة واحدة تستنفد حصّتها، والجلسة الأخرى على نفس الـ IP تظل تعمل.

لماذا التفريق؟ لأن مدرستنا كاملة تدخل من NAT واحد عند بداية اليوم،
ولأن مهاجمًا يوزّع طلباته على عشرات العناوين لا يصطدم بحدّ الـ IP أبدًا.

التشغيل (من جذر المستودع، الـ API على 5279):
    python tools/verify-rate-limits.py
ويكتب النتيجة في tools/out-rate-limits.txt
"""
import io
import json
import random
import time
import urllib.error
import urllib.request

import os

BASE = os.environ.get("EDULINK_API_URL", "http://localhost:5279")
OWNER_EMAIL = os.environ.get("EDULINK_OWNER_EMAIL", "owner@edulink.test")
OWNER_PASSWORD = os.environ.get("EDULINK_OWNER_PASSWORD", "Owner@12345")
LOGIN_LIMIT = 120        # RateLimit:LoginPermitPerMinute
API_LIMIT = 600          # RateLimit:ApiPermitPerMinute
ACCOUNT_LIMIT = 8        # RateLimit:LoginFailuresPerAccount
out = []


def log(line):
    out.append(line)
    print(line)


def need_token(label, payload):
    """فشل نظيف بدل Traceback لو لم يُرجع الدخول توكنًا (كلمة سر خاطئة/حساب مقفول)."""
    if not isinstance(payload, dict) or not payload.get("token"):
        print(f"فشل التحقق: {label} لم يُرجع توكن — {str(payload)[:160]}")
        raise SystemExit(1)
    return payload["token"]


def call(method, path, body=None, token=None, xff=None):
    """يُرجع (الكود، ترويسة Retry-After، الجسم المُحلَّل)."""
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if xff:
        req.add_header("X-Forwarded-For", xff)
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data) as res:
            raw = res.read().decode("utf-8")
            return res.status, res.headers.get("Retry-After"), (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, e.headers.get("Retry-After"), json.loads(raw)
        except Exception:
            return e.code, e.headers.get("Retry-After"), {"raw": raw[:160]}


SUF = str(random.randint(1000, 9999))
# الإنشاء بلا رقم هاتف يُرفض الآن، وعلى الرقم فهرس فريد — فلكل تشغيل أرقام جديدة
_PH = random.randint(100000, 999999)


def phone(slot: int) -> str:
    return f"+201{_PH}{slot}"

IP_OWN = f"203.0.113.{random.randint(10, 90)}"

_, _, owner = call("POST", "/api/auth/login", {"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, xff=IP_OWN)
tok = need_token("دخول المالك", owner)
log(f"دخول المالك -> 200 | بصمة التوكن {owner['token'][:8]}…")
log("")

# ── الطبقة 1: حدّ الـ IP (بريد مختلف في كل محاولة ⇒ القفل لكل حساب لا يتدخل) ──
# عناوين عشوائية: النافذة دقيقة، والتكرار الفوري بنفس العنوان يرث حصّة منقوصة
# فتفشل المطابقة على سبب لا علاقة له بالسيرفر.
BRUTE_IP = f"203.0.113.{random.randint(1, 99)}"
OTHER_IP = f"203.0.114.{random.randint(1, 99)}"
first_429 = None
accepted = 0
for i in range(LOGIN_LIMIT + 8):
    c, _, _ = call("POST", "/api/auth/login",
                   {"email": f"guess{i}-{SUF}@nowhere.test", "password": "Wrong@12345"}, xff=BRUTE_IP)
    if c == 429:
        first_429 = i + 1
        break
    accepted += 1
other_c, _, _ = call("POST", "/api/auth/login",
                     {"email": f"other-{SUF}@nowhere.test", "password": "Wrong@12345"}, xff=OTHER_IP)
log(f"1) حدّ الـ IP: {accepted} محاولة مقبولة من {BRUTE_IP} ثم 429 عند {first_429} (الحد {LOGIN_LIMIT})")
log(f"   عنوان IP آخر في نفس الدقيقة: {other_c} ← لا يتأثر")
log("")

# ── الطبقة 2: قفل لكل حساب (نفس الحساب من عناوين كثيرة) ──
victim = f"lockvictim{SUF}@edulink.test"
bystander = f"lockbystander{SUF}@edulink.test"
for addr, slot in ((victim, 1), (bystander, 2)):
    call("POST", "/api/users",
         {"name": f"حساب اختبار {addr[4:9]}", "email": addr, "password": "Probe@12345", "role": 0,
          "phone": phone(slot)}, tok, IP_OWN)

codes = []
retry_after = None
first_lock = None
for i in range(20):
    ip = f"192.0.2.{30 + i}"          # كل محاولة من عنوان مختلف تمامًا
    c, ra, _ = call("POST", "/api/auth/login", {"email": victim, "password": f"Guess#{i}"}, xff=ip)
    codes.append(c)
    if c == 429 and first_lock is None:
        first_lock = i + 1
        retry_after = ra
log(f"2) قفل الحساب: 20 محاولة على {victim} من 20 عنوانًا مختلفًا")
log(f"   النتيجة: {codes}")
log(f"   أول 429 عند المحاولة {first_lock} (الحد {ACCOUNT_LIMIT}) — Retry-After = {retry_after} ثانية")

c_by, _, _ = call("POST", "/api/auth/login", {"email": bystander, "password": "Probe@12345"}, xff="192.0.2.99")
log(f"   حساب آخر بينما الضحية مقفولة: {c_by} ← يجب 200")

c_right, ra_right, _ = call("POST", "/api/auth/login", {"email": victim, "password": "Probe@12345"}, xff="192.0.2.98")
log(f"   كلمة الضحية **الصحيحة** أثناء القفل: {c_right} (Retry-After={ra_right}) ← القفل على الحساب لا على الكلمة")
log("")

# ── الطبقة 3: حدّ لكل جلسة على بقية /api ──
student = f"sess{SUF}@edulink.test"
call("POST", "/api/students", {"name": "طالب اختبار الجلسة", "email": student,
                               "password": "Nour@12345", "states": 1, "access": 1,
                               "phone": phone(3)}, tok, IP_OWN)
_, _, stu = call("POST", "/api/auth/students/login", {"email": student, "password": "Nour@12345"}, xff="203.0.113.210")
stok = need_token("دخول الطالب", stu)

def align_window(probe):
    """النافذة الثابتة هنا مرتبطة بحركة هذا التوكن نفسه لا ببداية الدقيقة
    (مقيس: انتظار `time % 60` أعطى 597 لا 600). فبدل التخمين نلتقط فتح النافذة
    من السلوك: (١) نُشبع الحزنة حتى أول 429، (٢) ننتظر أول طلب **مقبول** بعد ذلك —
    وهذا الطلب هو أول المحاولات في النافذة الجديدة بالذات، فيُحسب المحاولة ١."""
    for _ in range(API_LIMIT + 60):
        if probe()[0] == 429:
            break
    t_wait = time.time()
    while time.time() - t_wait < 75:
        if probe()[0] != 429:
            return 1                       # هذه أول محاولة في النافذة الجديدة
        time.sleep(0.2)
    return 0


probe_session = lambda: call("GET", "/api/notifications?take=1", token=tok, xff=IP_OWN)
used = align_window(probe_session)
blocked_at = None
drifted = False
t0 = time.time()
if used:
    for i in range(API_LIMIT + 20):
        c, _, _ = probe_session()
        if c == 429:
            blocked_at = i + 2             # + المحاولة التمهيدي في نفس النافذة
            break
        used += 1
        if time.time() - t0 > 50:
            drifted = True                 # الجهاز أبطأ من النافذة ⇒ العدّ لا يصلح حكمًا
            break
c_other_session, _, _ = call("GET", "/api/notifications?take=1", token=stok, xff=IP_OWN)
log(f"3) حدّ الجلسة: {used} طلبًا مقبولًا من أول محاولة في النافذة ثم 429 عند المحاولة {blocked_at}")
log(f"   (الحصّة {API_LIMIT}/دقيقة لكل جلسة — نافذة ثابتة، والعدّ يبدأ من boundary جديد)")
if drifted:
    log("   ! الحلقة تجاوزت 50 ثانية على هذا الجهاز: النافذة قد تتجدد أثناء العدّ ⇒ لا حكم")
log(f"   جلسة طالب آخر على نفس IP: {c_other_session} ← يجب 200")
log("")

_, _, health = call("GET", "/api/health/db")
log(f"4) صحة القاعدة: {json.dumps(health, ensure_ascii=False)[:160]}")

io.open("tools/out-rate-limits.txt", "w", encoding="utf-8").write("\n".join(out))

# run.sh يقرأ كود الخروج وحده — فلا معنى لـ «نجح» إن لم تفشل الأداة عند انحراف السلوك
failures = []
if first_429 != LOGIN_LIMIT + 1:
    failures.append(f"حدّ الـ IP: أول 429 عند {first_429}، والمتوقع {LOGIN_LIMIT + 1}")
if other_c == 429:
    failures.append("عنوان IP آخر تأثر بحدّ العنوان الأول — تجزئة الـ IP معطلة")
if first_lock != ACCOUNT_LIMIT + 1:
    failures.append(f"قفل الحساب: أول 429 عند {first_lock}، والمتوقع {ACCOUNT_LIMIT + 1}")
if c_by != 200:
    failures.append(f"حساب شاهد لم يدخل أثناء قفل غيره (جاء {c_by}) — القفل ليس لكل حساب")
if c_right != 429:
    failures.append(f"قُبلت كلمة صحيحة أثناء القفل (جاء {c_right}) — القفل لا يُطبَّق")
if drifted:
    failures.append("تعذّر عدّ حزنة الجلسة: الحلقة تجاوزت 50 ثانية ⇒ النافذة تتجدد أثناء العدّ على هذا الجهاز — لا تُحسب نجاحًا")
elif used == 0:
    failures.append("حدّ الجلسة لم يُختبر: الحزنة بدت مشبعة في أربع دقائق متتالية — أداة أخرى تستخدم نفس التوكن؟")
elif blocked_at != API_LIMIT + 1 or used != API_LIMIT:
    failures.append(f"حدّ الجلسة لم يقع عند {API_LIMIT} بالضبط: مقبول={used} وأول 429 عند {blocked_at}")
if c_other_session == 429:
    failures.append("جلسة أخرى على نفس IP تأثرت — حدّ الجلسات يُطبَّق بالـ IP بدل التوكن")
if not (health or {}).get("canConnect"):
    failures.append("القاعدة غير متصلة")

print("\nالناتج مكتوب في tools/out-rate-limits.txt")
if failures:
    print("فشل " + str(len(failures)) + " تحقق:")
    for item in failures:
        print("  - " + item)
    raise SystemExit(1)
print(f"الطبقات الثلاث تحققت: IP عند {first_429} · حساب عند {first_lock} · جلسة عند {blocked_at}")
