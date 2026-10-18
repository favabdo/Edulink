#!/usr/bin/env node
/**
 * فاحظ تغطية الترجمة — كل مفتاح تستخدمه الواجهة يجب أن يوجد في **كل** لغة.
 *
 * لماذا: مفتاح ناقص يطبع اسمه الخام على الشاشة (مثال: `settings:security.serverNote`)،
 * وهو خطأ لا تُمسكه لا `tsc` ولا `oxlint` ولا بناء Vite — ظهر فعلًا أكثر من مرة.
 *
 * يخرج **1** عند: (أ) مفتاح مستخدم ولا وجود في لغة، (ب) قالب `t(\`ns:a.${x}\`)` ومساره
 * الأبوين غير موجود، (ج) ملف ترجمة عربي/إنجليزي لا تطابق مفاتيحه بينهما.
 * المفاتيح غير المستخدمة تُطبع للاستدلال فقط (لا تُفشل الفحص): بعضها يُقرأ ديناميكيًا.
 *
 * التشغيل من جذر المستودع: `node tools/check-i18n-keys.mjs`
 */
import fs from 'node:fs'
import path from 'node:path'

const WEB = path.join(process.cwd(), 'apps', 'web')
const SRC = path.join(WEB, 'src')
const LOCALES_DIR = path.join(SRC, 'locales')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const langs = fs.readdirSync(LOCALES_DIR).filter((d) => {
  return fs.existsSync(path.join(LOCALES_DIR, d)) && fs.statSync(path.join(LOCALES_DIR, d)).isDirectory()
})

/** namespaces لكل لغة = أسماء ملفات JSON */
const catalogs = new Map()
for (const lang of langs) {
  const dir = path.join(LOCALES_DIR, lang)
  const ns = {}
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    ns[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
  }
  catalogs.set(lang, ns)
}

function lookup(ns, keyPath) {
  const [namespace, ...rest] = keyPath.split(':')
  if (rest.length === 0) return undefined
  let node = ns[namespace]
  if (node === undefined) return null // الـ namespace نفسه غير موجود
  const parts = rest.join('.').split('.')
  for (const part of parts) {
    if (node === null || typeof node !== 'object' || !(part in node)) {
      // `t('x.alert', { count })` تُحلّ إلى alert_one/alert_other… فلا يُشترط الاسم المجرّد
      const last = parts[parts.length - 1]
      const siblings = node && typeof node === 'object' ? Object.keys(node) : []
      if (siblings.some((k) => k.replace(PLURAL_SUFFIX, '') === last)) return node
      return false
    }
    node = node[part]
  }
  return node
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

const files = walk(SRC)
const missing = []
const prefixes = new Set()
const usedKeys = new Map() // "ns:key" -> Set(files)
const usage = new Map() // ns -> count of dynamic-prefix usages

const LITERAL = /\bt\(\s*['"]([^'"]+)['"]/g
const TPL = /\bt\(\s*`([^`]*?)\$\{[^}]*\}([^`]*)`/g

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const rel = path.relative(process.cwd(), file)

  for (const match of text.matchAll(LITERAL)) {
    const key = match[1]
    if (!key.includes(':')) continue // namespace افتراضي — لا يُحكم عليه هنا
    if (!usedKeys.has(key)) usedKeys.set(key, new Set())
    usedKeys.get(key).add(rel)
    for (const lang of langs) {
      const found = lookup(catalogs.get(lang), key)
      if (found === false) missing.push([lang, key, rel, 'مفتاح'])
      else if (found === null) missing.push([lang, key, rel, 'namespace'])
    }
  }

  for (const match of text.matchAll(TPL)) {
    const head = match[1]
    if (!head.includes(':')) continue
    // مثل `settings:security.rules.${rule.key}` — المسار الأبوين يجب أن يكون كائنًا
    const parent = head.replace(/\.$/, '')
    prefixes.add(`${parent}  ←  من ${rel}`)
    // `settings:` أو `settings:roles.` — التوسّع على مستوى namespace كامل:
    // وجود الـ namespace يكفي، ولا يُطلب أبعد منه.
    const wholeNamespace = /:$/.test(head) || /:$/.test(head + '.')
    for (const lang of langs) {
      const nsName = parent.split(':')[0]
      if (wholeNamespace) {
        // رأس بلا مسار قبل `${…}` (مثل `settings:${roleLabelKey(role)}`) لا يمكن التحقق منه
        // أبدًا — وهو الذي طبع «roles.owner» الخامية على الشاشة. فليُرفض في الفحص.
        if (/:$/.test(head)) {
          missing.push([lang, head + '… ( ديناميكي بلا مسار )', rel, 'مسار غير قابل للتحقق'])
          continue
        }
        if (!(nsName in catalogs.get(lang))) missing.push([lang, nsName, rel, 'namespace'])
        continue
      }
      const found = lookup(catalogs.get(lang), parent)
      if (found === false || found === null) missing.push([lang, parent, rel, 'مسار ديناميكي'])
      else if (found !== undefined && typeof found !== 'object') missing.push([lang, parent, rel, 'ليس كائنًا'])
    }
    usage.set(head, (usage.get(head) ?? 0) + 1)
  }
}

// تطابق المفاتيح بين اللغات (كل namespace موجود في لغة يجب أن له نفس الأوراق)
function leafKeys(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) leafKeys(v, p, out)
    else out.push(p)
  }
  return out
}

