/**
 * تصدير CSV من المتصفح مباشرة — بدون باك اند.
 *
 * • BOM في أول الملف (`\uFEFF`) حتى تقرأه Excel بالعربية صحيحًا.
 * • الأرقام تُكتب خام (ASCII بلا فواصل الآلاف) لأن الفصل بالفاصلة العشرية يختلف بين Locale.
 * • الحقول التي تحتوي فاصلة أو علامات اقتباس أو أسطرًا تُلفّ بين علامتي تنصيص مضاعفتين.
 */

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function plainNumber(value: number): string {
  return String(Math.round(value * 10) / 10)
}

export function buildCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map((line) => line.map(escapeField).join(',')).join('\r\n')
}

/** بادئة BOM (U+FEFF) تقرأ بها Excel الملف عربيًا صحيحًا */
const BOM = String.fromCharCode(0xfeff)

export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'

  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)

  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
