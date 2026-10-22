# -*- coding: utf-8 -*-
"""
زرع بيانات اختبار حقيقية في قاعدة التطوير عبر الـ API نفسه.

الاستخدام (الـ API يعمل على 5279):
    python seed_dev.py

ينشئ: 6 مدرسين + مشرف + 12 طالبًا + حصص على مدى 8 أسابيع
      (ماضٍ منفَّذ بحضور واقعي، ومستقبل مجدول، وحصة تبدأ الآن للاختبار اللايف).

متسامح مع التكرار (idempotent): المستخدمون والطلاب الموجودون يُتخطَّون (409)،
والحصص لا تُزرع مرتين — إن وُجدت أي حصة "seed" فالحصص تُتخطى كلها.
"""

import json
import itertools
import random
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "http://localhost:5279"
TOKEN = None

# ⚠️ زرع تجريبي لحسابات محلية فقط. هذا الحارس يمنع أن تُزرع 24 حسابًا باسم
# @edulink.test في قاعدة عميل حقيقية بنطاق مختلف — لا استثناء ولا رفع علم:
# إن احتجت تجربة على سيرفر بعيد فاحملها عبر نفق إلى localhost.
_HOST = BASE.split("//", 1)[-1].split("/", 1)[0].split(":", 1)[0]
if _HOST not in ("localhost", "127.0.0.1", "::1"):
    raise SystemExit(
        "seed_dev.py للتطوير المحلي فقط: أصل الزرع يجب أن يكون localhost، "
        f"والأصل الحالي «{BASE}» قد يكون قاعدة مؤسسة حقيقية."
    )

random.seed(20260929)  # حتمي: نفس البيانات في كل تشغيل


def call(method: str, path: str, body: dict | None = None, auth: bool = True) -> tuple[int, dict | list | None]:
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if auth and TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    data = json.dumps(body).encode("utf-8") if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data) as res:
            raw = res.read().decode("utf-8")
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return e.code, None


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# ─────────────────────────────── حساب المالك ───────────────────────────────

status, data = call("POST", "/api/auth/login", {"email": "owner@edulink.test", "password": "Owner@12345"}, auth=False)
if status == 200:
    TOKEN = data["token"]
    print("✓ دخول المالك الموجود")
else:
    status, data = call("POST", "/api/setup/owner",
                        {"name": "مالك المنصة", "email": "owner@edulink.test", "password": "Owner@12345"}, auth=False)
    if status in (200, 201):
        TOKEN = data["token"]
        print("✓ إنشاء حساب المالك")
    else:
        print(f"✗ تعذّر تهيئة المالك ({status}): {data}")
        sys.exit(1)


_seq = itertools.count(1)


def dev_phone() -> str:
    """الخادم يرفض إنشاء أي حساب بلا رقم هاتف — الزرع المحلي يولّد رقمًا حتميًّا لكل حساب."""
    return f"+20100000{next(_seq):04d}"


def ensure_user(name: str, email: str, password: str, role: int) -> int | None:
    status, data = call("POST", "/api/users",
                        {"name": name, "email": email, "password": password, "role": role, "phone": dev_phone()})
    if status in (200, 201):
        print(f"  + {name} <{email}>")
        return data["id"]
    if status == 409:
        print(f"  = {email} موجود")
        return None
    print(f"  ! فشل إنشاء {email}: {status} {data}")
    return None


def ensure_student(name: str, email: str, password: str) -> int | None:
    status, data = call("POST", "/api/students",
                        {"name": name, "email": email, "password": password, "phone": dev_phone()})
    if status in (200, 201):
        print(f"  + {name} <{email}>")
        return data["id"]
    if status == 409:
        print(f"  = {email} موجود")
        return None
    print(f"  ! فشل إنشاء {email}: {status} {data}")
    return None


# ─────────────────────────────── المدرسون والمشرف ───────────────────────────────

TEACHER_PASSWORD = "Teacher@12345"
teachers = [
    ("أحمد المصري", "ahmed.teacher@edulink.test", "رياضيات"),
    ("سارة عبد الله", "sara.teacher@edulink.test", "لغة عربية"),
    ("محمود فتحي", "mahmoud.teacher@edulink.test", "فيزياء"),
    ("نورهان سعيد", "nourhan.teacher@edulink.test", "كيمياء"),
    ("كريم يوسف", "karim.teacher@edulink.test", "لغة إنجليزية"),
    ("هبة عادل", "heba.teacher@edulink.test", "أحياء"),
]
teacher_ids: list[int] = []
for name, email, _subject in teachers:
    uid = ensure_user(name, email, TEACHER_PASSWORD, role=0)
    if uid is None:  # موجود — نجيب معرّفه من قائمة المستخدمين
        status, users = call("GET", "/api/users")
        uid = next((u["id"] for u in (users or []) if u["email"] == email), None)
    if uid:
        teacher_ids.append(uid)

ensure_user("مشرف المنصة", "supervisor@edulink.test", "Supervisor@12345", role=1)

# ─────────────────────────────── الطلاب ───────────────────────────────

STUDENT_PASSWORD = "Student@12345"
first = ["يوسف", "مريم", "عمر", "ليلى", "زياد", "حبيبة", "آدم", "جنى", "مازن", "روان", "سليم", "ملك"]
last = ["الشناوي", "الجوهر", "عبد العال", "رمضان", "الغزالي", "شلبي", "الديب", "منصور"]
grades = ["g7", "g8", "g9", "g10", "g11", "g12"]

