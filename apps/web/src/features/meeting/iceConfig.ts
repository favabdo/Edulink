/**
 * تنقية قائمة ICE قبل أن تصل إلى `new RTCPeerConnection`.
 *
 * منفصلة في ملف بلا أي استيراد حتى يقدر فحصٌ آلي (Node) أن يستدعيها مباشرة
 * بدون تشغيل المتصفح — لأن الخطأ الذي تمنعه لا تظهر له أي علامة على الشاشة.
 *
 * مقيس في Chrome: عنصر `urls: [""]` واحد (يسقط من سطر فارغ في إعداد السيرفر)
 * يجعل `new RTCPeerConnection` يرمي `'' is not a valid URL` **داخل ردّ
 * `peer-joined`**، وعميل SignalR يطبع ذلك في الكونسول وحده — فتبقى الشاشة تقول
 * «متصل» ولا تتفاوض أبدًا ولا يصل صوت ولا صورة.
 */
export function sanitizeIceServers(list: RTCIceServer[] | undefined): RTCIceServer[] {
  const usable: RTCIceServer[] = []
  for (const entry of list ?? []) {
    const raw = Array.isArray(entry.urls) ? entry.urls : [entry.urls]
    const urls = raw
      .map((url) => (typeof url === 'string' ? url.trim() : ''))
      .filter((url) => /^(stuns?|turns?):\S+/.test(url))
    if (urls.length === 0) continue
    usable.push({ ...entry, urls })
  }
  return usable
}
