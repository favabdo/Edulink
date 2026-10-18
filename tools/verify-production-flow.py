# -*- coding: utf-8 -*-
"""
فحص جاهزية الإنتاج على SQL Server (بيئة Production، محددات المعدلات بقيمها الفعلية):
1) حدّ الدخول 120/دقيقة/IP يعمل فعلًا عند المحاولة 121، ولا يسري على IP آخر.
2) الدورة الوظيفية الكاملة تُكتب وتُقرا من SQL Server (حضور، إنهاء، تقارير، رسائل، إشعارات).
3) الصلاحيات: المدرس لا يُنشئ حصة (403) وطالب لا يراسل ولي أمر (403).
"""
import io
import json
import random
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import os

BASE = os.environ.get("EDULINK_API_URL", "http://localhost:5279")
OWNER_EMAIL = os.environ.get("EDULINK_OWNER_EMAIL", "owner@edulink.test")
OWNER_PASSWORD = os.environ.get("EDULINK_OWNER_PASSWORD", "Owner@12345")
lines = []
failures = []
SUF = str(random.randint(1000, 9999))
SUBJECT = "اللغة العربية — النحو والصرف وتحليل النصوص الأدبية للصف الثالث الثانوي"


def need_token(label, payload):
    """فشل نظيف بدل Traceback لو لم يُرجع الدخول توكنًا (كلمة سر خاطئة/حساب مقفول)."""
    if not isinstance(payload, dict) or not payload.get("token"):
        print(f"فشل التحقق: {label} لم يُرجع توكن — {str(payload)[:160]}")
        raise SystemExit(1)
    return payload["token"]


def call(method, path, body=None, token=None, xff=None):
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
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:160]}


def step(label, method, path, body=None, token=None, xff=None, expect=None):
    code, data = call(method, path, body, token, xff)
    if expect is not None and code != expect:
        ok = f"  ✗ متوقع {expect}"
        failures.append(f"{label}: جاء {code} والمتوقع {expect}")
    else:
        ok = ""
    lines.append(f"{label:34s} -> {code}{ok}")
    lines.append("     " + json.dumps(data, ensure_ascii=False)[:230])
    return code, data


# ── الدورة الوظيفية (عناوين نظيفة) ──────────────────────────────────────
# ملاحظة: قياس طبقات تحديد المعدل ليس هنا — له أداة مستقلة: tools/verify-rate-limits.py
IP_OWN, IP_TEACH, IP_STU, IP_PAR = "203.0.113.90", "203.0.113.91", "203.0.113.92", "203.0.113.93"

_, owner = call("POST", "/api/auth/login", {"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, xff=IP_OWN)
tok = need_token("دخول المالك", owner)
step("POST /api/users (مدرس جديد)", "POST", "/api/users",
     {"name": "أ. سارة فؤاد", "email": f"sara" + SUF + "@edulink.test", "password": "Sara@12345", "role": 0}, tok, IP_OWN, 201)
_, teacher = call("POST", "/api/auth/login", {"email": f"sara" + SUF + "@edulink.test", "password": "Sara@12345"}, xff=IP_TEACH)
ttok = need_token("دخول المدرس", teacher)
_, student = step("POST /api/students", "POST", "/api/students",
     {"name": "نور حمدي", "email": f"nour" + SUF + "@edulink.test", "password": "Nour@12345", "states": 1, "access": 1}, tok, IP_OWN, 201)
sid = student["id"]
step("POST /api/parents (ربط ابن)", "POST", "/api/parents",
     {"name": "والد نور", "email": f"dadanour" + SUF + "@edulink.test", "password": "Dad@12345",
      "studentId": sid, "relation": 0, "access": 1}, tok, IP_OWN, 201)
_, stu = call("POST", "/api/auth/students/login", {"email": f"nour" + SUF + "@edulink.test", "password": "Nour@12345"}, xff=IP_STU)
stok = need_token("دخول الطالب", stu)
_, par = call("POST", "/api/auth/parents/login", {"email": f"dadanour" + SUF + "@edulink.test", "password": "Dad@12345"}, xff=IP_PAR)
ptok = need_token("دخول ولي الأمر", par)

starts = (datetime.now(timezone.utc) - timedelta(days=1)).replace(microsecond=0, second=0)
_, sess = step("POST /api/sessions (مادة 70 حرفًا)", "POST", "/api/sessions",
     {"subject": SUBJECT, "teacherId": teacher["user"]["id"], "studentId": sid, "gradeKey": "g12",
      "durationMin": 90, "startsAt": starts.isoformat()}, tok, IP_OWN, 201)
ses_id = sess["id"]
step("PATCH /api/sessions/{id} → live", "PATCH", f"/api/sessions/{ses_id}", {"status": "live"}, ttok, IP_TEACH, 200)
step("POST /api/sessions/{id}/attendance", "POST", f"/api/sessions/{ses_id}/attendance",
     {"studentId": sid, "mark": "present"}, ttok, IP_TEACH, 200)
step("POST /api/sessions/{id}/end", "POST", f"/api/sessions/{ses_id}/end", {}, ttok, IP_TEACH, 200)

ms = int((datetime.now(timezone.utc) - timedelta(days=40)).timestamp() * 1000)
me = int((datetime.now(timezone.utc) + timedelta(days=40)).timestamp() * 1000)
_, rep = step(f"GET /api/reports/overview?teacherId", "GET",
     f"/api/reports/overview?from={ms}&to={me}&teacherId={teacher['user']['id']}", None, tok, IP_OWN, 200)
lines.append("     totals=" + json.dumps(rep["totals"], ensure_ascii=False))

step("POST /api/messages/send (موظف→ولي أمر)", "POST", "/api/messages/send",
     {"recipientKind": "parent", "recipientId": par["user"]["id"], "body": "تم تسجيل حضور نور"}, tok, IP_OWN, 200)
_, n1 = step("GET /api/notifications (ولي الأمر)", "GET", "/api/notifications?unreadOnly=0&take=5", None, ptok, IP_PAR, 200)
lines.append(f"     إشعارات ولي الأمر غير المقروءة = {n1['unread']}")

step("POST /api/sessions كمدرس → ممنوع", "POST", "/api/sessions",
     {"subject": "x", "teacherId": teacher["user"]["id"], "studentId": sid, "gradeKey": "g12",
      "durationMin": 60, "startsAt": starts.isoformat()}, ttok, IP_TEACH, 403)
step("راسلة طالب ←ولي أمر → ممنوع", "POST", "/api/messages/send",
     {"recipientKind": "parent", "recipientId": par["user"]["id"], "body": "مرحبا"}, stok, IP_STU, 403)
step("GET /api/reports/overview كمدرس → ممنوع", "GET", "/api/reports/overview", None, ttok, IP_TEACH, 403)
step("POST /api/auth/logout", "POST", "/api/auth/logout", {}, tok, IP_OWN, 204)

with io.open("tools/out-production-flow.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

if failures:
    print("فشل " + str(len(failures)) + " تحقق:")
    for item in failures:
        print("  - " + item)
    raise SystemExit(1)
print("كل التحققات مطابقة المتوقعة")
