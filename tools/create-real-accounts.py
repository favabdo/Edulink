# -*- coding: utf-8 -*-
"""
يمرّ سيناريو صاحب المشروع حرفيًا على قاعدة SQL Server نظيفة: مؤسسة واحدة
بمالك ومدير ومشرف ومدرسين وطالبَين وولي أمر، عبر نقاط النهاية الحقيقية فقط.
لا زرع وهمي ولا seed_dev.py — كل صف يُكتب من هذا السيناريو ثم يُقرأ من القاعدة.

⚠️ **كلمات السر:** القيم الافتراضية في هذا الملف **موثّقة في المستودع العام**، فهي تصلح
على `localhost` وحده. على أي هدف آخر **لا** تعمل الأداة حتى تُمرَّر الكلمات في البيئة
(`EDULINK_SEED_OWNER_PASSWORD` و`EDULINK_SEED_STAFF_PASSWORD` و`EDULINK_SEED_STUDENT_PASSWORD`
و`EDULINK_SEED_PARENT_PASSWORD`) — وإلا كان هذا السيناريو هو من يزرع «كلمات افتراضية موثّقة»
على قاعدة عميل، وهو بالضبط ما ترفضه بوابة `tools/verify-default-credentials.py`.

التشغيل (تطوير):  EDULINK_API_URL=http://localhost:5279 python tools/create-real-accounts.py
التشغيل (عند عميل): EDULINK_API_URL=https://DOMAIN  EDULINK_SEED_OWNER_PASSWORD=… … python tools/create-real-accounts.py
"""
import io
import json
import os
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

BASE = os.environ.get("EDULINK_API_URL", "http://localhost:5279").rstrip("/")
OUT = os.path.join("tools", "out-real-accounts.txt")

OWNER_EMAIL = os.environ.get("EDULINK_SEED_OWNER_EMAIL", "owner@tila.test")
DOMAIN = os.environ.get("EDULINK_SEED_DOMAIN", "@tila.test")
LOOPBACK = urlparse(BASE).hostname in ("localhost", "127.0.0.1", "::1")


def seed_password(role, local_default):
    """كلمة السر: من البيئة دائمًا خارج loopback، ومن الافتراضية المحلية على الجهاز."""
    return os.environ.get(f"EDULINK_SEED_{role.upper()}_PASSWORD", "") or (local_default if LOOPBACK else "")


OWNER_PASSWORD = seed_password("owner", "TilaOwner#2026")
STAFF_PASSWORD = seed_password("staff", "TilaSuper#2026")
TEACHER_PASSWORD = seed_password("teacher", "TilaTeach#2026")
STUDENT_PASSWORD = seed_password("student", "TilaStud#2026")
PARENT_PASSWORD = seed_password("parent", "TilaParent#2026")

lines = []


def post(path, payload, token=None, expect=None):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = res.read().decode("utf-8", "replace")
            code = res.status
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        code = err.code
    except Exception as err:
        return None, str(err)
    try:
        parsed = json.loads(body) if body else None
    except Exception:
        parsed = body
    if expect is not None and code not in expect:
        lines.append(f"✗ {path} رجّعت {code} (متوقع {expect}): {body[:200]}")
    return parsed, code


def login(email, password):
    for path in ("/api/auth/login", "/api/auth/students/login", "/api/auth/parents/login"):
        parsed, code = post(path, {"email": email, "password": password})
        if code == 200 and isinstance(parsed, dict) and parsed.get("token"):
            return parsed["token"], path
    return None, None


