/**
 * اختبار حمل لغرف الاجتماعات (SignalR) — يحاكي N غرفة × M عميل متزامن.
 *
 * الهدف المُعلَن: 500 حصة 1-to-1 متزامنة ≈ 1000-1500 اتصال WebSocket (بعضها مراقبون).
 * الوسائط هنا غير مشمولة: المتصفحان يتبادلانها P2P، والخادم لا يحمل إلا الإشارات —
 * وهذا السكربت يقيس تحمل الخادم لإشارات الانضمام/الرسائل تحديدًا.
 *
 * التشغيل (الـ API يعمل على 5279 وقاعدة البيانات مزروعة بـ seed_dev.py):
 *   node tools/loadtest/meeting-loadtest.mjs --rooms 500 --peers 2 --hold 60
 *
 * ملاحظات:
 * - العميلان في كل غرفة حسابا موظف (أونر) → الدور المُحدَّد من الخادم = observer،
 *   فلا يُكتب أي حضور أو حالة حصة أثناء الضغط (لا تلويث لبيانات التطوير).
 * - الغرف المستخدمة حصص scheduled حقيقية؛ إن لم تكفِ يُنشئ السكربت ما ينقص
 *   عبر POST /api/sessions بحسابات من seed_dev.py.
 * - للضغط الحقيقي بالوسائط (كاميرا/مايك) يلزم متصفحات فعلية — هذا يقيس الطبقة
 *   التي تُقاس آليًا: الإشارات والحالة تحت X اتصال.
 */

import {
  HttpTransportType,
  HubConnectionBuilder,
  LogLevel,
} from '@microsoft/signalr'

const args = parseArgs(process.argv.slice(2))
const BASE = args.base ?? process.env.EDULINK_API_URL ?? 'http://localhost:5279'
const ROOMS = Number(args.rooms ?? 500)
const PEERS = Number(args.peers ?? 2)
const HOLD = Number(args.hold ?? 30)
const BATCH = Number(args.batch ?? 50)
const TOKENS = Number(args.tokens ?? 1)
// بيانات الدخول من البيئة: deploy/run.sh يُنشئ المالك بكلمة سر أخرى، وكان
// المسار المثبّت هنا يفشل بـ 401 عند تشغيله من داخل الـ runbook.
const EMAIL = args.email ?? process.env.EDULINK_OWNER_EMAIL ?? 'owner@edulink.test'
const PASSWORD = args.pass ?? process.env.EDULINK_OWNER_PASSWORD ?? 'Owner@12345'

function parseArgs(list) {
  const out = {}
  for (let i = 0; i < list.length; i += 2) {
    const key = list[i]?.replace(/^--/, '')
    if (key) out[key] = list[i + 1]
  }
  return out
}

async function api(method, path, body, token) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    // 429 مش خطأ في السيرفر — المحدِّد يعمل كما يُفترض. ننتظر نافذة الدقيقة ونعيد.
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 0
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 61_000 - (Date.now() % 60_000)
      console.log(`  … حدّ المعدل (429) — انتظار ${(waitMs / 1000).toFixed(0)} ث ثم إعادة ${method} ${path}`)
      await new Promise((r) => setTimeout(r, waitMs))
      continue
    }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }
  throw new Error(`${method} ${path} -> ما زال مرفوضًا بعد 12 محاولة (حدّ المعدل)`)
}

// ───────────────────────── 1) دخول حساب الموظف ─────────────────────────

const login = await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD })
const ownerToken = login.token
console.log(`✓ دخول ${EMAIL} (دور ${login.user.roleName})`)

// ───────────────── 1-ب) حسابات متعددة: كل اتصال في الإنتاج له جلسته ─────────
// المحدِّلات مفروضة **لكل جلسة** (REST) ولكل جهاز (/hubs). تشغيل 4000 اتصال
// بتوكن واحد يقيس سلوكًا لا يحدث فعليًا، ويستنفد حصّة جلسة واحدة.
const tokens = [ownerToken]
if (TOKENS > 1) {
  console.log(`• تجهيز ${TOKENS} جلسة إشراف (كل اتصال يحصل على جلسة حقيقية)...`)
  // المشرف فأعلى فقط هو الذي يدخل أي غرفة كمراقب (MeetingHub.Join)،
  // فحسابات المدرس غير المسندة للغرفة ستُرفض.
  const users = await api('GET', '/api/users', null, ownerToken)
  let staff = users.filter((u) => u.role >= 1)
  let created = 0
  while (staff.length < TOKENS && created < TOKENS) {
    const email = `loadtest${staff.length + created}@edulink.test`
    try {
      await api('POST', '/api/users', {
        name: `مشرف اختبار ${staff.length + created}`,
        email, password: 'LoadTest@12345', role: 1,
        phone: `+201099${String(staff.length + created).padStart(6, '0')}`,
      }, ownerToken)
      created += 1
    } catch (e) {
      console.error(`✗ تعذّر إنشاء ${email}: ${e.message}`)
      break
    }
    if (created % 25 === 0) console.log(`  … أنشأنا ${staff.length + created - 1} حسابًا`)
  }
  const all = await api('GET', '/api/users', null, ownerToken)
  staff = all.filter((u) => u.role >= 1)
  for (const t of staff.slice(0, TOKENS)) {
    if (t.email === EMAIL) continue
    try {
      const lg = await api('POST', '/api/auth/login', { email: t.email, password: 'LoadTest@12345' })
      tokens.push(lg.token)
    } catch { /* حساب موجود بكلمة سر أخرى — نتخطاه */ }
  }
  console.log(`✓ ${tokens.length} جلسة دخول جاهزة`)
}

