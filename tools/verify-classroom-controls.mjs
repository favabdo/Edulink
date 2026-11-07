/**
 * بوابة غرفة المتصفح الحقيقي (CDP خامّ — بلا مكتبات خارجية):
 *   الوسائط تمشي فعلًا في الاتجاهين على الكود الجديد، وسقف معدل الفيديو مطبَّق على
 *   الـ sender، والقلم يصل ويُرسَم ويُمنع ويُمسح **عند المدرس نفسه**، وكتم المدرس
 *   يُطفئ ميكروفون الطالب الحقيقي، وقلب الكاميرا لا يقتل المسار الحيّ، وملء الشاشة
 *   يمسك البلاطة بالفعل.
 *
 * لماذا متصفح ولا SignalR خامّ: `verify-room-state.mjs` يقيس عقد الخادم من الخارج.
 * هذا الملف يقيس ما تراه الشاشة — لأن عيوب الوسائط التي بلغ عنها صاحب المشروع كلها
 * كانت «الشاشة تقول متصل» بينما لا شيء يمرّ.
 *
 * التشغيل (يكتب حسابات وحصصًا بنطاق @tila.test — قاعدة اختبار فقط):
 *   EDULINK_API_URL=http://127.0.0.1:5299 \
 *   EDULINK_EDGE_URL=http://127.0.0.1:8090 \
 *   EDULINK_SEED_OWNER_EMAIL=owner@tila.test EDULINK_SEED_OWNER_PASSWORD=… \
 *   node tools/verify-classroom-controls.mjs
 *
 * لا TURN هنا: قياس على شبكة واحدة (host candidates) — crossing NAT ما زال غير مُثبت.
 *
 * سبعة عشر بندًا: العشرة الأولى من الخطوة 63 (وسائط/قلم/كنترول)، وسبعة لنموذج الشرح
 * المُصنَّف — الأشكال كائن واحد، لون الكاتب وسماكته في الكائن نفسه، الممحاة تُمسح
 * الكائن لا اللوحة، التراجع على مستوى الكاتب، النصّ يصل حرفيًا، يد المشارك تظهر
 * باسمها عند الآخر فقط وتختفي عند السكون، والمسح يُسقط دفعة شرح لم تُرسَل بعد.
 *
 * الحالات الحمراء المقيسة على هذه الزيادة (كلٌّ أحمر وحده لا غير):
 *   `hitAnnotation` تُرجع false ⇒ بند الممحاة.
 *   حذف `event.preventDefault()` من فرع النص ⇒ بند النصّ (caret يُولد ويُغلقه onBlur).
 *   حذف إسقاط الطابور من `clearBoard` ⇒ بند المسح الفوري (الطالب 447 بكسل والمدرس 0).
 *   إلغاء فلتر الكاتب في `UndoAnnotation` (خادم) ⇒ بند التراجع هنا + بند في الخادم.
 *   إلغاء بثّ `pointer` في `SendPointer` (خادم) ⇒ بند اليد هنا + بند في الخادم.
 * وأربعة فخاخ في الأداة نفسها كُشِفت بالتشغيل لا بالقراءة: غلاف `WebSocket` لا بدّ أن
 * ينسخ ثوابته الساكنة (وإلا قررت صفحة SignalR أن المقبس ليس OPEN فسقطت البنود وكأن
 * المنتج مكسور)؛ وإطار النداء الخام لا يحمل `protocol/version` (هما للمصافحة) وإلا أغلق
 * الخادم الاتصال بردّ عام بلا سبب؛ ونداء `annotate` يستلم الدفعة **نصًّا** فإطار SignalR
 * يحملها بتفريغ الاقتباسات، والخادم يُفرّغ غير ASCII إلى ‎\uXXXX‎، فالوجاف الحرفي لا
 * يطابق رسالة عربية سليمة وتُقارَن الإطارات بعد التفكيك لا قبله؛ والدفعة تتأخر ~50ms
 * فالقراءة الفورية بعد السحب تُظهر منتجًا سليمًا مكسورًا. وفحص الحقن قبل أي بند يسمّي
 * الأداة نفسها إن لم يعمل سكربت القياس.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API = (process.env.EDULINK_API_URL || 'http://localhost:5279').replace(/\/+$/, '')
const EDGE = (process.env.EDULINK_EDGE_URL || 'http://localhost:8090').replace(/\/+$/, '')
const OWNER_EMAIL = process.env.EDULINK_SEED_OWNER_EMAIL
const OWNER_PASSWORD = process.env.EDULINK_SEED_OWNER_PASSWORD
if (!OWNER_EMAIL || !OWNER_PASSWORD) {
  console.error('✗ بيئة الأداة ناقصة: '
    + [!OWNER_EMAIL && 'EDULINK_SEED_OWNER_EMAIL', !OWNER_PASSWORD && 'EDULINK_SEED_OWNER_PASSWORD']
      .filter(Boolean).join(' · '))
  process.exit(1)
}
const CHROME = process.env.EDULINK_CHROME
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.EDULINK_CDP_PORT || 9333)
const VIDEO_MAX_BPS = 1_200_000
const RUN = Date.now().toString(36).slice(-5)
const PW = 'Gate#' + RUN + 'X!z'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const failures = []
const consoleErrors = []
/** كود إغلاق المقبوس وسببه — SignalR يطبع «ليس OPEN» ولا يسمّي ما أغلقه */
const netEvents = new Map()

async function item(name, fn) {
  try {
    const detail = await fn()
    results.push(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
    console.log(results.at(-1))
  } catch (err) {
    failures.push(`✗ ${name} — ${err.message}`)
    console.log(failures.at(-1))
  }
}

const randPhone = () => '+201' + Math.floor(1e9 + Math.random() * 9e9)

async function api(method, path, body, token) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 220)}`)
  return JSON.parse(text)
}

// ---------------------------------------------------------------- CDP client
class CDP {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.listeners = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, label } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${label}: ${msg.error.message}`))
        else resolve(msg.result)
        return
      }
      if (msg.method) this.listeners.forEach((cb) => cb(msg))
    })
  }

  static async connect(url) {
    const ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      socket.addEventListener('open', () => resolve(socket))
      socket.addEventListener('error', () => reject(new Error(`لم يفتح CDP على ${url}`)))
    })
    return new CDP(ws)
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, label: `${sessionId ?? ''} ${method}` })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  on(cb) { this.listeners.push(cb) }
}

/** وسم واحد = تبويب. كل النقرات بأحداث فأر حقيقية: .click() بلا user activation
 *  يرفض بها المتصفح ملء الشاشة، فيصير البند الأحمر كذبًا على المنتج. */
class Tab {
  constructor(browser, sessionId, name) {
    this.browser = browser
    this.sessionId = sessionId
    this.name = name
  }