def main():
    # 0) حارس: خارج loopback لا تُستخدم كلمات هذا الملف إطلاقًا
    if not LOOPBACK:
        missing = [f"EDULINK_SEED_{r}_PASSWORD" for r, v in
                   (("OWNER", OWNER_PASSWORD), ("STAFF", STAFF_PASSWORD),
                    ("STUDENT", STUDENT_PASSWORD), ("PARENT", PARENT_PASSWORD)) if not v]
        if os.environ.get("EDULINK_SEED_OWNER_EMAIL") is None:
            missing.append("EDULINK_SEED_OWNER_EMAIL")
        if os.environ.get("EDULINK_SEED_DOMAIN") is None:
            missing.append("EDULINK_SEED_DOMAIN")
        if missing:
            print("✗ هدف غير loopback (" + BASE + ") بلا بيانات مُمرَّرة من البيئة: "
                  + ", ".join(missing))
            print("  كلمات السر في هذا الملف موثّقة علنًا — تشغيلها على قاعدة عميل يزرع "
                  "«كلمة افتراضية» تصعب إزالتها لاحقًا. مرِ القيم ثم أعد التشغيل.")
            return 1

    # 1) أول حساب — نقطة الإعداد تعمل مرة واحدة على قاعدة فارغة
    owner, code = post(
        "/api/setup/owner",
        {"name": "مالك مؤسسة تيلا", "email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        expect=[200, 201, 409],
    )
    if code == 409:
        lines.append("· قاعدة غير فارغة: يُستخدم المالك الموجود")
    elif code in (200, 201):
        owner_id = (owner or {}).get("id")
        lines.append(f"✓ المالك أُنشئ (id={owner_id}) بكلمة السر من البيئة أو الافتراضية المحلية")
    else:
        lines.append(f"✗ إنشاء المالك فشل ({code}): {str(owner)[:200]}")
        report = "\n".join(lines) + "\n"
        io.open(OUT, "w", encoding="utf-8", newline="\n").write(report)
        print(report)
        return 1

    token, via = login(OWNER_EMAIL, OWNER_PASSWORD)
    if not token:
        print("\n".join(lines))
        print("✗ تعذّر دخول المالك — لا متابعة")
        io.open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
        return 1
    lines.append(f"✓ دخول المالك عبر {via} — طول التوكن {len(token)}")

    # 2) حسابات المؤسسة: مدير (2) + مشرفة (1) + مدرسان (0)
    staff = [
        {"name": "مدير عام تيلا", "email": "manager" + DOMAIN, "password": STAFF_PASSWORD, "role": 2},
        {"name": "مشرفة قسم تيلا", "email": "supervisor" + DOMAIN, "password": STAFF_PASSWORD, "role": 1},
        {"name": "أ. محمود سيد", "email": "teacher1" + DOMAIN, "password": TEACHER_PASSWORD, "role": 0},
        {"name": "أ. رانيا شكري", "email": "teacher2" + DOMAIN, "password": TEACHER_PASSWORD, "role": 0},
    ]
    ids = {}
    for s in staff:
        parsed, code = post("/api/users", s, token, expect=[200, 201, 409])
        if code in (200, 201):
            ids[s["email"]] = (parsed or {}).get("id")
            lines.append(f"✓ {s['name']} ({s['email']}) role={s['role']} id={ids[s['email']]}")
        elif code == 409:
            lines.append(f"· {s['email']} موجود بالفعل — لا يُحتسب جديد")
        else:
            lines.append(f"✗ {s['email']} فشل {code}: {parsed}")

    # 3) طالبان لهما كلمة سر خاصة بهما (aud=student)
    students = [
        {"name": "ياسمين عبد الله", "email": "student1" + DOMAIN, "password": STUDENT_PASSWORD},
        {"name": "عمر سيد", "email": "student2" + DOMAIN, "password": STUDENT_PASSWORD},
    ]
    for st in students:
        parsed, code = post("/api/students", st, token, expect=[200, 201, 409])
        if code in (200, 201):
            ids[st["email"]] = (parsed or {}).get("id")
            lines.append(f"✓ طالب {st['name']} id={ids[st['email']]}")

    # 4) ولي أمر + ربطه بابنه
    parsed, code = post(
        "/api/parents",
        {"name": "عبد الله منصور", "email": "parent1" + DOMAIN, "password": PARENT_PASSWORD, "relation": 0, "isPrimary": True},
        token,
        expect=[200, 201, 409],
    )
    parent_id = (parsed or {}).get("id") if code in (200, 201) else None
    if parent_id:
        ids["parent"] = parent_id
        lines.append(f"✓ ولي أمر {parsed.get('name')} id={parent_id}")
        student1 = ids.get("student1" + DOMAIN)
        if student1:
            parsed2, code2 = post(
                f"/api/parents/{parent_id}/link",
                {"studentId": student1, "relation": 0, "isPrimary": True},
                token,
                expect=[200, 201, 204, 409],
            )
            lines.append(f"✓ ربط ولي الأمر بالطالب (id={student1}) → {code2}")

    # 5) حصتان حقيقيتان — زوج لكل مدرس حتى يقاس العزل (كل مدرس يرى طلابه وحدهم)
    pairs = [
        (ids.get("teacher1" + DOMAIN), ids.get("student1" + DOMAIN)),
        (ids.get("teacher2" + DOMAIN), ids.get("student2" + DOMAIN)),
    ]
    for index, (teacher_id, student_id) in enumerate(pairs, start=1):
        if not teacher_id or not student_id:
            lines.append(f"! القفز على الزوج {index}: مدرسه أو طالبه غير موجود")
            continue
        starts = f"2030-01-{14 + index:02d}T10:00:00.000Z"  # مستقبل بعيد: لا حصة ماضية تُرفض
        parsed, code = post(
            "/api/sessions",
            {"subject": "رياضيات", "teacherId": teacher_id, "studentId": student_id,
             "gradeKey": "g9", "durationMin": 60, "startsAt": starts},
            token,
            expect=[200, 201, 400, 409],
        )
        if code in (200, 201):
            lines.append(f"✓ حصة مجدولة #{index} id={(parsed or {}).get('id')} كود={(parsed or {}).get('code')} "
                         f"(مدرس {teacher_id}/طالب {student_id})")
        else:
            lines.append(f"· حصة #{index} رجعت {code}: {str(parsed)[:160]}")

    # 6) تحقق من القراءة بعد الدخول لكل دور
    for label, email, password in (
        ("مشرفة", "supervisor" + DOMAIN, STAFF_PASSWORD),
        ("مدرس", "teacher1" + DOMAIN, TEACHER_PASSWORD),
        ("طالب", "student1" + DOMAIN, STUDENT_PASSWORD),
        ("ولي أمر", "parent1" + DOMAIN, PARENT_PASSWORD),
    ):
        tok, via = login(email, password)
        if not tok:
            lines.append(f"✗ دخول {label} ({email}) فشل")
            continue
        req = urllib.request.Request(BASE + "/api/auth/me")
        req.add_header("Authorization", "Bearer " + tok)
        with urllib.request.urlopen(req, timeout=30) as res:
            me = json.loads(res.read().decode("utf-8"))
        lines.append(f"✓ {label}: /api/auth/me → name={me.get('name')!r} aud={me.get('aud')} role={me.get('role')}")

    report = "\n".join(lines) + "\n"
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(report)
    print(report)
    failed = [l for l in lines if l.startswith("✗")]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
