# EduLink

منصة تعليمية أونلاين **All-in-One** — حصص مباشرة 1-to-1، إدارة مدرسين وطلاب، ومواعيد وحصص، تُبنى مرّة وتُباع لأكثر من مؤسسة (White-label).

> الاسم المعتمد: **EduLink** — الشعار النصي: `Learn • Teach • Grow`

## حالة المشروع

| البند | الحالة |
|---|---|
| الواجهة (ar/en + فاتح/غامق + كل الشاشات) | ✅ تعمل على بيانات حقيقية من الخادم، بلا أي بيانات نموذجية |
| الباك اند + قاعدة البيانات | ✅ ASP.NET Core (.NET 10) + EF Core على **SQL Server** (مجرَّب قراءة وكتابة في Production) |
| الحصة المباشرة (WebRTC + سبورة) | ✅ غرفة 1-to-1 مع مراقب، مقيسة حتى 2000 حصة متزامنة بلا فقدان رسائل |
| تحديد المعدل وقفل الدخول وعزل الأدوار | ✅ مفروضة في الخادم ومقاسة بأدوات تفشل فعلًا (`tools/verify-*.py`) |
| النشر | ⚙️ مُهيَّأ لسيرفر استضافة واحد (واجهة + API + nginx تحت `/edulink`) — `docs/06` |

## التشغيل محليًا (monorepo)

```bash
npm install                                  # من جذر المستودع (workspaces)
npm run dev                                  # الواجهة → http://localhost:5173

# الباك اند في نافذة أخرى
cd apps/api && dotnet run --launch-profile http   # → http://localhost:5279
```

فحص ما قبل التسليم: `npm run lint` و`npm run check:i18n` و`npm run build` — كلها يجب أن تخرج صفرًا.

## النشر على سيرفر واحد

الشكل المُسلَّم: **الواجهة تُخدَم ملفات ثابتة، والـ API عملية `dotnet` خلف nginx، كلهم على نفس
السيرفر وتحت بادئة مسار واحدة** (نفس شكل `/nilechat`)، والقاعدة على SQL Server عند العميل.

```bash
# 1) المخطط: ملف واحد يعمل Run على SQL Server (تراكمي، مرة أو عشر مرات بنفس النتيجة)
sqlcmd -S "SERVER,1433" -U sa -P "PASSWORD" -f 65001 -I -b -i RUN-ON-SQL-SERVER.sql

# 2) البناء تحت بادئة النشر (لا يُنشر بـ '/' ثم يُنقل)
cp apps/api/.env.example apps/api/.env       # واملأ بيانات دخول SQL Server فقط
cp apps/web/.env.example apps/web/.env       # VITE_BASE_PATH=/edulink/
npm run build                                # → apps/web/dist

# 3) الـ API كعملية مباشرة، والنقاط العامة كلها من nginx
dotnet publish apps/api -c Release -o /opt/edulink/api     # ثم deploy/edulink-api.service
# وبلوكات deploy/nginx-edulink.conf في إعداد nginx الموجود
```

الخطوات الكاملة مع القياسات وحدود العربة (TURN، النسخ الاحتياطي، إعادة قياس الحمل) في
**[`docs/06-deployment.md`](docs/06-deployment.md)** و**[`docs/11-production-deployment.md`](docs/11-production-deployment.md)**.
طريق بديل بعربة Docker: `bash deploy/run.sh` (يشغّل المخطط والبناء والبوابات السبع).

## توثيق المشروع

| الملف | المحتوى |
|---|---|
| [`AGENTS.md`](AGENTS.md) | قواعد المشروع وذاكرته وهويته — **يُقرأ أولًا** |
| [`docs/04-progress-log.md`](docs/04-progress-log.md) | سجل التقدم خطوة بخطوة وأين توقف العمل |
| [`docs/01-requirements.md`](docs/01-requirements.md) | المتطلبات والقرارات الوظيفية |
| [`docs/02-tech-stack.md`](docs/02-tech-stack.md) | الستاك التقني والتوصيات |
| [`docs/03-design-reference.md`](docs/03-design-reference.md) | قياسات الريفيرنس التصميمي |
| [`docs/05-project-structure.md`](docs/05-project-structure.md) | بنية الكود والتقنيات |
| [`docs/06-deployment.md`](docs/06-deployment.md) | النشر على السيرفر + الربط بـ SQL Server + الأداء |
| [`docs/07-database.md`](docs/07-database.md) | قواعد قاعدة البيانات وخطة المحرّكين |
| [`docs/09-structure.md`](docs/09-structure.md) | قواعد الاستراكشر — اقرأها قبل إضافة أي صفحة |

## البنية

```
Eduspace/
├── AGENTS.md                 # ذاكرة المشروع (تُقرأ تلقائيًا في كل جلسة)
├── RUN-ON-SQL-SERVER.sql     # مخطط SQL Server: ملف واحد يعمل Run (مُستخرَج من schema.sql)
├── apps/
│   ├── web/                  # الواجهة (Vite + React + TypeScript)
│   └── api/                  # الباك اند (ASP.NET Core + EF Core + SignalR)
├── packages/shared-types/    # أنواع مشتركة
├── database/schema.sql       # المصدر الوحيد للجداول (Supabase + SQL Server في ملف واحد)
├── deploy/                   # nginx + systemd + coturn + النسخ الاحتياطي + run.sh
├── tools/                    # أدوات قياس حقيقية (verify-*.py، loadtest، edge-proxy)
└── docs/                     # كل التوثيق + صور الريفيرنس + لقطات الشاشة
```

## التقنيات

**الواجهة:** React 19 · TypeScript 6 · Vite 8 · i18next · lucide-react · CSS Modules + Design Tokens
**الخادم:** ASP.NET Core (.NET 10) · EF Core · SignalR · WebRTC (STUN/TURN) · SQL Server أو Supabase

---

© 2026 Nile Techno by Abdullah Elsawy
