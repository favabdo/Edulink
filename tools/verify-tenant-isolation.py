#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
بوابة عزل الشركات (multi-tenant) — تقيس العزل من خارج الشيفرة، بدءًا من حسابي
مالكَي شركتين مختلفتين على نفس القاعدة:

  • قوائم المستخدمين/الطلاب/أولياء الأمور لا تُظهر شركة الأخرى (بالوجهين)
  • سجل الطالب الغريب ⇒ 404
  • حصة بمدرس/طالب من شركة أخرى ⇒ 400
  • قائمة الحصص والتقارير لا تُسرب حصص/مدرسين الشركة الأخرى
  • تعديل حساب شركة أخرى ⇒ 404
  • مراسلة شركة أخرى ⇒ 403
  • الانضمام لغرفة حصة شركة أخرى ⇒ يُرفض من الخادم (SignalR JSON خام)
  • وعلى العكس — كل شاشة داخل الشركة نفسها تعمل (القياس العكسي الإلزامي)

الاستخدام (كتابات على القاعدة — لا تُشغَّله على قاعدة إنتاج حقيقية إلا وأنت تعلم):
  EDULINK_API_URL=http://127.0.0.1:5299 \
  EDULINK_TENANT_A_EMAIL=... EDULINK_TENANT_A_PASSWORD=... \
  EDULINK_TENANT_B_EMAIL=... EDULINK_TENANT_B_PASSWORD=... \
  python tools/verify-tenant-isolation.py