  async init() {
    await this.browser.send('Page.enable', {}, this.sessionId)
    await this.browser.send('Runtime.enable', {}, this.sessionId)
    await this.browser.send('Network.enable', {}, this.sessionId)
    await this.browser.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, this.sessionId)
    // تسجيل اتصالات WebRTC التي يبنيها المنتج دون تغيير سلوكها: الوسيط يستدعي نفس
    // الباني الأصلي ويخزّن المِثال فقط، وإلا كان القياس يقيس المنصة لا الشاشة.
    await this.browser.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__clicks = [];
        // sessionStorage يبقى عبر التنقل في نفس التبويب: العدّادان يفرّقان
        // «مقبس واحد مات» عن «الشاشة تُعيد تركيب نفسها وتقتل كل اتصال»
        try {
          sessionStorage.setItem('navCount', String(Number(sessionStorage.getItem('navCount') || 0) + 1));
        } catch (err) { /* about:blank بلا تخزين */ }
        document.addEventListener('click', (e) => {
          const b = e.target && e.target.closest ? e.target.closest('button') : null;
          const text = b ? (b.getAttribute('aria-label') || b.textContent || '') : String(e.target && e.target.tagName);
          window.__clicks.push(text.trim().slice(0, 40));
          if (window.__clicks.length > 60) window.__clicks.shift();
        }, true);
        window.__clickCount = () => window.__clicks.length;
        window.__pcs = [];
        (function () {
          const Orig = window.RTCPeerConnection;
          function Wrapped(...args) { const pc = new Orig(...args); window.__pcs.push(pc); return pc; }
          Wrapped.prototype = Orig.prototype;
          for (const k of Object.getOwnPropertyNames(Orig)) {
            if (!['length', 'name', 'prototype'].includes(k)) Wrapped[k] = Orig[k];
          }
          Object.defineProperty(window, 'RTCPeerConnection', { value: Wrapped, writable: true, configurable: true });
        })();
        window.__media = [];
        (function () {
          const md = navigator.mediaDevices;
          if (!md || !md.getUserMedia) return;
          const Orig = md.getUserMedia.bind(md);
          navigator.mediaDevices.getUserMedia = function (constraints) {
            const rec = { wanted: JSON.stringify(constraints || {}), tracks: null, ended: [], error: null };
            window.__media.push(rec);
            return Orig(constraints).then((stream) => {
              rec.tracks = stream.getTracks().map((tr) => tr.kind + ':' + tr.readyState + ':' + (tr.getSettings().deviceId || '?').slice(0, 8));
              stream.getTracks().forEach((tr) => tr.addEventListener('ended', () => rec.ended.push(tr.kind)));
              return stream;
            }, (err) => { rec.error = err.name + ' ' + err.message; throw err; });
          };
        })();
        window.__ws = [];
        (function () {
          const Orig = window.WebSocket;
          function Wrapped(url, protocols) {
            const ws = protocols === undefined ? new Orig(url) : new Orig(url, protocols);
            try {
              sessionStorage.setItem('wsCount', String(Number(sessionStorage.getItem('wsCount') || 0) + 1));
            } catch (err) { /* عندها يُقاس عدد __ws وحده */ }
            const rec = { url: String(url).slice(0, 220), frames: [], ws, t0: Date.now() };
            const stamp = () => '+' + (Date.now() - rec.t0) + 'ms ';
            window.__ws.push(rec);
            ws.addEventListener('open', () => rec.frames.push(stamp() + 'open'));
            ws.addEventListener('message', (ev) => {
              if (typeof ev.data !== 'string' || ev.data.length < 2) return;
              rec.frames.push(stamp() + 'in ' + ev.data.slice(0, 420));
              if (rec.frames.length > 500) rec.frames.shift();
            });
            ws.addEventListener('close', (ev) => {
              rec.frames.push(stamp() + 'close code=' + ev.code + ' reason=' + String(ev.reason || '').slice(0, 80));
            });
            ws.addEventListener('error', () => { rec.frames.push(stamp() + 'socket-error'); });
            const origClose = ws.close.bind(ws);
            ws.close = (code, reason) => {
              const stack = String(new Error().stack || '').split('\\n').slice(1, 5).join(' ← ').slice(0, 220);
              rec.frames.push(stamp() + 'CLOSE-CALLED(' + (code ?? '-') + ') ' + stack);
              return origClose(code, reason);
            };
            const origSend = ws.send.bind(ws);
            ws.send = (data) => {
              rec.frames.push(stamp() + (typeof data === 'string' && data.length > 1
                ? 'out ' + data.slice(0, 420)
                : 'send(type=' + (typeof data) + ',len=' + (data?.byteLength ?? data?.length ?? '?') + ')'))
              return origSend(data);
            };
            return ws;
          }
          Wrapped.prototype = Orig.prototype;
          // الثوابت الساكنة تُنسخ وإلا صارت الأداة هي العيب: عميل SignalR يقارن
          // readyState بـ constructor.OPEN، وبلا OPEN تُرفض المصافحة «لا OPEN state»
          for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wrapped[k] = Orig[k];
          Object.defineProperty(window, 'WebSocket', { value: Wrapped, writable: true, configurable: true });
        })();
        window.__wsFind = (needle) => window.__ws.flatMap((s) => s.frames)
          .filter((f) => f.includes(needle)).slice(-2).join(' ⏐ ');
        window.__wsCount = (needle) => window.__ws.flatMap((s) => s.frames)
          .filter((f) => f.includes(needle)).length;
        window.__wsFrames = (urlNeedle) => window.__ws.filter((s) => s.url.includes(urlNeedle))
          .map((s) => s.url.slice(0, 40) + ' << ' + s.frames.slice(-12)
            .join(' ⏐ ').replace(/[\\u0000-\\u001f\\u007f]/g, '~')).join(' || ').slice(0, 1400);
        // ردّ الخادم لنداء بعينه: SignalR يكتب الإكمال تحت type:3 (أمّا 6 فـ Ping
        // و7 إغلاق الاتصال) — حتى لا يحسب البند ردّه هو (إطار صادر) إثباتًا من الخادم
        window.__wsReply = (id) => window.__ws.flatMap((s) => s.frames)
          .filter((f) => /^\\+\\d+ms in /.test(f) && f.includes('"type":3')
            && f.includes('"invocationId":"' + id + '"'))
          .slice(-1)[0] || '';
        window.__inkCanvases = () => [...document.querySelectorAll('canvas[aria-label]')].map((c) => {
          const r = c.getBoundingClientRect();
          let painted = 0;
          try {
            const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 8) painted += 1;
          } catch (err) { painted = -1; }
          return { label: (c.getAttribute('aria-label') || '').slice(0, 22), cls: c.className.slice(0, 26),
                   at: Math.round(r.x) + ',' + Math.round(r.y), size: Math.round(r.width) + 'x' + Math.round(r.height),
                   buf: c.width + 'x' + c.height, painted };
        });
        window.__canvases = () => JSON.stringify(window.__inkCanvases());
        // أكبر قيمة بين اللوحات: أي حبرٍ باقٍ على أي لوحة يُعَدّ باقياً على الشاشة
        window.__inkPixels = () => {
          const all = window.__inkCanvases();
          return all.length ? Math.max(...all.map((c) => c.painted)) : -1;
        };
        // عدّ بكسلات شريط أفقي من اللوحة فقط: «كائن منطقة معينة مُمسح» لا يُقاس
        // بمجموع اللوحة لأن بقية الكائنات تبقى سالمة عمدًا (الممحاة كائنية لا مسح عام)
        window.__inkRegion = (x0, x1) => {
          const c = document.querySelector('canvas[aria-label]');
          if (!c) return -1;
          const sx = Math.max(0, Math.round(c.width * x0));
          let painted = 0;
          try {
            const data = c.getContext('2d').getImageData(sx, 0, Math.max(1, Math.round(c.width * (x1 - x0))), c.height).data;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 8) painted += 1;
          } catch (err) { return -2; }
          return painted;
        };
        // الأداة التي حملها اللوح فعليًا: data-tool لا حالة React — تُقرأ من الشاشة نفسها
        window.__boardTool = () => {
          const c = document.querySelector('canvas[aria-label]');
          return c ? String(c.getAttribute('data-tool') || '') : '';
        };
        // المؤشرات الحيّة للآخرين (لا مؤشر لصاحبه) + اسم من يحملها
        window.__pointers = () => [...document.querySelectorAll('[data-pointer]')]
          .map((e) => (e.textContent || '').trim().slice(0, 24));
        // الاتجاه مهم: «إطار فيه الأداة» قد يكون ردّ الأداة نفسه لا رسالة الطرف الآخر.
        // ونداء annotate يستلم الدفعة **نصًّا** فإطار SignalR يحملها بتفريغ الاقتباسات،
        // والخادم (System.Text.Json) يُفرّغ غير ASCII أيضًا إلى \\uXXXX — فالوجاف الحرفي
        // لا يطابق رسالة سليمة (عربي على السلك!)، لذا تُقارَن الوجافة بعد التفكيك لا قبله.
        const BS = String.fromCharCode(92), QU = String.fromCharCode(34);
        const HEX4 = /^[0-9a-fA-F]{4}$/;
        const norm = (s) => {
          let out = '';
          for (let i = 0; i < s.length; i += 1) {
            const ch = s.charAt(i);
            if (ch === BS && s.charAt(i + 1) === QU) { out += QU; i += 1; continue; }
            if (ch === BS && s.charAt(i + 1) === 'u') {
              const hex = s.substr(i + 2, 4);
              if (HEX4.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 5; continue; }
            }
            out += ch;
          }
          return out;
        };
        window.__wsOutCount = (needle) => window.__ws.flatMap((s) => s.frames)
          .filter((f) => f.includes('ms out') && norm(f).includes(needle)).length;
        window.__wsInCount = (needle) => window.__ws.flatMap((s) => s.frames)
          .filter((f) => f.includes('ms in') && norm(f).includes(needle)).length;
        // إطار واحد يحمل الوِجافتين معًا: لا يُحسب نجاحًا أن يأتي اللون في رسالة والسماكة في أخرى
        window.__wsInBoth = (n1, n2) => window.__ws.flatMap((s) => s.frames)
          .filter((f) => { const n = norm(f); return f.includes('ms in') && n.includes(n1) && n.includes(n2); })
          .slice(-1)[0] || '';
        window.__wsNorm = (needle) => window.__ws.flatMap((s) => s.frames)
          .filter((f) => norm(f).includes(needle)).slice(-1)[0] || '';
        window.__notice = () => {
          const el = document.querySelector('[role="alert"]');
          return el ? el.textContent.trim() : '';
        };
        window.__bodyText = () => document.body.innerText;
        window.__findButton = (label) => {
          const nodes = [...document.querySelectorAll('button')];
          const hit = nodes.find((b) => (b.getAttribute('aria-label') || '').includes(label)
            || (b.title || '').includes(label) || (b.textContent || '').trim().includes(label));
          if (!hit) return null;
          if (hit.disabled) return { disabled: true, label };
          hit.scrollIntoView({ block: 'center', inline: 'center' });
          const r = hit.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
        };
        window.__dumpButtons = () => [...document.querySelectorAll('button')].map((b) => {
          const r = b.getBoundingClientRect();
          return ((b.getAttribute('aria-label') || b.textContent || '?').trim().slice(0, 26))
            + (b.disabled ? '[off]' : '') + ' @' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
        }).join(' · ');
        window.__senders = () => ({
          senders: window.__pcs.flatMap((pc) => pc.getSenders()
            .map((s) => ({ kind: s.track ? s.track.kind : 'none', enabled: s.track ? s.track.enabled : null,
              ready: s.track ? s.track.readyState : 'none', hint: s.track ? s.track.contentHint : '',
              maxBitrate: s.getParameters && s.getParameters().encodings && s.getParameters().encodings[0]
                ? s.getParameters().encodings[0].maxBitrate : undefined,
              frameRate: s.track && s.track.getSettings ? s.track.getSettings().frameRate : undefined }))),
        });
        window.__bytesIn = async () => {
          let bytes = 0;
          for (const pc of window.__pcs) {
            const stats = await pc.getStats();
            stats.forEach((s) => { if (s.type === 'inbound-rtp') bytes += s.bytesReceived ?? 0; });
          }
          return { bytes, pcs: window.__pcs.length };
        };`,
    }, this.sessionId)
  }

  /** كروم يرفض ملء الشاشة للتبويب غير المُركَّز — فالقياس بلا هذه خطوة كذب على المنتج */
  async bringToFront() {
    await this.browser.send('Page.bringToFront', {}, this.sessionId)
    await sleep(300)
  }

  /** ما رآه بروتوكول الشبكة في هذه الجلسة: إنشاء/رسائل/إغلاق بكوده */
  socketTrace() {
    return (netEvents.get(this.sessionId) ?? []).slice(-12).join(' → ') || 'لا أحداث'
  }

  async goto(url) {
    await this.browser.send('Page.navigate', { url }, this.sessionId)
    await sleep(1000)
  }

  async eval(expression) {
    const r = await this.browser.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true }, this.sessionId)
    if (r.exceptionDetails) {
      throw new Error(`${this.name}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    }
    return r.result.value
  }

  async until(label, expression, ms = 20000) {
    const t0 = Date.now()
    for (;;) {
      let value
      try {
        value = await this.eval(expression)
      } catch (err) {
        // صفحة تُستبدل أثناء التنقل تُسقط النداء — وهذا فشل لا «لم يحدث بعد»
        throw new Error(`«${label}» — فشل التقييم: ${err.message}`)
      }
      if (value) return value
      if (Date.now() - t0 > ms) throw new Error(`«${label}» لم يتحقق خلال ${ms}ms`)
      await sleep(300)
    }
  }

  /** نقرة فأر حقيقية على زر بموضعه النصي — والفشل يسمّي حالة الصفحة نفسها */
  async click(label) {
    let box = null
    try {
      await this.until(`زرّ «${label}»`, `window.__findButton(${JSON.stringify(label)}) ? 1 : 0`, 12000)
      box = await this.eval(`window.__findButton(${JSON.stringify(label)})`)
    } catch (err) {
      const dump = await this.eval('window.__dumpButtons()').catch(() => 'لا dump')
      throw new Error(`${this.name}: ${err.message} — أزرار الصفحة: ${String(dump).slice(0, 900)}`)
    }
    if (box?.disabled) throw new Error(`زرّ «${label}» معطَّل في الشاش عند ${this.name}`)
    if (!box?.x) throw new Error(`زرّ «${label}» بلا مقاس عند ${this.name}`)
    if (box.x < 0 || box.y < 0 || box.x > 1440 || box.y > 900) {
      throw new Error(`زرّ «${label}» خارج الشاشة عند ${this.name}: @${Math.round(box.x)},${Math.round(box.y)}`)
    }
    const before = await this.eval('window.__clickCount()')
    // بروتوكول CDP لا يعرف «mouseClicked»، وpress بلا clickCount لا يولّد click أبدًا:
    // press/release باثنين clickCount=1 هي التي تُنتج الحدث عند نفس العقدة.
    for (const [type, buttons] of [['mouseMoved', 0], ['mousePressed', 1], ['mouseReleased', 0]]) {
      await this.browser.send('Input.dispatchMouseEvent', {
        type, x: Math.round(box.x), y: Math.round(box.y),
        button: type === 'mouseMoved' ? 'none' : 'left',
        buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
      }, this.sessionId)
    }
    await sleep(250)
    const after = await this.eval('window.__clickCount()')
    if (after <= before) {
      const last = await this.eval('window.__clicks.slice(-3).join(" | ")').catch(() => 'لا سجل')
      throw new Error(`${this.name}: نقرة الفأر على «${label}» @${Math.round(box.x)},${Math.round(box.y)} لم تُنتج أي حدث click في DOM `
        + `(آخر مُلتقَط: ${last}) — الأداة لا المنتج`)
    }
    return `نُقر «${label}»`
  }

  /** أزرار إذن المدرس لا تُبنى في DOM إلا وتاب «المشاركون» مفتوح — فالبند الذي
   *  يضغطها يجب أن يفتحه، وإلا كان أحمر لأن الأداة لم تصل إلى الزر. */
  async openPeople() {
    await this.click('المشاركون')
    await this.until('لوحة المشاركين فيها أزرار الإذن',
      `(() => { const b = [...document.querySelectorAll('button')];
        return b.some((x) => /إذن المدرس|إسكات|منع الكتابة|السماح بالكتابة/.test((x.getAttribute('aria-label') || ''))) ? 1 : 0 })()`, 10000)
  }

  async boardBox() {
    await this.until('سبورة بالمقاس', `(() => { const c = document.querySelector('canvas[aria-label]');
      if (!c) return 0; const r = c.getBoundingClientRect(); return (r.width > 60 && r.height > 40) ? 1 : 0 })()`, 20000)
    return this.eval(`(() => { const r = document.querySelector('canvas[aria-label]').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
  }

  /** مسار أفقي عند منتصف اللوحة — نفس ما كانت تفعله البنود الأولى */
  async drawStroke(fromPct, toPct, steps = 6) {
    const box = await this.boardBox()
    const at = (pct) => ({ x: box.x + box.w * pct, y: box.y + box.h * 0.5 })
    return this.dragPath(at(fromPct), at(toPct), steps)
  }

  /** ضغط وسحب وإفلات بإحداثيات مُطلقة داخل الشاشة — الأشكال تحتاج قطرًا لا خطًا أفقيًا */
  async dragPath(from, to, steps = 6) {
    const a = { x: Math.round(from.x), y: Math.round(from.y) }
    const b = { x: Math.round(to.x), y: Math.round(to.y) }
    await this.browser.send('Input.dispatchMouseEvent',
      { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 }, this.sessionId)
    for (let i = 1; i <= steps; i += 1) {
      await this.browser.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(a.x + ((b.x - a.x) * i) / steps),
        y: Math.round(a.y + ((b.y - a.y) * i) / steps),
        button: 'left', buttons: 1,
      }, this.sessionId)
      await sleep(30)
    }
    await this.browser.send('Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 }, this.sessionId)
  }

  /** لمسة واحدة في نقطة محددة بالمقاسات النسبية للوحة (نقر الممحاة أو وضع caret النص) */
  async tap(xPct, yPct) {
    const box = await this.boardBox()
    const p = { x: box.x + box.w * xPct, y: box.y + box.h * yPct }
    for (const [type, buttons, clickCount] of [['mousePressed', 1, 1], ['mouseReleased', 0, 1]]) {
      await this.browser.send('Input.dispatchMouseEvent',
        { type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', buttons, clickCount }, this.sessionId)
    }
    return p
  }

  /** مسار بين نقطتين نسبيتين على اللوحة — ما يُنتج كائنًا له مساحة في منطقة مقصودة */
  async dragBoard(x0, y0, x1, y1, steps = 8) {
    const box = await this.boardBox()
    return this.dragPath(
      { x: box.x + box.w * x0, y: box.y + box.h * y0 },
      { x: box.x + box.w * x1, y: box.y + box.h * y1 },
      steps,
    )
  }

  /** تحريك بلا ضغط: هذا هو مسار المؤشر الحيّ وحده (الشرح لا يبدأ إلا مع زر مشدود) */
  async hover(xPct, yPct, steps = 8) {
    const box = await this.boardBox()
    const a = { x: box.x + box.w * 0.2, y: box.y + box.h * 0.3 }
    const b = { x: box.x + box.w * xPct, y: box.y + box.h * yPct }
    for (let i = 0; i <= steps; i += 1) {
      await this.browser.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(a.x + ((b.x - a.x) * i) / steps),
        y: Math.round(a.y + ((b.y - a.y) * i) / steps),
        buttons: 0,
      }, this.sessionId)
      await sleep(40)
    }
    return b
  }

  /** كتابة حقيقية: insertText يمر بنفس طريق onChange الذي يمرّ به المفتاح الحقيقي */
  async insertText(text) {
    await this.browser.send('Input.insertText', { text }, this.sessionId)
  }

  async pressEnter() {
    for (const type of ['keyDown', 'keyUp']) {
      await this.browser.send('Input.dispatchKeyEvent', {
        type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r',
      }, this.sessionId)
    }
  }

  async screenshot(path) {
    const r = await this.browser.send('Page.captureScreenshot', { format: 'png' }, this.sessionId)
    writeFileSync(path, Buffer.from(r.data, 'base64'))
  }
}

// ------------------------------------------------------------- chrome launch
const profile = mkdtempSync(join(tmpdir(), `edu-room-${RUN}-`))
let chrome = null
let browser = null
const tabs = []

async function waitForCdp() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      if (res.ok) return (await res.json()).webSocketDebuggerUrl
    } catch { /* لم يقلع بعد */ }
    await sleep(500)
  }
  throw new Error('CDP لم يفتح — تحقق من مسار كرووم ومن خلوّ المنفذ ' + DEBUG_PORT)
}

try {
  if (!existsSync(CHROME)) throw new Error(`لا chrome في ${CHROME} — اضبط EDULINK_CHROME`)

  chrome = spawn(CHROME, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1440,900',
    '--disable-gpu',
    'about:blank',
  ], { stdio: 'ignore' })

  browser = await CDP.connect(await waitForCdp())
  browser.on((msg) => {
    const m = msg.method ?? ''
    if (m.startsWith('Network.webSocket')) {
      const key = msg.sessionId ?? ''
      if (!netEvents.has(key)) netEvents.set(key, [])
      const p = msg.params ?? {}
      const frame = p.response && p.response.payloadData ? String(p.response.payloadData).slice(0, 140) : ''
      const text = m.replace('Network.webSocket', '') +
        (p.code !== undefined ? ` code=${p.code}` : '') +
        (p.reason ? ` reason=${String(p.reason).slice(0, 80)}` : '') +
        (frame ? ` data=«${frame}»` : '')
      const list = netEvents.get(key)
      list.push(text)
      if (m === 'Network.webSocketWillSendHandshakeRequest') {
        const h = p.requestHeaders ?? {}
        list.push('headers ' + Object.entries(h)
          .filter(([k]) => /^(authorization|cookie|origin|sec-websocket-protocol|sec-websocket-extensions)$/i.test(k))
          .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' ; ') || 'headers (بلا ترويسات ذات معنى)')
      }
      if (list.length > 40) list.shift()
    }
    if (msg.method === 'Network.requestWillBeSent' && String(msg.params?.request?.url ?? '').includes('/hubs/')) {
      const key = msg.sessionId ?? ''
      if (!netEvents.has(key)) netEvents.set(key, [])
      const list = netEvents.get(key)
      const h = msg.params.request.headers ?? {}
      list.push(`HTTP ${msg.params.request.method} ${String(msg.params.request.url).slice(-40)} `
        + Object.entries(h).filter(([k]) => /^authorization$/i.test(k)).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(''))
      if (list.length > 40) list.shift()
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const text = msg.params?.exceptionDetails?.exception?.description ?? ''
      if (text) consoleErrors.push(text.split('\n')[0].slice(0, 160))
    }
    // SignalR يطبع فشل الاتصال في الكونسول ولا يرميه: بلا هذا الالتقاط يظل السبب مجهولًا
    if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
      consoleErrors.push(String(msg.params.entry.text ?? '').slice(0, 160))
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      const first = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
      if (first) consoleErrors.push(first.slice(0, 160))
    }
  })

  // ============ تجهيز البيانات من نقاط نهاية الشاشة نفسها ============
  const owner = (await api('POST', '/api/auth/login', { email: OWNER_EMAIL, password: OWNER_PASSWORD })).token
  const teacher = await api('POST', '/api/users', { name: `أ. غرفة ${RUN}`, email: `qa.ui.${RUN}.t@tila.test`, password: PW, role: 0, phone: randPhone() }, owner)
  const student = await api('POST', '/api/students', { name: `طالب غرفة ${RUN}`, email: `qa.ui.${RUN}.s@tila.test`, password: PW, states: 1, access: 1, phone: randPhone() }, owner)
  const session = await api('POST', '/api/sessions', {
    subject: 'بوابة المتصفح', teacherId: teacher.id, studentId: student.id, gradeKey: 'g9',
    durationMin: 60, startsAt: new Date(Date.now() - 60_000).toISOString(),
  }, owner)
  const teacherTok = (await api('POST', '/api/auth/login', { email: teacher.email, password: PW })).token
  const studentTok = (await api('POST', '/api/auth/students/login', { email: student.email, password: PW })).token

  async function openTab(token, label) {
    const { targetId } = await browser.send('Target.createTarget', { url: `${EDGE}/` })
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
    const tab = new Tab(browser, sessionId, label)
    await tab.init()
    // السياق قد يسبق ارتباط الصفحة بالأصل فلا يُقرأ localStorage — الكتابة تُعاد حتى تنجح
    await tab.until('كتابة التوكن في localStorage', `(() => {
      try {
        window.localStorage.setItem('edulink.token', ${JSON.stringify(token)});
        return window.localStorage.getItem('edulink.token') === ${JSON.stringify(token)} ? 1 : 0;
      } catch (err) { return 0; }
    })()`, 30000)
    await tab.goto(`${EDGE}/sessions/${session.id}/live`)
    // حالة الغرفة أولًا: بلا اتصال لا يوجد أي RTCPeerConnection، فيبدو العيب كأنه وسائط
    await tab.until('الغرفة اتصلت بالخادم', `(() => {
      const b = document.body.innerText;
      if (b.includes('تعذّر الوصول إلى خادم الاجتماعات') || b.includes('تعذّر الاتصال')) return 0;
      return b.includes('متصل') ? 1 : 0;
    })()`, 30000).catch(async (err) => {
      const body = await tab.eval('window.__bodyText()').catch(() => 'لا جسم')
      const sockets = await tab.eval(`window.__ws.map((w) =>
        w.url.slice(-46) + ' state=' + (w.ws ? w.ws.readyState : '?') + ' [' + w.frames.slice(-10).join('; ') + ']'
      ).join(' ||| ')`).catch(() => 'لا مقبس')
      const counters = await tab.eval('[sessionStorage.getItem("wsCount"), sessionStorage.getItem("navCount")].join("/")').catch(() => '؟')
      const boots = await tab.eval('(window.__bootLog || []).join(" ; ")').catch(() => 'لا سجل')
      throw new Error(`${tab.name}: ${err.message} — مقابس=${counters} — إقلاع=(${boots}) — شاشته: «${String(body).replace(/\s+/g, ' ').slice(0, 260)}»`
        + ` · مقابسها: ${sockets}`
        + ` · مقبسها: ${tab.socketTrace()}`
        + ` · كونسول: ${consoleErrors.slice(-3).join(' | ') || 'بلا'}`)
    })
    // سكربت القياس إن لم يُحقن (خطأ صياغة واحد يُسقط كل الدالة) فإن كل بند يفشل
    // وكأن المنتج مكسور — فالتحقق من الحقن نفسه يسبق أي اتهام للشاشة
    const injected = await tab.eval('[typeof window.__pcs, typeof window.__ws, typeof window.__clicks, typeof window.__wsReply, typeof window.__wsInBoth, typeof window.__wsNorm, typeof window.__inkRegion, typeof window.__boardTool, typeof window.__pointers].join("/")')
    if (!/^object\/object\/object\/function\/function\/function\/function\/function\/function$/.test(injected)) {
      throw new Error(`الأداة: سكربت القياس لم يعمل في صفحة ${tab.name} (${injected}) — عيب في الأداة لا في الشاشة`)
    }
    tabs.push(tab)
    return tab
  }

  const T = await openTab(teacherTok, 'المدرس')
  const S = await openTab(studentTok, 'الطالب')
  await T.until('اتصال وسائط عند المدرس', 'window.__pcs.length >= 1', 30000)
  await S.until('اتصال وسائط عند الطالب', 'window.__pcs.length >= 1', 30000)
  await sleep(4000)

  /** قراءة بكسلات شريط أفقي من اللوحة (0..1 من عرضها) */
  const region = (tab, x0, x1) => tab.eval(`window.__inkRegion(${x0}, ${x1})`)
  const inCount = (tab, needle) => tab.eval(`window.__wsInCount(${JSON.stringify(needle)})`)
  const outCount = (tab, needle) => tab.eval(`window.__wsOutCount(${JSON.stringify(needle)})`)
  const inBoth = (tab, n1, n2) => tab.eval(`window.__wsInBoth(${JSON.stringify(n1)}, ${JSON.stringify(n2)})`)

  /**
   * بداية نظيفة لكل بند يقيس كائنًا: بلا هذا يُنسب حبر البند السابق إلى كائن البند
   * التالي، فيُقرأ بند مكسور أخضر. والفحص يشمل عدّاد المنطقة في الطرفين حتى لا
   * تُقرّر شاشة واحدة أنّ اللوح فاضي بينما الأخرى لا تزال ترى حبرًا.
   */
  async function cleanBoard() {
    await T.click('مسح')
    await T.until('سبورة المدرس فاضية', 'window.__inkPixels() === 0 ? 1 : 0', 8000)
    await S.until('سبورة الطالب فاضية', 'window.__inkPixels() === 0 ? 1 : 0', 8000)
    const a = await region(T, 0, 1)
    const b = await region(S, 0, 1)
    if (a !== 0 || b !== 0) throw new Error(`الأداة: «مسح» لم يُفرغ اللوح (منطقة المدرس ${a} والطالب ${b}) — القياس التالي بلا معنى`)
  }

  await item('وسائط مستقبَلة في الاتجاهين بعد التثبيت (لا «متصل» بلا بايتات)', async () => {
    const t0 = Date.now()
    let t = { bytes: 0, pcs: 0 }
    let s = { bytes: 0, pcs: 0 }
    for (;;) {
      t = await T.eval('window.__bytesIn()')
      s = await S.eval('window.__bytesIn()')
      if (t.bytes >= 1000 && s.bytes >= 1000) break
      if (Date.now() - t0 > 25000) {
        throw new Error(`البايتات بعد 25 ث: المدرس ${t.bytes}B على ${t.pcs} اتصال والطالب ${s.bytes}B على ${s.pcs} — اتجاه واحد صامت`)
      }
      await sleep(1000)
    }
    return `مدرس ${t.bytes}B على ${t.pcs} اتصال · طالب ${s.bytes}B على ${s.pcs} (بعد ${Math.round((Date.now() - t0) / 1000)} ث)`
  })

  await item('سقف معدل الفيديو وcontentHint والقيود على المسار المُرسَل فعلًا', async () => {
    await T.until('sender فيديو عند المدرس',
      'window.__senders().senders.some((s) => s.kind === "video") ? 1 : 0', 20000)
    const { senders } = await T.eval('window.__senders()')
    const video = senders.filter((x) => x.kind === 'video')
    if (video.length === 0) {
      throw new Error(`لا sender فيديو عند المدرس — ما طلبه الجهاز وما رجع: ${JSON.stringify(await T.eval('window.__media'))}`)
    }
    const uncapped = video.filter((x) => x.maxBitrate !== VIDEO_MAX_BPS)
    if (uncapped.length) throw new Error(`${uncapped.length}/${video.length} إرسال بلا سقف (${uncapped.map((v) => v.maxBitrate).join(',')})`)
    const hinted = video.filter((x) => x.hint === 'motion').length
    const fps = video.map((x) => x.frameRate).filter((n) => typeof n === 'number')
    const over = fps.filter((n) => n > 31)
    if (over.length) throw new Error(`معدل الإطارات ${over.join(',')} تجاوز 30 — القيود لم تُطبَّق على هذا المسار`)
    return `maxBitrate=${VIDEO_MAX_BPS} على ${video.length} · hint=motion عند ${hinted} · fps=${fps.map((n) => n.toFixed(0)).join(',') || 'غير مقروء'}`
  })

  await item('قلم المدرس يُرسم عند الطالب بصفحة رسالات واحدة', async () => {
    const before = await S.eval('window.__inkPixels()')
    await T.drawStroke(0.2, 0.7)
    await S.until('بكسل القلم عند الطالب', `(window.__inkPixels() > ${before}) ? 1 : 0`, 10000)
    return `${before} → ${await S.eval('window.__inkPixels()')} بكسل عند الطالب`
  })

  await item('مسح المدرس يُبيضّ شاشة المدرس نفسه لا شاشة الطالب وحدها', async () => {
    const teacherBefore = await T.eval('window.__inkPixels()')
    if (teacherBefore <= 0) throw new Error('سبورة المدرس فارغة أصلًا، فالبند بلا معنى')
    await T.click('مسح')
    try {
      await T.until('سبورة المدرس صارت فاضية', 'window.__inkPixels() === 0 ? 1 : 0', 8000)
    } catch (err) {
      throw new Error(`${err.message} · تنبيه المدرس: «${await T.eval('window.__notice()')}»`
        + ` · لوحاته: ${await T.eval('window.__canvases()')}`
        + ` · إطار wb-clear عنده: «${await T.eval('window.__wsFind("wb-clear")') || 'لم يصل'}»`)
    }
    await S.until('سبورة الطالب صارت فاضية', 'window.__inkPixels() === 0 ? 1 : 0', 8000)
    return `المدرس ${teacherBefore} → 0 · والطالب 0`
  })

  await item('منع المدرس لقلم الطالب: رسمته تتوقف عند الطالب والخادم يرفض ضربته هو نفسها', async () => {
    await T.openPeople()
    const sentPerms = await T.eval('window.__wsCount("setPermissions")')
    await T.click('منع الكتابة على السبورة')
    try {
      await S.until('شاشة الطالب تحمل سبب القفل',
        `window.__bodyText().includes('الكتابة موقوفة بأمر المدرس') ? 1 : 0`, 8000)
    } catch (err) {
      throw new Error(`${err.message} · المدرس أرسل setPermissions عدد ${sentPerms} ·`
        + ` إطارات perms عند الطالب: «${await S.eval('window.__wsFind("\\"perms\\"")') || 'لم تصل'}»`
        + ` · جسم صفحة الطالب: «${(await S.eval('window.__bodyText()')).replace(/\\s+/g, ' ').slice(0, 160)}»`)
    }
    const before = await T.eval('window.__inkPixels()')
    await S.drawStroke(0.3, 0.8)
    await sleep(1200)
    const afterPaint = await T.eval('window.__inkPixels()')
    if (afterPaint !== before) throw new Error(`ضربة فأر من طالب ممنوع وصلت (${before} → ${afterPaint})`)
    // الضربة الحرفية من نفس المقبوس: الواجهة تُخفي القلم، فقياس الخادم وحده ما يكشفه
    const pushed = await S.eval(`(() => {
      const rec = window.__ws.find((w) => w.url.includes('/hubs/meetings'));
      if (!rec || !rec.ws || rec.ws.readyState !== 1) return 'لا مقبس حيّ';
      rec.frames.length = 0;
      // نفس شكل إطار النداء الذي يرسله التطبيق فعلًا (مقيس من إطاراته الحيّة):
      // target/arguments/invocationId/type — وبلا protocol/version لأن هذين
      // للمصافحة وحدها وإلا رفضهما المحلّل وأغلق الاتصال بردّ عام
      const one = '{"id":"raw-' + Date.now() + '","tool":"pen","color":"#f0f","width":6,"points":[0.4,0.4,0.5,0.45,0.6,0.6]}'
      const ops = '[{"op":"add","a":' + one + '}]'
      const frame = '{"target":"annotate","arguments":' + JSON.stringify([ops])
        + ',"invocationId":"9001","type":1}';
      rec.ws.send(frame + '\\u001e');
      return 'أُرسلت: ' + frame.slice(0, 150);
    })()`)
    if (!pushed.startsWith('أُرسلت')) throw new Error(`الأداة: لم تستطع إرسال ضربة حرفية — ${pushed}`)
    await sleep(1500)
    const afterRaw = await T.eval('window.__inkPixels()')
    const rejected = await S.eval('window.__wsReply("9001")')
    const dump = await S.eval('window.__wsFrames("/hubs/meetings")')
    const alive = await S.eval(`(() => {
      const rec = window.__ws.find((w) => w.url.includes('/hubs/meetings'));
      if (!rec || !rec.ws) return 'no-socket';
      return rec.ws.readyState === 1 && !rec.frames.some((f) => f.includes('"type":7')) ? 'alive' : 'closed';
    })()`)
    if (alive !== 'alive') {
      throw new Error(`رفض الخادم قذف الطالب من الغرفة بدل أن يردّ على نداءه وحده (${alive}) · ${dump}`)
    }
    if (afterRaw !== before) {
      throw new Error(`الخادم قبل ضربة طالب ممنوع: بكسل المدرس ${before} → ${afterRaw} · ردّ الخادم: «${rejected || 'بلا'}» · ${dump}`)
    }
    if (!/منع الكتابة/.test(rejected)) {
      throw new Error(`الضربة لم تصل (صحيح) لكن الخادم لم يُسجّل سببًا مفهومًا للطالب · إطار 9001: «${rejected || 'بلا'}» · ${dump}`)
    }
    return `رسمته تتوقف · والضربة الحرفية رُفضت: ${(() => { const m = /HubException:\s*([\s\S]+)$/.exec(rejected); return m ? m[1] : rejected.slice(rejected.indexOf('in ') + 3) })().slice(0, 80)}`
  })

  await item('رفع المدرس للمنع يُخفي السبب ويعيد قلم الطالب يعمل', async () => {
    await T.openPeople()
    await T.click('السماح بالكتابة')
    await S.until('السبب اختفى من شاشة الطالب',
      `window.__bodyText().includes('الكتابة موقوفة بأمر المدرس') ? 0 : 1`, 8000)
    const before = await T.eval('window.__inkPixels()')
    await S.drawStroke(0.15, 0.55)
    await T.until('ضربة الطالب تعمل بعد السماح', `(window.__inkPixels() > ${before}) ? 1 : 0`, 10000)
    return `${before} → ${await T.eval('window.__inkPixels()')} بكسل عند المدرس`
  })

  await item('إسكات المدرس يُطفئ مسار الطالب الصوتي ويُبدّل زرّه عنده', async () => {
    await T.openPeople()
    await T.click('إسكات')
    try {
      await S.until('المسار الصوتي عند الطالب انطفأ',
        'window.__senders().senders.some((s) => s.kind === \"audio\" && s.enabled === false) ? 1 : 0', 10000)
    } catch (err) {
      throw new Error(`${err.message} · إطارات perms عند الطالب: «${await S.eval('window.__wsFind("\\"perms\\"")') || 'لم تصل'}»`
        + ` · مُرسِلات الطالب: ${JSON.stringify((await S.eval('window.__senders()')).senders)}`)
    }
    await S.until('شاشة الطالب تقول إن المنع من المدرس',
      `window.__bodyText().includes('الكتم بأمر المدرس') ? 1 : 0`, 6000)
    return 'track.enabled=false وزرّه مكتوم بأمر المدرس'
  })

  await item('قلب الكاميرا لا يُنهي المسار الحيّ ولو رفض الجهاز القلب', async () => {
    const vids = (x) => x.senders.filter((s) => s.kind === 'video')
    const before = vids(await S.eval('window.__senders()'))
    await S.click('الخلفية')
    await sleep(1500)
    const after = vids(await S.eval('window.__senders()'))
    const ended = after.filter((s) => s.ready === 'ended')
    const liveBefore = before.filter((s) => s.ready === 'live').length
    const liveAfter = after.filter((s) => s.ready === 'live').length
    if (ended.length > 0 || liveAfter < liveBefore || liveAfter === 0) {
      throw new Error(`مسار مات عند القلب: ended=${ended.length} حي ${liveBefore} → ${liveAfter} — عيب الموبايل بعينه`)
    }
    const notice = await S.eval('window.__notice()')
    return `${liveAfter} مسار live بعد القلب (كانت ${liveBefore}) · وتنبيهه: «${(notice || 'بلا').slice(0, 44)}»`
  })

  await item('ملء الشاشة يمسك البلاطة نفسها (بنقرة حقيقية لها user activation)', async () => {
    await T.bringToFront()
    await T.click('ملء الشاشة')
    try {
      await T.until('document.fullscreenElement هو البلاطة',
        `(() => { const el = document.fullscreenElement; return el && el.tagName === 'FIGURE' ? 1 : 0 })()`, 6000)
    } catch (err) {
      throw new Error(`${err.message} · fullscreenElement=${await T.eval('document.fullscreenElement ? document.fullscreenElement.tagName : "لا شيء"')}`
        + ` · تنبيه الشاشة: «${await T.eval('window.__notice()')}»`
        + ` · جسم الصفحة: «${(await T.eval('window.__bodyText()')).replace(/\\s+/g, ' ').slice(0, 120)}»`)
    }
    const tag = await T.eval('document.fullscreenElement.tagName')
    await T.eval('document.exitFullscreen ? document.exitFullscreen() : 0; 1')
    return `fullscreenElement = ${tag}`
  })

  await item('الكتابة الكثيفة تُرسم محليًا فورًا وتصل للطالب كاملة', async () => {
    const before = await T.eval('window.__inkPixels()')
    const studentBefore = await S.eval('window.__inkPixels()')
    for (let i = 0; i < 6; i += 1) await T.drawStroke(0.1 + i * 0.08, 0.2 + i * 0.08, 12)
    await T.until('المدرس يرى خطوطه', `(window.__inkPixels() > ${before}) ? 1 : 0`, 12000)
    await S.until('الطالب يستقبلها كلها', `(window.__inkPixels() > ${studentBefore}) ? 1 : 0`, 12000)
    return `${before} → ${await T.eval('window.__inkPixels()')} بكسل عند المدرس · ${studentBefore} → ${await S.eval('window.__inkPixels()')} عند الطالب`
  })

  await item('أدوات الأشكال: المستطيل والدائرة كائنٌ واحد بأداته يصل الشاشتين', async () => {
    await cleanBoard()
    await T.click('مستطيل')
    const toolAfterRect = await T.eval('window.__boardTool()')
    if (toolAfterRect !== 'rect') {
      throw new Error(`زرّ «مستطيل» لم يبدّل اللوح: data-tool=${toolAfterRect || 'لا شيء'} — الأداة لا تصل السطح`)
    }
    await T.dragBoard(0.1, 0.2, 0.38, 0.6)
    // الدفعة تُجمَّع ~50ms قبل الإرسال: قراءة فورية بعد السحب تُظهر منتجًا سليمًا مكسورًا
    await T.until('إطار صادر يحمل الأداة rect', `window.__wsOutCount(${JSON.stringify('"tool":"rect"')}) > 0 ? 1 : 0`, 6000)
    await S.until('بكسل المستطيل عند الطالب', `(window.__inkRegion(0.08, 0.4) > 0) ? 1 : 0`, 10000)
    const rectIn = await inCount(S, '"tool":"rect"')
    const teacherRegion = await region(T, 0.08, 0.4)
    const studentRegion = await region(S, 0.08, 0.4)
    if (teacherRegion <= 0) throw new Error(`المدرس نفسه لا يرى مستطيله (منطقة ${teacherRegion}) بينما الطالب يراه ${studentRegion}`)

    await T.click('دائرة')
    const toolAfterEllipse = await T.eval('window.__boardTool()')
    if (toolAfterEllipse !== 'ellipse') {
      throw new Error(`زرّ «دائرة» لم يبدّل اللوح: data-tool=${toolAfterEllipse || 'لا شيء'}`)
    }
    await T.dragBoard(0.62, 0.2, 0.9, 0.62)
    await S.until('بكسل الدائرة عند الطالب', `(window.__inkRegion(0.6, 0.92) > 0) ? 1 : 0`, 10000)
    const ellipseIn = await inCount(S, '"tool":"ellipse"')
    if (ellipseIn === 0) {
      throw new Error(`الدائرة لم تصل الطالب · إطارات rect عنه: ${rectIn} · لوحاته: ${await S.eval('window.__canvases()')}`)
    }
    // كائن واحد لا مقاطع: المستطيل برسالة واحدة ⇒ عدد دفعات الشرح لاعدد نقاط السحب
    const batchFrames = await outCount(T, '"op":"add"')
    return `rect عند ${rectIn} رسالة · ellipse عند ${ellipseIn} · ${batchFrames} دفعة صادرة للأداتين (data-tool=${toolAfterRect}/${toolAfterEllipse})`
  })

  await item('لون الكاتب وسماكته يسافران في الكائن نفسه لا في افتراض الطرف الآخر', async () => {
    await cleanBoard()
    await T.click('قلم')
    await T.click('#dc2626')
    await T.click('سماكة 8')
    const pressed = await T.eval(`(() => {
      const c = document.querySelector('button[aria-label="#dc2626"]');
      const w = document.querySelector('button[aria-label="سماكة 8"]');
      return (c ? c.getAttribute('aria-pressed') : 'لا زر لون') + '/' + (w ? w.getAttribute('aria-pressed') : 'لا زر سماكة');
    })()`)
    if (pressed !== 'true/true') {
      throw new Error(`اللون والسماكة لم يُعلَّما مُختارَين على الشاشة (aria-pressed=${pressed}) — فالبند يقيس حالة لا قرار`)
    }
    await T.drawStroke(0.15, 0.5)
    await S.until('الحبر يصل الطالب', `(window.__inkRegion(0.1, 0.55) > 0) ? 1 : 0`, 10000)
    const frame = await inBoth(S, '"color":"#dc2626"', '"width":8')
    if (!frame) {
      throw new Error(`لا رسالة واحدة تحمل اللون والسماكة معًا عند الطالب · اللون: ${await inCount(S, '"color":"#dc2626"')} ·`
        + ` السماكة: ${await inCount(S, '"width":8')} · آخر إطار add: «${await S.eval(`window.__wsNorm(${JSON.stringify('"op":"add"')})`) || 'لم يصل'}»`)
    }
    return `الطالب استقبل لون الكاتب وسماكته في رسالة واحدة (${frame.slice(0, 90)}…)`
  })

  await item('الممحاة تُمسح الكائن كله من الشاشتين وتترك ما حوله', async () => {
    await cleanBoard()
    await T.click('قلم')
    await T.drawStroke(0.08, 0.35)
    await T.click('مستطيل')
    await T.dragBoard(0.65, 0.25, 0.92, 0.7)
    await S.until('الكائنان عند الطالب', `((window.__inkRegion(0.06, 0.4) > 0 && window.__inkRegion(0.62, 0.94) > 0) ? 1 : 0)`, 12000)
    const beforePen = await region(S, 0.06, 0.4)
    const beforeRect = await region(S, 0.62, 0.94)

    await T.click('ممحاة')
    const toolNow = await T.eval('window.__boardTool()')
    if (toolNow !== 'eraser') throw new Error(`الممحاة لم تُصبِح وضع المؤشر: data-tool=${toolNow || 'لا شيء'}`)
    await T.tap(0.78, 0.45)
    await S.until('المستطيل اختفى من شاشة الطالب', `(window.__inkRegion(0.62, 0.94) === 0) ? 1 : 0`, 10000)
    const afterRectT = await region(T, 0.62, 0.94)
    const afterRectS = await region(S, 0.62, 0.94)
    if (afterRectT !== 0 || afterRectS !== 0) {
      throw new Error(`الممحاة أمسحت من شاشة واحدة فقط: المدرس ${afterRectT} والطالب ${afterRectS}`)
    }
    const afterPenT = await region(T, 0.06, 0.4)
    const afterPenS = await region(S, 0.06, 0.4)
    if (afterPenT === 0 || afterPenS === 0) {
      throw new Error(`الممحاة مسحت اللوحة كلها بدل الكائن الملموس (القلم ${beforePen} → ${afterPenT}/${afterPenS}) — هذا مسحٌ لا محاة`)
    }
    return `المستطيل ${beforeRect} → 0 في الطرفين · والقلم بقي ${afterPenT}/${afterPenS} بكسل`
  })

  await item('تراجع المدرس يُمسح آخر كائن له وحده: كائن الطالب يبقى على الشاشتين', async () => {
    await cleanBoard()
    await T.click('مستطيل')
    await T.dragBoard(0.05, 0.2, 0.3, 0.6)
    await S.until('مستطيل المدرس عند الطالب', `(window.__inkRegion(0.03, 0.33) > 0) ? 1 : 0`, 10000)
    await S.click('مستطيل')
    await S.dragBoard(0.45, 0.2, 0.72, 0.6)
    await T.until('مستطيل الطالب عند المدرس', `(window.__inkRegion(0.42, 0.75) > 0) ? 1 : 0`, 10000)
    const teacherObj = await region(T, 0.03, 0.33)
    const pupilObj = await region(T, 0.42, 0.75)
    if (teacherObj <= 0 || pupilObj <= 0) {
      throw new Error(`بداية البند غير مكتملة عند المدرس (كائنه ${teacherObj} وكائن الطالب ${pupilObj}) — بلا كائنين لا معنى للتراجع`)
    }

    await T.click('تراجع')
    await T.until('كائن المدرس اختفى', `(window.__inkRegion(0.03, 0.33) === 0) ? 1 : 0`, 10000)
    await S.until('وكائن المدرس اختفى عند الطالب أيضًا', `(window.__inkRegion(0.03, 0.33) === 0) ? 1 : 0`, 10000)
    const keptT = await region(T, 0.42, 0.75)
    const keptS = await region(S, 0.42, 0.75)
    if (keptT === 0 || keptS === 0) {
      throw new Error(`تراجع المدرس أزال كائن الطالب (${pupilObj} → ${keptT}/${keptS}) — التراجع عالمي لا على مستوى الكاتب`)
    }
    const stillMine = await region(T, 0.03, 0.33)
    if (stillMine !== 0) throw new Error(`كائن المدرس لم يُمسح بالتراجع (${stillMine} بكسل باقٍ)`)
    return `كائن المدرس → 0 في الطرفين · وكائن الطالب باقٍ ${keptT}/${keptS}`
  })

  await item('النصّ يُكتب على اللوحة ويصل حرفيًا كما كتبه صاحبه', async () => {
    await cleanBoard()
    await T.bringToFront()
    await T.click('نص')
    const toolNow = await T.eval('window.__boardTool()')
    if (toolNow !== 'text') throw new Error(`زرّ «نص» لم يبدّل اللوح: data-tool=${toolNow || 'لا شيء'}`)
    await T.tap(0.3, 0.4)
    try {
      await T.until('caret النص ظهر على اللوحة', `document.querySelectorAll('input[aria-label="نص"]').length`, 8000)
    } catch (err) {
      const under = await T.eval(`(() => { const b = document.querySelector('canvas[aria-label]').getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(b.x + b.width * 0.3), Math.round(b.y + b.height * 0.4));
        return el ? el.tagName + '/' + (String(el.className).slice(0, 24) || '-') : 'null' })()`)
      const inputs = await T.eval(`[...document.querySelectorAll('input')].map((i) =>
        i.tagName + '[' + (i.getAttribute('aria-label') || '?') + ']' + (document.activeElement === i ? '*focus' : '')).join(',') || 'لا إدخال'`)
      throw new Error(`${err.message} · تحت النقطة الملموسة: ${under} · data-tool=${await T.eval('window.__boardTool()')}`
        + ` · إدخالات الشاشة: ${inputs} · تنبيه: «${await T.eval('window.__notice()')}»`)
    }
    await T.insertText('مرحبا')
    const typed = await T.eval(`(() => { const i = document.querySelector('input[aria-label="نص"]'); return i ? i.value : 'لا إدخال' })()`)
    if (typed !== 'مرحبا') {
      throw new Error(`الأداة: insertText لم يصل الحقل (${JSON.stringify(typed)}) — التركيز على التبويب أو مسار الكتابة، لا المنتج`)
    }
    await T.pressEnter()
    await S.until('نص المدرس يُرسم عند الطالب', `(window.__inkRegion(0.25, 0.6) > 0) ? 1 : 0`, 10000)
    const frame = await inBoth(S, '"tool":"text"', 'مرحبا')
    if (!frame) {
      throw new Error(`النص رسم لكنه لم يصل كما كُتب · إطار text: «${await S.eval(`window.__wsNorm(${JSON.stringify('"tool":"text"')})`) || 'لم يصل'}»`)
    }
    const caretGone = await T.eval(`document.querySelectorAll('input[aria-label="نص"]').length`)
    if (caretGone !== 0) throw new Error(`caret النص لم يُغلق بعد Enter (باقٍ ${caretGone}) — الكتابة التالية تكتب فوق نفس الحقل`)
    return `«مرحبا» عند الطالب في رسالة واحدة · واللوح تحرّر من caret`
  })

  await item('مؤشر المشارك الحيّ يظهر باسمه على شاشة الطرف الآخر، ولا يظهر لصاحبه', async () => {
    await S.click('قلم')
    await S.hover(0.55, 0.62)
    try {
      await T.until('شارة مؤشر الطالب على شاشة المدرس', `window.__pointers().length`, 8000)
    } catch (err) {
      throw new Error(`${err.message} · إرسال pointer عند الطالب: ${await outCount(S, '"target":"sendPointer"') || await outCount(S, 'sendPointer')} ·`
        + ` لوحاته: ${await S.eval('window.__canvases()')} · جسم المدرس: «${(await T.eval('window.__bodyText()')).replace(/\\s+/g, ' ').slice(0, 120)}»`)
    }
    const names = await T.eval('window.__pointers().join("|")')
    if (!names.includes(`طالب غرفة ${RUN}`)) {
      throw new Error(`المؤشر ظهر بلا اسم صاحبه المُصادَق عليه: «${names}»`)
    }
    // الشارة طبقة عرض: لو التقطت الأحداث فهي تبتلع الكتابة أينما طافت فوق اللوحة
    const underPill = await T.eval(`(() => { const p = document.querySelector('[data-pointer]');
      if (!p) return 'no-pill'; const r = p.getBoundingClientRect();
      const el = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
      return el ? el.tagName : 'null' })()`)
    if (!/^CANVAS$/.test(underPill)) {
      throw new Error(`مركز شارة المؤشر يلتقط الأحداث بدل اللوحة: عنصر تحته ${underPill} («${names}»)`)
    }
    const selfPills = await S.eval('window.__pointers().length')
    if (selfPills !== 0) {
      throw new Error(`الطالب يرى يده على شاشته (${selfPills} شارة) — المؤشر للآخرين وحدهم، كزووم`)
    }
    await sleep(2200)
    const afterIdle = await T.eval('window.__pointers().length')
    if (afterIdle !== 0) {
      throw new Error(`يد الطالب بقيت على شاشة المدرس بعد أن سكتت (${afterIdle} شارة بعد 2.2 ث) — مؤشر مجمّد`)
    }
    return `«${names}» عند المدرس ثم اختفى عند السكون (وبلا يد عند صاحبه)`
  })

  await item('شرح في طريقه للإرسال ثم مسح فوري: المسح يُسقط الدفعة ولا تستعيد شاشة الطالب حبرًا', async () => {
    await cleanBoard()
    await T.click('قلم')
    const batchesBefore = await outCount(T, '"op":"add"')
    // سحبة قصيرة بحركة واحدة: كائن ذو طول، مُثبَّت محليًا وموضوع في طابور الدفعة (~50ms)
    await T.dragBoard(0.3, 0.5, 0.34, 0.54, 1)
    const committed = await region(T, 0, 1)
    if (committed <= 0) throw new Error(`الأداة: السحب لم يُثبّت كائنًا (بكسل ${committed}) فالبند بلا معنى`)
    await T.click('مسح')
    await sleep(900)
    const batchesAfter = await outCount(T, '"op":"add"')
    const teacherAfter = await region(T, 0, 1)
    const studentAfter = await region(S, 0, 1)
    const late = batchesAfter - batchesBefore
    if (late !== 0) {
      throw new Error(`بعد قرار المسح أُرسلت ${late} دفعة شرح كان لا بد أن تُسقَط — الطالب يرى ${studentAfter} بكسل`
        + ` والمدرس ${teacherAfter} · آخر add صادر: «${await T.eval(`window.__wsNorm(${JSON.stringify('"op":"add"')})`).then((x) => x.slice(0, 130))}»`)
    }
    if (teacherAfter !== 0 || studentAfter !== 0) {
      throw new Error(`المسح لم يُفرغ اللوح في الطرفين (${teacherAfter}/${studentAfter}) مع صفر دفعات متأخرة`)
    }
    return `كائن مثبَّت (${committed} بكسل) أُسقطت دفعته · والمدرس 0 والطالب 0`
  })

  const shots = join(tmpdir(), `edu-room-shots-${RUN}`)
  mkdirSync(shots, { recursive: true })
  await T.screenshot(join(shots, 'teacher.png'))
  await S.screenshot(join(shots, 'student.png'))
  console.log(`\nلقطات الشاشة: ${join(shots, 'teacher.png')} · ${join(shots, 'student.png')}`)
  console.log('الحسابات: ' + teacher.email + ' · ' + student.email + ` · حصة ${session.code} (id ${session.id})`)
  if (consoleErrors.length) console.log(`أخطاء كونسول (${consoleErrors.length}): ` + consoleErrors.slice(0, 4).join(' | '))
} catch (err) {
  // فشل الإعداد بلا هذا الالتقاط كان سطرًا واحدًا لا دليل فيه من الشاشة نفسها
  const shots = join(tmpdir(), `edu-room-fail-${RUN}`)
  mkdirSync(shots, { recursive: true })
  console.log(`\n✗ فشل الإعداد: ${err.message}`)
  for (const tab of tabs) {
    const file = join(shots, `${tab.name}.png`)
    try { await tab.screenshot(file) } catch { /* قد يكون التبويب ميتًا */ }
    const body = await tab.eval('window.__bodyText()').catch(() => 'لا جسم')
    const url = await tab.eval('String(window.location)').catch(() => 'لا عنوان')
    console.log(`  ${tab.name}: ${url}\n  لقطته: ${file}\n  نص شاشته: «${String(body).replace(/\s+/g, ' ').slice(0, 300)}»`)
  }
  if (consoleErrors.length) console.log(`  كونسول (${consoleErrors.length}): ` + consoleErrors.slice(0, 6).join(' | '))
  throw err
} finally {
  try { browser?.ws?.close() } catch { /* لا شيء */ }
  if (chrome) chrome.kill('SIGTERM')
  await sleep(1000)
  // مجلد تشغيل هذه الجولة وحده — يُمسح باسمه لا بمسح عام للمؤقت
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* قد يبقى مقفلًا لحظة */ }
}

if (failures.length) {
  console.log(`\n✗ ${failures.length} بندًا فاشل من ${results.length + failures.length}`)
  process.exit(1)
}
console.log(`\n✓ ${results.length} بندًا أخضر — الشاشة نفسها تفعل ما طُلب`)
