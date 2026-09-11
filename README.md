# EduLink

منصة تعليمية أونلاين **All-in-One** — حصص مباشرة 1-to-1، إدارة مدرسين وطلاب، ومواعيد وحصص، تُبنى مرّة وتُباع لأكثر من مؤسسة (White-label).

> الاسم المعتمد: **EduLink** — الشعار النصي: `Learn • Teach • Grow`

## حالة المشروع

| البند | الحالة |
|---|---|
| صفحة تسجيل الدخول | ✅ مكتملة (عربي/إنجليزي + فاتح/غامق + بيضاوي بالكامل) |
| الشعار الرسمي | ✅ مركَّب في الصفحة والأيقونة المفضلة |
| التوثيق | ✅ كامل في `docs/` |
| جاهزية النشر | ✅ إعدادات Vercel والخطوط المحلية جاهزة |
| الـ backend وقاعدة البيانات | ❌ لم يبدأ |
| الجلسات المباشرة (LiveKit) | ❌ لم يبدأ |

## التشغيل محليًا

```bash
cd eduspace-web
npm install
npm run dev      # http://localhost:5173
npm run build    # بناء الإنتاج
npm run lint     # فحص الكود
npm run preview  # معاينة نسخة الإنتاج
```

## النشر على Vercel

**الأسرع — من داخل مجلد المشروع بلا Git:**

```bash
cd eduspace-web
npm i -g vercel && vercel login
vercel --prod
```

**أو عبر GitHub:** المستودع المرتبط هو <https://github.com/favabdo/Edulink>،
وجذر المستودع **هو مجلد `eduspace-web` نفسه** — استورده في <https://vercel.com/new>
واترك Root Directory على `/` كما هي، وسيُضبط الباقي تلقائيًا.

التفاصيل الكاملة والأداء وترويسات الأمان في **[`docs/06-deployment.md`](docs/06-deployment.md)**.

## توثيق المشروع

| الملف | المحتوى |
|---|---|
| [`AGENTS.md`](AGENTS.md) | قواعد المشروع وذاكرته وهويته — **يُقرأ أولًا** |
| [`docs/04-progress-log.md`](docs/04-progress-log.md) | سجل التقدم خطوة بخطوة وأين توقف العمل |
| [`docs/01-requirements.md`](docs/01-requirements.md) | المتطلبات والقرارات الوظيفية |
| [`docs/02-tech-stack.md`](docs/02-tech-stack.md) | الستاك التقني والتوصيات |
| [`docs/03-design-reference.md`](docs/03-design-reference.md) | قياسات الريفيرنس التصميمي |
| [`docs/05-project-structure.md`](docs/05-project-structure.md) | بنية الكود والتقنيات |
| [`docs/06-deployment.md`](docs/06-deployment.md) | النشر على Vercel والأداء |

## البنية

```
Eduspace/
├── AGENTS.md            # ذاكرة المشروع (تُقرأ تلقائيًا في كل جلسة)
├── docs/                # كل التوثيق + صور الريفيرنس + لقطات الشاشة
└── eduspace-web/        # كود الواجهة (Vite + React + TypeScript)
    ├── vercel.json      # إعدادات النشر
    ├── public/fonts/    # خطوط مستضافة محليًا (بلا طلبات خارجية)
    └── src/
```

## التقنيات

React 19 · TypeScript 6 · Vite 8 · i18next · lucide-react · CSS Modules + Design Tokens

---

© 2026 Nile Techno by Abdullah Elsawy
