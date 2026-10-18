/**
 * تحقق من مسار WebSocket **عبر الوسيط** (عقد deploy/nginx.conf):
 *   1) يُنشئ مالكًا ومدرسًا وطالبًا وحصة من خلال /api على الوسيط (نفس الأصل).
 *   2) يفتح اتصال SignalR على /hubs/meetings بالنسبة النسبية نفسها التي تستخدمها
 *      الواجهة حين لا يكون VITE_API_BASE_URL مضبوطًا، وينضم للحصة مراقبًا.
 *   3) يرسل رسالة ويؤكد وصولها — أي أن الترقية والسلوك داخل الغرفة يعملان خلف الوسيط.
 *
 * التشغيل: node tools/hub-through-proxy-check.mjs --proxy http://localhost:8080
 */
import { HttpTransportType, HubConnectionBuilder, LogLevel } from '@microsoft/signalr'

const arg = (n, f) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f
}
const PROXY = (arg('proxy', process.env.EDULINK_PROXY_URL || 'http://localhost:8080')).replace(/\/+$/, '')
const EMAIL = process.env.EDULINK_OWNER_EMAIL || 'owner@edulink.test'
const PASSWORD = process.env.EDULINK_OWNER_PASSWORD || 'Owner@12345'

async function api(method, path, body, token) {
  const res = await fetch(PROXY + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (res.status === 429) {
    throw new Error(`${method} ${path} -> 429 (حدّ الدخول لكل IP أو قفل الحساب فعّال الآن — انتظر الدقيقة التالية أو شغّل هذا الفحص قبل فيريفاير التزوير)`)
  }
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 160)}`)
  return text ? JSON.parse(text) : null
}

const results = []

// إعادة التشغيل على قاعدة فيها الحسابات لا يجب أن تُفشل الفحص: 409 ⇒ ابحث عنها بالبريد
async function ensure(listPath, body, token) {
  const created = await api('POST', listPath, body, token)
  if (created && created.id) return created
  const rows = await api('GET', `${listPath}?take=500`, null, token)
  const found = Array.isArray(rows) ? rows.find((r) => r.email === body.email) : null
  if (!found) throw new Error(`لم يُعثر على ${body.email} في ${listPath} بعد 409`)
  return found
}

await api('POST', '/api/setup/owner', { name: 'Owner', email: EMAIL, password: PASSWORD })
const login = await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD })
const tok = login.token
results.push(`✓ دخول عبر الوسيط — توكن ${String(tok).slice(0, 8)}…`)

const teacher = await ensure('/api/users',
  { name: 'أ. سارة الوسيط', email: 'sara.edge@edulink.test', password: 'Sara@12345', role: 0 }, tok)
const student = await ensure('/api/students',
  { name: 'نور الوسيط', email: 'nour.edge@edulink.test', password: 'Nour@12345', states: 1, access: 1 }, tok)
const session = await api('POST', '/api/sessions', {
  subject: 'اللغة العربية — النحو والصرف عبر الوسيط',
  teacherId: teacher.id, studentId: student.id, gradeKey: 'g12', durationMin: 60,
  startsAt: new Date(Date.now() - 60_000).toISOString(),
}, tok)
results.push(`✓ تكويد وحصة عبر الوسيط — code=${session.code}`)

let received = 0
const conn = new HubConnectionBuilder()
  // نفس ما تفعله الواجهة تمامًا: `/hubs/...` نسبي، بلا أصل مُطلَق
  .withUrl(`${PROXY}/hubs/meetings?access_token=${encodeURIComponent(tok)}&room=${encodeURIComponent(session.code)}`, {
    skipNegotiation: true,
    transport: HttpTransportType.WebSockets,
  })
  .configureLogging(LogLevel.Error)
  .build()

let state = 'idle'
conn.on('chat', () => { received += 1 })
await conn.start()
state = 'connected'
// مطالعة العميل لدوره لا معنى لها هنا: الحساب مالك (مشرف فأعلى)، فنطالِب بدور «teacher»
// وهو أعلى مما نحن، وننتظر أن يرجع الخادم الدور المحسوب من القاعدة لا ما أرسلناه.
// لو انحلت الصلاحية يومًا من ما يرسله المتصفح بدل ما تحسبه القاعدة، هذا السطر يفشل — وهذا هو المراد.
const info = await conn.invoke('join', session.code, 'teacher', 'edge-check')
if (info?.room !== session.code) throw new Error(`الغرفة المُرجعة ${info?.room} لا تساوي كود الحصة ${session.code}`)
// `join` يُرجع **الآخرين فقط** (لا self)، فالدور المحسوب لا يُقرأ من نتيجته إطلاقًا.
// القناة الحقيقية له هي رسالة `peer-joined` التي يرسلها الخادم ببياناته هو، لذلك
// ينضم اتصال ثانٍ بنفس المطالبة المرتفعة 'teacher'، وما يصلنا عنه هو ما حسبه الخادم.
let peerRole = null
let peerName = null
conn.on('peer-joined', (p) => { peerRole = p?.role ?? null; peerName = p?.name ?? null })

const conn2 = new HubConnectionBuilder()
  .withUrl(`${PROXY}/hubs/meetings?access_token=${encodeURIComponent(tok)}&room=${encodeURIComponent(session.code)}`, {
    skipNegotiation: true,
    transport: HttpTransportType.WebSockets,
  })
  .configureLogging(LogLevel.Error)
  .build()
await conn2.start()
await conn2.invoke('join', session.code, 'teacher', 'edge-check-2')
await new Promise((r) => setTimeout(r, 1200))

if (peerRole === null) throw new Error('لم تصل `peer-joined` من الاتصال الثاني — لا قياس للدور المحسوب في الخادم')
if (peerRole !== 'observer') {
  throw new Error(`الخادم منح '${peerRole}' لعميل مطالِب بـ 'teacher' — الأدوار يجب أن تُحسب من القاعدة لا من المتصفح`)
}
results.push(`✓ اتصال WebSocket مُرقّى عبر الوسيط — حالة=${state} غرفة=${info.room} (الآخرون عند الانضمام: ${info.peers?.length ?? 0})`)
results.push(`✓ الدور محسوب من القاعدة: مطالعة 'teacher' رجعت '${peerRole}' للشريك ${peerName}`)

// الاتجاه المعاكس (بدونه الفحص أحادي ولا يمكن أن يرفض): المدرس الحقيقي يطالِب بـ 'student'.
// لو وثق الخادم يومًا بما يرسله المتصفح لرجعت 'student' هنا — فيفشل هذا السطر على بيانات حقيقية.
const teacherLogin = await api('POST', '/api/auth/login', { email: 'sara.edge@edulink.test', password: 'Sara@12345' })
if (!teacherLogin?.token) throw new Error('تعذّر دخول المدرس لقياس الاتجاه المعاكس للدور')
let teacherRole = null
conn.on('peer-joined', (p) => { if (p?.name === 'edge-teacher') teacherRole = p.role ?? null })
const conn3 = new HubConnectionBuilder()
  .withUrl(`${PROXY}/hubs/meetings?access_token=${encodeURIComponent(teacherLogin.token)}&room=${encodeURIComponent(session.code)}`, {
    skipNegotiation: true,
    transport: HttpTransportType.WebSockets,
  })
  .configureLogging(LogLevel.Error)
  .build()
await conn3.start()
await conn3.invoke('join', session.code, 'student', 'edge-teacher')
await new Promise((r) => setTimeout(r, 1200))
if (teacherRole === null) throw new Error('لم تصل `peer-joined` من المدرس — لا قياس للاتجاه المعاكس')
if (teacherRole !== 'teacher') {
  throw new Error(`المدرس الحقيقي حصل على '${teacherRole}' بدل 'teacher' — الخادم صدَّق مطالعة العميل 'student'`)
}
results.push(`✓ الاتجاه المعاكس: مطالعة 'student' من المدرس رجعت '${teacherRole}' (مدرس الحصة من القاعدة)`)

await conn.send('sendChat', 'ping عبر الوسيط')
await new Promise((r) => setTimeout(r, 1500))
results.push(`✓ رسائل مستقبَلة عبر الوسيط: ${received}`)
await conn3.stop()
await conn2.stop()
await conn.stop()

console.log(results.join('\n'))
if (!received) {
  console.log('✗ لم تصل رسالة عبر الوسيط — مسار /hubs غير مكتمل')
  process.exit(1)
}
console.log('المسار الكامل عبر الوسيط يعمل (REST + WebSocket + غرفة + رسائل)')
