import type { PDFDocumentProxy } from 'pdfjs-dist'
import { apiFetchBytes } from '../../lib/apiClient'

/**
 * المستند الذي يعرضه المدرس داخل الحصة ويكتب فوقه.
 *
 * `pdfjs-dist` يُحمَّل **كسولًا** (`import()` عند أول PDF فعلًا): صورةٌ في حصة لا
 * يجب أن تُنزّل حزمة تحويل PDF كاملة على موبايل الطالب.
 * ومصدر الـ worker من `?url` لا من مسار يدوي: Vite يضعه في `dist/assets` باسم مبعثر
 * ويكتبه تحت **بادئة النشر** نفسها (`/edulink/`) — فيعمل على سيرفر العميل كما يعمل
 * على dev server، بلا ملف يُنسخ يدويًا ولا رابط يُنسَى تحديثه.
 */
type PdfModule = typeof import('pdfjs-dist');

let pdfLoader: Promise<PdfModule> | null = null;

async function pdfModule(): Promise<PdfModule> {
  if (!pdfLoader) {
    pdfLoader = import('pdfjs-dist').then(async (mod) => {
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')) as unknown as {
        default: string;
      };
      mod.GlobalWorkerOptions.workerSrc = worker.default;
      return mod;
    });
  }
  return pdfLoader;
}

export type SharedDoc = {
  fileId: number;
  fileName: string;
  mime: string;
  page: number;
};

export type DocGeometry = {
  /** عرض/ارتفاع الصفحة — سطح السبورة يأخذهما حتى تتطابق إحداثيات القلم عند الجميع */
  aspect: number;
  pageCount: number;
};

type Cached = {
  bytes: ArrayBuffer;
  pdf: PDFDocumentProxy | null;
  image: ImageBitmap | null;
  geometry: DocGeometry;
};

/** آخر ثلاثة مستندات فقط: الانضمام لحصة طويلة يكرّر نفس الملف، ومسح الذاكرة يتركها تنمو */
const cache = new Map<string, Cached>();

function docPath(doc: SharedDoc, sessionCode: string): string {
  return `/api/files/${doc.fileId}/shared?session=${encodeURIComponent(sessionCode)}`;
}

async function load(doc: SharedDoc, sessionCode: string): Promise<Cached> {
  const key = `${doc.fileId}:${sessionCode}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const bytes = await apiFetchBytes(docPath(doc, sessionCode));
  const isPdf = doc.mime === 'application/pdf' || (doc.fileName.toLowerCase().endsWith('.pdf') && !doc.mime.startsWith('image/'));
  const view = new DataView(bytes);

  // التوقيع لا يُسأل عنه في الاستجابة: `mime` قادم من رفع العميل وقد يكون
  // 'image/png' على ملف PDF، فالمحتوى هو الحكم على أي فرع نرسم به.
  const looksPdf = isPdf || view.byteLength > 5 && asAscii(view, 0, 5) === '%PDF-';

  let cached: Cached;
  if (looksPdf) {
    const { getDocument } = await pdfModule();
    const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
    const first = await pdf.getPage(Math.min(Math.max(1, doc.page), pdf.numPages));
    const base = first.getViewport({ scale: 1 });
    cached = { bytes, pdf, image: null, geometry: { aspect: base.width / base.height, pageCount: pdf.numPages } };
  } else {
    const image = await createImageBitmap(new Blob([bytes], { type: doc.mime || 'image/png' }));
    cached = { bytes, pdf: null, image, geometry: { aspect: image.width / image.height, pageCount: 1 } };
  }
  if (cache.size > 3) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      const dropped = cache.get(oldest);
      dropped?.image?.close();
      cache.delete(oldest);
    }
  }
  cache.set(key, cached);
  return cached;
}

function asAscii(view: DataView, from: number, length: number): string {
  let out = '';
  for (let i = from; i < from + length && i < view.byteLength; i += 1) out += String.fromCharCode(view.getUint8(i));
  return out;
}

/** قياس الصفحة قبل الرسم: سطح السبورة يحتاج نسبة العرض حتى تتطابق ضربات المدرس والطالب */
export async function measureDoc(doc: SharedDoc, sessionCode: string): Promise<DocGeometry> {
  const entry = await load(doc, sessionCode);
  const page = Math.min(Math.max(1, doc.page), entry.geometry.pageCount);
  if (!entry.pdf) return entry.geometry;
  const viewport = (await entry.pdf.getPage(page)).getViewport({ scale: 1 });
  return { aspect: viewport.width / viewport.height, pageCount: entry.geometry.pageCount };
}

/**
 * رسم الصفحة على الـ canvas بمقاسه الحالي (device pixels). القلم طبقة فوق هذه
 * النتيجة، فالكتابة على المستند لا تلمس بتاته.
 */
export async function paintDoc(
  canvas: HTMLCanvasElement,
  doc: SharedDoc,
  sessionCode: string,
): Promise<void> {
  const entry = await load(doc, sessionCode);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const page = Math.min(Math.max(1, doc.page), entry.geometry.pageCount);

  if (entry.image) {
    ctx.drawImage(entry.image, 0, 0, canvas.width, canvas.height);
    return;
  }
  if (!entry.pdf) return;
  const pdfPage = await entry.pdf.getPage(page);
  const fit = pdfPage.getViewport({ scale: 1 });
  const scale = Math.min(canvas.width / fit.width, canvas.height / fit.height);
  const viewport = pdfPage.getViewport({ scale });
  const offsetX = (canvas.width - viewport.width) / 2;
  const offsetY = (canvas.height - viewport.height) / 2;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  try {
    await pdfPage.render({ canvasContext: ctx, canvas, viewport }).promise;
  } finally {
    ctx.restore();
  }
}
