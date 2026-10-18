# -*- coding: utf-8 -*-
"""
فيريفاير طبقة الوسيط: هل يسري حدّ الدخول على **العنوان الذي أضافه الوسيط** أم
على قيمة `X-Forwarded-For` التي يكتبها العميل بنفسه؟ الثانية تعني أن أي مهاجم
يفتح حزنة جديدة لكل محاولة فيتجاوز `RateLimit:LoginPermitPerMinute` بالكامل.

يُشغَّل عبر الوسيط لا على الـ API مباشرة (`deploy/nginx.conf` أو `tools/edge-proxy.mjs`)،
لأن قياس حدّ الـ IP عبر وسيط هو بالضبط ما لا تستطيع أدوات التمويه الأخرى قياسه.

  python tools/verify-xff-spoof.py green    # الضبط الصحيح: LIMIT مقبولة ثم 429 رغم ترويسة مزوَّرة مختلفة كل مرة
  python tools/verify-xff-spoof.py red      # إعداد خاطئ عمدًا (Network__ForwardedHeadersLimit أكبر من عدد وسائطك)
                                            # ⇒ يُتوقع صفر 429؛ يظهر أن الحارس يعمل لأنه يفشل عند غيابه

المتغيّرات: EDULINK_BASE (http://localhost:8080) · EDULINK_LOGIN_LIMIT (120) · EDULINK_OUT (tools)
تنتظر الأداة نافذة نظيفة أولًا (الحزنة قد تكون مستهلكة من خطوة سابقة في البوابة)، وتحكم على
**عدد المقبول** لا على مجرد ظهور 429 — فلا تمرّ عند 429 مبكر ولا عند نافذة تتجدد أثناء العدّ.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("EDULINK_BASE", "http://localhost:8080").rstrip("/")
LIMIT = int(os.environ.get("EDULINK_LOGIN_LIMIT", "120"))
MODE = (sys.argv[1] if len(sys.argv) > 1 else "green").lower()
SUF = "%s-%s" % (os.getpid(), os.environ.get("EDULINK_XFF_RUN", ""))
out = []


def attempt(xff, i):
    req = urllib.request.Request(BASE + "/api/auth/login", method="POST")
    req.add_header("Content-Type", "application/json")
    if xff is not None:
        req.add_header("X-Forwarded-For", xff)
    body = json.dumps({"email": f"xffprobe{SUF}-{i}@nowhere.test",
                       "password": "Wrong@12345"}).encode()
    try:
        with urllib.request.urlopen(req, data=body) as res:
            return res.status
    except urllib.error.HTTPError as e:
        return e.code
    except OSError as e:
        print(f"لا يمكن الوصول إلى {BASE}: {e}", flush=True)
        raise SystemExit(2)


SATURATED = "saturated"        # الحزنة مشبعة من خطوة سابقة:جهل لا نتيجة


def measure(run):
    """عدّ المقبول حتى 429، وكل محاولة تحمل `X-Forwarded-For` مزوَّرًا مختلفًا."""
    global SUF
    SUF = "p%s-%s" % (os.getpid(), run)          # بريد جديد لكل جولة: لا تتراكم محاولات على نفس الحساب
    if attempt("198.51.100.250", -1) == 429:
        return SATURATED                          # بقايا نافذة سابقة — لا حكم
    accepted, first_429_at, n = 1, None, 0        # المحاولة التمهيدية أُخذت من النافذة نفسها
    started = time.time()
    while accepted < LIMIT + 20:
        n += 1
        c = attempt("198.51.100.%d" % (n % 250), n)
        if c == 429:
            first_429_at = n
            break
        accepted += 1
    return {"accepted": accepted, "first429": first_429_at,
            "elapsed": time.time() - started, "rolled": (time.time() - started) >= 55}


# 0) نافذة كاملة فقط: بقايا نافذة سابقة (أو أداة أخرى في نفس الدقيقة) تعطي عدًّا ناقصًا
res = accepted = first_429_at = None
elapsed = rolled = False
for run in range(3):
    res = measure(run)
    if res == SATURATED:
        reason = "الحزنة كانت مشبعة من خطوة سابقة"
    elif res["first429"] is None:
        break                                     # لا 429 طوال LIMIT+10: هذا هو تجاوز الحدّ
    elif res["accepted"] == LIMIT and not res["rolled"]:
        break                                     # نافذة كاملة نظيفة
    else:
        reason = "النافذة كانت مبتدئة جزئيًا (مقبول %s من %s)" % (res["accepted"], LIMIT)
    if run < 2:
        out.append(f"• {reason} — انتظرنا النافذة التالية")
        time.sleep(61 - (time.time() % 60))
else:
    out.append("✗ لم نحصل على نافذة كاملة بعد ثلاث محاولات — راجع من يستهلك حزنة الدخول على هذا العنوان.")
    print("\n".join(out), flush=True)
    raise SystemExit(2)

accepted, first_429_at = res["accepted"], res["first429"]
elapsed, rolled = res["elapsed"], res["rolled"]

# 2) بلا أي ترويسة من العميل: الوسيط وحده يضيف قيمته — يجب أن تقع في نفس الحزنة
c_plain = attempt(None, LIMIT + 900)
# 3) قيمة مزوَّرة ثابتة مغايرة — لا يجوز أن تفتح حزنة جديدة
c_fixed = attempt("192.0.2.77", LIMIT + 901)

out.insert(0, f"الوضع: {MODE} | الوسيط: {BASE} | حدّ الدخول لكل IP: {LIMIT}")
out.insert(1, f"1) محاولات بتزوير مختلف ⇒ مقبول {accepted}، أول 429 عند المحاولة {first_429_at} "
              f"(العدّ استغرق {elapsed:.0f} ث)")
out.insert(2, f"2) محاولة بلا ترويسة من العميل -> {c_plain}")
out.insert(3, f"3) محاولة بقيمة مزوَّرة ثابتة 192.0.2.77 -> {c_fixed}")
out.insert(4, "")

ok = True
if MODE == "green":
    if rolled:
        out.append("الحكم ✗: امتدّ العدّ فوق 55 ثانية فالنافذة تتجدد أثناء القياس — أعد التشغيل.")
        ok = False
    elif first_429_at is None:
        out.append(f"الحكم ✗: صفر 429 بعد {accepted} محاولة على نفس العنوان المضاف ⇒ الحزنة تُبنى على "
                   "ترويسة العميل والحدّ قابل للتجاوز بتزوير X-Forwarded-For.")
        ok = False
    elif accepted != LIMIT:
        out.append(f"الحكم ✗: القبول توقف عند {accepted} لا عند الحدّ المضبوط {LIMIT} — راجع "
                   "`RateLimit:LoginPermitPerMinute` وتأكد أن الأداة تعمل عبر الوسيط لا على الـ API مباشرة.")
        ok = False
    elif c_plain != 429:
        out.append("الحكم ✗: محاولة بلا ترويسة لم تُرفض والحزنة مشبعة ⇒ مفتاح الحزنة ليس عنوان الوسيط.")
        ok = False
    else:
        out.append(f"الحكم ✓: {LIMIT} مقبولة بالضبط ثم 429، و120 ترويسة مزوَّرة مختلفة لم تفتح حزنة "
                   "جديدة، والمحاولة بلا ترويسة وقعت في نفس الحزنة ⇒ التزوير لا يشتري أي شيء.")
elif MODE == "red":
    if first_429_at is not None:
        out.append("الحكم ✗: الفيريفاير لا يميّز — ظهر 429 في وضع يُتوقع فيه تجاوز كامل.")
        ok = False
    else:
        out.append(f"الحكم ✓ (هذا هو الفشل المطلوب): {accepted} محاولة مقبولة بلا أي 429 رغم أن الحدّ "
                   f"{LIMIT} ⇒ كل ترويسة مزوَّرة فتحت حزنة جديدة. السبب أن `Network:ForwardedHeadersLimit` "
                   "أكبر من عدد وسائطك الحقيقي؛ القيمة الصحيحة لوسيط واحد هي 1.")
else:
    out.append(f"الحكم ✗: وضع غير معروف `{MODE}` — استخدم green أو red.")
    ok = False

text = "\n".join(out)
print(text, flush=True)
with open(os.path.join(os.environ.get("EDULINK_OUT", "tools"), "out-xff-spoof.txt"), "w",
          encoding="utf-8") as f:
    f.write(text + "\n")
if not ok:
    raise SystemExit(1)
