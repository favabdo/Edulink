#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
بوابة نافذة الانضمام + الوقت الفعلي المقيس.

تقيس طلبين لصاحب المشروع (2026-11-05) من الخارج، لا من قراءة الشيفرة:

  1) **النافذة**: الحصة لا تُفتح طول اليوم. تُقبل الانضمامات داخل
     [الموعد − JoinEarlyMinutes ، النهاية + JoinGraceMinutes] فقط، وما عداها
     يُرفض **من الخادم** (SignalR وHTTP معًا) — لأن حجب الزرار في الشاشة لا يمنع
     من يكتب النداء في DevTools. والحصة الجارية (live) تبقى مفتوحة لأن الطالب
     الذي انقطع منه الاتصال في منتصفها لازم يرجع.

  2) **الوقت الفعلي**: الساعات = مجموع فترات الجلوس داخل الغرفة، لا `durationMin`
     المكتوب في الجدول. تُقاس بحالتين: دخول/خروج/دخول (الشريطان معًا)، وحصّة
     قديمة بلا أشرطة (سلسلة البدائل: `metadata.durationMinutes` ثم
     `endsAt − joinedAt` ثم `durationMin`).

  3) **التطابق**: رقم الطالبة نفسه في `/api/reports/overview` و`/api/sessions`
     و`/api/sessions/stats` — وهو بالضبط ما كان مكسورًا (1.5 مقابل 3.2).

الاستخدام (يكتب بيانات في القاعدة التي يعمل عليها الـ API — قاعدة اختبار فقط):
  EDULINK_API_URL=http://127.0.0.1:5279 \
  EDULINK_SETUP_EMAIL=owner@window-test.local EDULINK_SETUP_PASSWORD='Win@2026x' \
  EDULINK_SQLCMD='sqlcmd -S "(localdb)\MSSQLLocalDB" -E -d EdulinkVerify' \
  python tools/verify-session-window-and-hours.py

`EDULINK_SQLCMD` مطلوبة لبند واحد لا بديل له: إعمار حصة live بعد نهايتها
المجدولة (لا طريقة أخرى للوصول لتلك الحالة من خارج المنتج، والـ API لا يسمح
بكتابة موعد في الماضي). **بدونها البند أحمر لا أخضر.**

