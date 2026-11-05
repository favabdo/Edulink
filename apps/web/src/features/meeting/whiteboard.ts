import type { Stroke } from './meetingClient'

/**
 * نموذج السبورة الخالص: مخزن المقاطع + رسمها على أي سياق بأي مقاس.
 *
 * الإحداثيات نسبية (0..1) دائمًا، فيرسم نفس المخزن على بلاطة صغيرة أو على المسرح
 * كامل العرض بلا أي تحويل — وهذا ما يجعل «تكبير السبورة» عند طرف لا يُفسد ما كتبه
 * الطرف الآخر.
 */

/** سماكة القلم بالبكسل المنطقي، تُضرب في devicePixelRatio عند الرسم */
const PEN_WIDTH = 2.5;

/** ألوان القلم المعتمدة — يطابقها `safeColor` أسفل */
export const BOARD_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#111827'];

export function drawSegments(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  segments: readonly Stroke[],
  pixelRatio: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = PEN_WIDTH * pixelRatio;
  for (const s of segments) {
    if (!Number.isFinite(s.x1) || !Number.isFinite(s.y1) || !Number.isFinite(s.x2) || !Number.isFinite(s.y2)) continue;
    ctx.strokeStyle = safeColor(s.color);
    ctx.beginPath();
    ctx.moveTo(s.x1 * width, s.y1 * height);
    ctx.lineTo(s.x2 * width, s.y2 * height);
    ctx.stroke();
  }
}

/** لون من شبكة الطرف الآخر لا يُقبل أعمى: يُسمح بـ #rgb/#rrggbb فقط */
function safeColor(color: string): string {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color ?? '') ? color : '#2563eb';
}

/**
 * ضربة من الطرف الآخر إلى مخزن قابل للرسم. تُقبل فقط لو كانت النسبيات داخل 0..1
 * بضمان (حتى لا تُطير ضربة تالفة كل ما على اللوحة).
 */
export function parseSegment(raw: string): Stroke | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  const numbers = ['x1', 'y1', 'x2', 'y2'].map((key) => value[key]);
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  const [x1, y1, x2, y2] = numbers as number[];
  const color = typeof value.color === 'string' ? safeColor(value.color) : '#2563eb';
  return { x1, y1, x2, y2, color };
}
