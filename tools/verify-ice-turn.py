# -*- coding: utf-8 -*-
"""
فيريفاير إعداد الخطة الباردة (ICE/TURN): هل التوكن الذي يرسله الـ API للمتصفح
يقبله خادم coturn فعلًا؟

الجواب يعتمد على خوارزميةTURN REST API حرفيًا:
    username   = "<unix expiry>:<user id>"
    credential = base64(HMAC-SHA1(shared_secret, username))
أي انحراف في ترتيب الحقول أو في الترميز (base64 مقابل hex) أو في السلسلة المُوقَّعة
يعني أن كل مكالمة على شبكة NAT صارمة سترفضها TURN، بينما تعمل الغرف على Wi‑Fi المنزلي —
وهو فشل يظهر عند العميل لا عندنا. لذلك يُعاد حساب التوقيع هنا بمسار مستقل (`hmac`/`hashlib`
في معيار Python) ويقارن بما أرسله الخادم.

يُقرأ الإعداد الذي شُغِّل به الـ API من نفس متغيّرات البيئة، فيُثبت أن **سرّ coturn
وسرّ الـ API متطابقان** — وهو أكثر خطأ شائع عند تهيئة خادم جديد.

  python tools/verify-ice-turn.py green   # الوضع الصحيح: متوقع تطابق التوقيع ومنفذ بلا توكن = 401
  python tools/verify-ice-turn.py red     # إثبات أن الفيريفاير يفشل فعلًا:
        شغّل الـ API بـ Meeting__TurnSecret مختلف عن EDULINK_TURN_SECRET
        هنا يُعدّ كشفُ عدم التطابق نجاحًا (يخرج 0)، ومرورُهُ أخضرًا يعني أن المقارنة لم تتم

المتغيّرات:
  EDULINK_API_URL        (افتراضي http://localhost:5279)
  EDULINK_OWNER_EMAIL    (افتراضي owner@edulink.test)
  EDULINK_OWNER_PASSWORD (افتراضي Owner@12345)
  EDULINK_TURN_URLS      سلسلة TURN المتوقعة، مفصولة بفواصل إن تعددت (لا شيء = وضع STUN فقط)
  EDULINK_TURN_SECRET    سرّ use-auth-secret في coturn
  EDULINK_TURN_TTL       عمر التوكن بالثواني (افتراضي 86400، نفس افتراضي الـ API)
يخرج non-zero عند أي نتيجة contradicting للوضع المطلوب، ويكتب tools/out-ice-turn.txt.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("EDULINK_API_URL", "http://localhost:5279").rstrip("/")
MODE = (sys.argv[1] if len(sys.argv) > 1 else "green").lower()
EMAIL = os.environ.get("EDULINK_OWNER_EMAIL", "owner@edulink.test")
PASSWORD = os.environ.get("EDULINK_OWNER_PASSWORD", "Owner@12345")
TURN_URLS = [u.strip() for u in os.environ.get("EDULINK_TURN_URLS", "").split(",") if u.strip()]
TURN_SECRET = os.environ.get("EDULINK_TURN_SECRET", "")
TTL = int(os.environ.get("EDULINK_TURN_TTL", "86400"))
out = []


def call(path, token=None, method="GET", body=None):
    req = urllib.request.Request(BASE + path, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data) as res:
            return res.status, json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return e.code, {"raw": raw[:200]}
    except OSError as e:
        print(f"لا يمكن الوصول إلى {BASE}: {e}", flush=True)
        raise SystemExit(2)


status, payload = call("/api/auth/login", method="POST",
                       body={"email": EMAIL, "password": PASSWORD})
if status != 200 or not payload.get("token"):
    out.append(f"الحكم ✗: تعذّر دخول المالك لقياس ICE — /api/auth/login أعاد {status}")
    print("\n".join(out), flush=True)
    raise SystemExit(1)
token = payload["token"]

# 1) المنفذ محمي: بلا توكن لا يجوز أن يُسرَّب إعداد الخادم
anon_status, _ = call("/api/meeting/ice")

# 2) إعداد الخادم كما يراه المتصفح
ice_status, ice = call("/api/meeting/ice", token=token)
servers = ice.get("iceServers") or []
flat = json.dumps(servers, ensure_ascii=False)

out.append(f"الوضع: {MODE} | الأصل: {BASE} | TURN المتوقع: {TURN_URLS or '— (STUN فقط)'} | TTL: {TTL}s")
out.append(f"1) /api/meeting/ice بلا توكن -> {anon_status}")
out.append(f"2) /api/meeting/ice بتوكن -> {ice_status} و{len(servers)} مدخلًا")

problems = []
if anon_status != 401:
    problems.append(f"المنفذ لم يُرفض بلا توكن (جاء {anon_status} بدل 401) — إعداد الخادم يصير مقروءًا لأي زائر")
if ice_status != 200:
    problems.append(f"المنفذ أعاد {ice_status} بدل 200 مع توكن صالح")
if not servers:
    problems.append("قائمة iceServers فارغة — المتصفح سيسقط إلى STUN العام بصمت")

entry = None
if servers:
    for s in servers:
        urls = s.get("urls")
        urls = urls if isinstance(urls, list) else [urls]
        if TURN_URLS and any(u in TURN_URLS for u in urls):
            entry = s
            break

if TURN_URLS:
    out.append("3) مدخل TURN المطابق للإعداد:")
    if entry is None:
        problems.append("لا مدخل TURN في الاستجابة رغم ضبط EDULINK_TURN_URLS — Meeting:TurnUrls لم يصل الـ API")
    else:
        username = entry.get("username") or ""
        credential = entry.get("credential") or ""
        out.append(f"   username={username!r} credential_len={len(credential)}")
        m = re.match(r"^(\d{5,}):(.+)$", username)
        if not m:
            problems.append("صيغة username ليست `<expiry>:<user id>` كما يشترط TURN REST API — سيرفضها coturn فورًا")
        else:
            expiry, user_id = int(m.group(1)), m.group(2)
            now = int(time.time())
            out.append(f"   expiry بعد {expiry - now}s من الآن، ومعرّف المستخدم={user_id!r}")
            if not (TTL - 120 <= expiry - now <= TTL + 120):
                problems.append(f"عمر التوكن {expiry - now}s لا يطابق TTL المضبوط {TTL}s — إما انتهاء مبكر يقطع الوسائط "
                                "أثناء الحصة، أو توكن صالح لفترة أطول من المتفق عليه")
            if not user_id or user_id == "anon":
                problems.append("username لا يحمل معرّف المستخدم الحقيقي — التوكن يصبح قابلًا لإعادة الاستخدام لكل الحسابات")
            if TURN_SECRET and credential:
                expected = base64.b64encode(
                    hmac.new(TURN_SECRET.encode(), username.encode(), hashlib.sha1).digest()).decode()
                same = hmac.compare_digest(expected, credential)
                out.append(f"   إعادة حساب التوقيع مستقلة: {'مطابق' if same else 'مختلف'}")
                if not same:
                    problems.append("credential لا تساوي base64(HMAC-SHA1(secret, username)) — سيرفض coturn كل طلب تحويل "
                                    "ولن يظهر الخطأ إلا عند أول شبكة NAT صارمة. راجع تطابق `Meeting:TurnSecret` مع "
                                    "`use-auth-secret` في coturn وحرفيته (بلا مسافات/اقتباس زائد)")
            elif not TURN_SECRET:
                problems.append("EDULINK_TURN_SECRET غير مضبوط هنا فلا يمكن التحقق من التوقيع — اضبطه بقيمة coturn نفسها")
        if not credential:
            problems.append("مدخل TURN بلا credential — الخادم يرسل العناوين فقط لأن `Meeting:TurnSecret` غير مضبوط: "
                            "إما خادم TURN مفتوح بلا تحقق أو رفض صامت من coturn. وضع الحسابات الثابتة مقبول للتنزيل لا للإنتاج")
else:
    signed = [s for s in servers if s.get("username") or s.get("credential")]
    if signed:
        # الاستجابة تُعلن TURN مُوقّعًا لكن المشغّل لم يمرّ إلينا الإعداد: لا يجوز أن يمرّ فحص بلا مقارنة
        problems.append(f"الخادم يرسل {len(signed)} مدخل TURN موقّع لكن EDULINK_TURN_URLS/EDULINK_TURN_SECRET غير مضبوطين "
                        "لدى الفيريفاير — لم تُتحقق أي إشارة، فلا تحسب هذه النتيجة خضراء")
    elif os.environ.get("EDULINK_REQUIRE_TURN") == "1":
        problems.append("لا مدخل TURN في الاستجابة مع EDULINK_REQUIRE_TURN=1 — Meeting:TurnUrls غير مضبوط على هذا الخادم، "
                        "فالمكالمات ستفشل على شبكات NAT الصارمة رغم أن الغرف تعمل على الشبكات المفتوحة")
    else:
        problems.append("لا EDULINK_TURN_URLS ولا TURN في استجابة الخادم: هذه بيئة تطوير بلا TURN، والنتيجة لا تُثبت شيئًا "
                        "عن خادم إنتاج — اضبط EDULINK_TURN_URLS وEDULINK_TURN_SECRET بقيمة coturn نفسها")
    out.append("3) لم يُمرّر EDULINK_TURN_URLS للفيريفاير — لا مقارنة ممكنة. الاستجابة الفعلية:")
    out.append(f"   {flat[:220]}")

out.append("")
if MODE not in ("green", "red"):
    problems.append(f"وضع غير معروف `{MODE}` — استخدم green أو red")

failed = bool(problems)
if MODE == "red":
    # في وضع red النتيجة المطلوبة هي أن يُكشف الخلل، لا أن يمرّ الصمت
    if problems:
        out.append(f"الحكم ✓ (هذا هو الفشل المطلوب): كشف الفيريفاير عدم التطابق — {problems[0]}")
        failed = False
    else:
        out.append("الحكم ✗: مرّ الفيريفاير أخضر في وضع يُتوقع فيه أن يفشل — يعني أن مقارنة التوقيع لم تتم فعلًا "
                   "(شغّل الـ API بسـرّ مختلف عن EDULINK_TURN_SECRET أو بلا Meeting:TurnUrls)")
        failed = True
elif problems:
    out.append(f"الحكم ✗: {' · '.join(problems)}")
else:
    out.append("الحكم ✓: كل شيء مطابق — التوكن موقّع كما يفحصه coturn (base64(HMAC-SHA1)) وusername=`expiry:user`، "
               "والمنفذ مرفوض بلا توكن.")

text = "\n".join(out)
print(text, flush=True)
with open(os.path.join(os.environ.get("EDULINK_OUT", "tools"), "out-ice-turn.txt"), "w", encoding="utf-8") as f:
    f.write(text + "\n")
if failed:
    raise SystemExit(1)
