# استراكشر المشروع (Monorepo)

> المعيار المتَّبع: **apps/ + packages/** للـ monorepo، و**feature folders** في الواجهة،
> و**Clean Architecture** في الباك اند — مطابق لمشروع `NileTechno` المرجعي.

---

## 1) الشجرة العامة

```
Eduspace/                        ← جذر المستودع (Git)
├── apps/
│   ├── web/                     الواجهة — React 19 + Vite + TypeScript
│   └── api/                     الباك اند — ASP.NET Core (.NET 10)
├── packages/
│   └── shared-types/            أنواع TypeScript مشتركة بين تطبيقات الواجهة
├── database/
│   ├── schema.sql               الملف الوحيد لكل تغييرات قاعدة البيانات
│   └── README.md
├── docs/                        كل التوثيق
├── package.json                 npm workspaces (apps/* + packages/*)
├── AGENTS.md                    ذاكرة المشروع
└── README.md
```

**لماذا هذا الشكل؟** فصل تام بين الباك والفرونت، وكل تطبيق له `package.json`/`csproj` مستقل،
ومكان واحد للأنواع المشتركة، ومكان واحد لقاعدة البيانات.

---

## 2) الواجهة — `apps/web/src`

```
src/
├── main.tsx                     نقطة البداية: المُزوّدات + الراوتر
├── app/                         إعداد التطبيق
│   ├── App.tsx                  تجميع عام
│   └── router/
│       ├── paths.ts             كل المسارات في مكان واحد (ROUTES)
│       ├── AppRouter.tsx        تعريف المسارات
│       └── ProtectedRoute.tsx   حماية الصفحات الداخلية
├── components/                  مكوّنات عامة مشتركة (Design system)
│   ├── BrandLogo.tsx
│   ├── PreferenceToggles.tsx
│   └── icons/GoogleIcon.tsx
├── features/                    وحدات الميزات (المنطق والبيانات)
│   ├── auth/
│   │   ├── api/authApi.ts       عقد الـ API الخاص بالمصادقة
│   │   ├── authContext.ts       السياق + hook
│   │   ├── AuthProvider.tsx     إدارة الجلسة
│   │   ├── validation.ts        قواعد التحقق
│   │   └── components/          مكوّنات خاصة بالمصادقة (لا تُستخدم خارجها)
│   └── dashboard/
│       └── data/                بيانات/أنواع اللوحة
├── layouts/                     هياكل الصفحات
│   ├── AuthLayout.tsx           هيكل صفحات الدخول
│   └── DashboardLayout.tsx      هيكل الصفحات الداخلية
├── lib/                         أدوات عامة
│   ├── apiClient.ts             عميل الـ API الموحّد
│   └── constants.ts             ثوابت ومتغيّرات بيئة
├── locales/                     **الترجمات — namespace لكل صفحة**
│   ├── ar/{common,login,dashboard}.json
│   └── en/{common,login,dashboard}.json
├── pages/                       **صفحة = مجلد + مسار**
│   ├── LoginPage/               → /login
│   ├── HomePage/                → /home
│   ├── SchedulePage/            → /schedule
│   ├── SessionsPage/            → /sessions
│   ├── StudentsPage/            → /students
│   ├── ReportsPage/             → /reports
│   ├── MessagesPage/            → /messages
│   ├── SettingsPage/            → /settings
│   └── ComingSoonPage/          صفحة مؤقتة للمسارات غير المبنية
├── styles/                      design tokens + global
├── theme/                       المظهر (فاتح/غامق)
└── i18n/                        إعداد i18next فقط (الملفات في locales/)
```

### القواعد (مهم)

| القاعدة | التفصيل |
|---|---|
| **صفحة = مجلد + مسار** | كل صفحة في `pages/<Name>Page/` ولها مسار في `app/router/paths.ts` وسطر في `AppRouter.tsx`. |
| **`features/` للمنطق و`pages/` للعرض** | النداءات والأنواع والسياق في `features/`، والصفحة تجمع المكوّنات وتُعرض فقط. |
| **مكوّنات الوحدة تبقى داخلها** | `features/auth/components/` لا تُستخدم خارج المصادقة. ما يُستخدم في مكانين ينتقل إلى `components/`. |
| **ممنوع كتابة مسار نصًّا** | استخدم `ROUTES.*` من `paths.ts` دائمًا. |
| **الترجمة namespace لكل وحدة** | ملف JSON لكل صفحة في `locales/<lang>/`، والاستخدام `t('login:form.submit')`. |
| **إضافة صفحة جديدة** | مجلد في `pages/` + مسار في `paths.ts` + سطر في `AppRouter.tsx` + ملف JSON في `locales/` + إضافته في `i18n/index.ts`. |

---

## 3) الباك اند — `apps/api`

**الحالة الحالية:** مشروع واحد `EduspaceApi` بمجلدات منظّمة
(`Controllers`, `Services`, `Data`, `Models`, `Auth`, `Contracts`).

**المعيار المستهدف** (نفس `NileTechno` — Clean Architecture):

```
apps/api/
├── Eduspace.sln
└── src/
    ├── Eduspace.Domain/           الكيانات وقواعد العمل (Entities, Enums, Common)
    ├── Eduspace.Application/      حالات الاستخدام
    │   ├── Common/                Interfaces, Models, Mappings, Exceptions
    │   └── Features/<Feature>/    Commands/*, Queries/*, DTOs
    ├── Eduspace.Infrastructure/   EF Core، Repositories، Services
    └── Eduspace.API/              Controllers, Middleware, Filters
```

**اتجاه الاعتماد:** `Domain ← Application ← Infrastructure ← API`
و`MediatR` + `FluentValidation` + `AutoMapper` في طبقة Application.

> ⚠️ **لم يُنفَّذ بعد** — الباك اند حاليًا مشروع واحد عامل ومُختبَر. التقسيم هو الخطوة التالية.

---

## 4) أوامر التشغيل

```bash
# من جذر المستودع
npm install                                   # تثبيت كل الـ workspaces مرة واحدة
npm run dev                                   # الواجهة (apps/web)

# الباك اند في نافذة أخرى
cd apps/api && dotnet run --launch-profile http
```

- الواجهة: `http://localhost:5173` (وتمرّر `/api` إلى الـ API عبر بروكسي Vite).
- الـ API: `http://localhost:5279`.
- **Vercel:** اضبط **Root Directory = `apps/web`**.
