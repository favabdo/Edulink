/**
 * محاكي nginx للتحقق المحلي: نفس عقد deploy/nginx.conf
 *   - يخدم apps/web/dist (مع try_files → index.html للروابط الداخلية)
 *   - يمرّر /api و /hubs إلى الـ API، ويرفع WebSocket بترقية حقيقية
 *   - يضيف X-Forwarded-For بنفس سلوك nginx: $proxy_add_x_forwarded_for
 *     (أي «ما أرسله العميل + عنوانه الحقيقي») — وهذا بالضبط ما يكشف
 *     هل يستطيع عميل مخادع أن يزوّر IPه أمام تحديد المعدل.
 *
 * التشغيل:  node tools/edge-proxy.mjs --listen 8080 --api http://localhost:5279
 *   وتحت بادئة النشر كما على السيرفر:  --prefix /edulink
 *   وفوق TLS كما يفعل nginx: --listen 8443 --cert cert.pem --key key.pem
 *   (بشهادة يُقاس بها مسار https/wss قبل التسليم — لا بثقة المتصفح نفسه.)
 * (أداة تحقق للتطوير فقط — ليست بديلًا عن nginx في الإنتاج.)
 */
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const LISTEN_PORT = Number(arg('listen', 8080))
const API = new URL(arg('api', 'http://localhost:5279'))
const DIST = normalize(arg('dist', 'apps/web/dist'))
const TLS_CERT = arg('cert', '')
const TLS_KEY = arg('key', '')
const SECURE = Boolean(TLS_CERT && TLS_KEY)
// بادئة النشر كما في deploy/nginx-edulink.conf: `--prefix /edulink` يجعل الوسيط يقيس
// نفس العقد الذي يقيمه nginx على السيرفر (/edulink/api → /api، و/edulink/hubs → /hubs،
// والباقي ملفات من dist تحت تلك البادئة). خارج البادئة ⇒ 404 لا رجوع صامت.
const PREFIX = (arg('prefix', '') || '').replace(/\/+$/, '')
// صمِّم للاختبار فقط: بدل أن نضيف عنوان العميل الحقيقي (وهو ::1 حين يكون
// العميل والوسيط على نفس الجهاز) نضيف عنوانًا اصطلاحيًا، فيُعرف يقينًا
// هل يعتمد الـ API القيمة التي أضافها الوسيط (صحيح) أم قيمة العميل المزوّرة.
const FAKE_CLIENT = arg('fake-client', '')

function appendedFor(realPeer) {
  return FAKE_CLIENT || realPeer
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
}

/** يجرّد بادئة النشر من المسار القادم؛ null يعني خارج البادئة (404 مثل location غير موجود). */
function stripPrefix(url) {
  if (!PREFIX) return url
  if (url === PREFIX) return '/'
  if (url.startsWith(`${PREFIX}/`) || url.startsWith(`${PREFIX}?`)) {
    return url.slice(PREFIX.length) || '/'
  }
  return null
}

async function serveStatic(req, res, path) {
  const rel = normalize(decodeURIComponent(path.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIST, rel)
  try {
    const info = await stat(file)
    if (info.isDirectory()) throw new Error('dir')
  } catch {
    file = join(DIST, 'index.html')   // try_files ... /index.html
  }
  const body = await readFile(file)
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(body)
}

function forward(req, res, path) {
  const headers = { ...req.headers }
  // سلوك $proxy_add_x_forwarded_for: نضيف عنوان العميل الحقيقي إلى ما أرسله هو
  const peer = req.socket.remoteAddress ?? ''
  headers['x-forwarded-for'] = headers['x-forwarded-for']
    ? `${headers['x-forwarded-for']}, ${peer}`
    : String(peer)
  headers['x-forwarded-proto'] = SECURE ? 'https' : 'http'
  headers.host = API.host

  const upstream = http.request(
    { host: API.hostname, port: API.port, method: req.method, path, headers },
    (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.headers)
      ur.pipe(res)
    },
  )
  upstream.on('error', () => { res.writeHead(502); res.end('bad gateway') })
  req.pipe(upstream)
}

const isApiPath = (path) => path.startsWith('/api') || path.startsWith('/hubs')

const handle = (req, res) => {
  const path = stripPrefix(req.url)
  if (path === null) { res.writeHead(404); res.end('outside deploy prefix'); return }
  if (isApiPath(path)) return forward(req, res, path)
  serveStatic(req, res, path).catch(() => { res.writeHead(500); res.end('error') })
}

const server = SECURE
  ? https.createServer({ key: readFileSync(TLS_KEY), cert: readFileSync(TLS_CERT) }, handle)
  : http.createServer(handle)

// ترقية WebSocket كما يفعل nginx (proxy_set_header Upgrade/Connection)
server.on('upgrade', (req, socket, head) => {
  const path = stripPrefix(req.url)
  if (path === null || !isApiPath(path)) { socket.destroy(); return }
  const peer = req.socket.remoteAddress ?? ''
  const headers = { ...req.headers }
  headers['x-forwarded-for'] = headers['x-forwarded-for']
    ? `${headers['x-forwarded-for']}, ${peer}`
    : String(peer)
  headers.host = API.host

  const proxySocket = net.connect(Number(API.port || 80), API.hostname, () => {
    const lines = [`GET ${path} HTTP/1.1`]
    for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`)
    proxySocket.write(`${lines.join('\r\n')}\r\n\r\n`)
    socket.write('HTTP/1.1 101 Switching Protocols\r\n\r\n'.replace('\r\n\r\n', ''))
    // نمرّر استجابة الخادم الخام ثم نلصق الطرفين
    proxySocket.once('data', (chunk) => {
      socket.write(chunk)
      proxySocket.pipe(socket)
      socket.pipe(proxySocket)
      if (head?.length) proxySocket.write(head)
    })
  })
  proxySocket.on('error', () => socket.destroy())
  socket.on('error', () => proxySocket.destroy())
})

server.listen(LISTEN_PORT, () => {
  console.log(`✓ وسيط محلي على ${SECURE ? 'https' : 'http'}://localhost:${LISTEN_PORT}${PREFIX || '/'} → ${API.origin} (dist: ${DIST})`)
})
