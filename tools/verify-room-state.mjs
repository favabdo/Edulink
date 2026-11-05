/**
 * بوابة حالة الغرفة (SignalR خامّ — لا متصفح ولا قراءة شيفرة):
 *   1) ضربة القلم تصل **لغير المُرسِل** وتصل لمن دخل متأخرًا من حالة الخادم.
 *   2) مخزن الضربات محدود (FIFO) فلا ينمو بلا سقف مع طول الحصة.
 *   3) رسالة المحادثة لا ترجع لمُرسلها (كانت تظهر عنده مرتين).
 *   4) تحكم المسرح/المستند/مسح السبورة للمدرس أو الإشراف فقط، والملف المعروض
 *      لا يُنزَّل إلا بمشاركة نشطة في غرفة حقيقية.
 *   5) إعداد ICE المُرسَل للمتصفح بلا عنصر فارغ، ودالة التنقية ترفضه فعلًا.
 *
 * الكتابة في القاعدة حقيقية (حسابات + حصة + ملف) بنطاق @tila.test — لذا
 * تُشغَّل على **قاعدة اختبار** ويتبعها deploy/cleanup-verification-data.sql.
 *
 * التشغيل:
 *   EDULINK_API_URL=http://localhost:5279 \
 *   EDULINK_SEED_OWNER_EMAIL=owner@tila.test EDULINK_SEED_OWNER_PASSWORD=… \
 *   node tools/verify-room-state.mjs
 */
import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr'
import { sanitizeIceServers } from '../apps/web/src/features/meeting/iceConfig.ts'

const BASE = (process.env.EDULINK_API_URL || 'http://localhost:5279').replace(/\/+$/, '')
const OWNER_EMAIL = process.env.EDULINK_SEED_OWNER_EMAIL || 'owner@tila.test'
const OWNER_PASSWORD = process.env.EDULINK_SEED_OWNER_PASSWORD || 'TilaOwner#2026'
const SEGMENT_CAP = 400
const RUN = Date.now().toString(36).slice(-5)
/** كلمات غير ثابتة: لا يجوز أن توجد كلمة سر موثَّقة في المستودع لحسابات تكتبها الأداة */
const PW = { staff: 'Gate#' + RUN + 'S!', student: 'Gate#' + RUN + 'D!', parent: 'Gate#' + RUN + 'P!' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function http(method, path, body, token, rawBody) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  const text = await res.text()
  return { status: res.status, text, json: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : null }
}