أي بند أحمر أو «لم أستطع التحقق» ⇒ خروج 1.
"""
import base64
import json
import os
import secrets
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request

# على هذا الجهاز المخرجات المُحوَّلة إلى ملف تُكتب cp1252 افتراضيًا فتسقط على
# أول سطر عربي — ترميز صريح لا خيار هنا.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE = os.environ.get("EDULINK_API_URL", "").rstrip("/")
HUB_PATH = "/hubs/meetings"  # كما يرسمها Program.cs:400 — المسار الخطأ يجعل كل بند «مرفوض» أخضر زورًا
ORIGIN = os.environ.get("EDULINK_ORIGIN", "http://localhost:5173")
SETUP_EMAIL = os.environ.get("EDULINK_SETUP_EMAIL", "")
SETUP_PASSWORD = os.environ.get("EDULINK_SETUP_PASSWORD", "")
SQLCMD = os.environ.get("EDULINK_SQLCMD", "")

TIMEOUT = 30
SUFFIX = str(time.time_ns())
_phone_seq = [0]

# النافذة كما في appsettings.json — لو تغيّر الإعداد عند المُشغِّل تُمرَّر هنا
EARLY_MINUTES = int(os.environ.get("EDULINK_JOIN_EARLY", "30"))
GRACE_MINUTES = int(os.environ.get("EDULINK_JOIN_GRACE", "5"))

# كم تبقى الطالبة داخل الغرفة في القياس: 240 ث = 0.1 ساعة بعشرية التقارير.
# أقل من ذلك يجعل المقارنة صفرًا مقابل صفر، وهو أخضر لا يعني شيئًا.
STUDENT_STAY_SECONDS = int(os.environ.get("EDULINK_STAY_SECONDS", "240"))

failures = []
checks = 0


def ok(label, detail=""):
    global checks
    checks += 1
    print(f"  ✓ {label}" + (f" — {detail}" if detail else ""))


def bad(label, detail):
    global checks
    checks += 1
    failures.append(f"{label}: {detail}")
    print(f"  ✗ {label} — {detail}")


def check(label, condition, detail):
    (ok if condition else bad)(label, detail if not condition else "")


def phone():
    _phone_seq[0] += 1
    return f"051{SUFFIX[-5:]}{_phone_seq[0]:02d}"


def email(tag):
    # @edulink.test عمدًا: هو النطاق الذي يعرفه deploy/cleanup-verification-data.sql
    # وtools/verify-no-dev-data.py — نطاق خاص كان يترك بقايا لا يحاسب عليها أحد.
    return f"w{tag}.{SUFFIX}@edulink.test"


def request(method, path, token=None, body=None, timeout=TIMEOUT):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Accept", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as res:
            return res.status, _json(res.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as err:
        return err.code, _json(err.read().decode("utf-8", "replace"))
    except Exception as err:
        return None, {"_transport": f"{type(err).__name__}: {err}"}


def _json(raw):
    try:
        return json.loads(raw)
    except Exception:
        return {"_raw": raw[:200]}


def login(email_, password, path="/api/auth/login"):
    return request("POST", path, body={"email": email_, "password": password})


# ───────── WebSocket خام + SignalR JSON (نفس عميل بوابة الشركات) ─────────

def _ws_frame(payload: bytes, opcode=1):
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    n = len(payload)
    if n < 126:
        head = struct.pack("!BB", 0x80 | opcode, 0x80 | n)
    elif n < 65536:
        head = struct.pack("!BBH", 0x80 | opcode, 0x80 | 126, n)
    else:
        head = struct.pack("!BBQ", 0x80 | opcode, 0x80 | 127, n)
    return head + mask + masked


def _ws_read(sock, timeout=15):
    sock.settimeout(timeout)
    head = sock.recv(2)
    if len(head) < 2:
        raise ConnectionError("websocket مغلق")
    opcode = head[0] & 0x0F
    n = head[1] & 0x7F
    if n == 126:
        n = struct.unpack("!H", sock.recv(2))[0]
    elif n == 127:
        n = struct.unpack("!Q", sock.recv(8))[0]
    payload = b""
    while len(payload) < n:
        chunk = sock.recv(n - len(payload))
        if not chunk:
            break
        payload += chunk
    return opcode, payload


class Hub:
    """عميل SignalR JSON بخام WebSocket — يقيس رفض `Join` كما يراه المتصفح."""

    def __init__(self, hub_path, token, timeout=20):
        self.timeout = timeout
        u = BASE.split("://", 1)
        self.secure = u[0] == "https"
        host, _, port = u[1].partition(":")
        self.host, self.port = host, int(port) if port else (443 if self.secure else 80)
        sep = "&" if "?" in hub_path else "?"
        path = f"{hub_path}{sep}access_token={urllib.request.quote(token)}"
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\nHost: {self.host}:{self.port}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
            f"Origin: {ORIGIN}\r\n\r\n"
        ).encode()
        raw = socket.create_connection((self.host, self.port), timeout=timeout)
        self.sock = self._ssl_wrap(raw) if self.secure else raw
        self.sock.sendall(req)
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("ردّ فارغ على ترقية WebSocket")
            buf += chunk
        status = buf.split(b"\r\n", 1)[0].decode("latin-1")
        if " 101 " not in status:
            raise ConnectionError(f"فشل الترقية: {status}")
        self.send_text('{"protocol":"json","version":1}\x1e')
        deadline = time.time() + timeout
        while True:
            if time.time() > deadline:
                raise TimeoutError("لا استجابة مصافحة SignalR")
            op, payload = _ws_read(self.sock, timeout)
            if op == 1:
                text = payload.decode("utf-8", "replace")
                if "\x1e" in text:
                    first = text.split("\x1e", 1)[0]
                    msg = json.loads(first) if first.strip() else {}
                    if msg.get("error"):
                        raise ConnectionError(f"فشل المصافحة: {msg['error']}")
                    return

    def _ssl_wrap(self, sock):
        import ssl
        return ssl.create_default_context().wrap_socket(sock, server_hostname=self.host)

    def send_text(self, text):
        self.sock.sendall(_ws_frame(text.encode("utf-8")))

    def join(self, room):
        self.send_text(json.dumps(
            {"type": 1, "invocationId": "1", "target": "Join",
             "arguments": [room, "student", None]}) + "\x1e")
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            try:
                op, payload = _ws_read(self.sock, timeout=5)
            except (socket.timeout, TimeoutError):
                continue
            if op == 8:
                return None, "websocket أُغلق قبل الاكتمال"
            if op != 1:
                continue
            for part in payload.decode("utf-8", "replace").split("\x1e"):
                if not part.strip():
                    continue
                msg = json.loads(part)
                if msg.get("type") == 3:
                    if "error" in msg:
                        return None, msg["error"]
                    return msg.get("result"), None
                if msg.get("type") == 7:
                    return None, msg.get("error", "اتصال أُغلق")
        return None, f"انتهت المهلة ({self.timeout} ث) بلا اكتمال"

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


def join_attempt(token, room):
    """الاتصال والانضمام ثم إغلاق نظيف. يرجع (result, error)."""
    try:
        hub = Hub(HUB_PATH, token)
    except Exception as err:
        return None, f"transport: {err}"
    try:
        return hub.join(room)
    except Exception as err:
        return None, f"transport: {err}"
    finally:
        hub.close()


def keep_open_join(token, room):
    """اتصال يبقى مفتوحًا (لقياس المدة الحقيقية) — يرجع (hub, result, error)."""
    try:
        hub = Hub(HUB_PATH, token)
    except Exception as err:
        return None, None, f"transport: {err}"
    try:
        result, error = hub.join(room)
    except Exception as err:
        hub.close()
        return None, None, f"transport: {err}"
    return hub, result, error


def transport_failure(error):
    """
    الرفض الحقيقي يأتي من الـ Hub (نص عربي من SessionWindow). أما فشل الترقية
    أو انتهاء المهلة فمعناه أن البند **لم يُقَس** — وعدّه نجاحًا هو أخطر عيب في
    بوابة: أول تشغيل لهذا الملف أخضر بنود «مرفوض» كلها وهو لا يصل القاعدة أصلًا.
    """
    return error is not None and str(error).startswith("transport:")


def check_acceptance(label, error):
    if transport_failure(error):
        bad(label, f"لم أُتحقق — الاتصال نفسه فشل: {error}")
    elif error is not None:
        bad(label, f"رُفض: {error}")
    else:
        ok(label, "قُبل من الخادم")


def check_refusal(label, error):
    if transport_failure(error):
        bad(label, f"لم أُتحقق — الاتصال نفسه فشل: {error}")
    elif error is None:
        bad(label, "قُبل الانضمام! النافذة لا تُفرض في الـ Hub")
    else:
        ok(label, str(error)[:80])


def sql(script):
    if not SQLCMD:
        return None
    try:
        proc = subprocess.run(SQLCMD + " -I -b -Q " + json.dumps(script),
                              shell=True, capture_output=True, timeout=60)
    except Exception as err:
        return f"__error__ {err}"
    if proc.returncode != 0:
        return f"__error__ {proc.stderr.decode('utf-8', 'replace')[:200]}"
    return proc.stdout.decode("utf-8", "replace")


def iso(minutes_from_now):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + minutes_from_now * 60))


# ───────── التجهيز ─────────

def bootstrap():
    """مالك (إنشاء إن كانت القاعدة فارغة) + مدرس + طالبتان — كلها من نقاط الـ API."""
    request("POST", "/api/setup/owner",
            body={"name": "مالك النافذة", "email": SETUP_EMAIL, "password": SETUP_PASSWORD})
    status, body = login(SETUP_EMAIL, SETUP_PASSWORD)
    if status != 200:
        raise SystemExit(f"دخول المالك فشل ({status}): {body}")
    token = body["token"]

    ids = {}
    status, body = request("POST", "/api/users", token, {
        "name": "مدرس النافذة", "email": email("teacher"),
        "password": "Teach@2026x", "role": 0, "access": 1, "states": 1, "phone": phone()})
    if status != 201:
        raise SystemExit(f"إنشاء المدرس فشل ({status}): {body}")
    ids["teacher"] = body["id"]

    for key, name in (("studentA", "روان أ"), ("studentB", "روان ب")):
        status, body = request("POST", "/api/students", token, {
            "name": name, "email": email(key), "password": "Stud@2026x",
            "phone": phone(), "states": 1, "access": 1})
        if status != 201:
            raise SystemExit(f"إنشاء {key} فشل ({status}): {body}")
        ids[key] = body["id"]

    status, body = login(email("teacher"), "Teach@2026x")
    if status != 200:
        raise SystemExit(f"دخول المدرس فشل ({status}): {body}")
    ids["teacherToken"] = body["token"]

    for key in ("studentA", "studentB"):
        status, body = login(email(key), "Stud@2026x", "/api/auth/students/login")
        if status != 200:
            raise SystemExit(f"دخول {key} فشل ({status}): {body}")
        ids[key + "Token"] = body["token"]

    return token, ids


def create_session(token, teacher_id, student_id, minutes_from_now, duration_min, subject):
    status, body = request("POST", "/api/sessions", token, {
        "subject": subject, "teacherId": teacher_id, "studentId": student_id,
        "gradeKey": "g7", "durationMin": duration_min, "startsAt": iso(minutes_from_now)})
    if status != 201:
        raise SystemExit(f"إنشاء الحصة فشل ({status}): {body}")
    return body


def session_row(rows, session_id):
    for row in rows:
        if row["id"] == session_id:
            return row
    return None


# ───────── 1) النافذة تُفرض في الخادم ─────────

def test_window(token, ids, sessions):
    print("\n[1] نافذة الانضمام مقيسة من Hub وHTTP")

    status, body = request("GET", "/api/sessions", ids["teacherToken"])
    if status != 200:
        bad("GET /api/sessions", f"الحالة {status}: {body}")
        return
    rows = body

    expected_states = {
        "future": "tooEarly",
        "inWindow": "open",
        "past": "windowClosed",
    }
    for key, want in expected_states.items():
        row = session_row(rows, sessions[key]["id"])
        if row is None:
            bad(f"joinState لحصة {key}", "الحصة غير موجودة في ردّ المدرس")
            continue
        check(f"joinState = {want} لحصة {key}",
              row.get("joinState") == want,
              f"رجع {row.get('joinState')!r} (المفروض {want}) — الحالة {row.get('status')} "
              f"وتبدأ {row.get('startsAt')}; إن كانت no_show ففاحص الحصص الفائتة سبق البوابة "
              f"وأغلقها: أعد التشغيل بـ Sessions__MissedGraceMinutes كبيرًا")

    for key, want in expected_states.items():
        room = sessions[key]["code"]
        result, error = join_attempt(ids["teacherToken"], room)
        if want == "open":
            check_acceptance(f"انضمام حصة {key} (مفتوحة)", error)
        else:
            check_refusal(f"انضمام حصة {key} مرفوض", error)

    # الطالب: نفس النافذة على نفس الحصة
    result, error = join_attempt(ids["studentAToken"], sessions["future"]["code"])
    check_refusal("طالب يحاول حصة مستقبلية ⇒ مرفوض", error)
    result, error = join_attempt(ids["studentAToken"], sessions["inWindow"]["code"])
    check_acceptance("طالب يحاول حصة في نافذتها ⇒ مقبول", error)

    # HTTP لا يفتح بابًا خلفيًا
    status, body = request("PATCH", f"/api/sessions/{sessions['future']['id']}",
                           ids["teacherToken"], {"status": "live"})
    check("PATCH status=live على حصة مستقبلية ⇒ 400",
          status == 400, f"رجع {status}: {body}")
    status, body = request("POST", f"/api/sessions/{sessions['future']['id']}/attendance",
                           ids["teacherToken"], {"studentId": ids["studentA"]})
    check("تسجيل حضور على حصة مستقبلية ⇒ 400",
          status == 400, f"رجع {status}: {body}")
    status, body = request("POST", f"/api/sessions/{sessions['future']['id']}/end",
                           ids["teacherToken"], {"by": "teacher"})
    check("إنهاء حصة لم تُفتح ⇒ مرفوض (لا يُكذب عليها «مكتملة»)",
          status == 400, f"رجع {status}: {body}")


def test_live_stays_open(token, ids, sessions):
    """
    الحصة الجارية تبقى مفتوحة بعد نهايتها المجدولة — الحالة التي لا تُبنى من
    خارج المنتج: حصة في نافذتها تُحوَّل live، ثم يُرجَع موعدنها بـ UPDATE واحد.
    """
    print("\n[2] حصة live بعد نهاية موعدها (انقطاع اتصال الطالب في منتصفها)")
    if not SQLCMD:
        bad("بقاء live مفتوحة", "EDULINK_SQLCMD غير مضبوطة — البند لم يُقَس ولا يُقرأ نجاحًا")
        return

    session = sessions["liveLong"]
    status, body = request("PATCH", f"/api/sessions/{session['id']}",
                           ids["teacherToken"], {"status": "live"})
    if status != 200:
        bad("تحويل الحصة إلى live", f"رجع {status}: {body}")
        return

    out = sql(f"UPDATE dbo.[Edu_Sessions] SET startsAt = DATEADD(minute, -180, startsAt) "
              f"WHERE id = {session['id']};")
    if out is None or str(out).startswith("__error__"):
        bad("إعمار موعد الحصة (sqlcmd)", f"فشل التحديث: {out}")
        return

    result, error = join_attempt(ids["studentAToken"], session["code"])
    check_acceptance("طالب يعود إلى حصة live بعد نهاية موعدها ⇒ مقبول", error)

    status, row = request("GET", f"/api/sessions/{session['id']}", ids["teacherToken"])
    check("joinState = open لهذه الحصة (وليست windowClosed)",
          isinstance(row, dict) and (row.get("session") or {}).get("joinState") == "open",
          f"رجع {(row.get('session') or {}).get('joinState') if isinstance(row, dict) else row}")


# ───────── 2) الوقت الفعلي المقيس ─────────

def test_actual_minutes(token, ids, sessions):
    print("\n[3] الساعات = الجلوس داخل الغرفة، لا المدة المكتوبة")

    session = sessions["inWindow"]
    # شريطان للمدرس بينهما خروج ودخول جديد — المفروض يُجمَعان
    hub1, result, error = keep_open_join(ids["teacherToken"], session["code"])
    if error is not None:
        bad("الدخول الأول للمدرس", f"رُفض: {error}")
        return
    enter1 = time.time()
    time.sleep(6)
    hub1.close()
    leave1 = time.time()
    time.sleep(2)  # حتى يلتقط الخادم الانفصال ويختم الشريط

    hub2, result, error = keep_open_join(ids["teacherToken"], session["code"])
    if error is not None:
        bad("الدخول الثاني للمدرس", f"رُفض: {error}")
        return
    enter2 = time.time()
    time.sleep(6)
    hub2.close()
    leave2 = time.time()
    time.sleep(2)

    student_hub, result, error = keep_open_join(ids["studentAToken"], session["code"])
    if error is not None:
        bad("دخول الطالبة", f"رُفض: {error}")
        return
    s_enter = time.time()
    # 4 دقائق لا ثوانٍ: عشرية الساعة في التقارير لا تُظهر أقل من ذلك، والمقارنة
    # التي طرفاها صفران لا تُثبت شيئًا (كان أول تشغيل أخضر على 0.0 = 0.0).
    time.sleep(STUDENT_STAY_SECONDS)
    student_hub.close()
    s_leave = time.time()
    time.sleep(2)

    measured_teacher = (leave1 - enter1) + (leave2 - enter2)
    measured_student = s_leave - s_enter

    status, body = request("POST", f"/api/sessions/{session['id']}/end",
                           ids["teacherToken"], {"by": "teacher"})
    if status != 200:
        bad("إنهاء الحصة", f"رجع {status}: {body}")
        return

    minutes = body.get("actualMinutes")
    student_minutes = body.get("studentMinutes")
    duration = body.get("durationMin")
    if not isinstance(minutes, (int, float)):
        bad("actualMinutes في الردّ", f"مفقود أو ليس رقمًا: {minutes!r}")
        return

    check("الحصة اكتملت", body.get("status") == "completed", f"status={body.get('status')}")
    check(f"الوقت المقيس أقل من المدة المكتوبة ({duration} د)",
          minutes < duration,
          f"actualMinutes={minutes} — ما زال يُنسَخ من durationMin")
    check(f"المدرسان يُجمَع شريطاهما ({measured_teacher:.0f} ث ≈ {measured_teacher/60:.2f} د)",
          abs(minutes - measured_teacher / 60) <= 1.0,
          f"actualMinutes={minutes} د مقابل مقيس خارجيًا {measured_teacher/60:.2f} د")
    check(f"جلوس الطالبة يُقاس وحده ({measured_student:.0f} ث ≈ {measured_student/60:.2f} د)",
          isinstance(student_minutes, (int, float))
          and abs(student_minutes - measured_student / 60) <= 1.0,
          f"studentMinutes={student_minutes!r} مقابل مقيس خارجيًا {measured_student/60:.2f} د")

    # البدائل القديمة: حصة بلا أشرطة، والرقم الذي أرسلته الشاشة يجب أن يُستعمل
    legacy = sessions["legacy"]
    status, body = request("PATCH", f"/api/sessions/{legacy['id']}",
                           ids["teacherToken"], {"status": "live"})
    if status != 200:
        bad("تحويل الحصة القديمة إلى live", f"رجع {status}: {body}")
        return
    status, body = request("POST", f"/api/sessions/{legacy['id']}/end",
                           ids["teacherToken"], {"by": "teacher", "durationMinutes": 7})
    if status != 200:
        bad("إنهاء الحصة القديمة بـ 7 دقائق", f"رجع {status}: {body}")
        return
    check("حصة بلا أشرطة ⇒ metadata.durationMinutes هو المُستعمَل (7 لا 45)",
          body.get("actualMinutes") == 7,
          f"actualMinutes={body.get('actualMinutes')!r} وdurationMin={body.get('durationMin')}")
    check("أساسان مختلفان فعلًا: الطالبة التي لم تدخل = 0 دقيقة وهي 7 دقائق مدرّس",
          body.get("studentMinutes") == 0,
          f"studentMinutes={body.get('studentMinutes')!r} — رقم المدرس يُعاد استخدامه لصف الطالب")

    # الانضمام لحصة مكتملة مرفوض، والزرار يُقرأ من joinState
    result, error = join_attempt(ids["teacherToken"], session["code"])
    check_refusal("انضمام بعد الإنهاء ⇒ مرفوض", error)
    after = session_row(request("GET", "/api/sessions", ids["teacherToken"])[1], session["id"])
    check("joinState = finished بعد الإنهاء",
          after is not None and after.get("joinState") == "finished",
          f"رجع {after and after.get('joinState')!r}")


# ───────── 3) تطابق الأرقام بين الأسطح ─────────

def test_consistency(token, ids, sessions):
    print("\n[4] رقم الطالبة نفسه في كل سطح")

    status, rows = request("GET", "/api/sessions", token)
    if status != 200:
        bad("GET /api/sessions بالمالك", f"رجع {status}")
        return

    # الطالبة أ جلست في الغرفة فعليًا ⇒ رقم غير صفر يجب أن يتطابق في الثلاثة مصادر.
    # الطالبة ب لم تدخل حصة اكتملت قط ⇒ صفرها **نتيجة مقصودة**: كان الصف القديم
    # يرث رقم مدرّسها (0.1)، فالتطابق على صفرين هنا قياس لا مقارنة فارغة.
    expect_nonzero = {"studentA": True, "studentB": False}

    for key, label in (("studentA", "الطالبة أ"), ("studentB", "الطالبة ب")):
        student_id = ids[key]
        mine = [s for s in rows if s["studentId"] == student_id
                and s["status"] == "completed"]
        # نفس حساب الواجهة حرفيًا لصف طالب: Σ studentMinutes / 60 بعشرية واحدة
        local_hours = round(sum(s["studentMinutes"] for s in mine) / 60, 1)

        status, overview = request("GET", "/api/reports/overview", token)
        if status != 200:
            bad("GET /api/reports/overview", f"رجع {status}")
            return
        row = next((r for r in overview.get("students", []) if r["id"] == student_id), None)
        if row is None:
            bad(f"صف {label} في التقارير", "الطالبة ليست في قائمة الطلاب")
            continue
        report_hours = row["rows"]["completedHours"]

        if expect_nonzero[key] and abs(report_hours) < 0.05 and abs(local_hours) < 0.05:
            bad(f"{label}: مقارنة التقارير بالمجموع",
                "صفر في المصدرين — لا مقارنة فعلية؛ زد EDULINK_STAY_SECONDS")
            continue
        check(f"{label}: التقارير {report_hours} = مجموع DTO {local_hours}"
              + (" (جلست فعلًا)" if expect_nonzero[key] else " (لم تدخل ⇒ صفر لا رقم مدرّسها)"),
              abs(report_hours - local_hours) < 0.051
              and (report_hours > 0 if expect_nonzero[key] else report_hours == 0),
              f"فرق {round(report_hours - local_hours, 3)} ساعة وقيمة {report_hours} "
              f"— نفس العطل الذي أعطى 1.5 مقابل 3.2")

        status, stats = request("GET", f"/api/sessions/stats?studentId={student_id}", token)
        if status != 200:
            bad(f"/api/sessions/stats للطالبة {label}", f"رجع {status}")
            continue
        check(f"{label}: stats {stats.get('hours')} = التقارير {report_hours}",
              abs(float(stats.get("hours", -1)) - report_hours) < 0.051,
              f"مصدر ثالث يعيد رقمًا مختلفًا: {stats.get('hours')}")

    status, overview = request("GET", "/api/reports/overview", token)
    weekly = overview.get("weekly", [])
    check("رسم الأسابيع 12 بندًا في الخادم (والواجهة صارت 12 مثلها)",
          len(weekly) == 12, f"رجع {len(weekly)} بندًا")

    teacher_row = next((r for r in overview.get("teachers", [])
                        if r["id"] == ids["teacher"]), None)
    if teacher_row is None:
        bad("صف المدرس في التقارير", "المدرس ليس في قائمة المدرسين")
        return
    teacher_local = round(sum(s["actualMinutes"] for s in rows
                              if s["teacherId"] == ids["teacher"] and s["status"] == "completed") / 60, 1)
    if abs(teacher_row["rows"]["completedHours"]) < 0.05 and abs(teacher_local) < 0.05:
        bad("مقارنة ساعات المدرس", "صفر في المصدرين — لا مقارنة فعلية")
        return
    check(f"ساعات المدرس = Σ الوقت المقيس لحصصه ({teacher_local})",
          abs(teacher_row["rows"]["completedHours"] - teacher_local) < 0.051,
          f"التقارير {teacher_row['rows']['completedHours']} مقابل {teacher_local}")


def main():
    if not BASE or not SETUP_EMAIL or not SETUP_PASSWORD:
        raise SystemExit("EDULINK_API_URL وEDULINK_SETUP_EMAIL وEDULINK_SETUP_PASSWORD مطلوبة")

    print(f"الهدف: {BASE} | النافذة: −{EARLY_MINUTES} د قبل، +{GRACE_MINUTES} د بعد النهاية")
    token, ids = bootstrap()

    sessions = {
        "future": create_session(token, ids["teacher"], ids["studentA"], 180, 60, "رياضيات النافذة"),
        "inWindow": create_session(token, ids["teacher"], ids["studentA"], -5, 60, "علوم النافذة"),
        "past": create_session(token, ids["teacher"], ids["studentA"], -180, 60, "فيزياء النافذة"),
        "liveLong": create_session(token, ids["teacher"], ids["studentA"], -5, 60, "كيمياء النافذة"),
        "legacy": create_session(token, ids["teacher"], ids["studentB"], -2, 45, "أحياء القديمة"),
    }

    test_window(token, ids, sessions)
    test_live_stays_open(token, ids, sessions)
    test_actual_minutes(token, ids, sessions)
    test_consistency(token, ids, sessions)

    print(f"\n{checks} بندًا مقسومًا — {len(failures)} أحمر")
    for line in failures:
        print(f"  ✗ {line}")
    if failures:
        print("\nالنتيجة: أحمر")
        return 1
    print("\nالنتيجة: أخضر — النافذة والساعات المقيسة تعمل")
    return 0


if __name__ == "__main__":
    sys.exit(main())
