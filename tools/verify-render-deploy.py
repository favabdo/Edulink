# -*- coding: utf-8 -*-
"""
بوابة التحقق من نشر EduLink على وسيط عام (Render / أي nginx أمامي مع TLS).
docs/12-render-deployment.md — لا تمرّ هذه الأداة بصمت: كل بند «لم أُتحقق» = خروج 1.

تقيس ما **يكسر النشر** ولا تراه اختبارات الجهاز المحلي:

  1. **المدخل العام https**: الـ URL يجب أن يكون https، والشهادة تُتحقَّق منها
     بسلسلة ثقة حقيقية (نظام التشغيل، أو ملف CA تعطيه — لا `verify_mode=NONE`).
  2. **`/api/health/db`** ⇒ 200 و`provider` = المتوقع (SqlServer) و`canConnect` = true.
     هذا هو الجاهزية التي يقرأها Render نفسه في `healthCheckPath`.
  3. **CORS بين أصلين**: نداء بـ `Origin: <أصل الواجهة>` يجب أن يرجّع
     `Access-Control-Allow-Origin` مطابقًا. النشر على أصلين (API في حاوية والواجهة
     static) يسقط هنا أول يوم لو تُرك `Cors__Origins__0` على قيمة localhost.
  4. **دخول حقيقي**: `POST /api/auth/login` ⇒ توكن، ثم `/api/auth/me` ⇒ 200 وهوية صحيحة.
  5. **`POST /hubs/meetings/negotiate`** بتوكن ⇒ 200 و`connectionToken` (المسار الذي
     يفتحه SignalR قبل أي غرفة).
  6. **ترقية WebSocket فعلية** على `/hubs/meetings`: `101 Switching Protocols` و
     `Sec-WebSocket-Accept` محسوبًا كما في RFC 6455. بلا هذا تموت الحصة الحيّة على
     وسيط لا يمرّر الترقية — وهو ما لا يقدر أي فحص HTTP على كشفه.

الحالات الخاصة بـ Render (وليست أخطاء في المنصة) موثَّقة في docs/12: لا SQL Server
مدار لديهم، ولا coturn في حاوياتهم، وخطة المجاني تنام فتنهي الاتصالات.

التشغيل:
   EDULINK_API_URL=https://edulink-api.onrender.com \
   EDULINK_ORIGIN=https://edulink-web.onrender.com \
   EDULINK_EMAIL=owner@… EDULINK_PASSWORD=… \
   [EDULINK_EXPECT_PROVIDER=SqlServer] [EDULINK_TLS_CA=ca.pem] \
   python tools/verify-render-deploy.py green

حالة الرفض (تُثبت أن الأداة تفشل فعلًا — ثلاث حالات، كل واحدة يجب أن تخرج 1):
   python tools/verify-render-deploy.py red
"""
import base64
import json
import os
import socket
import ssl
import sys
import hashlib
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("EDULINK_API_URL", "http://localhost:5279").rstrip("/")
ORIGIN = os.environ.get("EDULINK_ORIGIN", "").rstrip("/")
EMAIL = os.environ.get("EDULINK_EMAIL", "")
PASSWORD = os.environ.get("EDULINK_PASSWORD", "")
EXPECT_PROVIDER = os.environ.get("EDULINK_EXPECT_PROVIDER", "SqlServer")
TLS_CA = os.environ.get("EDULINK_TLS_CA", "")
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

ENV_KEYS = ("EDULINK_API_URL", "EDULINK_ORIGIN", "EDULINK_EMAIL", "EDULINK_PASSWORD")


def ctx_for():
    """سياق SSL يتحقق من الشهادة دائمًا — بسلسلة النظام أو بـ CA يُمرَّر صراحةً."""
    ctx = ssl.create_default_context(cafile=TLS_CA if TLS_CA else None)
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    return ctx