/** نجاح متوقَّع — وإلا البوابة تسمّي الردّ نفسه لا «حدث خطأ» */
async function ok(method, path, body, token) {
  const r = await http(method, path, body, token)
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${r.text.slice(0, 200)}`)
  return r.json
}

async function login(email, password, path = '/api/auth/login') {
  const r = await http('POST', path, { email, password })
  if (r.status !== 200 || !r.json?.token) throw new Error(`دخول ${email} → ${r.status}: ${r.text.slice(0, 160)}`)
  return r.json.token
}

const randPhone = () => `+201${Math.floor(1e9 + Math.random() * 9e9)}`

/** اتصال غرفتي مع تسجيل كل ما يصل — القياس من الوارد لا من المُرسَل */
async function connectHub(token, roomCode) {
  const rec = { strokes: [], chats: [], stages: [], docs: [], clears: [], peers: [], errors: [] }
  const conn = new HubConnectionBuilder()
    .withUrl(`${BASE}/hubs/meetings?access_token=${encodeURIComponent(token)}&room=${encodeURIComponent(roomCode)}`, {
      skipNegotiation: true,
      transport: HttpTransportType.WebSockets,
    })
    .configureLogging(LogLevel.Error)
    .build()
  conn.on('stroke', (from, seg) => { rec.strokes.push({ from, seg }) })
  conn.on('chat', (from, name, role, text) => { rec.chats.push({ from, text }) })
  conn.on('stage', (stage, boardOn, from) => { rec.stages.push({ stage, boardOn, from }) })
  conn.on('doc', (docJson, from) => { rec.docs.push({ docJson, from }) })
  conn.on('wb-clear', (from) => { rec.clears.push({ from }) })
  conn.on('peer-joined', (p) => { rec.peers.push(p) })
  await conn.start()
  return { conn, rec }
}

async function until(label, pred, ms = 5000) {
  const t0 = Date.now()
  for (;;) {
    const value = pred()
    if (value) return value
    if (Date.now() - t0 > ms) throw new Error(`«${label}» لم يحدث خلال ${ms}ms`)
    await sleep(120)
  }
}

/** يجب أن يُرفض — وإلا كان بندًا أخضر بلا قدرة على الرفض */
async function mustReject(promise, label) {
  try {
    await promise
  } catch {
    return true
  }
  throw new Error(`${label}: قُبل النداء بينما كان متوقعًا أن يرفضه الخادم`)
}

const results = []
const failures = []
async function item(name, fn) {
  try {
    const detail = await fn()
    results.push(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (err) {
    failures.push(`✗ ${name} — ${err.message}`)
  }
}

// ============ التهيئة: مالك ← مدرس/طالب/مدرسٍ آخر ← حصة ← ملفان ============
let owner
try {
  owner = await login(OWNER_EMAIL, OWNER_PASSWORD)
} catch (err) {
  console.log(`✗ لا دخول بالمالك (${OWNER_EMAIL}): ${err.message}\n` +
    'اضبط EDULINK_SEED_OWNER_EMAIL / EDULINK_SEED_OWNER_PASSWORD على مالك قاعدة الاختبار نفسها.')
  process.exit(1)
}

const teacher = await ok('POST', '/api/users', {
  name: `أ. بوابة الغرفة ${RUN}`, email: `qa.room.${RUN}.t@tila.test`,
  password: PW.staff, role: 0, phone: randPhone(),
}, owner)
const peer = await ok('POST', '/api/users', {
  name: `أ. مدرس آخر ${RUN}`, email: `qa.room.${RUN}.p@tila.test`,
  password: PW.staff, role: 0, phone: randPhone(),
}, owner)
const student = await ok('POST', '/api/students', {
  name: `طالب بوابة الغرفة ${RUN}`, email: `qa.room.${RUN}.s@tila.test`,
  password: PW.student, states: 1, access: 1, phone: randPhone(),
}, owner)
const parent = await ok('POST', '/api/parents', {
  name: `ولي أمر بوابة الغرفة ${RUN}`, email: `qa.room.${RUN}.par@tila.test`,
  password: PW.parent, phone: randPhone(), relation: 0, isPrimary: true,
}, owner)
await ok('POST', `/api/parents/${parent.id}/link`, { studentId: student.id, relation: 0, isPrimary: true }, owner)
const session = await ok('POST', '/api/sessions', {
  subject: 'بوابة حالة الغرفة', teacherId: teacher.id, studentId: student.id,
  gradeKey: 'g9', durationMin: 60, startsAt: new Date(Date.now() - 60_000).toISOString(),
}, owner)
const code = session.code
const [teacherTok, peerTok, studentTok, parentTok] = await Promise.all([
  login(teacher.email, PW.staff),
  login(peer.email, PW.staff),
  login(student.email, PW.student, '/api/auth/students/login'),
  login(parent.email, PW.parent, '/api/auth/parents/login'),
])

// PDF صغير حقيقي (صفحة واحدة) — الرفع عبر نفس نقطة النهاية التي تستخدمها الشاشة
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\n' +
  'trailer<</Root 1 0 R>>\n%%EOF\n', 'latin1')

async function upload(token, name) {
  const form = new FormData()
  form.append('file', new Blob([PDF], { type: 'application/pdf' }), name)
  const res = await fetch(`${BASE}/api/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const text = await res.text()
  if (res.status >= 400) throw new Error(`رفع ${name} → ${res.status}: ${text.slice(0, 160)}`)
  return JSON.parse(text)
}
const ownFile = await upload(teacherTok, `بوابة-ملكه-${RUN}.pdf`)
const foreignFile = await upload(peerTok, `بوابة-غريب-${RUN}.pdf`)

// ============ البنود ============
const room = await connectHub(teacherTok, code)
const tJoin = await room.conn.invoke('join', code, 'teacher', 'gate-teacher')

await item('انضمام المدرس يرجع شكل غرفة فيه لقطة السبورة', () =>
  until('لقطة السبورة في نتيجة join', () => tJoin?.board && typeof tJoin.board.stage === 'string'
    && Array.isArray(tJoin.board.segments) && 'doc' in tJoin.board && 'isOn' in tJoin.board)
    ? `stage=${tJoin.board.stage} segments=${tJoin.board.segments.length}` : null)

