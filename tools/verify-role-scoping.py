# -*- coding: utf-8 -*-
"""
بوابة عزل القراءة لكل مدرّس (docs/11 §6 — الخطوة 52).

الفحص لا يقرأ الكود: **يجرّب بتوكنات حقيقية**. الأساس الذي تُقاس عليه الصواب
ليس فرضًا من عندي — هو `GET /api/sessions` **بتوكن المدرس نفسه**: الخادم يرجّع
له حصصه، فطلاب هذه الحصص هم بالضبط ما يملك أن يقرأه. ومن هناك:

  1. `GET /api/students` للمدرس = طلاب حصصه، لا أكثر (كل زائد = تسريب).
  2. `GET /api/students/{id}` لطالب ليس من حصصه = **403** (الواجهة تحجب، والتسريب
     يُسرق برقم id من DevTools — فهذا هو القياس الحقيقي).
  3. `GET /api/parents` للمدرس: كل الأبناء الظاهرين فيه من طلابه فقط.
  4. الإدارة (مشرف فأعلى) ترى المؤسسة كاملة — بلا تضييق زائد يكسر شاشاتها.
  5. `GET /api/sessions/stats?studentId=` لطالب خارج حصصه: لا يجوز أن تُعيد أرقام
     حصصه الحقيقية (قياس مقابل لأساس الإدارة)، مع قياس عكسي أن إحصائيات **طالبه هو**
     ما زالت تعمل — لئلّا يُحسب تقييدٌ زائد يُعطّل شاشة المدرس نجاحًا.
  6. `GET /api/parents/children?student=` لطالب خارج حصصه = **403** أو بلا بيانات،
     بنفس القياس العكسي لطالبه.

**تخرج 1 ولا تُحسب نجاحًا** في أي حالة «لم أُتحقق»: بيانات بيئة ناقصة، أصل غير
reachable، استجابة بشكل غير متوقع، أو **طالب واحد فقط في القاعدة** (لا ضحية يُقاس
عليها الحجب).

التشغيل (بعد `python tools/create-real-accounts.py` أو مؤسسة حقيقية بمدرسين وطالبَين):
   EDULINK_API_URL=http://localhost:5279 \
   EDULINK_ADMIN_EMAIL=supervisor@… EDULINK_ADMIN_PASSWORD=… \
   EDULINK_T1_EMAIL=teacher1@… EDULINK_T1_PASSWORD=… \
   EDULINK_T2_EMAIL=teacher2@… EDULINK_T2_PASSWORD=… \
   python tools/verify-role-scoping.py
"""
import io
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("EDULINK_API_URL", "http://localhost:5279").rstrip("/")
OUT = os.path.join("tools", "out-role-scoping.txt")
ENV_KEYS = (
    "EDULINK_ADMIN_EMAIL", "EDULINK_ADMIN_PASSWORD",
    "EDULINK_T1_EMAIL", "EDULINK_T1_PASSWORD",
    "EDULINK_T2_EMAIL", "EDULINK_T2_PASSWORD",
)


def req(method, path, token=None, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=20) as res:
            raw = res.read().decode("utf-8", "replace")
            return res.status, _parse(raw)
    except urllib.error.HTTPError as err:
        return err.code, _parse(err.read().decode("utf-8", "replace"))
    except Exception as err:
        return None, str(err)


