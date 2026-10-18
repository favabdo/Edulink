"""
EduLink — بوابة «تغيير كل كلمات سر الحسابات المزروعة» (docs/11 §7)

البند كان يدويًا: على المشغّل أن يتذكّر تدوير كل كلمة سر مزروعة. هذا الفحص يجعله
حكمًا آليًا: يجرّب **الكلمات الموثّقة في المستودع** على مسارات الدخول الثلاثة،
و**يفشل (خروج 1) إذا نجح أي دخول بها** — أي أن الحساب ما زال بكلمته الافتراضية.

قراءات البريد من `apps/api/seed_dev.py` نفسها (لا نسخ يدوي) حتى تبقى القائمة
مطابقة لما يُزرَع فعلًا؛ والبريد/الكلمة الموثّقة في `apps/api/README.md` و
`deploy/run.sh` مضمومة صراحة.

الآثار الجانبية محسوبة: كل محاولة دخول تُنشئ جلسة في `Edu_Tokens`، لذلك أي
كلمة افتراضية ما زالت صالحة تُسجَّل خروجًا فورًا بعد القياس حتى لا تترك الجهاز
المتحقق داخل النظام. ولا محاولة ثانية على الحساب نفسه حتى لا نُفعّل قفل الحساب
(`LoginFailuresPerAccount=8`) بغير قصد.

الترميز: لا نصوص عربية في وسائط الأوامر؛ قائمة من الملف نفسه بلوحة UTF-8.

التشغيل (من جذر المستودع، بعد رفع الـ API):
    EDULINK_API_URL=http://localhost:5279 python tools/verify-default-credentials.py
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
OUT = os.path.join(ROOT, 'tools', 'out-default-credentials.txt')

STAFF = '/api/auth/login'
STUDENT = '/api/auth/students/login'
PARENT = '/api/auth/parents/login'

# كلمات سر موثّقة في المستودع — إن قبلها النظام فالحساب لم يُدوَّر بعد
DOC_DEFAULTS = [
    (STAFF, 'owner@edulink.test', 'Owner@12345'),        # apps/api/README.md
    (STAFF, 'owner@edulink.test', 'ChangeMe@2026'),      # deploy/run.sh (الافتراضي)
    (STAFF, 'supervisor@edulink.test', 'Supervisor@12345'),
]


def read_real_accounts_candidates():
    """
    مصدر ثانٍ: `tools/create-real-accounts.py` يبني مؤسسة تيلا بكلمات موثّقة في المستودع
    (تُستخدم الآن على loopback وحدها بحارس في نص الملف). إن بقيت هذه الحسابات على قاعدة
    سيُسلَّم منها فتلك كلمات افتراضية تعمل — فلا يجوز أن تفلت من هذه البوابة.
    """
    path = os.path.join(ROOT, 'tools', 'create-real-accounts.py')
    try:
        src = io.open(path, encoding='utf-8').read()
    except OSError:
        return []
    pairs = {}
    for var in ('OWNER_PASSWORD', 'STAFF_PASSWORD', 'TEACHER_PASSWORD', 'STUDENT_PASSWORD', 'PARENT_PASSWORD'):
        m = re.search(var + r'\s*=\s*seed_password\(\s*"[a-z]+"\s*,\s*"([^"]+)"', src)
        if m:
            pairs[var] = m.group(1)
    dm = re.search(r'DOMAIN\s*=\s*os\.environ\.get\([^,]+,\s*"(@[^"]+)"', src)
    dom = dm.group(1) if dm else '@tila.test'
    out = []
    for local, key in (('owner', 'OWNER_PASSWORD'), ('manager', 'STAFF_PASSWORD'),
                       ('supervisor', 'STAFF_PASSWORD'), ('teacher1', 'TEACHER_PASSWORD'),
                       ('teacher2', 'TEACHER_PASSWORD'), ('student1', 'STUDENT_PASSWORD'),
                       ('student2', 'STUDENT_PASSWORD'), ('parent1', 'PARENT_PASSWORD')):
        pw = pairs.get(key)
        if pw:
            path_kind = STUDENT if local.startswith('student') else PARENT if local.startswith('parent') else STAFF
            out.append((path_kind, local + dom, pw))
    return out


def read_seed_candidates():
    """ي استخراج بريد المدرسين/الطلاب/أولياء الأمور وكلماتهم من seed_dev.py نفسه."""
    try:
        src = io.open(SEED, encoding='utf-8').read()
    except OSError:
        return []
    pairs = {}
    for var in ('TEACHER_PASSWORD', 'STUDENT_PASSWORD', 'PARENT_PASSWORD'):
        m = re.search(var + r'\s*=\s*"([^"]+)"', src)
        if m:
            pairs[var] = m.group(1)
    emails = re.findall(r'"([a-z0-9._-]+@(?:edulink|example)\.test)"', src)
    out = []
    for email in dict.fromkeys(emails):
        if email.endswith('.teacher@edulink.test'):
            out.append((STAFF, email, pairs.get('TEACHER_PASSWORD', 'Teacher@12345')))
        elif email.endswith('.student@edulink.test'):
            out.append((STUDENT, email, pairs.get('STUDENT_PASSWORD', 'Student@12345')))
        elif email.endswith('.parent@edulink.test'):
            out.append((PARENT, email, pairs.get('PARENT_PASSWORD', 'Parent@12345')))

    # بريد مُوَلَّد لا حرفي في المصدر: `seed.student{i:02d}@…` داخل `for i in range(1, 13)`
    tmpl = re.search(r'f"(seed\.student\{i:0?2?d?\}@[a-z.]+\.test)"', src)
    rng = re.search(r'for i in range\(\s*(\d+)\s*,\s*(\d+)\s*\)', src)
    if tmpl and rng:
        lo, hi = int(rng.group(1)), int(rng.group(2))
        email_tpl = tmpl.group(1)
        for i in range(lo, hi):
            out.append((STUDENT, email_tpl.replace('{i:02d}', f'{i:02d}'),
                        pairs.get('STUDENT_PASSWORD', 'Student@12345')))
    return out


def post(path, payload, token=None):
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(BASE + path, data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()
    except Exception as err:                       # تعذّر الاتصال = لا قياس
        return None, str(err).encode('utf-8')


def real_emails(token):
    """بريد الحسابات الموجودة فعلًا — لأن الـ 401 متعمَّد أنه لا يفرّق بين
    «بريد غير موجود» و«كلمة خاطئة» (لا user enumeration في `/api/auth/login`).
    بلا هذه القائمة لا يملك الفحص أن يدّعي أن كلمة «دُوِّرت»."""
    found, readable = set(), True
    for path in ('/api/users?take=500', '/api/students?take=500', '/api/parents?take=500'):
        code, blob = get(path, token)
        if code != 200:
            readable = False
            continue
        try:
            data = json.loads(blob.decode('utf-8', 'replace'))
        except Exception:
            readable = False
            continue
        items = data if isinstance(data, list) else next(
            (data[k] for k in ('items', 'data', 'rows', 'results') if isinstance(data.get(k), list)), None)
        if items is None:
            readable = False
            continue
        for it in items:
            email = (it.get('email') or '').strip().lower()
            if email:
                found.add(email)
    return found, readable


def get(path, token):
    req = urllib.request.Request(BASE + path, method='GET')
    req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()
    except Exception as err:
        return None, str(err).encode('utf-8')


def main():
    candidates = DOC_DEFAULTS + read_seed_candidates() + read_real_accounts_candidates()
    if not candidates:
        print('✗ لا مرشّحات للتحقق (تعذّرت قراءة seed_dev.py) — لم يتحقق شيء')
        return 1

    # التحقق من الوجود يحتاج حساب إدارة يعمل؛ بدونه لا فرق بين «غير موجود» و«مُدوَّر»
    op_email = os.environ.get('EDULINK_OWNER_EMAIL', '')
    op_pass = os.environ.get('EDULINK_OWNER_PASSWORD', '')
    code, blob = post(STAFF, {'email': op_email, 'password': op_pass})
    op_token = ''
    if code == 200:
        try:
            op_token = json.loads(blob.decode('utf-8', 'replace')).get('token', '')
        except Exception:
            op_token = ''
    existing, list_readable = (real_emails(op_token) if op_token else (set(), False))
    if op_token:
        post('/api/auth/logout', {}, op_token)

    live, rotated, absent, unclear = [], [], [], []
    for path, email, password in candidates:
        code, blob = post(path, {'email': email, 'password': password})
        if code == 200:
            token = ''
            try:
                token = json.loads(blob.decode('utf-8', 'replace')).get('token', '')
            except Exception:
                pass
            if token:                              # لا نترك جلسة متحقق خلفنا
                post('/api/auth/logout', {}, token)
            live.append((path, email, password))
        elif code == 401:
            # مُدوَّر = مرفوض **وهو موجود**. مرفوض وغير موجود = لا شيء كان ليُدوَّر.
            if email.lower() in existing:
                rotated.append((path, email))
            else:
                absent.append((path, email))
        elif code == 429:
            unclear.append((path, email, '429 — حزنة المحدِّد مشبعة: أعد الفحص بعد دقيقة'))
        elif code is None:
            unclear.append((path, email, 'تعذّر الاتصال بالـ API'))
        else:
            unclear.append((path, email, f'حالة {code} غير متوقعة على {path}'))

    lines = [f'الأصل: {BASE}', '',
             f'· مرشّحات مُجرَّبة: {len(candidates)}  |  ما زالت بكلمتها الافتراضية: {len(live)}'
             f'  |  مُدوَّرة (موجودة ومرفوضة): {len(rotated)}  |  غير موجودة في القاعدة: {len(absent)}'
             f'  |  غير قابلة للحكم: {len(unclear)}']
    for path, email, password in live:
        lines.append(f'  ✗ ما زالت صالحة: {email} / {password}  ({path})')
    for path, email, why in unclear:
        lines.append(f'  ! {email} ({path}): {why}')
    if absent:
        lines.append(f'  · {len(absent)} مرشّحًا غير موجود أصلًا (زراعة لم تُشغَّل أو نسخة عميل نظيفة) —'
                     ' لا يُنسب إليها «تدوير»')
    report = '\n'.join(lines) + '\n'
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(report)
    print(report)

    if live:
        print(f'فشل: {len(live)} حسابًا ما زال بكلمته الافتراضية — دوِّرها ثم `DELETE FROM dbo.[Edu_Tokens];`'
              ' (تغيير كلمة السر وحده لا يُبطل جلسات الأجهزة القديمة: docs/11 §7).')
        return 1
    if not op_token:
        print('لم يتحقق شيء: تعذّر الدخول بحساب الإدارة — لا قائمة حسابات، فلا تفرقة بين '
              '"غير موجود" و"مُدوَّر". لا تُحسب نجاحًا (أخضر بلا قياس).')
        return 1
    if not list_readable:
        print('لم يتحقق شيء: قائمة الحسابات (/api/users|students|parents) غير مقروءة — '
              'الادّعاء بالتدوير غير مدعوم. لا تُحسب نجاحًا.')
        return 1
    if unclear:
        print('تحذير: بقيت بنود غير قابلة للحكم — لا تُعلِّم البند منجزًا قبل إعادة الفحص.')
        return 1
    if not rotated:
        print('لا كلمة افتراضية تعمل، لكن **ولا مرشّح موجود** في القاعدة — هذا لا يُثبت تدويرًا؛ '
              'إن كانت قاعدة عميل نظيفة فالبند غير منطبق هنا (وليس مُنجَزًا).')
        return 1
    print(f'نجح: {len(rotated)} حسابًا موجودًا حُكِمت كلها ورفضت كلماتها الافتراضية '
          f'({len(absent)} مرشّحًا غير موجود لا يُنسب إليه شيء).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