const pupil = await connectHub(studentTok, code)
await pupil.conn.invoke('join', code, 'student', 'gate-student')
await until('الدور المحسوب من القاعدة يصل للمدرس', () => room.rec.peers.some((p) => p.name === 'gate-student' && p.role === 'student'))

// 1) ضربة القلم: تصل للطرف الآخر وحده، وتُطابق ما أُرسل حرفيًا
const sent = [`{"x0":0.1,"y0":0.1,"x1":${0.2},"y1":0.2,"c":"#111"}`,
  `{"x0":0.3,"y0":0.3,"x1":0.4,"y1":0.4,"c":"#222"}`,
  `{"x0":0.5,"y0":0.5,"x1":0.6,"y1":0.6,"c":"#333"}`]
await item('القلم يصل للطرف الآخر بنفس البتّات ولا يرجع لكاتبه', async () => {
  for (const seg of sent) await room.conn.invoke('sendStroke', seg)
  await until('وصول الضربات الثلاث للطالب', () => pupil.rec.strokes.length === sent.length)
  const echo = room.rec.strokes.filter((s) => s.seg === sent[0]).length
  if (echo !== 0) throw new Error(`المُرسِل استلم ضربته نفسه ${echo} مرة`)
  const mismatch = pupil.rec.strokes.findIndex((s, i) => s.seg !== sent[i])
  if (mismatch !== -1) throw new Error(`الضربة ${mismatch} ليست ما أُرسل`)
  return `${pupil.rec.strokes.length} للطالب · 0 للمدرس`
})

// 2) من دخل متأخرًا يرى ما كُتب (حالة الخادم، لا بثّ لحظي فقط)
await item('من دخل متأخرًا يرى كل ما كُتب من لقطة الخادم', async () => {
  const late = await connectHub(teacherTok, code)
  const info = await late.conn.invoke('join', code, 'teacher', 'gate-late')
  const got = info.board.segments
  await late.conn.stop()
  if (got.length !== sent.length) throw new Error(`لقطة فيها ${got.length} والضربات ${sent.length}`)
  const missing = sent.filter((s) => !got.includes(s))
  if (missing.length) throw new Error(`ناقصة: ${missing[0].slice(0, 40)}`)
  return `${got.length} ضربة محفوظة`
})

// 3) السقف: بعد (سقف + 20) ضربة لا يرى جديدٌ أكثر من السقف، وأقدمها هو الساقط
await item(`مخزن الضربات محدود بـ ${SEGMENT_CAP} (FIFO يسقط الأقدم)`, async () => {
  const marks = []
  for (let i = 0; i < SEGMENT_CAP + 20; i += 1) {
    const seg = `{"i":${i},"x0":0.01,"y0":0.01,"x1":0.02,"y1":0.02,"c":"#000"}`
    marks.push(seg)
    await room.conn.invoke('sendStroke', seg)
  }
  const late = await connectHub(teacherTok, code)
  const info = await late.conn.invoke('join', code, 'teacher', 'gate-cap')
  await late.conn.stop()
  const got = info.board.segments
  if (got.length !== SEGMENT_CAP) throw new Error(`القطة رجعت ${got.length} ضربة والسقف ${SEGMENT_CAP}`)
  if (!got.includes(marks[marks.length - 1])) throw new Error('آخر ضربة مفقودة — السقف يسقط من الطرف الخطأ')
  if (got.includes(marks[0])) throw new Error('أقدم ضربة ما زالت محفوظة بعد تجاوز السقف')
  if (got.includes(sent[0])) throw new Error('ضربات ما قبل السقف لم تُزَح كما يفترض FIFO')
  return `${got.length} محفوظة · آخرها موجود · أقدمها مُزال`
})

// 4) المحادثة: مرة واحدة عند الطرف الآخر، وصفر عند كاتبها
await item('الرسالة تصل الطرف الآخر مرة واحدة ولا ترجع لكاتبها', async () => {
  const text = `بوابة-رسالة-${RUN}`
  const before = { t: room.rec.chats.length, s: pupil.rec.chats.length }
  await room.conn.invoke('sendChat', text)
  await until('وصول الرسالة للطالب', () => pupil.rec.chats.filter((c) => c.text === text).length === 1)
  await sleep(600)
  const atSender = room.rec.chats.length - before.t
  if (atSender !== 0) throw new Error(`كاتب الرسالة استلم نسخته ${atSender} مرة`)
  const atOther = pupil.rec.chats.length - before.s
  if (atOther !== 1) throw new Error(`الطرف الآخر استلم ${atOther} بدل واحدة`)
  return '1 للطرف الآخر · 0 للكاتب'
})