const token = ownerToken
let tokenCursor = 0
function nextToken() {
  const tk = tokens[tokenCursor % tokens.length]
  tokenCursor += 1
  return tk
}

// ───────────────────────── 2) تجهيز الغرف ─────────────────────────

let sessions = await api('GET', '/api/sessions?status=scheduled', null, token)
console.log(`• حصص مجدولة متاحة: ${sessions.length}`)

if (sessions.length < ROOMS) {
  const need = ROOMS - sessions.length
  console.log(`• إنشاء ${need} حصة إضافية للاختبار...`)
  const students = await api('GET', '/api/students', null, token)
  const users = await api('GET', '/api/users', null, token)
  const teacher = users.find((u) => u.role === 0)
  if (!teacher || students.length === 0) {
    console.error('✗ يجب زرع بيانات seed_dev.py أولًا (مدرسون + طلاب).')
    process.exit(1)
  }
  for (let i = 0; i < need; i += 1) {
    const created = await api('POST', '/api/sessions', {
      subject: 'رياضيات',
      teacherId: teacher.id,
      studentId: students[i % students.length].id,
      gradeKey: 'g7',
      durationMin: 45,
      startsAt: new Date(Date.now() + (i + 1) * 60_000).toISOString(),
      metadata: '{"loadtest":true}',
    }, token)
    sessions.push(created)
  }
  console.log(`✓ جاهز ${sessions.length} غرفة`)
}

const rooms = sessions.slice(0, ROOMS).map((s) => s.code)

// ───────────────────────── 3) إثقال الغرف بالدخول ─────────────────────────

const joinTimes = []
const errors = []
let chatOk = 0
let chatErr = 0
const connections = []

function makeConn(room, tk) {
  const conn = new HubConnectionBuilder()
    .withUrl(`${BASE}/hubs/meetings?access_token=${encodeURIComponent(tk)}&room=${encodeURIComponent(room)}`, {
      skipNegotiation: true,
      transport: HttpTransportType.WebSockets,
      withCredentials: false,
    })
    .configureLogging(LogLevel.Error)
    .build()
  conn.on('chat', () => { chatOk += 1 })
  return conn
}

async function joinOne(room, peerIdx) {
  const t0 = performance.now()
  const tk = nextToken()
  const conn = makeConn(room, tk)
  try {
    await conn.start()
    await conn.invoke('join', room, 'observer', `load-${room}-${peerIdx}`)
    joinTimes.push(performance.now() - t0)
    connections.push(conn)
  } catch (e) {
    errors.push(`${room}#${peerIdx}: ${e.message}`)
    try { await conn.stop() } catch { /* ignore */ }
  }
}

console.log(`• ربط ${ROOMS} غرفة × ${PEERS} عميل = ${ROOMS * PEERS} اتصال عبر ${tokens.length} جلسة (≈${Math.ceil((ROOMS * PEERS) / tokens.length)} اتصال/جلسة، دُفعات ${BATCH})...`)
const rampT0 = performance.now()
for (let i = 0; i < rooms.length; i += BATCH) {
  const wave = []
  for (const room of rooms.slice(i, i + BATCH)) {
    for (let p = 0; p < PEERS; p += 1) wave.push(joinOne(room, p))
  }
  await Promise.allSettled(wave)
}
const rampMs = performance.now() - rampT0

// ───────────────────────── 4) فترة الثبات + رسائل ─────────────────────────

console.log(`• الاتصال اكتمل في ${(rampMs / 1000).toFixed(1)} ث — ثبات ${HOLD} ث مع رسائل كل ثانيتين...`)
const ticker = setInterval(() => {
  for (const conn of connections) {
    conn.send('sendChat', 'ping').catch(() => { chatErr += 1 })
  }
}, 2000)
await new Promise((r) => setTimeout(r, HOLD * 1000))
clearInterval(ticker)

// ───────────────────────── 5) التقرير ─────────────────────────

const sorted = joinTimes.slice().sort((a, b) => a - b)
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]?.toFixed(0) ?? '-'
const rss = process.memoryUsage.rss()

console.log(`
══════════ تقرير اختبار الحمل ══════════
الاتصالات المطلوبة : ${ROOMS * PEERS}
اتصالات نجحت      : ${connections.length}
أخطاء الانضمام    : ${errors.length}
زمن الربط الكلي    : ${(rampMs / 1000).toFixed(1)} ث
انضمام (ms) p50/p95/p99: ${pct(0.5)} / ${pct(0.95)} / ${pct(0.99)}
رسائل مستقبَلة     : ${chatOk}   (إرسال فشل: ${chatErr})
RSS عملية الاختبار : ${(rss / 1024 / 1024).toFixed(0)} MB
${errors.length ? `\nعيّنات أخطاء:\n${errors.slice(0, 10).join('\n')}` : '✓ لا أخطاء'}
═════════════════════════════════════════
`)
console.log('⚠ استهلاك الخادم يُقرأ من سجل/مراقب السيرفر أثناء التشغيل (CPU/RSS/عدد الاتصالات النشطة).')

for (const conn of connections) {
  await conn.stop().catch(() => { /* ignore */ })
}
process.exit(errors.length > 0 ? 1 : 0)
