"""
EduLink — بوابة «تفريغ بيانات التطوير قبل التسليم» (docs/11 §7)

كان البند يدويًا: على المشغّل أن يحذف الحسابات والبيانات المزروعة ثم يتأكد.
هذا الفحص يجعله حكمًا: يبحث عن **بصمات بيانات التطوير** في النظام الجاري
ويفشل (خروج 1) إن بقي أي منها.

ما يُعدّ بصمة تطوير (لا عدد صفوف مجرد):
  1. أي حساب بريده ضمن قائمة `apps/api/seed_dev.py` (مدرسون/مشرف/أولياء أمور،
     والطلاب المُولَّدون بنمط `seed.studentNN@…` بعد توسيع السلسلة من نص المصدر).
  2. أي حساب على **نطاقات التطوير**: `@edulink.test` (زرع seed_dev) + النطاق الافتراضي
     لـ `tools/create-real-accounts.py` (مثل `@tila.test`) — **عدا البريد الذي تسجّل به أنت**
     (المؤسسات الحقيقية تستخدم نطاقها؛ فبقاء حسابات تجارب = تسليم ناقص).
  3. مراسلات/إشعارات داخلية مُزروعة تُحسب وتُطبع للاستدلال، ولا تُبنى عليها نجمة خضراء.

لا يوجد «استثناء بصمت»: إن لم يستطع الفحص قراءة القوائم (401/403/شكل غير متوقع)
يفشل صريحًا لأن «لم أُتحقق» ليست نجاحًا.

التشغيل:
    EDULINK_API_URL=https://DOMAIN EDULINK_OWNER_EMAIL=... EDULINK_OWNER_PASSWORD=... \
      python tools/verify-no-dev-data.py
"""
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request

BASE = os.environ.get('EDULINK_API_URL', 'http://localhost:5279').rstrip('/')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, 'apps', 'api', 'seed_dev.py')
OUT = os.path.join(ROOT, 'tools', 'out-no-dev-data.txt')
DEV_DOMAIN = '@edulink.test'
ME_EMAIL = os.environ.get('EDULINK_OWNER_EMAIL', '')


def dev_domains():
    """
    نطاقات التطوير: `@edulink.test` الثابت، + النطاق الافتراضي الذي يبني به
    `tools/create-real-accounts.py` مؤسسته التجريبية (مثل `@tila.test`) — فبدون هذا
    الثاني تفلت حسابات الاختبار من البوابة وتُسلَّم مع قاعدة العميل.
    """
    extra = []
    path = os.path.join(ROOT, 'tools', 'create-real-accounts.py')
    try:
        m = re.search(r'DOMAIN\s*=\s*os\.environ\.get\([^,]+,\s*"(@[^"]+)"',
                      io.open(path, encoding='utf-8').read())
        if m and m.group(1) != DEV_DOMAIN:
            extra.append(m.group(1))
    except OSError:
        pass
    return tuple([DEV_DOMAIN] + extra)


def req(path, payload=None, token=None, method=None):
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    r = urllib.request.Request(BASE + path, data=body, method=method or ('POST' if body else 'GET'))
    r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(r, timeout=20) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()
    except Exception as err:
        return None, str(err).encode('utf-8')


def seed_emails():
    """بريد الزرع الحرفي + السلاسل المُولَّدة، من نص seed_dev.py نفسه."""
    try:
        src = io.open(SEED, encoding='utf-8').read()
    except OSError:
        return set(), False
    found = set(re.findall(r'"([a-z0-9._-]+@edulink\.test)"', src))
    tmpl = re.search(r'f"(seed\.student\{i:0?2?d?\}@[a-z.]+\.test)"', src)
    rng = re.search(r'for i in range\(\s*(\d+)\s*,\s*(\d+)\s*\)', src)
    if tmpl and rng:
        tpl = tmpl.group(1)
        for i in range(int(rng.group(1)), int(rng.group(2))):
            found.add(tpl.replace('{i:02d}', f'{i:02d}'))
    return found, bool(re.search(r'seed_dev|ensure_user', src))


def rows_of(blob):
    """يُرجّع (قائمة, هل الشكل مفهوم) — الشكل المجهول ليس «فارغًا» بل «لا قياس»."""
    data = json.loads(blob.decode('utf-8', 'replace'))
    if isinstance(data, list):
        return data, True
    if isinstance(data, dict):
        for key in ('items', 'data', 'rows', 'results'):
            if isinstance(data.get(key), list):
                return data[key], True
    return None, False


def main():
    code, blob = req('/api/auth/login', {'email': ME_EMAIL, 'password': os.environ.get('EDULINK_OWNER_PASSWORD', '')})
    if code != 200:
        print(f'✗ تعذّر الدخول بحساب الإدارة ({code}) — لم يتحقق شيء من بنود التطوير')
        return 1
    tok = json.loads(blob.decode('utf-8'))['token']

    seeds, seed_readable = seed_emails()
    if not seed_readable:
        print('✗ لم تُقرأ seed_dev.py — القائمة المرجعية غير متاحة، لا يمكن الحكم')
        return 1

    domains = dev_domains()
    flagged = []
    counts = {}
    for label, path in (('users', '/api/users?take=500'),
                        ('students', '/api/students?take=500'),
                        ('parents', '/api/parents?take=500')):
        c, b = req(path, token=tok)
        if c != 200:
            print(f'✗ {path} رجّعت {c} — لا صلاحية قراءة للحساب أو تغيّر المسار: لا تحكم')
            return 1
        items, shaped = rows_of(b)
        if not shaped:
            print(f'✗ شكل استجابة {path} غير متوقع — لا يمكن عدّ الحسابات')
            return 1
        counts[label] = len(items)
        for it in items:
            email = (it.get('email') or '').strip().lower()
            if not email or email == ME_EMAIL.lower():
                continue
            if email in seeds:
                flagged.append((label, email, 'مزروع من seed_dev.py'))
            elif email.endswith(domains):
                hit = next(d for d in domains if email.endswith(d))
                flagged.append((label, email, f'نطاق تطوير {hit}'))

    for label, path in (('sessions', '/api/sessions?status=scheduled&take=500'),
                        ('notifications', '/api/notifications?take=500')):
        c, b = req(path, token=tok)
        if c == 200:
            items, shaped = rows_of(b)
            counts[label] = len(items) if shaped else 'شكل غير متوقع'
        else:
            counts[label] = f'غير متاح ({c})'

    lines = [f'الأصل: {BASE}', f'بريد الإدارة (مستثنى): {ME_EMAIL}', '',
             f'· الحسابات: users={counts.get("users")} students={counts.get("students")} parents={counts.get("parents")}',
             f'· الحصص المُجدولة: {counts.get("sessions")}   الإشعارات: {counts.get("notifications")}',
             f'· بصمات تطوير باقية: {len(flagged)}']
    for label, email, why in flagged[:40]:
        lines.append(f'  ✗ {label}: {email} — {why}')
    if len(flagged) > 40:
        lines.append(f'  … و{len(flagged) - 40} أخرى (راجع الملف كاملًا)')
    report = '\n'.join(lines) + '\n'
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(report)
    print(report)

    if flagged:
        print(f'فشل: {len(flagged)} سجلًا ما زال من بيانات التطوير — احذفها ثم أنشئ حسابات العميل الحقيقية من الواجهة.')
        print('  حذف آمن مرتّب (القيود الخارجية أولًا ثم الأبناء): راجع docs/11 §7 وdatabase/README.md.')
        return 1
    print('نجح: لا بصمات تطوير باقية (لا بريد مزروع ولا نطاق تطوير عدا حسابك).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