// 5) المسرح قرار المدرس: يصل Everyone، ومطالبة الطالب مرفوضة ولا تُغيّر الحالة
await item('تحكم المسرح للمدرس فقط ومطالبة الطالب مرفوضة', async () => {
  await room.conn.invoke('setStage', 'board', true)
  await until('وصول قرار المدرس للطالب', () => pupil.rec.stages.some((s) => s.stage === 'board' && s.boardOn === true))
  await mustReject(pupil.conn.invoke('setStage', 'video', false), 'طالب ينادي setStage')
  await sleep(700)
  if (pupil.rec.stages.some((s) => s.stage === 'video')) throw new Error('طالب نجح في تغيير المسرح')
  const late = await connectHub(teacherTok, code)
  const info = await late.conn.invoke('join', code, 'teacher', 'gate-stage')
  await late.conn.stop()
  if (info.board.stage !== 'board' || info.board.isOn !== true) {
    throw new Error(`لقطة المتأخر تقول stage=${info.board.stage} isOn=${info.board.isOn} بعد قرار المدرس`)
  }
  return 'board/true وصلت ولُقطت · مطالبة الطالب رُفضت'
})

// 6) المستند: للمدرس فقط، لملفاته فقط، ومنح القراءة يسقط عن الغريب
await item('عرض المستند للمدرس ولملفه نفسه فقط', async () => {
  const doc = { fileId: ownFile.id, fileName: ownFile.fileName, mime: 'application/pdf', page: 1 }
  await mustReject(pupil.conn.invoke('shareDocument', JSON.stringify(doc)), 'طالب ينادي shareDocument')
  await mustReject(room.conn.invoke('shareDocument', JSON.stringify({ fileId: foreignFile.id })),
    'مدرس يعرض ملف مدرس آخر')
  await room.conn.invoke('shareDocument', JSON.stringify(doc))
  await until('وصول المستند للطالب', () => pupil.rec.docs.some((d) => d.docJson && JSON.parse(d.docJson).fileId === ownFile.id))
  const late = await connectHub(teacherTok, code)
  const info = await late.conn.invoke('join', code, 'teacher', 'gate-doc')
  await late.conn.stop()
  if (!info.board.doc || JSON.parse(info.board.doc).fileId !== ownFile.id) throw new Error('لقطة المتأخر بلا المستند المعروض')
  return `${ownFile.fileName} وصل الطرفين ولُقط`
})

await item('تنزيل الملف المشترك مسموح لركاب الغرفة ومرفوض لغيرهم', async () => {
  const shared = await http('GET', `/api/files/${ownFile.id}/shared?session=${encodeURIComponent(code)}`, undefined, studentTok)
  if (shared.status !== 200) throw new Error(`طالب الغرفة على ملف معروض → ${shared.status}، متوقع 200`)
  const outsider = await http('GET', `/api/files/${ownFile.id}/shared?session=${encodeURIComponent(code)}`, undefined, peerTok)
  if (outsider.status === 200) throw new Error('مدرس غير مشارك نزّل ملف غرفة ليس فيها')
  const unshared = await http('GET', `/api/files/${foreignFile.id}/shared?session=${encodeURIComponent(code)}`, undefined, studentTok)
  if (unshared.status === 200) throw new Error('طالب نزّل ملفًا لم يُشارك في الغرفة')
  const noRoom = await http('GET', `/api/files/${ownFile.id}/shared`, undefined, studentTok)
  if (noRoom.status === 200) throw new Error('نقطة القراءة عملت بلا كود غرفة')
  return `200 للمشارك · ${outsider.status} للغريب · ${unshared.status} لغير المعروض`
})

// 7) المسح قرار المدرس: الطالب لا يمحو سبورة الحصة، والمدرس يمحوها للجميع
await item('مسح السبورة للمدرس فقط وبعدها لا يبقى أثر للمتأخر', async () => {
  await mustReject(pupil.conn.invoke('clearWhiteboard'), 'طالب ينادي clearWhiteboard')
  const beforeLate = await connectHub(teacherTok, code)
  const before = await beforeLate.conn.invoke('join', code, 'teacher', 'gate-before-clear')
  await beforeLate.conn.stop()
  if (before.board.segments.length === 0) throw new Error('الضربات لم تكن محفوظة أصلًا فصار البند بلا معنى')
  await room.conn.invoke('clearWhiteboard')
  await until('وصول المسح للطالب', () => pupil.rec.clears.length >= 1)
  const afterLate = await connectHub(teacherTok, code)
  const after = await afterLate.conn.invoke('join', code, 'teacher', 'gate-after-clear')
  await afterLate.conn.stop()
  if (after.board.segments.length !== 0) throw new Error(`بعد المسح بقيت ${after.board.segments.length} ضربة في اللقطة`)
  return `رفضت على الطالب · ${before.board.segments.length} ← 0 للمتأخر`
})

