/**
 * ما يمكن مشاركته بصريًا من هذا الجهاز فعلًا — لا مما نظن أن المتصفح يدعمه.
 *
 * الحقيقة المقاسة: **لا متصفح جوال ينفّذ `getDisplayMedia`** (لا iOS Safari ولا
 * Chrome على Android)، فزر «مشاركة الشاشة» على الموبايل كان يرمي استثناء ويُسقطه
 * `catch` يفسّر كل خطأ على أنه «المستخدم ألغى» ⇒ زر ميت بلا رسالة. البديل الذي
 * يعمل في حصة حقيقية هو الكاميرا الخلفية (الكتاب/الورق/السبورة في الغرفة) أو ملف.
 */

export type ShareMode = 'screen' | 'camera';

export type ShareFailure = {
  reason: 'unsupported' | 'denied' | 'busy' | 'error';
  /** نص المتصفح الخام — يُضاف خلف الترجمة، ولا يُعرض وحده بديلًا عنها */
  detail: string;
};

export type ShareResult = { track: MediaStreamTrack; mode: ShareMode } | { failure: ShareFailure };

export function screenCaptureSupported(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/** اللمس أو الجوال: مشاركة الشاشة غير متاحة، فالكاميرا هي الطريق */
export function isTouchFirst(): boolean {
  if (!screenCaptureSupported()) return true;
  return window.matchMedia?.('(pointer: coarse)').matches ?? (navigator.maxTouchPoints ?? 0) > 0;
}

export async function acquireVisualShare(mode: ShareMode): Promise<ShareResult> {
  if (mode === 'screen') {
    if (!screenCaptureSupported()) {
      return { failure: { reason: 'unsupported', detail: 'getDisplayMedia' } };
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) return { failure: { reason: 'error', detail: 'no-video-track' } };
      return { track, mode };
    } catch (err) {
      return { failure: describe(err) };
    }
  }

  try {
    // الكاميرا الخلفية أولًا (ورقة/كتاب)، ومع رفض النظام لها تُجرَّأ أي كاميرا
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) return { failure: { reason: 'error', detail: 'no-camera' } };
    return { track, mode };
  } catch (err) {
    return { failure: describe(err) };
  }
}

function describe(err: unknown): ShareFailure {
  const name = err instanceof DOMException ? err.name : '';
  const detail = err instanceof Error ? err.message : String(err);
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return { reason: 'denied', detail };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return { reason: 'busy', detail };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { reason: 'error', detail };
  }
  return { reason: 'error', detail };
}
