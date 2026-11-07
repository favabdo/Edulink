/**
 * نموذج الشرح (annotation) — نسخة مطابقة لسلوك شريط أدوات زووم على السبورة والمستند.
 *
 * كان النموذج مقطعًا خطّيًا `{x1,y1,x2,y2,color}` بسماكة واحدة، فكل ما يظهر على الشاشة
 * سطرٌ حرّ مهما اختار المستخدم. الآن **كائن مُصنَّف** له أداة ولون وسماكة ونقاط نسبية
 * 0..1، والمرسوم يُعاد رسمه تدريجيًا كما كان: الضربة الجديدة تُضاف فوق القائم ولا
 * تُعيد رسم اللوحة — وهذا شرط أن تكتب ثقيلًا على جهاز يفكّ شيفرة الفيديو في نفس اللحظة.
 *
 * النسبيات تُحفظ لا البكسل، فتكبير بلاطة أو تصغيرها لا يُفسد ما كتبه الطرف الآخر.
 */

export type AnnotationTool = 'pen' | 'highlighter' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text'

/** كائن شرح واحد: `points` مسطّحة [x,y,…] نسبية 0..1، و`text` للأداة text فقط */
export type Annotation = {
  id: string
  tool: AnnotationTool
  color: string
  width: number
  points: number[]
  text?: string
}

/** ما يصل الشاشات: إضافة كائن أو حذف مجموعة معرّفات (الممحاة والتراجع) */
export type BoardOp = { op: 'add'; a: Annotation } | { op: 'del'; ids: string[] }

/** أدوات الشريط بالترتيب الذي يظهر به — يطابق زووم: حراري، ناسر، خط، سهم، مستطيل، دائرة، نص، محاة */
export const BOARD_TOOLS: AnnotationTool[] = ['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse', 'text']

/** الممحاة وضع مؤشر لا كائن محفوظ: تلمس كائنًا فيُمسح كله */
export type BoardTool = AnnotationTool | 'eraser'
export const BOARD_TOOLBAR: BoardTool[] = [...BOARD_TOOLS, 'eraser']

/** لوحة الألوان: نفس ترتيب زووم لكن بهدوء، وأبيض وأسود لأن السبورة تُعرض على الثيمَين */
export const BOARD_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#f8fafc', '#111827']

/** ثلاث سماكات كما في زووم (رفيع/متوسط/عريض) بالبكسل المنطقي */
export const BOARD_WIDTHS = [2, 4, 8]

export const DEFAULT_TOOL: AnnotationTool = 'pen'
export const DEFAULT_COLOR = BOARD_COLORS[0]
export const DEFAULT_WIDTH = BOARD_WIDTHS[1]

/** حدود الخادم لنفس الأرقام: أي قيمة خارجها تُرفض عند الاستقبال، لا عند الرسم */
export const ANNOTATION_LIMITS = {
  points: 400,
  text: 200,
  id: 64,
  widthMin: 1,
  widthMax: 40,
} as const

const TOOLS = new Set<string>(BOARD_TOOLS)

/** لون من شبكة الطرف الآخر لا يُقبل أعمى: يُسمح بـ #rgb/#rrggbb فقط */
export function safeColor(color: unknown): string {
  return typeof color === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : DEFAULT_COLOR;
}

function finitePoint(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * كائن من الشبكة لا من الثقة: ترفض الأداة المجهولة والنقاط خارج 0..1 والمعرّف الطويل
 * والنصّ الطويل، فلا تُطير ضربة تالفة كل ما على اللوحة ولا يرسو HTML في `fillText`.
 */
export function parseAnnotation(raw: unknown): Annotation | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > ANNOTATION_LIMITS.id) return null
  if (typeof value.tool !== 'string' || !TOOLS.has(value.tool)) return null
  if (!Array.isArray(value.points)) return null
  const points = value.points
  if (points.length < 2 || points.length > ANNOTATION_LIMITS.points * 2) return null
  if (!points.every(finitePoint)) return null
  if (typeof value.width !== 'number' || !Number.isFinite(value.width)) return null
  const width = Math.min(ANNOTATION_LIMITS.widthMax, Math.max(ANNOTATION_LIMITS.widthMin, value.width))
  const tool = value.tool as AnnotationTool
  let text: string | undefined
  if (tool === 'text') {
    if (typeof value.text !== 'string' || value.text.length === 0) return null
    text = value.text.slice(0, ANNOTATION_LIMITS.text)
  }
  // الأشكال والنص تحتاج نقطتين (أو واحدة للنص) على الأكثر، والحرّي ما شاء من النقاط
  if ((tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse') && points.length !== 4) return null
  if (tool === 'text' && points.length !== 2) return null
  return { id: value.id, tool, color: safeColor(value.color), width, points: points as number[], text }
}

export function parseOp(raw: unknown): BoardOp | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (value.op === 'add') {
    const annotation = parseAnnotation(value.a)
    return annotation ? { op: 'add', a: annotation } : null
  }
  if (value.op === 'del') {
    if (!Array.isArray(value.ids)) return null
    const ids = value.ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= ANNOTATION_LIMITS.id)
    return ids.length > 0 ? { op: 'del', ids } : null
  }
  return null
}

