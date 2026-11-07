/**
 * بوابة حالة الغرفة (SignalR خامّ — لا متصفح ولا قراءة شيفرة):
 *   1) الشرح **كائن مُصنَّف** (قلم/ناسر/خط/سهم/مستطيل/دائرة/نص) بـ `annotate` دفعة واحدة:
 *      يصل لغير المُرسِل بنفس البتّات، والخادم يتحقَّق من كل حقل (أداة، نقاط 0..1، لون
 *      `#hex`، سماكة، عدد نقاط الشكل، نصّ بلا تجاوز) فلا يمرّ تالف ولا يُخزَّن ولا يُبثّ.
 *   2) مخزن الكائنات محدود (FIFO) فلا ينمو بلا سقف مع طول الحصة، ومن يدخل متأخرًا
 *      يرى ما كُتب من حالة الخادم. **الممحاة** تمسح بالمعرّف ولا تبثّ معرّفًا غير موجود،
 *      و**التراجع** يمسح آخر كائن للحساب نفسه لا آخر كائن على الشاشة.
 *   3) رسالة المحادثة لا ترجع لكاتبها (كانت تظهر عنده مرتين).
 *   4) تحكم المسرح/المستند/مسح السبورة للمدرس أو الإشراف فقط؛ **المسح يصل المدرس
 *      نفسه** (كان `OthersInGroup` فيُبقي ما كتبه على شاشته بعد أن تبيض شاشة
 *      الطالب)؛ والمستند يُغيّر المسرح فيُلتقط في لقطة المتأخر.
 *   5) **صلاحيات المشارك قرار الخادم لا قرار المتصفح**: `setPermissions` للمدرس فقط،
 *      والكتابة تُرفض من الخادم على المقفول مع سبب، وطلب `setState` من مكتوم لا
 *      يرفعه، والقرار يصل كل الغرفة بمن فيه المستهدف.
 *   6) سقف رسائل الشرح لكل اتصال في الثانية.
 *   7) **المؤشر الحيّ** يصل الطرف الآخر وحده، ولا يُخزَّن في اللوحة، ويسقط بالمرة
 *      لمن مُنع من الكتابة.
 *   8) إعداد ICE المُرسَل للمتصفح بلا عنصر فارغ، ودالة التنقية ترفضه فعلًا.
 *
 * الكتابة في القاعدة حقيقية (حسابات + حصة + ملف) بنطاق @tila.test — لذا
 * تُشغَّل على **قاعدة اختبار** ويتبعها deploy/cleanup-verification-data.sql.
 *
 * التشغيل:
 *   EDULINK_API_URL=http://localhost:5299 \
 *   EDULINK_SEED_OWNER_EMAIL=owner@tila.test EDULINK_SEED_OWNER_PASSWORD=… \
 *   node tools/verify-room-state.mjs
 */
import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr'
import { sanitizeIceServers } from '../apps/web/src/features/meeting/iceConfig.ts'

const BASE = (process.env.EDULINK_API_URL || 'http://localhost:5279').replace(/\/+$/, '')
/**
 * لا كلمة سر احتياطية في المستودع: بوابة verify-default-credentials.py تُعدّ أي كلمة
 * موثَّقة مرشّحًا حيًّا، فالبوابة تطلبها من البيئة وترفض العمل بلا ما ينقصها.
 */
const missingKeys = ['EDULINK_SEED_OWNER_EMAIL', 'EDULINK_SEED_OWNER_PASSWORD']
  .filter((k) => !process.env[k])
