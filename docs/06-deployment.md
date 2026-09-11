# النشر على Vercel — EduLink

> كل إعدادات النشر جاهزة في `eduspace-web/vercel.json`. المشروع **لا يحتاج أي متغيّرات بيئة**.

---

## الطريقة الأسرع: Vercel CLI (بدون Git) ⭐

الأسرع لأنك تنشر من داخل مجلد المشروع مباشرة، فلا توجد مشكلة «المجلد الجذري».

```bash
cd "D:\work\My Project\Eduspace\eduspace-web"
npm i -g vercel        # مرة واحدة
vercel login           # مرة واحدة
vercel --prod          # النشر للإنتاج
```

في أول مرة سيسألك:
- `Set up and deploy?` → **Y**
- `Which scope?` → اختر حسابك
- `Link to existing project?` → **N**
- `What's your project's name?` → `edulink` (أو أي اسم)
- `In which directory is your code located?` → **`.`** (نقطة = المجلد الحالي)
- سيكتشف Vite تلقائيًا، فيضبط أمر البناء والمخرجات من `vercel.json`.

بعد النشر سيطبع لك الرابط، وكل مرة بعدها `vercel --prod` تنشر تحديثًا.

---

## الطريقة الثانية: GitHub + Vercel (نشر تلقائي عند كل تعديل)

> **المستودع المرتبط:** `https://github.com/favabdo/Edulink` — وهو **monorepo**:
> الفرونت في `apps/web` والباك اند في `apps/api` وقاعدة البيانات في `database/`.

### ⚠️ مهم جدًا بعد إعادة الهيكلة إلى monorepo

البناء ينجح لكن Vercel لا يجد مجلد المخرجات، لأن الفرونت انتقل إلى `apps/web`:

```
Error: No Output Directory named "dist" found after the Build completed.
```

**الحل (اختر واحدًا):**

**الأفضل — اضبط Root Directory:** من **Project → Settings → General → Root Directory** اختر **`apps/web`**، ثم أعد النشر.
هذا هو الإعداد القياسي للـ monorepo، و`apps/web/vercel.json` يتكفّل بالباقي.

**أو اترك الإعداد كما هو:** أُضيف `vercel.json` في **جذر المستودع** يحدّد
`outputDirectory: "apps/web/dist"` — فيعمل النشر بلا أي تغيير في الإعدادات.

> ℹ️ لو ضبطت Root Directory على `apps/web`، ملف `vercel.json` في الجذر يصبح **غير مستخدم**
> ويُفضَّل حذفه لاحقًا حتى لا تتكرر نفس الإعدادات في مكانين.

> ⚠️ **لا تضبط `installCommand` داخل `apps/web`** — ملف القفل (`package-lock.json`) موجود في
> **جذر الـ workspace** بعد التحوّل إلى npm workspaces، فتشغيل `npm ci` داخل `apps/web` يفشل.
> اترك Vercel يكتشف الـ workspace ويتثبّت من الجذر تلقائيًا.

### الرفع على GitHub

```bash
cd "D:\work\My Project\Eduspace\eduspace-web"
git add -A
git commit -m "..."
git push origin main
```

### الاستيراد في Vercel