/**
 * رسم كائن واحد فوق القائم. `pixelRatio` يُضرب في السماكة فقط، فالإحداثيات نسبية
 * وتُحوَّل هنا إلى مقاس السطح الحالي — وهذا ما يجعل نفس المخزن يُرسم على بلاطة
 * صغيرة أو على المسرح كامل العرض بلا أي تحويل.
 */
export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  annotation: Annotation,
  pixelRatio = 1,
): void {
  const p = annotation.points
  ctx.save()
  ctx.strokeStyle = annotation.color
  ctx.fillStyle = annotation.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const w = annotation.width * pixelRatio
  if (annotation.tool === 'highlighter') {
    ctx.globalAlpha = 0.35
    ctx.lineWidth = w * 3
  } else {
    ctx.lineWidth = w
  }

  switch (annotation.tool) {
    case 'pen':
    case 'highlighter': {
      ctx.beginPath()
      ctx.moveTo(p[0] * width, p[1] * height)
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * width, p[i + 1] * height)
      ctx.stroke()
      break
    }
    case 'line':
    case 'arrow': {
      const [x1, y1, x2, y2] = [p[0] * width, p[1] * height, p[2] * width, p[3] * height]
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      if (annotation.tool === 'arrow') drawArrowHead(ctx, x1, y1, x2, y2, w)
      break
    }
    case 'rect': {
      const [x1, y1, x2, y2] = [p[0] * width, p[1] * height, p[2] * width, p[3] * height]
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
      break
    }
    case 'ellipse': {
      const [x1, y1, x2, y2] = [p[0] * width, p[1] * height, p[2] * width, p[3] * height]
      ctx.beginPath()
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    case 'text': {
      // حجم النص بالبكسل المنطقي مرتبط بالسماكة، فيبقى مقروءًا على البلاطة الصغيرة
      const size = Math.round((annotation.width * 6 + 10) * pixelRatio)
      ctx.font = `${size}px Cairo, system-ui, sans-serif`
      ctx.textBaseline = 'middle'
      ctx.fillText(annotation.text ?? '', p[0] * width, p[1] * height)
      break
    }
  }
  ctx.restore()
}

export function drawAll(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  annotations: readonly Annotation[],
  pixelRatio: number,
): void {
  for (const annotation of annotations) drawAnnotation(ctx, width, height, annotation, pixelRatio)
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: number,
): void {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = Math.max(8, stroke * 3)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6))
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6))
  ctx.stroke()
}

/**
 * ملامسة الممحاة: نقطة بالمقاسات النسبية تُقارن بكل كائن. المنحنى يُختبر بمقاطع صغيرة
 * على طول نقاطه، والأشكال بمحيطها، والنصّ بصندوق تقديري لعرضه — فتعمل الممحاة كما في
 * زووم: تمسح **الكائن كله** بلمسة واحدة على أي جزء منه، لا بكسلات من منتصفه.
 */
export function hitAnnotation(annotation: Annotation, x: number, y: number, tolerance = 0.012): boolean {
  const p = annotation.points
  const reach = tolerance + annotation.width / 200
  if (annotation.tool === 'text') {
    const w = Math.min(0.6, ((annotation.text?.length ?? 4) * 0.045))
    return x >= p[0] - reach && x <= p[0] + w + reach && Math.abs(y - p[1]) <= 0.03 + reach
  }
  if (annotation.tool === 'rect' || annotation.tool === 'ellipse') {
    const [x1, y1, x2, y2] = [Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.max(p[0], p[2]), Math.max(p[1], p[3])]
    const inside = x >= x1 - reach && x <= x2 + reach && y >= y1 - reach && y <= y2 + reach
    if (annotation.tool === 'rect') return inside
    if (!inside) return false
    // محيط القطع الناقص فقط: ما بداخله يظل قابلًا للكتابة فوقه
    const cx = (x1 + x2) / 2
    const cy = (y1 + y2) / 2
    const rx = Math.max((x2 - x1) / 2, 1e-6)
    const ry = Math.max((y2 - y1) / 2, 1e-6)
    const k = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
    return k >= 0.65 && k <= 1.45
  }
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (distanceToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true
  }
  return false
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / length))
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}