if (missingKeys.length) {
  console.error('✗ بيئة الأداة ناقصة: ' + missingKeys.join(' · '))
  process.exit(1)
}
const OWNER_EMAIL = process.env.EDULINK_SEED_OWNER_EMAIL
const OWNER_PASSWORD = process.env.EDULINK_SEED_OWNER_PASSWORD
const OBJECT_CAP = 300
const ANNOTATION_BATCHES_PER_SECOND = 30
const RUN = Date.now().toString(36).slice(-5)
/** كلمات غير ثابتة: لا يجوز أن توجد كلمة سر موثَّقة في المستودع لحسابات تكتبها الأداة */
const PW = { staff: 'Gate#' + RUN + 'S!', student: 'Gate#' + RUN + 'D!', parent: 'Gate#' + RUN + 'P!' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** كائن شرح بالشكل الحقيقي الذي ترسله الشاشة: أداة ولون وسماكة ونقاط نسبية 0..1 */
const note = (i, tool = 'pen') => ({
  id: `n-${RUN}-${i}`, tool, color: '#000000', width: 4,
  points: tool === 'text' ? [0.1, 0.1 + (i % 50) * 0.01] : [0.01, 0.01 + (i % 50) * 0.01, 0.02, 0.02 + (i % 50) * 0.01],
  ...(tool === 'text' ? { text: `ملاحظة ${i}` } : {}),
})
const addOp = (a) => ({ op: 'add', a })
const delOp = (ids) => ({ op: 'del', ids })

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
  const rec = { adds: [], dels: [], pointers: [], chats: [], stages: [], docs: [], clears: [], peers: [], perms: [], states: [], errors: [] }
  const conn = new HubConnectionBuilder()
    .withUrl(`${BASE}/hubs/meetings?access_token=${encodeURIComponent(token)}&room=${encodeURIComponent(roomCode)}`, {
      skipNegotiation: true,
      transport: HttpTransportType.WebSockets,
    })
    .configureLogging(LogLevel.Error)
    .build()
  conn.on('annotate', (from, batch) => {
    for (const raw of batch ?? []) {
      let op
      try { op = JSON.parse(raw) } catch { continue }
      if (op?.op === 'add' && op.a) rec.adds.push({ from, a: op.a, raw })
      else if (op?.op === 'del' && Array.isArray(op.ids)) rec.dels.push({ from, ids: op.ids })
    }
  })
  conn.on('pointer', (from, x, y, tool) => { rec.pointers.push({ from, x, y, tool }) })
  conn.on('chat', (from, name, role, text) => { rec.chats.push({ from, text }) })
  conn.on('stage', (stage, boardOn, from) => { rec.stages.push({ stage, boardOn, from }) })
  conn.on('doc', (docJson, from) => { rec.docs.push({ docJson, from }) })
  conn.on('wb-clear', (from) => { rec.clears.push({ from }) })
  conn.on('peer-joined', (p) => { rec.peers.push(p) })
  // البثّ لكل الغرفة: المستهدف نفسه يجب أن يسمع قراره، وإلا بقيت شاشته تكذب
  conn.on('perms', (connId, canSpeak, canVideo, canWrite, canShare, muted, camera) => {
    rec.perms.push({ connId, canSpeak, canVideo, canWrite, canShare, muted, camera })
  })
  conn.on('state', (connId, muted, camera, hand) => { rec.states.push({ connId, muted, camera, hand }) })
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
  } catch (err) {
    return err instanceof Error && err.message ? err.message : 'مرفوض'
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

await item('انضمام المدرس يرجع شكل غرفة فيه لقطة السبورة وصفّه هو بصلاحياته', async () => {
  await until('لقطة السبورة + Me في نتيجة join', () => tJoin?.board && typeof tJoin.board.stage === 'string'
    && Array.isArray(tJoin.board.annotations) && 'doc' in tJoin.board && 'isOn' in tJoin.board
    && tJoin.me && typeof tJoin.me.canWrite === 'boolean' && typeof tJoin.me.canShare === 'boolean')
  return `stage=${tJoin.board.stage} annotations=${tJoin.board.annotations.length} me.canWrite=${tJoin.me.canWrite} me.canShare=${tJoin.me.canShare}`
})

const pupil = await connectHub(studentTok, code)
const pJoin = await pupil.conn.invoke('join', code, 'student', 'gate-student')
const pupilConn = pJoin.self
await until('الدور المحسوب من القاعدة يصل للمدرس', () => room.rec.peers.some((p) => p.name === 'gate-student' && p.role === 'student'))
await item('الطالب يعرف صلاحياته من نتيجة انضمامه (يكتب ولا يشارك ملفًا)', () => {
  if (!(pJoin.me?.canWrite === true && pJoin.me?.canShare === false)) {
    throw new Error(`صف الطالب في join غير متوقع: ${JSON.stringify(pJoin.me)}`)
  }
  return `canWrite=${pJoin.me.canWrite} canShare=${pJoin.me.canShare}`
})

// 1) الشرح دفعة واحدة: يصل للطرف الآخر وحده، وبالشكل المُرسَل حرفيًا
const sent = [
  { id: `${RUN}-s1`, tool: 'pen', color: '#111111', width: 4, points: [0.1, 0.1, 0.12, 0.14, 0.15, 0.2] },
  { id: `${RUN}-s2`, tool: 'rect', color: '#222222', width: 2, points: [0.3, 0.3, 0.4, 0.42] },
  { id: `${RUN}-s3`, tool: 'text', color: '#333333', width: 4, points: [0.5, 0.5], text: 'شرح' },
]
const sentJson = sent.map((a) => JSON.stringify(addOp(a)))
await item('دفعة شرح واحدة تصل للطرف الآخر بنفس البتّات ولا ترجع لكاتبها', async () => {
  const beforeT = room.rec.adds.length
  await room.conn.invoke('annotate', JSON.stringify(sent.map(addOp)))
  await until('وصول الكائنات الثلاثة للطالب', () => pupil.rec.adds.length >= sent.length)
  const echo = room.rec.adds.length - beforeT
  if (echo !== 0) throw new Error(`المُرسِل استلم دفعته نفسها ${echo} مرة`)
  const got = pupil.rec.adds.slice(0, sent.length).map((x) => x.raw)
  const mismatch = got.findIndex((raw, i) => raw !== sentJson[i])
  if (mismatch !== -1) throw new Error(`الكائن ${mismatch} ليس ما أُرسل: ${got[mismatch]}`)
  return `${pupil.rec.adds.length} للطالب · 0 للمدرس · نداء واحد`
})

// 2) التحقق في الخادم: كل حقل يُفحص هنا، والتالف يسقط وحده لا دفعته كلها
await item('الخادم يرفض الكائنات التالفة ولا يمرّها للغرفة', async () => {
  const broken = [
    { id: `${RUN}-b1`, tool: 'pen', color: '#444444', width: 4, points: [0.1, 0.1, 0.2, 0.2] },
    { id: `${RUN}-b2`, tool: 'pen', color: '#444444', width: 4, points: [2, 0.1, 0.2, 0.2] },
    { id: `${RUN}-b3`, tool: 'crayon', color: '#444444', width: 4, points: [0.1, 0.1, 0.2, 0.2] },
    { id: `${RUN}-b4`, tool: 'pen', color: 'red', width: 4, points: [0.3, 0.3, 0.4, 0.4] },
    { id: `${RUN}-b5`, tool: 'rect', color: '#555555', width: 4, points: [0.5, 0.5, 0.6] },
    { id: `${RUN}-b6`, tool: 'text', color: '#666666', width: 4, points: [0.7, 0.7] },
    { id: 'x'.repeat(80), tool: 'pen', color: '#777777', width: 4, points: [0.8, 0.8, 0.9, 0.9] },
    { id: `${RUN}-b8`, tool: 'pen', color: '#888888', width: 900, points: [0.9, 0.9, 0.95, 0.95] },
    { id: `${RUN}-b9`, tool: 'pen', color: '#999999', width: 4, points: [0.2, 0.2, 0.3, 0.3] },
  ]
  const before = pupil.rec.adds.length
  await room.conn.invoke('annotate', JSON.stringify(broken.map(addOp)))
  await until('وصول الكائنين الصالحين', () => pupil.rec.adds.length >= before + 2)
  await sleep(400)
  const arrived = pupil.rec.adds.length - before
  if (arrived !== 2) throw new Error(`وصل ${arrived} من دفعة فيها كائنان صالحان فقط (${broken.length} أُرسلت)`)
  return `${broken.length} أُرسلت · 2 وصلت · ${broken.length - 2} أُسقطت في الخادم`
})

// 3) من دخل متأخرًا يرى ما كُتب (حالة الخادم، لا بثّ لحظي فقط)
await item('من دخل متأخرًا يرى كل ما كُتب من لقطة الخادم', async () => {
  const late = await connectHub(teacherTok, code)
  const info = await late.conn.invoke('join', code, 'teacher', 'gate-late')
  const got = info.board.annotations.map((raw) => JSON.parse(raw).id)
  await late.conn.stop()
  const expected = sent.length + 2
  if (got.length !== expected) throw new Error(`لقطة فيها ${got.length} والكائنات المتوقعة ${expected}`)
  const missing = sent.map((a) => a.id).filter((id) => !got.includes(id))
  if (missing.length) throw new Error(`ناقصة من اللقطة: ${missing[0]}`)
  return `${got.length} كائنًا محفوظًا`
})

// 4) السقف: بعد (سقف + 20) كائنًا لا أكثر من السقف، وأقدمها هو الساقط
await item(`مخزن الشرح محدود بـ ${OBJECT_CAP} كائنًا (FIFO يسقط الأقدم)`, async () => {
  const marks = []
  for (let i = 0; i < OBJECT_CAP + 20; i += 1) marks.push(note(i))
  // الدفعات محكومة بسقف الرسائل/ثانية، فالقياس يُرسل على مراحل ويعدّ
  for (let i = 0; i < marks.length; i += 8) {
    await room.conn.invoke('annotate', JSON.stringify(marks.slice(i, i + 8).map(addOp)))
    if (i % 24 === 16) await sleep(1000)
  }
  const late = await connectHub(teacherTok, code)
  const info = await late.conn.invoke('join', code, 'teacher', 'gate-cap')
  await late.conn.stop()
  const got = info.board.annotations.map((raw) => JSON.parse(raw).id)
  if (got.length !== OBJECT_CAP) throw new Error(`اللقطة رجعت ${got.length} كائنًا والسقف ${OBJECT_CAP}`)
  if (!got.includes(marks[marks.length - 1].id)) throw new Error('آخر كائن مفقود — السقف يسقط من الطرف الخطأ')
  if (got.includes(marks[0].id)) throw new Error('أقدم كائن ما زال محفوظًا بعد تجاوز السقف')
  if (got.includes(sent[0].id)) throw new Error('كائنات ما قبل السقف لم تُزَح كما يفترض FIFO')
  return `${got.length} محفوظة · آخرها موجود · أقدمها مُزال`
})

// 5) المحادثة: مرة واحدة عند الطرف الآخر، وصفر عند كاتبها
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

// 6) المسرح قرار المدرس: يصل Everyone، ومطالبة الطالب مرفوضة ولا تُغيّر الحالة
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

// 7) المستند: للمدرس فقط، لملفاته فقط، ومنح القراءة يسقط عن الغريب — والمسرح يتبعه
await item('عرض المستند للمدرس ولملفه نفسه فقط ويغيّر المسرح في اللقطة', async () => {
  const doc = { fileId: ownFile.id, fileName: ownFile.fileName, mime: 'application/pdf', page: 1 }
  await mustReject(pupil.conn.invoke('shareDocument', JSON.stringify(doc)), 'طالب بلا إذن ينادي shareDocument')
  await mustReject(room.conn.invoke('shareDocument', JSON.stringify({ fileId: foreignFile.id })),
    'مدرس يعرض ملف مدرس آخر')
  await room.conn.invoke('shareDocument', JSON.stringify(doc))
  await until('وصول المستند للطالب', () => pupil.rec.docs.some((d) => d.docJson && JSON.parse(d.docJson).fileId === ownFile.id))
  const late = await connectHub(teacherTok, code)
  const info = await late.conn.invoke('join', code, 'teacher', 'gate-doc')
  await late.conn.stop()
  if (!info.board.doc || JSON.parse(info.board.doc).fileId !== ownFile.id) throw new Error('لقطة المتأخر بلا المستند المعروض')
  // كان الخادم لا يمسّ state.Stage فيدخل المتأخر على فيديو والسبورة مغلقة مع ملف مفتوح
  if (info.board.stage !== 'doc') throw new Error(`المسح المحفوظ يقول stage=${info.board.stage} بعد مشاركة ملف`)
  return `${ownFile.fileName} وصل الطرفين · stage=doc في اللقطة`
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

// 8) المسح: الطالب لا يمحو، والمدرس يمحو **شاشته هو أيضًا** ثم لا يبقى أثر للمتأخر
await item('مسح السبورة يمحو شاشة المدرس نفسه أيضًا لا شاشة الطالب وحدها', async () => {
  await mustReject(pupil.conn.invoke('clearWhiteboard'), 'طالب ينادي clearWhiteboard')
  const beforeLate = await connectHub(teacherTok, code)
  const before = await beforeLate.conn.invoke('join', code, 'teacher', 'gate-before-clear')
  await beforeLate.conn.stop()
  if (before.board.annotations.length === 0) throw new Error('الشرح لم يكن محفوظًا أصلًا فصار البند بلا معنى')
  const myClears = room.rec.clears.length
  await room.conn.invoke('clearWhiteboard')
  // هذا بالضبط ما كان مكسورًا: OthersInGroup ⇒ المُرسِل لا يسمع مسحه فلا تبيض شاشته
  await until('وصول المسح للمدرس نفسه', () => room.rec.clears.length > myClears, 4000)
  await until('وصول المسح للطالب', () => pupil.rec.clears.length >= 1)
  const afterLate = await connectHub(teacherTok, code)
  const after = await afterLate.conn.invoke('join', code, 'teacher', 'gate-after-clear')
  await afterLate.conn.stop()
  if (after.board.annotations.length !== 0) throw new Error(`بعد المسح بقي ${after.board.annotations.length} كائنًا في اللقطة`)
  return `المدرس سمع مسحه · ${before.board.annotations.length} ← 0 للمتأخر`
})

// SignalR يُعالج نداءات نفس الاتصال بالترتيب: عشرين زوجًا (annotate ثم clearWhiteboard
// بلا انتظار) وصلت كلها بالترتيب ولقطة المتأخر فضياء — مقيس مرتين، وبلا حالة حمراء
// قابلة للتكرار فلا يُترك بندًا أخضر أبدًا. الحارس الباقي في بوابة المتصفح: قرار المسح
// يتجاوز أي دفعة شرح لم تُرسَل بعد من نفس الجهاز (هناك قِيس أخضر/أحمر).

// 9) الصلاحيات: المدرس يقفل القلم، فالكتابة تُرفض من الخادم **بسبب مسمّى** ولا تصل
await item('منع الكتابة يرفض قلم الطالب من الخادم مع سبب ولا يمرّر للغرفة', async () => {
  await room.conn.invoke('setPermissions', pupilConn, null, null, false, null)
  await until('وصول القرار للطالب نفسه', () => pupil.rec.perms.some((p) => p.connId === pupilConn && p.canWrite === false))
  await until('وصول القرار للمدرس', () => room.rec.perms.some((p) => p.connId === pupilConn && p.canWrite === false))
  const before = room.rec.adds.length
  const reason = await mustReject(pupil.conn.invoke('annotate', JSON.stringify([addOp(note(900))])),
    'طالب ممنوع يكتب على السبورة')
  await sleep(700)
  if (room.rec.adds.length !== before) throw new Error('كائن طالب ممنوع وصل الغرفة رغم الرفض')
  if (!/منع الكتابة/.test(reason)) throw new Error(`الرفض بلا سبب مفهوم للطالب: ${reason}`)
  // ثم يُرفع المنع فتعود الكتابة تعمل — وإلا كان البند قياس منع لا قياس صلاحية
  await room.conn.invoke('setPermissions', pupilConn, null, null, true, null)
  const arrived = room.rec.adds.length
  await pupil.conn.invoke('annotate', JSON.stringify([addOp(note(901))]))
  await until('عودة الكتابة بعد رفع المنع', () => room.rec.adds.length > arrived)
  return `مرفوض: ${reason.slice(0, 48)} · وبعد السماح وصلت`
})

// 9-ب) الممحاة: حذف بالمعرّف يصل الطرف الآخر، والمعرّف المجهول لا يخلق عملية وهمية
await item('الممحاة تمسح بالمعرّف عند الطرف الآخر، والمعرّف المجهول لا يمرّر شيئًا', async () => {
  const a = note(910)
  const b = note(911)
  await room.conn.invoke('annotate', JSON.stringify([addOp(a), addOp(b)]))
  await until('وصول الكائنين للطالب', () => pupil.rec.adds.some((x) => x.a.id === b.id))
  const beforeDel = pupil.rec.dels.length
  await room.conn.invoke('annotate', JSON.stringify([delOp([a.id, `${RUN}-غير-موجود`])]))
  await until('وصول عملية الحذف', () => pupil.rec.dels.length > beforeDel)
  const last = pupil.rec.dels[pupil.rec.dels.length - 1]
  if (!last.ids.includes(a.id)) throw new Error(`المعرّف المطلوب لم يُمسح: ${JSON.stringify(last.ids)}`)
  if (last.ids.includes(`${RUN}-غير-موجود`)) throw new Error('الخادم مرّر معرّفًا غير موجود في اللوحة — أي أنه بثّ ما لم يحدث')
  const late = await connectHub(teacherTok, code)
  const info = await late.conn.invoke('join', code, 'teacher', 'gate-erase')
  await late.conn.stop()
  const ids = info.board.annotations.map((raw) => JSON.parse(raw).id)
  if (ids.includes(a.id)) throw new Error('المحو لم يُسقط الكائن من اللقطة المحفوظة')
  if (!ids.includes(b.id)) throw new Error('الممحاة مسحت كائنًا لم يُطلب محوه')
  return `${ids.length} كائنًا في اللقطة · المطلوب محوه غائب · والمجهول لم يُبثّ`
})

// 9-ج) التراجع عن كاتبه لا عن آخر ما ظهر: مدرس يكتب ثم طالب يكتب، فتراجع المدرس يمحو سطره هو
await item('التراجع يمسح آخر كائن للحساب نفسه لا آخر كائن على الشاشة', async () => {
  const mine = note(920)
  const theirs = note(921)
  await room.conn.invoke('annotate', JSON.stringify([addOp(mine)]))
  await until('وصول كائن المدرس للطالب', () => pupil.rec.adds.some((x) => x.a.id === mine.id))
  await pupil.conn.invoke('annotate', JSON.stringify([addOp(theirs)]))
  await until('وصول كائن الطالب للمدرس', () => room.rec.adds.some((x) => x.a.id === theirs.id))
  const undone = await room.conn.invoke('undoAnnotation')
  if (undone !== mine.id) throw new Error(`تراجع المدرس رجّع ${undone} لا كائنَه هو ${mine.id}`)
  await until('بلوغ الحذف للطالب', () => pupil.rec.dels.some((d) => d.ids.includes(mine.id)))
  const late = await connectHub(teacherTok, code)
  const info = await late.conn.invoke('join', code, 'teacher', 'gate-undo')
  await late.conn.stop()
  const ids = info.board.annotations.map((raw) => JSON.parse(raw).id)
  if (ids.includes(mine.id)) throw new Error('التراجع لم يُسقط كائن صاحبه من اللقطة')
  if (!ids.includes(theirs.id)) throw new Error('التراجع أكل كائن حساب آخر — كان يجب أن يبقى')
  return `رجع ${undone} · وكائن الطالب باقٍ`
})

// 9-د) المؤشر الحيّ: يصل الطرف الآخر ولا يرجع لصاحبه، ولا يُخزَّن للمتأخر، ويسقط بالمرة إذا كان القلم مقفولًا
await item('المؤشر الحيّ يصل الطرف الآخر ولا يُخزَّن ولا يمرّ لممنوع الكتابة', async () => {
  const beforeP = pupil.rec.pointers.length
  await room.conn.invoke('sendPointer', 0.42, 0.24, 'pen')
  await until('وصول المؤشر للطالب', () => pupil.rec.pointers.length > beforeP)
  if (room.rec.pointers.length !== 0) throw new Error(`المؤشر رجع لكاتبه ${room.rec.pointers.length} مرة`)
  const got = pupil.rec.pointers[pupil.rec.pointers.length - 1]
  if (got.x !== 0.42 || got.y !== 0.24) throw new Error(`إحداثيات المؤشر غير ما أُرسل: ${JSON.stringify(got)}`)
  const late = await connectHub(teacherTok, code)
  const info = await late.conn.invoke('join', code, 'teacher', 'gate-pointer')
  await late.conn.stop()
  if (info.board.annotations.some((raw) => raw.includes('0.42'))) throw new Error('المؤشر خُزِّن في اللوحة — كان يجب أن يكون عارضًا')
  await room.conn.invoke('setPermissions', pupilConn, null, null, false, null)
  await until('وصول المنع للطالب', () => pupil.rec.perms.some((p) => p.connId === pupilConn && p.canWrite === false))
  const blockedBefore = pupil.rec.pointers.length
  await pupil.conn.invoke('sendPointer', 0.9, 0.9, 'pen')
  await sleep(600)
  await room.conn.invoke('setPermissions', pupilConn, null, null, true, null)
  if (pupil.rec.pointers.length !== blockedBefore) {
    throw new Error(`مؤشر طالبٍ ممنوع قلمه مرّ للغرفة (${pupil.rec.pointers.length - blockedBefore})`)
  }
  return `وصل للطرف الآخر فقط · بلا تخزين · وسقط مع المنع`
})

// 10) الصلاحيات: إسكات المدرس يسري على إعلان الطالب نفسه فلا يرفعه بنداء مباشر
await item('إسكات المدرس لا يرفعه إعلان الطالب أنه غير مكتوم', async () => {
  const statesBefore = room.rec.states.length
  await room.conn.invoke('setPermissions', pupilConn, false, null, null, null)
  await until('الطالب يسمع أنه ممنوع من الكلام', () => pupil.rec.perms.some((p) => p.connId === pupilConn && p.canSpeak === false))
  await pupil.conn.invoke('setState', false, true, false) // «لست مكتومًا» — لا حق له في إلغائه
  await until('المدرس يرى الطالب مكتومًا رغم إعلانه', () => room.rec.states.slice(statesBefore).some((s) => s.connId === pupilConn && s.muted === true))
  const latest = room.rec.states.filter((s) => s.connId === pupilConn).at(-1)
  if (latest.muted !== true) throw new Error(`إعلان الطالب أسقط الكتم: muted=${latest.muted}`)
  const restored = pupil.rec.perms.length
  await room.conn.invoke('setPermissions', pupilConn, true, null, null, null)
  // أول حدث انضمام يقول canSpeak=true أصلًا، فالبند بلا مقارنة العدد كان يمرّ بلا معنى
  await until('الطالب يسمع رفع الكتم في حدث جديد', () => pupil.rec.perms.length > restored
    && pupil.rec.perms.at(-1).connId === pupilConn && pupil.rec.perms.at(-1).canSpeak === true)
  return 'setState من الطالب ظل مكتومًا في عين الغرفة · والرفع وصل حدثًا جديدًا'
})

// 11) الصلاحيات قرار مدرّس لا قرار المتصفح: الطالب وولي الأمر لا يملكان setPermissions
await item('setPermissions للمدرس فقط — الطالب وولي الأمر مرفوضان', async () => {
  await mustReject(pupil.conn.invoke('setPermissions', room.rec.peers[0]?.connId ?? pupilConn, true, true, true, true),
    'طالب ينادي setPermissions')
  const watcher = await connectHub(parentTok, code)
  await watcher.conn.invoke('join', code, 'observer', 'gate-perms-parent')
  await mustReject(watcher.conn.invoke('setPermissions', pupilConn, false, false, false, false),
    'ولي أمر مراقب ينادي setPermissions')
  await watcher.conn.stop()
  return 'رُفض من الاثنين'
})

// 11-ب) المنع قرار على **الشخص** لا على المقبس: اتصال ثانٍ لنفس الحساب، وعودة بعد انقطاع
await item('منع المدرس يسري على كل اتصال لنفس الحساب ولا يسقط بإعادة الاتصال', async () => {
  const second = await connectHub(studentTok, code)
  const info = await second.conn.invoke('join', code, 'student', 'gate-second-device')
  const secondConn = info.me?.connId ?? (typeof info.self === 'string' ? info.self : null)
  if (!secondConn) throw new Error('الأداة: نتيجة join بلا معرّف اتصال — لا تُنسب للخادم')
  let third = null
  try {
    await room.conn.invoke('setPermissions', secondConn, null, null, false, null)
    await until('الاتصال الثاني يسمع منعه', () => second.rec.perms.some((p) => p.canWrite === false))
    const onSecond = await mustReject(second.conn.invoke('annotate', JSON.stringify([addOp(note(902))])),
      'اتصال ثانٍ لنفس الحساب الممنوع')
    await second.conn.stop()
    third = await connectHub(studentTok, code)
    await third.conn.invoke('join', code, 'student', 'gate-after-reconnect')
    const onRejoin = await mustReject(third.conn.invoke('annotate', JSON.stringify([addOp(note(903))])),
      'الاتصال العائد لنفس الحساب بعد الانقطاع')
    return `مرفوض على الثاني (${onSecond.slice(0, 26)}) · وعلى العائد (${onRejoin.slice(0, 26)})`
  } finally {
    // رفع المنع عن الحساب كله ثم قطع الاتصال الزائد، فلا يُحمَّل بند لاحق ثقل هذا البند
    await room.conn.invoke('setPermissions', pupilConn, null, null, true, null).catch(() => undefined)
    if (third) await third.conn.stop().catch(() => undefined)
  }
})

// 12) السقف: أكثر من (سقف/ثانية) دفعة في الثانية تُرفض، فلا يُغرق اتصالٌ الغرفة
await item(`سقف ${ANNOTATION_BATCHES_PER_SECOND} دفعة شرح في الثانية لكل اتصال`, async () => {
  const t0 = Date.now()
  let rejected = 0
  const arrivedBefore = pupil.rec.adds.length
  for (let i = 0; i < ANNOTATION_BATCHES_PER_SECOND + 10; i += 1) {
    try {
      await room.conn.invoke('annotate', JSON.stringify([addOp(note(1000 + i))]))
    } catch {
      rejected += 1
    }
  }
  await sleep(500)
  const elapsed = Date.now() - t0
  const arrived = pupil.rec.adds.length - arrivedBefore
  if (rejected === 0) {
    throw new Error(`لم تُرفض أي دفعة بعد ${ANNOTATION_BATCHES_PER_SECOND + 10} في ${elapsed}ms `
      + `· ووصل للطالب ${arrived} · حالة الاتصال ${room.conn.state} — صفر مرفوض مع صفر وصول يعني أن نداءاتي لم تصل الغرفة`)
  }
  if (arrived === 0) throw new Error(`رُفض ${rejected} ولم تصل واحدة — السقف يرفض كل شيء لا ما زاد عليه`)
  return `${rejected} دفعة رُفضت · ${arrived} وصلت في ${(elapsed / 1000).toFixed(1)}s`
})

// 13) ICE: ما يرسله الخادم قابل للاستيعاب في المتصفح، والدالة ترفض الفارغ
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
console.log(`\n✓ ${(results.length)} بندًا أخضر — حالة الغرفة والصلاحيات مفروضة في الخادم`)
console.log(`   الحسابات التي كُتبت: ${teacher.email} · ${peer.email} · ${student.email} · حصة ${code} · ملفان ${ownFile.id}/${foreignFile.id}`)
console.log('   على قاعدة اختبار فقط، ثم: deploy/cleanup-verification-data.sql')