def _parse(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return raw


def login(email, password):
    code, blob = req("POST", "/api/auth/login", body={"email": email, "password": password})
    if code == 200 and isinstance(blob, dict) and blob.get("token"):
        return blob["token"]
    return None


def as_list(path, token, who):
    """قائمة متوقَّعة من الخادم، أو رسالة «لا قياس» تخرج بالفحص."""
    code, blob = req("GET", path, token)
    if code != 200 or not isinstance(blob, list):
        return None, f"{path} ⇒ {code} ل{who} — استجابة غير متوقعة، لا قياس"
    return blob, None


def main():
    missing = [k for k in ENV_KEYS if not os.environ.get(k)]
    if missing:
        print("✗ بيانات بيئة ناقصة: " + ", ".join(missing) + " — لا قياس، فلا تُحسب خضراء")
        return 1

    tokens = {}
    for slot, (ek, pk) in (('admin', ENV_KEYS[0:2]), ('t1', ENV_KEYS[2:4]), ('t2', ENV_KEYS[4:6])):
        tok = login(os.environ[ek], os.environ[pk])
        if not tok:
            print(f"✗ تعذّر دخول {slot} ({os.environ[ek]}) — لا قياس")
            return 1
        tokens[slot] = tok

    lines, leaks = [], []

    admin_students, err = as_list("/api/students", tokens['admin'], 'الإدارة')
    if err:
        print("✗ " + err)
        return 1
    all_ids = {int(s["id"]) for s in admin_students}
    emails = {int(s["id"]): s.get("email", "") for s in admin_students}

    def own_student_ids(slot):
        """الأساس الصحيح: طلاب حصص هذا المدرس، من /api/sessions بتوكنه هو."""
        sessions, err = as_list("/api/sessions", tokens[slot], 'المدرس')
        if err:
            return None, err
        return {int(s["studentId"]) for s in sessions if s.get("studentId") is not None}, None

    for slot, label in (('t1', 'مدرّس-1'), ('t2', 'مدرّس-2')):
        own, err = own_student_ids(slot)
        if err:
            print("✗ " + err)
            return 1
        seen_rows, err = as_list("/api/students", tokens[slot], label)
        if err:
            print("✗ " + err)
            return 1
        seen = {int(s["id"]) for s in seen_rows}

        extra = seen - own
        if extra:
            leaks.append(f"{label}: {len(extra)} طالبًا في /api/students ليسوا من حصصه "
                         f"{[(i, emails.get(i)) for i in sorted(extra)][:3]}")
        else:
            lines.append(f"✓ {label}: يرى {len(seen)} طالبًا = طلاب حصصه ال{len(own)} بالضبط")

        # الضحية: طالب معروف في القاعدة خارج حصص هذا المدرس
        victims = sorted(all_ids - own)
        if not victims:
            leaks.append(f"{label}: لا يوجد طالب خارج حصصه في القاعدة — لا يمكن قياس الحجب "
                         "(أضف طالبًا لمدرّس آخر). لا تُحسب خضراء.")
            continue
        victim = victims[0]
        code, blob = req("GET", f"/api/students/{victim}", tokens[slot])
        if code == 200:
            got = blob.get("email") if isinstance(blob, dict) else "?"
            leaks.append(f"{label}: فتح سجل طالب خارج حصصه بالمعرّف id={victim} email={got}")
        elif code == 403:
            lines.append(f"✓ {label}: GET /api/students/{victim} ⇒ 403 كما يجب")
        else:
            leaks.append(f"{label}: GET /api/students/{victim} ⇒ {code} (منتظر 403) — لا حكم")

        # أولياء الأمور: لا أبناء خارج طلابه
        parents, err = as_list("/api/parents", tokens[slot], label)
        if err:
            print("✗ " + err)
            return 1
        children = {int(c["studentId"]) for p in parents for c in (p.get("children") or [])}
        foreign = children - own
        if foreign:
            leaks.append(f"{label}: /api/parents فيه أبناء خارج حصصه: {sorted(foreign)}")
        else:
            lines.append(f"✓ {label}: /api/parents يعيد {len(parents)} ولي أمر، وأبناؤهم كلهم من طلابه")

        # (5) إحصائيات الضحية — الأساس من توكن الإدارة، لا من قراءة الكود
        mine = sorted(own)[0] if own else None
        acode, ablob = req("GET", f"/api/sessions/stats?studentId={victim}", tokens['admin'])
        if acode != 200 or not isinstance(ablob, dict) or "totalSessions" not in ablob:
            leaks.append(f"{label}: أساس الإدارة /api/sessions/stats?studentId={victim} ⇒ {acode} "
                         "— شكل غير متوقع، لا قياس")
        else:
            base = int(ablob["totalSessions"])
            if base <= 0:
                leaks.append(f"{label}: الضحية id={victim} بلا حصص عند الإدارة — لا مادة تميّز "
                             "التسريب، لا تُحسب خضراء")
            else:
                tcode, tblob = req("GET", f"/api/sessions/stats?studentId={victim}", tokens[slot])
                if tcode == 403:
                    lines.append(f"✓ {label}: stats?studentId={victim} ⇒ 403 (أساس الإدارة {base})")
                elif tcode == 200 and isinstance(tblob, dict) and "totalSessions" in tblob:
                    got = int(tblob["totalSessions"])
                    if got == base:
                        leaks.append(f"{label}: stats?studentId={victim} سرّبت أرقام حصصه الحقيقية "
                                     f"(totalSessions={got} = أساس الإدارة)")
                    elif got == 0:
                        lines.append(f"✓ {label}: stats?studentId={victim} ⇒ صفر بدل {base} — بلا تسريب")
                    else:
                        leaks.append(f"{label}: stats?studentId={victim} ⇒ {got} (منتظر 0 أو 403) — لا حكم")
                else:
                    leaks.append(f"{label}: stats?studentId={victim} ⇒ {tcode} — غير مفهوم، لا قياس")

                # القياس العكسي: إحصائيات طالبه هو يجب أن تظل تعمل
                if mine is None:
                    leaks.append(f"{label}: لا طالب له في /api/sessions — لا قياس عكسي")
                else:
                    ocode, oblob = req("GET", f"/api/sessions/stats?studentId={mine}", tokens[slot])
                    if ocode == 200 and isinstance(oblob, dict) and int(oblob.get("totalSessions") or 0) > 0:
                        lines.append(f"✓ {label}: إحصائيات طالبه ({mine}) ما زالت تعمل "
                                     f"({oblob['totalSessions']} حصة)")
                    else:
                        leaks.append(f"{label}: إحصائيات طالبه {mine} ⇒ {ocode} / صفر — "
                                     "تقييد زائد يكسر شاشة المدرس")

        # (6) ملف الأبناء — نفس المنطق على /api/parents/children
        ccode, cblob = req("GET", f"/api/parents/children?student={victim}", tokens[slot])
        if ccode == 403:
            lines.append(f"✓ {label}: children?student={victim} ⇒ 403 كما يجب")
        elif ccode == 200:
            n = len(cblob) if isinstance(cblob, list) else -1
            if n > 0:
                leaks.append(f"{label}: children?student={victim} أعادت {n} سجلًا لطالب خارج حصصه")
            else:
                lines.append(f"✓ {label}: children?student={victim} ⇒ بلا بيانات")
        else:
            leaks.append(f"{label}: children?student={victim} ⇒ {ccode} — غير مفهوم، لا قياس")

        if mine is not None:
            wcode, wblob = req("GET", f"/api/parents/children?student={mine}", tokens[slot])
            if wcode == 200:
                lines.append(f"✓ {label}: children?student={mine} (طالبه) ⇒ 200")
            else:
                leaks.append(f"{label}: children?student={mine} لطالبه ⇒ {wcode} — "
                             "تقييد زائد يكسر شاشة المدرس")

    # الإدارة ترى الكامل — والتضييق الزائد يكسر شاشات المشرف
    if len(all_ids) < 2:
        leaks.append(f"القاعدة فيها {len(all_ids)} طالبًا فقط عند الإدارة — لا سيناريو مقارنة")
    else:
        lines.append(f"✓ الإدارة ترى كل الطلاب ({len(all_ids)}) أي أكثر مما يرى أي مدرّس")

    lines.insert(0, f"الأصل: {BASE}  |  طلاب عند الإدارة: {len(all_ids)}")
    for leak in leaks:
        lines.append("✗ " + leak)

    report = "\n".join(lines) + "\n"
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(report)
    print(report)
    if leaks:
        print(f"فشل: {len(leaks)} بند — عزل المدرس غير محقق.")
        return 1
    print("نجح: كل مدرّس في طلاب حصصه، والحجب بالمعرّف يعمل، والإدارة ترى الكامل.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