أي بند أحمر أو «لم أُتحقق» ⇒ خروج 1.
"""
import base64
import hashlib
import json
import os
import secrets
import socket
import struct
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("EDULINK_API_URL", "").rstrip("/")
ORIGIN = os.environ.get("EDULINK_ORIGIN", "http://localhost:5173")
EMAIL_A = os.environ.get("EDULINK_TENANT_A_EMAIL", "")
PASS_A = os.environ.get("EDULINK_TENANT_A_PASSWORD", "")
EMAIL_B = os.environ.get("EDULINK_TENANT_B_EMAIL", "")
PASS_B = os.environ.get("EDULINK_TENANT_B_PASSWORD", "")

TIMEOUT = 30
_suffix = str(time.time_ns())
_phone_seq = [0]


def phone():
    _phone_seq[0] += 1
    return f"050{_suffix[-5:]}{_phone_seq[0]:02d}"


def email(tag):
    return f"t{tag}.{_suffix}@tenant-test.local"


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
            raw = res.read().decode("utf-8", "replace")
            return res.status, _json(raw)
    except urllib.error.HTTPError as err:
        return err.code, _json(err.read().decode("utf-8", "replace"))
    except Exception as err:
        return None, {"_transport": f"{type(err).__name__}: {err}"}


def _json(raw):
    try:
        return json.loads(raw)
    except Exception:
        return {"_raw": raw[:200]}


def login(email_, password):
    return request("POST", "/api/auth/login", body={"email": email_, "password": password})


def login_parent(email_, password):
    return request("POST", "/api/auth/parents/login", body={"email": email_, "password": password})


# ───────── WebSocket خام + SignalR JSON ─────────

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
    """عميل SignalR JSON بخام WebSocket — يكفي للاتصال والاستدعاء وقراءة الخطأ."""

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
        self.sock = (ssl_wrap(raw, self.host) if self.secure else raw)
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
        # مصافحة SignalR
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

    def send_text(self, text):
        self.sock.sendall(_ws_frame(text.encode("utf-8")))

    def invoke(self, target, *args):
        self.send_text(json.dumps(
            {"type": 1, "invocationId": "1", "target": target, "arguments": list(args)}) + "\x1e")
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            try:
                op, payload = _ws_read(self.sock, timeout=5)
            except (socket.timeout, TimeoutError):
                continue
            if op == 8:
                raise ConnectionError("websocket أُغلق قبل الاكتمال")
            if op != 1:
                continue
            for part in payload.decode("utf-8", "replace").split("\x1e"):
                if not part.strip():
                    continue
                msg = json.loads(part)
                if msg.get("type") == 3:  # Completion
                    if "error" in msg:
                        return None, msg["error"]
                    return msg.get("result"), None
                if msg.get("type") == 7:  # Close (HubException)
                    return None, msg.get("error", "اتصال أُغلق")
        return None, f"انتهت المهلة ({self.timeout} ث) بلا اكتمال"

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


def ssl_wrap(sock, host):
    import ssl
    ctx = ssl.create_default_context()
    return ctx.wrap_socket(sock, server_hostname=host)


# ───────── تجهيز بيانات كل شركة عبر الـ API فقط ─────────

def provision_company(owner_email, owner_pass, side):
    """تسجيل دخول المالك ثم إنشاء (مدرس، طالب، ولي أمر مرتبط، حصة مستقبلية).
    يعيد قاموسًا بالمعرّفات أو يرفع RuntimeError برسالة واضحة."""
    status, blob = login(owner_email, owner_pass)
    if status != 200 or not isinstance(blob, dict) or "token" not in blob:
        raise RuntimeError(
            f"لم أُتحقق: دخول المالك {owner_email} ⇒ {status} {str(blob)[:150]} "
            "— أنشئ الشركتين أولًا (setup/owner وsetup/tenant)")
    tok = blob["token"]
    out = {"token": tok, "ownerId": blob["user"]["id"], "emails": []}

    tch_email, stu_email, par_email = email(f"{side}.tch"), email(f"{side}.stu"), email(f"{side}.par")

    status, blob = request("POST", "/api/users", tok, {
        "name": "مدرس اختبار العزل", "email": tch_email, "password": "Isol@t10n!x",
        "role": 0, "states": 1, "access": 1, "phone": phone()})
    if status != 201:
        raise RuntimeError(f"إنشاء مدرس الشركة ⇒ {status} {str(blob)[:150]}")
    out["teacherId"] = blob["id"]

    status, blob = request("POST", "/api/students", tok, {
        "name": "طالب اختبار العزل", "email": stu_email, "password": "Isol@t10n!x",
        "states": 1, "access": 1, "phone": phone()})
    if status != 201:
        raise RuntimeError(f"إنشاء طالب الشركة ⇒ {status} {str(blob)[:150]}")
    out["studentId"] = blob["id"]

    status, blob = request("POST", "/api/parents", tok, {
        "name": "ولي اختبار العزل", "email": par_email, "password": "Isol@t10n!x",
        "access": 1, "studentId": out["studentId"], "relation": 0, "phone": phone()})
    if status != 201:
        raise RuntimeError(f"إنشاء ولي أمر الشركة ⇒ {status} {str(blob)[:150]}")
    out["parentId"] = blob["id"]
    out["parentEmail"] = par_email
    out["emails"] = [tch_email, stu_email, par_email]

    starts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 86400))
    status, blob = request("POST", "/api/sessions", tok, {
        "subject": "حصة عزل", "teacherId": out["teacherId"], "studentId": out["studentId"],
        "gradeKey": "g7", "durationMin": 60, "startsAt": starts})
    if status != 201:
        raise RuntimeError(f"جدولة حصة الشركة ⇒ {status} {str(blob)[:150]}")
    out["sessionCode"] = blob["code"]
    out["sessionId"] = blob["id"]
    return out


def list_emails(tok, path, key):
    status, blob = request("GET", path, tok)
    if status != 200 or not isinstance(blob, list):
        return None
    return {str(item.get(key, "")).lower() for item in blob}


def run():
    ok, bad = [], []
    if not BASE:
        bad.append("لم أُتحقق: اضبط EDULINK_API_URL")
        return ok, bad
    if not (EMAIL_A and PASS_A and EMAIL_B and PASS_B):
        bad.append("لم أُتحقق: اضبط بيانات مالكي الشركتين "
                   "(EDULINK_TENANT_A_EMAIL/PASSWORD وEDULINK_TENANT_B_EMAIL/PASSWORD)")
        return ok, bad

    status, blob = request("GET", "/api/health/db")
    if status != 200 or not isinstance(blob, dict):
        bad.append(f"لم أُتحقق: /api/health/db ⇒ {status} {str(blob)[:120]}")
        return ok, bad
    ok.append(f"✓ الـ API حيّ على {BASE} (مزوّد {blob.get('provider')})")

    try:
        A = provision_company(EMAIL_A, PASS_A, "A")
        B = provision_company(EMAIL_B, PASS_B, "B")
    except RuntimeError as err:
        bad.append(str(err))
        return ok, bad
    ok.append(f"✓ شركتان مُجهّزتان عبر الـ API: "
              f"مالك A={A['ownerId']} ومالك B={B['ownerId']} وحصة A={A['sessionCode']} وحصة B={B['sessionCode']}")

    # 1) قوائم المستخدمين — بالوجهين
    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        leaked = _foreign_emails_in(mine, other, "/api/users", "email")
        if leaked is None:
            bad.append(f"لم أُتحقق: قائمة المستخدمين لـ {side} لم تُقرأ")
        elif leaked:
            bad.append(f"تسريب: مالك {side} يرى حسابات الشركة الأخرى في /api/users: {leaked}")
        else:
            ok.append(f"✓ {side}: /api/users بلا حسابات الشركة الأخرى")

    # 2) قوائم الطلاب — بالوجهين
    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        leaked = _foreign_emails_in(mine, other, "/api/students", "email")
        if leaked is None:
            bad.append(f"لم أُتحقق: قائمة الطلاب لـ {side} لم تُقرأ")
        elif leaked:
            bad.append(f"تسريب: مالك {side} يرى طلاب الشركة الأخرى في /api/students: {leaked}")
        else:
            ok.append(f"✓ {side}: /api/students بلا طلاب الشركة الأخرى")

    # 3) قوائم أولياء الأمور — بالوجهين
    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        leaked = _foreign_emails_in(mine, other, "/api/parents", "email")
        if leaked is None:
            bad.append(f"لم أُتحقق: قائمة أولياء الأمور لـ {side} لم تُقرأ")
        elif leaked:
            bad.append(f"تسريب: مالك {side} يرى أولياء الشركة الأخرى في /api/parents: {leaked}")
        else:
            ok.append(f"✓ {side}: /api/parents بلا أولياء الشركة الأخرى")

    # 4) سجل الطالب الغريب ⇒ 404 (بالوجهين)
    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        status, blob = request("GET", f"/api/students/{other['studentId']}", mine["token"])
        if status == 200:
            bad.append(f"تسريب: مالك {side} قرأ ملف طالب الشركة الأخرى ⇒ 200")
        elif status == 404:
            ok.append(f"✓ {side}: طالب الشركة الأخرى ⇒ 404")
        else:
            bad.append(f"غير متوقع: طالب الشركة الأخرى لـ {side} ⇒ {status} (المطلوب 404)")

    # 5) حصة بمدرس/طالب من شركة أخرى ⇒ 400
    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        starts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 90000))
        status, blob = request("POST", "/api/sessions", mine["token"], {
            "subject": "حصة عبرية", "teacherId": other["teacherId"],
            "studentId": mine["studentId"], "gradeKey": "g7",
            "durationMin": 60, "startsAt": starts})
        if status in (200, 201):
            bad.append(f"تسريب: مالك {side} جدول حصة على مدرس الشركة الأخرى ⇒ {status}")
        elif status == 400:
            ok.append(f"✓ {side}: جدولة على مدرس الشركة الأخرى ⇒ 400")
        else:
            bad.append(f"غير متوقع: جدولة عبرية (مدرس) لـ {side} ⇒ {status} {str(blob)[:120]}")

    # 6) قائمة الحصص لا تُسرب شركة الأخرى
    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        status, blob = request("GET", "/api/sessions", mine["token"])
        if status != 200 or not isinstance(blob, list):
            bad.append(f"لم أُتحقق: قائمة الحصص لـ {side} ⇒ {status}")
            continue
        codes = {s.get("code") for s in blob}
        if other["sessionCode"] in codes:
            bad.append(f"تسريب: مالك {side} يرى حصة الشركة الأخرى ({other['sessionCode']})")
        elif mine["sessionCode"] not in codes:
            bad.append(f"كسر وظيفي: مالك {side} لا يرى حصته هو ({mine['sessionCode']})")
        else:
            ok.append(f"✓ {side}: /api/sessions حصته هو وحده")

    # 7) تعديل حساب شركة أخرى ⇒ 404
    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        status, blob = request("PATCH", f"/api/users/{other['teacherId']}", mine["token"],
                               {"name": "اختراق"})
        if status == 200:
            bad.append(f"تسريب: مالك {side} عدّل حساب الشركة الأخرى ⇒ 200")
        elif status == 404:
            ok.append(f"✓ {side}: تعديل حساب الشركة الأخرى ⇒ 404")
        else:
            bad.append(f"غير متوقع: تعديل عبر الشركة لـ {side} ⇒ {status} (المطلوب 404)")

    # 8) التقارير: كونسول الإدارة لا يرى مدرس الشركة الأخرى
    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        status, blob = request("GET", "/api/reports/overview", mine["token"])
        if status != 200 or not isinstance(blob, dict):
            bad.append(f"لم أُتحقق: /api/reports/overview لـ {side} ⇒ {status}")
            continue
        tids = {t.get("id") for t in blob.get("teachers", [])}
        sids = {s.get("id") for s in blob.get("students", [])}
        if other["teacherId"] in tids or other["studentId"] in sids:
            bad.append(f"تسريب: تقارير مالك {side} تُظهر أطراف الشركة الأخرى")
        else:
            ok.append(f"✓ {side}: تقارير المؤسسة بلا أطراف الشركة الأخرى")

    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        status, blob = request("GET", f"/api/reports/teachers/{other['teacherId']}", mine["token"])
        if status == 200:
            bad.append(f"تسريب: تقرير مدرس الشركة الأخرى ⇒ 200 لـ {side}")
        elif status == 404:
            ok.append(f"✓ {side}: تقرير مدرس الشركة الأخرى ⇒ 404")
        else:
            bad.append(f"غير متوقع: تقرير المدرس العابر لـ {side} ⇒ {status} (المطلوب 404)")

    # 9) المراسلة عبر الشركات ⇒ 403
    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        status, blob = request("POST", "/api/messages/send", mine["token"], {
            "recipientKind": "staff", "recipientId": other["ownerId"],
            "body": "رسالة عبرية بين شركتين"})
        if status == 200:
            bad.append(f"تسريب: مالك {side} أرسل رسالة لشركة أخرى ⇒ 200")
        elif status == 403:
            ok.append(f"✓ {side}: مراسلة شركة أخرى ⇒ 403")
        else:
            bad.append(f"غير متوقع: رسالة عابرة للشركات لـ {side} ⇒ {status} (المطلوب 403)")

    # 10) الانضمام لغرفة شركة أخرى يُرفض + غرفة الشركة نفسها تعمل
    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        hub = None
        try:
            hub = Hub("/hubs/meetings", mine["token"])
            result, err = hub.invoke("Join", other["sessionCode"], "observer", "مالك اختبار")
            if err is None:
                bad.append(f"تسريب غرفة: مالك {side} انضم لغرفة الشركة الأخرى {other['sessionCode']}")
            else:
                ok.append(f"✓ {side}: غرفة الشركة الأخرى تُرفض ({str(err)[:60]})")
        except Exception as err:
            # رفض المصافحة نفسه مقبول إذا كان بسبب الغرفة — لا نعرف سببه هكذا
            bad.append(f"لم أُتحقق: فحص غرفة الشركة الأخرى لـ {side} انهار بـ {type(err).__name__}: {err}")
        finally:
            if hub:
                hub.close()

    for side, mine in (("A", A), ("B", B)):
        hub = None
        try:
            hub = Hub("/hubs/meetings", mine["token"])
            result, err = hub.invoke("Join", mine["sessionCode"], "observer", "مالك اختبار")
            if err is not None or not isinstance(result, dict) or "room" not in result:
                bad.append(f"كسر وظيفي: مالك {side} لم يستطع دخول غرفته: {err or result}")
            else:
                ok.append(f"✓ {side}: دخول غرفته يعمل ({result.get('room')})")
        except Exception as err:
            bad.append(f"لم أُتحقق: فحص غرفة الشركة نفسها لـ {side} انهار بـ {type(err).__name__}: {err}")
        finally:
            if hub:
                hub.close()

    # 11) ولي الأمر يرى أبناءه فقط عبر mine=1 — وولي الشركة الأخرى لا يرى غير أبنائها
    for side, (mine, other) in (("A", (A, B)), ("B", (B, A))):
        status, blob = login_parent(mine["parentEmail"], "Isol@t10n!x")
        if status != 200 or not isinstance(blob, dict) or "token" not in blob:
            bad.append(f"لم أُتحقق: دخول ولي أمر الشركة {side} ⇒ {status} {str(blob)[:120]}")
            continue
        status, blob = request("GET", "/api/parents/children?mine=1", blob["token"])
        if status != 200 or not isinstance(blob, list):
            bad.append(f"لم أُتحقق: children?mine=1 لولي الشركة {side} ⇒ {status}")
            continue
        ids = {row.get("student", {}).get("id") for row in blob}
        if other["studentId"] in ids:
            bad.append(f"تسريب: ولي أمر الشركة {side} يرى ابن الشركة الأخرى")
        elif mine["studentId"] not in ids:
            bad.append(f"كسر وظيفي: ولي أمر الشركة {side} لا يرى ابنه هو — أعاد {ids}")
        else:
            ok.append(f"✓ {side}: ولي الأمر يرى أبناءه فقط عبر mine=1")

    return ok, bad


def _foreign_emails_in(mine, other, path, key):
    """بريدات الشركة الأخرى التي ظهرت لقائمة الشركة mine — None إن لم تُقرأ القائمة."""
    emails = list_emails(mine["token"], path, key)
    if emails is None:
        return None
    foreign = []
    for e in (other.get("emails") or []):
        if e in emails:
            foreign.append(e)
    return foreign


if __name__ == "__main__":
    lines, failures = run()
    for line in lines:
        print(line)
    for line in failures:
        print("✗ " + line)
    print(f"\nالنتيجة: {len(lines)} بندًا أخضر، {len(failures)} أحمر/لم يُتحقق")
    sys.exit(1 if failures else 0)