// 8) ICE: ما يرسله الخادم قابل للاستيعاب في المتصفح، والدالة ترفض الفارغ
await item('إعداد ICE من الخادم بلا عنصر فارغ وبصيغة صحيحة', async () => {
  const r = await http('GET', '/api/meeting/ice', undefined, teacherTok)
  if (r.status !== 200) throw new Error(`/api/meeting/ice → ${r.status}`)
  const list = r.json?.iceServers ?? []
  if (list.length === 0) throw new Error('الخادم أرسل قائمة فارغة')
  const bad = list.flatMap((e) => (Array.isArray(e.urls) ? e.urls : [e.urls]).filter((u) => !/^(stuns?|turns?):\S+/.test(String(u))))
  if (bad.length) throw new Error(`عنصر غير صالح يصل للمتصفح: ${JSON.stringify(bad)}`)
  return list.map((e) => (Array.isArray(e.urls) ? e.urls[0] : e.urls)).join(' | ').slice(0, 80)
})

await item('دالة تنقية ICE ترفض الفارغ والنص بلا بروتوكول', () => {
  const leaks = [{ urls: [''] }, { urls: [' '] }, { urls: ['not-a-url'] }, { urls: [] }, {}]
  if (sanitizeIceServers(leaks).length !== 0) throw new Error('قائمة ملوثة مرّت للمتصفح — هذا ما كان يُميت الوسائط بصمت')
  const mixed = sanitizeIceServers([{ urls: ['stun:stun.l.google.com:19302', ''] }, { urls: [''] }])
  if (mixed.length !== 1 || mixed[0].urls.length !== 1) throw new Error(`التنقية المشروطة أخطأت: ${JSON.stringify(mixed)}`)
  const signed = sanitizeIceServers([{ urls: ['turn:host:3478?transport=udp'], username: 'u', credential: 'c' }])
  if (signed.length !== 1 || signed[0].username !== 'u') throw new Error('التنقية أسقطت حساب TURN صالحًا')
  return 'الفارغ/بلا بروتوكول مرفوض · TURN الموقع محفوظ'
})

await item('إنهاء الحصة بيد المدرس فقط — الطالب وولي الأمر المراقب مرفوضان', async () => {
  const iso = new Date().toISOString()
  await mustReject(pupil.conn.invoke('endRoom', iso), 'طالب ينادي endRoom')
  const watcher = await connectHub(parentTok, code)
  const joined = await watcher.conn.invoke('join', code, 'observer', 'gate-parent')
  if (joined.peers === undefined) throw new Error('انضمام ولي الأمر لم يرجع شكل غرفة')
  await mustReject(watcher.conn.invoke('endRoom', iso), 'ولي أمر مراقب ينادي endRoom')
  await mustReject(watcher.conn.invoke('clearWhiteboard'), 'ولي أمر مراقب ينادي clearWhiteboard')
  await mustReject(watcher.conn.invoke('setStage', 'video', false), 'ولي أمر مراقب ينادي setStage')
  await room.conn.invoke('endRoom', iso)
  await watcher.conn.stop()
  return 'رُفض من الطالب والولي المراقب · قُبل من المدرس'
})

await pupil.conn.stop()
await room.conn.stop()

console.log(results.join('\n'))
if (failures.length) {
  console.log('\n' + failures.join('\n'))
  console.log(`\n✗ ${(failures.length)} بندًا فاشل من ${(results.length + failures.length)}`)
  process.exit(1)
}
console.log(`\n✓ ${(results.length)} بندًا أخضر — حالة الغرفة مفروضة في الخادم`)
console.log(`   الحسابات التي كُتبت: ${teacher.email} · ${peer.email} · ${student.email} · حصة ${code} · ملفان ${ownFile.id}/${foreignFile.id}`)
console.log('   على قاعدة اختبار فقط، ثم: deploy/cleanup-verification-data.sql')