/**
 * لواحق الجمع في i18next تختلف مشروعًا بين اللغات (ar: zero/one/two/few/many/other،
 * en: one/other) — فتُقارن الأوراق بعد تجريد اللاحق، وإلا يُفشل الفحص بغير سبب.
 */
const PLURAL = /_(zero|one|two|few|many|other)$/
const normalizeLeaves = (obj) => new Set(leafKeys(obj).map((k) => k.replace(PLURAL, '')))

const mismatches = []
const [firstLang, ...otherLangs] = langs
const baseNs = catalogs.get(firstLang)
for (const nsName of Object.keys(baseNs)) {
  for (const lang of otherLangs) {
    const ns = catalogs.get(lang)
    if (!(nsName in ns)) {
      mismatches.push(`namespace «${nsName}» موجود في ${firstLang} ولا وجود في ${lang}`)
      continue
    }
    const a = normalizeLeaves(baseNs[nsName])
    const b = normalizeLeaves(ns[nsName])
    for (const key of a) if (!b.has(key)) mismatches.push(`${lang}: ${nsName}:${key} ناقص (موجود في ${firstLang})`)
    for (const key of b) if (!a.has(key)) mismatches.push(`${firstLang}: ${nsName}:${key} ناقص (موجود في ${lang})`)
  }
}

// المفاتيح غير المستخدمة — للاستدلال فقط
const orphans = []
for (const [nsName, tree] of Object.entries(catalogs.get(firstLang))) {
  for (const leaf of leafKeys(tree)) {
    const full = `${nsName}:${leaf}`
    if (!usedKeys.has(full) && ![...usedKeys.keys()].some((u) => u.startsWith(full) || full.startsWith(u))) {
      orphans.push(full)
    }
  }
}

const lines = []
lines.push(`اللغات: ${langs.join(', ')}  |  مفاتيح مستخدمة: ${usedKeys.size}  |  مسارات ديناميكية: ${prefixes.size}`)
if (orphans.length) lines.push(`\nغير مستخدمة (لا تُفشل الفحص): ${orphans.length}\n${orphans.slice(0, 12).map((o) => `  · ${o}`).join('\n')}`)
lines.push('')

const seen = new Set()
for (const [lang, key, file, kind] of missing) {
  const id = `${lang}|${key}`
  if (seen.has(id)) continue
  seen.add(id)
  lines.push(`✗ ${kind} مفقود: [${lang}] ${key}   (من ${file})`)
}
for (const m of mismatches) lines.push(`✗ تفاوت لغات: ${m}`)

if (lines.length > 2 + (orphans.length ? 2 : 0)) {
  console.log(lines.join('\n'))
  console.log(`\nفشل: ${seen.size} مفتاح مفقود، ${mismatches.length} تفاوت بين اللغات.`)
  process.exit(1)
}

console.log(lines.join('\n'))
console.log('نجح: كل مفتاح تستخدمه الواجهة موجود في كل لغة، والمسافات متطابقة بين اللغتين.')