def request(method, path, token=None, body=None, origin=None, timeout=25):
    """يعيد (status, headers-dict, parsed) أو (None, سبب-الفشل, None) عند تعذّر الشبكة."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if origin:
        req.add_header("Origin", origin)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx_for()) as res:
            raw = res.read().decode("utf-8", "replace")
            return res.status, dict(res.headers), _parse(raw)
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), _parse(err.read().decode("utf-8", "replace"))
    except Exception as err:
        return None, f"{type(err).__name__}: {err}", None


def _parse(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return raw


def ws_upgrade(path, timeout=25):
    """ترقية WebSocket يدوية: تعيد (status_line, headers) أو (None, سبب)."""
    u = BASE.split("://", 1)
    secure, rest = u[0] == "https", u[1]
    host, _, port = rest.partition(":")
    port = int(port) if port else (443 if secure else 80)
    key = base64.b64encode(os.urandom(16)).decode()
    req = (
        f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
        f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
        f"Origin: {ORIGIN}\r\n\r\n"
    ).encode()
    try:
        raw = socket.create_connection((host, port), timeout=timeout)
        sock = ctx_for().wrap_socket(raw, server_hostname=host) if secure else raw
        sock.sendall(req)
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
        sock.close()
        if not buf:
            return None, "ردّ فارغ على ترقية WebSocket", {}
        head = buf.split(b"\r\n\r\n", 1)[0].decode("latin-1")
        lines = head.split("\r\n")
        headers = {}
        for line in lines[1:]:
            k, _, v = line.partition(":")
            headers[k.strip().lower()] = v.strip()
        return lines[0], headers, key
    except Exception as err:
        return None, f"{type(err).__name__}: {err}", key if "key" in dir() else ""


def run():
    """يعيد (أسطر نجاح، قائمة فشل). أي فشل يعني خروج 1."""
    ok, bad = [], []

    # 1) https + شهادة
    if not BASE.startswith("https://"):
        bad.append(f"المدخل العام ليس https: {BASE} — المنصة تُسلَّم بكلمة سر وحساسيات، "
                   "وWSS لا يعمل بلا TLS في متصفح حقيقي")
        return ok, bad
    ok.append(f"✓ المدخل https: {BASE}")

    # 2) الصحة + المزوّد
    status, reason, blob = request("GET", "/api/health/db")
    if status is None:
        bad.append(f"لم أُتحقق: {BASE}/api/health/db غير reachable — {reason}")
        return ok, bad
    if status != 200 or not isinstance(blob, dict):
        bad.append(f"لم أُتحقق: /api/health/db ⇒ {status} بشكل غير متوقع: {str(blob)[:120]}")
        return ok, bad
    got_provider = blob.get("provider")
    if got_provider != EXPECT_PROVIDER:
        bad.append(f"المزوّد = {got_provider!r} والمتوقع {EXPECT_PROVIDER!r} — "
                   "النشر على قاعدة غير التي تُسلَّم")
    elif not blob.get("canConnect"):
        bad.append("الصحة تقول canConnect=false — الـ API يعمل لكنه لا يصل القاعدة")
    else:
        ok.append(f"✓ /api/health/db ⇒ provider={got_provider} · canConnect=true · "
                  f"usesMigrations={blob.get('usesMigrations')}")

    # 3) CORS عبر Origin حقيقي
    status, headers, _ = request("GET", "/api/health/db", origin=ORIGIN)
    if status is None:
        bad.append(f"لم أُتحقق: نداء CORS لم يصل — {headers}")
    else:
        acao = (headers or {}).get("access-control-allow-origin")
        if acao != ORIGIN:
            bad.append(f"CORS: `Access-Control-Allow-Origin` = {acao!r} والقيمة المطلوبة {ORIGIN!r} "
                       "— الواجهة على أصل مختلف فلن يستطيع المتصفح قراءة أي نداء /api "
                       "(اضبط Cors__Origins__0 في render.yaml / لوحة Render)")
        else:
            ok.append(f"✓ CORS: الأصل {ORIGIN} مقبول على /api")

    # 4) دخول حقيقي
    status, reason, blob = request("POST", "/api/auth/login", body={"email": EMAIL, "password": PASSWORD})
    token = blob.get("token") if isinstance(blob, dict) else None
    if status is None:
        bad.append(f"لم أُتحقق: نداء الدخول لم يصل — {reason}")
        return ok, bad
    if status != 200 or not token:
        bad.append(f"الدخول بحساب {EMAIL} ⇒ {status} بلا توكن — لا قياس لما بعده "
                   "(لا تُحسب خضراء). هل أُنشئ المالك بعد النشر؟")
        return ok, bad
    ok.append(f"✓ دخول {EMAIL} ⇒ توكن بطول {len(token)}")

    status, reason, me = request("GET", "/api/auth/me", token=token)
    if status != 200 or not isinstance(me, dict) or not me.get("id"):
        bad.append(f"لم أُتحقق: /api/auth/me ⇒ {status if status is not None else reason} "
                   f"({str(me)[:90]})")
    else:
        ok.append(f"✓ /api/auth/me ⇒ id={me.get('id')} aud={me.get('aud')} role={me.get('role')}")

    # 5) negotiate الخاص بـ SignalR
    hub = f"/hubs/meetings/negotiate?negotiateVersion=1&access_token={token}"
    status, reason, neg = request("POST", hub, token=token, body={})
    if status != 200 or not isinstance(neg, dict) or not neg.get("connectionToken"):
        bad.append(f"لم أُتحقق: /hubs/meetings/negotiate ⇒ "
                   f"{status if status is not None else reason} ({str(neg)[:120]}) — "
                   "المسار غير مُمرَّر من الوسيط أو أن التوكن لا يصل الـ Hub")
        return ok, bad
    ok.append(f"✓ negotiate ⇒ connectionToken بطول {len(str(neg['connectionToken']))}")
    conn_token = str(neg["connectionToken"])

    # 6) ترقية WebSocket حقيقية (ما لا يراه أي فحص HTTP) — بنفس ما يرسله SignalR
    path = (f"/hubs/meetings?access_token={token}&room=rendercheck"
            f"&negotiateVersion=1&connectionToken={urllib.parse.quote(conn_token, safe='')}")
    line, headers, key = ws_upgrade(path)
    if line is None:
        bad.append(f"لم أُتحقق: ترقية WebSocket فشلت — {headers}")
    elif "101" not in str(line):
        bad.append(f"الوسيط لا يمرّر ترقية WebSocket: {line!r} (headers={list(headers)[:6]}) "
                   "— الحصة الحيّة مستحيلة على هذا النشر")
    else:
        want = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        got = headers.get("sec-websocket-accept")
        if got != want:
            bad.append(f"ترقية 101 لكن `Sec-WebSocket-Accept` غير مطابق RFC 6455: {got!r}")
        else:
            ok.append("✓ WebSocket: 101 Switching Protocols + Accept مطابق — الوسيط يمرّر الغرف")
    return ok, bad


def red_cases():
    """حالات يجب أن تفشل — حتى لا يكون الأخضر زينة. كل بند يعيد خروجًا غير صفري."""
    print("حالات الرفض المتوقَّعة (كل واحدة يجب أن تُخرج 1):")
    import subprocess
    cases = [
        ("مزوّد متوقع خاطئ", {"EDULINK_EXPECT_PROVIDER": "Postgres"}),
        ("أصل CORS خاطئ", {"EDULINK_ORIGIN": "https://definitely-not-the-web-origin.invalid"}),
        ("حساب غير موجود", {"EDULINK_EMAIL": "no-such-user@render-check.invalid",
                            "EDULINK_PASSWORD": "NoSuch@12345"}),
        ("أصل غير reachable", {"EDULINK_API_URL": "https://127.0.0.1:1"}),
    ]
    failed_to_fail = []
    for label, override in cases:
        env = dict(os.environ)
        env.update(override)
        code = subprocess.call([sys.executable, __file__, "green"], env=env)
        verdict = "خرج 1 كما يجب" if code != 0 else "**خرج 0 — الأداة عمياء هنا!**"
        print(f"  · {label}: {verdict}")
        if code == 0:
            failed_to_fail.append(label)
    return 1 if failed_to_fail else 0


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "green"
    if mode == "red":
        return red_cases()

    missing = [k for k in ENV_KEYS if not os.environ.get(k)]
    if missing:
        print("✗ بيانات بيئة ناقصة: " + ", ".join(missing) + " — لا قياس، فلا تُحسب خضراء")
        return 1

    ok, bad = run()
    print(f"الأصل: {BASE}  |  أصل الواجهة: {ORIGIN}  |  المزوّد المتوقع: {EXPECT_PROVIDER}")
    for line in ok:
        print(line)
    for line in bad:
        print("✗ " + line)
    if bad:
        print(f"\nفشل: {len(bad)} بند — النشر غير مطابق.")
        return 1
    print(f"\nنجح: {len(ok)} بند — TLS والصحة وCORS والدخول وSignalR وترقية WebSocket كلها عاملة.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