student_ids: list[int] = []
for i in range(1, 13):
    name = f"{first[i % len(first)]} {last[i % len(last)]}"
    email = f"seed.student{i:02d}@edulink.test"
    sid = ensure_student(name, email, STUDENT_PASSWORD)
    if sid is None:
        status, rows = call("GET", "/api/students?search=" + email)
        sid = rows[0]["id"] if rows else None
    if sid:
        student_ids.append(sid)

if not teacher_ids or not student_ids:
    print("✗ لا يوجد مدرسون أو طلاب كافون للحصص")
    sys.exit(1)

# ─────────────────────────────── أولياء الأمور ───────────────────────────────

PARENT_PASSWORD = "Parent@12345"
parents = [
    ("خالد عبدالله", "khaled.parent@edulink.test", [0, 6]),
    ("منى إبراهيم", "mona.parent@edulink.test", [1, 7]),
    ("سامي فوزي", "samy.parent@edulink.test", [2, 8]),
    ("هدى نصر", "hoda.parent@edulink.test", [3, 9, 10]),
]
for name, email, child_idx in parents:
    status, _ = call("POST", "/api/auth/parents/login", {"email": email, "password": PARENT_PASSWORD}, auth=False)
    if status == 200:
        continue  # موجود بالفعل
    payload = {
        "name": name,
        "email": email,
        "password": PARENT_PASSWORD,
        "phone": dev_phone(),
        "access": 1,
        "studentId": student_ids[child_idx[0]],
        "relation": 0,
    }
    status, _ = call("POST", "/api/parents", payload)
    if status not in (200, 201):
        print(f"✗ تعذر إنشاء ولي أمر {email} ({status})")
        continue
    for extra in child_idx[1:]:
        status, plist = call("GET", "/api/parents")
        me = next((p for p in (plist or []) if p["email"] == email), None)
        if me:
            call("POST", f"/api/parents/{me['id']}/link", {"studentId": student_ids[extra], "relation": 2, "isPrimary": False})

# ─────────────────────────────── الحصص ───────────────────────────────

status, existing = call("GET", "/api/sessions?status=scheduled")
seeded = [s for s in (existing or []) if '"seed"' in (s.get("metadata") or "")]
if seeded:
    print(f"= حصص seed موجودة ({len(seeded)}) — تخطي زرع الحصص")
    sys.exit(0)

status, all_sessions = call("GET", "/api/sessions")
if len(all_sessions or []) > 3:
    print(f"= توجد حصص سابقة ({len(all_sessions)}) — تخطي زرع الحصص")
    sys.exit(0)

now = datetime.now(timezone.utc)
created = 0

# الماضي: 6 أسابيع، لكل مدرس حصص منفَّذة بحضور واقعي
for week in range(6, 0, -1):
    for t_idx, tid in enumerate(teacher_ids):
        for k in range(2):
            student = student_ids[(t_idx * 2 + k + week) % len(student_ids)]
            starts = now - timedelta(weeks=week, days=k, hours=random.choice([9, 11, 14, 16]))
            duration = random.choice([30, 45, 60])
            roll = random.random()
            payload = {
                "subject": teachers[t_idx][2],
                "metadata": '{"seed": true}',
                "teacherId": tid,
                "studentId": student,
                "gradeKey": random.choice(grades),
                "durationMin": duration,
                "startsAt": iso(starts),
            }
            status, data = call("POST", "/api/sessions", payload)
            if status not in (200, 201):
                continue
            session_id = data["id"]
            if roll < 0.72:      # حضر (معظمه في الوقت وبعضه متأخر)
                mark = "late" if roll < 0.12 else "present"
                call("POST", f"/api/sessions/{session_id}/attendance", {"studentId": student, "mark": mark})
                call("POST", f"/api/sessions/{session_id}/end", {"by": "teacher", "durationMinutes": duration})
            elif roll < 0.85:    # حصة منفَّذة تأخر المدرس عنها الطالب — غياب
                call("POST", f"/api/sessions/{session_id}/end", {"by": "teacher", "durationMinutes": duration})
            elif roll < 0.93:    # ملغاة
                call("POST", f"/api/sessions/{session_id}/cancel", {"by": "supervisor", "reason": "ظرف طارئ"})
            else:                # لم يحضر أحد
                call("PATCH", f"/api/sessions/{session_id}", {"status": "no_show"})
            created += 1

# المستقبل: أسبوع أمامي مجدول
for day in range(1, 8):
    t_idx = day % len(teacher_ids)
    starts = now + timedelta(days=day, hours=random.choice([10, 13, 15, 17]))
    status, data = call("POST", "/api/sessions", {
        "subject": teachers[t_idx][2],
        "metadata": '{"seed": true}',
        "teacherId": teacher_ids[t_idx],
        "studentId": student_ids[day % len(student_ids)],
        "gradeKey": random.choice(grades),
        "durationMin": random.choice([30, 45, 60]),
        "startsAt": iso(starts),
    })
    created += status in (200, 201)

# حصة "الآن" لاختبار الغرفة اللايف فورًا بحساب المدرس الأول
status, data = call("POST", "/api/sessions", {
    "subject": "رياضيات",
    "metadata": '{"seed": true}',
    "teacherId": teacher_ids[0],
    "studentId": student_ids[0],
    "gradeKey": "g10",
    "durationMin": 45,
    "startsAt": iso(now - timedelta(minutes=5)),
})
live_id = data["id"] if status in (200, 201) else None
created += live_id is not None

print(f"✓ زُرعت {created} حصة — حصة اللايف للتجربة: {data.get('code') if live_id else '—'}")
