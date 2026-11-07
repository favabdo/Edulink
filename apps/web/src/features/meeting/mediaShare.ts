/**
 * مشاركة الشاشة من هذا الجهاز فعلًا — لا مما نظن أن المتصفح يدعمه.
 *
 * الحقيقة المقاسة: **لا متصفح جوال ينفّذ `getDisplayMedia`** (لا iOS Safari ولا
 * Chrome على Android). كان الزر يرمي استثناء يفسّره `catch` على أن «المستخدم ألغى»
 * ⇒ زر ميت بلا رسالة. والقلب من أمامية لخلفية صار في `MeetingClient.flipCamera`
 * على المسار الحيّ نفسه، لا بمسار ثانٍ يُفتح ثم يُوقف ويقتل الكاميرتين معًا.
 */

export type ShareFailure = {
  reason: 'unsupported' | 'denied' | 'busy' | 'error';
  /** نص المتصفح الخام — يُضاف خلف الترجمة، ولا يُعرض وحده بديلًا عنها */
  detail: string;
};

export type ShareResult = { track: MediaStreamTrack } | { failure: ShareFailure };

export function screenCaptureSupported(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export async function acquireVisualShare(): Promise<ShareResult> {
  if (!screenCaptureSupported()) {
    return { failure: { reason: 'unsupported', detail: 'getDisplayMedia' } };
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!track) return { failure: { reason: 'error', detail: 'no-video-track' } };
    return { track };
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