1. افتح <https://vercel.com/new> واختر مستودع `Edulink`.
2. اترك **Root Directory** على `/` كما هي (لا تغيّرها).
3. Framework Preset سيُضبط تلقائيًا على **Vite**:
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm ci`
4. اضغط **Deploy**.

بعد الربط، كل `git push` على `main` ينشر تلقائيًا، وكل Pull Request يحصل على رابط معاينة.

> ℹ️ **ملاحظة:** مجلد `docs/` يقع **خارج** المستودع (في المجلد الأب)، فهو غير مُتتبَّع بـ Git
> وغير مرفوع إلى GitHub. لو أردت رفعه أيضًا: انقله إلى داخل `eduspace-web/docs/` وسيصبح
> مُتتبَّعًا تلقائيًا، ولن يؤثر على النشر لأن Vite لا يبنيه.

---

## ما الموجود في `vercel.json`

| الإعداد | القيمة | لماذا |
|---|---|---|
| `framework` | `vite` | ضبط تلقائي صحيح |
| `installCommand` | `npm ci` | تثبيت أسرع ومطابق لـ `package-lock.json` |
| `buildCommand` | `npm run build` | `tsc -b && vite build` (فحص أنواع ثم بناء) |
| `outputDirectory` | `dist` | مخرجات Vite |
| `cleanUrls` | `true` | روابط بدون `.html` |
| `rewrites` | كل المسارات → `/index.html` | مهم عند إضافة مسارات (Router) لاحقًا؛ الملفات الثابتة لها الأولوية دائمًا |
| `Cache-Control` على `/assets/*` و `/fonts/*` | `max-age=31536000, immutable` | هذه ملفات باسم يحتوي بصمة المحتوى، فتُخزَّن سنة كاملة |
| `Cache-Control` على `/login-showcase.jpg` | 7 أيام + `stale-while-revalidate` | اسمه ثابت بلا بصمة، فكاش أقصر |
| ترويسات أمان | `nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN` | حماية أساسية |
| `Permissions-Policy` | `camera=(self), microphone=(self), display-capture=(self)` | **مقصودة**: الجلسات المباشرة (LiveKit) ستحتاج الكاميرا والمايك من نفس النطاق |

---

## النطاق المخصّص (Custom Domain)

من **Project → Settings → Domains** أضف نطاق المؤسسة، واتبع تعليمات الـ DNS.

> **للبيع لأكثر من مؤسسة (White-label):** كل مؤسسة لها نطاق وقاعدة بيانات مستقلة.
> أقترح مشروع Vercel واحد مع عدة Domains، والـ backend يحدّد المؤسسة من الدومين (get host → connection string)، فيبقى النشر واحدًا للجميع.

---

## أيقونة التطبيق والتثبيت على الموبايل

المنصة قابلة **للتثبيت كتطبيق** من المتصفح (Add to Home Screen) عبر Web App Manifest.

| الملف | الاستخدام |
|---|---|
| `public/icons/icon-192.png` | أيقونة أندرويد (192×192) |
| `public/icons/icon-512.png` | أيقونة أندرويد عالية الدقة + شاشة البداية (512×512) |
| `public/icons/apple-touch-icon.png` | أيقونة iOS عند الإضافة للشاشة الرئيسية (180×180) |
| `public/manifest.webmanifest` | `display: standalone` + الأيقونات + اللغة والاتجاه |
| `public/favicon.png` | أيقونة تبويب المتصفح |

**ملاحظات فنية:**
- الأيقونة الأصلية كان لها **حواف مستديرة على خلفية سوداء**.

  لتفادي ظهور السواد عند أقنعة المشغّلات (launcher masks)، تُملأ الحواف
  بامتداد ألوان الحافة نفسها فتخرج **مربعة كاملة (full-bleed)**.
- الأيقونات مُعلَنة بـ `purpose: "any maskable"` — ومحتوى الأيقونة (القبعة والحرف
  والاسم) يقع داخل المنطقة الآمنة، فيُقتطع الخلفية فقط عند القناع.
- `background_color` و`theme_color` بلون خلفية الصفحة الفاتح `#f3f8fd` لمطابقة
  أول رسم للتطبيق فلا يحدث وميض داكن→فاتح.
- سكربت التوليد محفوظ في `tmp/make-app-icons.ps1`، والملف الأصلي في
  `docs/reference/app-icon-source.png`.

## الأداء — ما تم تجهيزه

| البند | قبل | بعد |
|---|---|---|
| الخطوط | طلب خارجي إلى Google Fonts (DNS + TLS + CSS حاجب للرسم) | **3 ملفات محلية** من نفس النطاق، خطوط متغيّرة تغطّي الأوزان 400–800، `font-display: swap` |
| طلب الخط | 8 ملفات محتملة | **ملف واحد** للغة المستخدمة (عربي: `cairo-arabic` + `cairo-latin` / إنجليزي: `inter-latin`) |
| نسخة الاسم في الشعار | كانتا تُنزَّلان معًا (50KB هدر) | خلفية CSS — **نسخة الثيم الفعّال فقط** |
| صورة اللوحة على الجوال | كانت تُنزَّل رغم إخفاء اللوحة (125KB هدر) | خلفية CSS داخل لوحة مخفية → **لا تُنزَّل إطلاقًا** |
| LCP (صورة اللوحة) | تبدأ بعد تنزيل JS وترتيب React | **`preload` + `fetchpriority=high`** من `<head>` بالتوازي مع JS (على الشاشات الكبيرة فقط) |
| وميض الثيم / انقلاب الاتجاه | يحصلان بعد التحميل | يُطبَّقان **قبل أول رسم** من سكربت مضمّن |
| إزاحة التصميم (CLS) | صور الشعار بلا أبعاد | `aspect-ratio` محدّد مسبقًا لكل صورة |
| النقل | — | Vercel يضغط Brotli تلقائيًا للملفات النصية |

**حجم الصفحة عند أول زيارة (عربي، ديسكتوب):** ≈ 89KB JS (92KB مضغوط) + 3.8KB CSS + 1KB CSS خطوط + 64KB خطوط + 125KB صورة + 46KB شعار ≈ **330KB** قبل ضغط Brotli للملفات النصية.

---

## نشر الباك اند (منفصل عن الواجهة)

الواجهة تُنشر على Vercel، أما **الباك اند (ASP.NET Core) فيحتاج استضافة تشغّل .NET** — لا يصلح Vercel له.
خيارات مناسبة: **Azure App Service**، **Railway**، **Render**، أو **VPS** (Hetzner في ألمانيا كما اتفقنا) بـ Docker.

### خطوات الربط

1. انشر الـ API واحصل على عنوانه، مثال: `https://api.edulink.example`.
2. على Vercel اضبط متغيّر البيئة:
   ```
   VITE_API_BASE_URL = https://api.edulink.example
   ```
   الواجهة تقرأه في `src/api/client.ts` وتضيفه قبل كل نداء. **بدونه تستخدم مسارًا نسبيًا `/api`** (وهذا يعمل في التطوير عبر بروكسي Vite فقط).
3. اضبط في الـ API:
   ```
   Database__Provider=Postgres
   Database__EnsureCreated=false
   ConnectionStrings__Postgres=<Supabase connection string>
   Cors__Origins__0=https://edulink.vercel.app
   Cors__Origins__1=https://<الدومين النهائي>
   ```
   ⚠️ لا تنسَ إضافة دومين الواجهة إلى `Cors__Origins` وإلا رفض المتصفح النداءات.
4. **لا تُشغّل EF Migrations** على قاعدة الإنتاج — المخطط من `db/schema.sql` فقط.

## التحقق بعد النشر

1. افتح الرابط، وتأكد أن الخطوط ظاهرة (وليست خط النظام).
2. بدّل اللغة والمظهر — يجب أن يعملا والاتجاه ينقلب فورًا.
3. افتح DevTools → **Network**:
   - `/fonts/*.woff2` يجب أن يكون من نفس النطاق.
   - `/login-showcase.jpg` يجب أن يظهر في الوضع الديسكتوب ولا يظهر على مقاس الجوال.
   - `/assets/*` يجب أن تحمل `cache-control: public, max-age=31536000, immutable`.
4. **Lighthouse** → يجب أن تكون درجات Performance / Best Practices / SEO عالية.
