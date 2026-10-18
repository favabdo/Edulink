# Eduspace API — الباك اند

ASP.NET Core Web API (.NET 10) يخدم تطبيق الويب في `../` (مشروع Vite).

> **قاعدة البيانات:** المصدر الوحيد للمخطط هو **`database/schema.sql`** في جذر المستودع (قسم PostgreSQL في الأعلى، وقسم SQL Server في آخره). **لا تُستخدم EF Migrations إطلاقًا** — الكيانات تقرأ وتكتب فقط.

---

## التشغيل محليًا

```bash
cd api
dotnet run --launch-profile http
```

يعمل على `http://localhost:5279`، وتطبيق الويب يمرّر إليه `/api` تلقائيًا عبر بروكسي Vite (في `vite.config.ts`) فلا نحتاج CORS في التطوير.

في التطوير المحلي يُستخدم **SQLite** (`eduspace.dev.db`) ويُنشئ التطبيق جداوله من نموذج الكيانات تلقائيًا. الملف غير مُتتبَّع بـ Git.

### إنشاء أول حساب (الأونر)

لا يوجد تسجيل ذاتي. لإنشاء أول حساب:

```bash
curl -X POST http://localhost:5279/api/setup/owner \
  -H "Content-Type: application/json" \
  -d '{"name":"مالك المنصة","email":"owner@edulink.test","password":"Owner@12345"}'
```

⚠️ **على Windows/Git Bash لا تُرسل العربية في سطر الأوامر** — `curl` يحوِّل الوسائط إلى cp1252 فتُخزَّن `Name` كلها `?` (مقيس: `-d '{"name":"طالب ألفا"}'` أنتجت «???? ????» في القاعدة، بينما نفس النص من ملف وصل سليمًا). الصيغة الآمنة على النظامين — والجسم من ملف UTF-8:

```bash
printf '{"name":"مالك المنصة","email":"owner@edulink.test","password":"Owner@12345"}' > owner.json
curl -X POST http://localhost:5279/api/setup/owner \
  -H "Content-Type: application/json" --data-binary @owner.json
```

`deploy/run.sh` يستخدم هذه الصيغة نفسها في خطوة المالك.

هذا المسار **يُعطِّل نفسه تلقائيًا**: يعمل فقط إذا كانت قاعدة البيانات بلا أي مستخدم، وبعدها يرجّع `409`.

---

## التحويل إلى Supabase (PostgreSQL)

### 1) أنشئ الجداول
**Supabase → SQL Editor → New query**، والصق محتوى **`database/schema.sql`** كاملًا ثم **Run**.
الملف قابل لإعادة التشغيل بأمان.

### 2) هات سلسلة الاتصال
**Supabase → Project Settings → Database → Connection string → URI**:

```
postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

### 3) اضبط الإعدادات
أسهل طريقة للتطوير المحلي: ملف **`apps/api/appsettings.Development.json`** (مستثنى من Git):

```json
{
  "Database": { "Provider": "Postgres", "EnsureCreated": false },
  "ConnectionStrings": {
    "Postgres": "Host=aws-0-<region>.pooler.supabase.com;Port=6543;Database=postgres;Username=postgres.<ref>;Password=<PASSWORD>;SSL Mode=Require;Trust Server Certificate=true"
  }
}
```

⚠️ **`EnsureCreated=false` مهم:** التطبيق لا ينشئ ولا يعدّل أي جدول — المخطط من `database/schema.sql` فقط.

### 4) تأكّد أن الـ API يقرأ من Supabase فعلًا

```bash
curl http://localhost:5279/api/health/db
```

يجب أن يظهر `"provider":"Postgres"` و`"canConnect":true` مع `usersCount` بالعدد الحقيقي،
وفي بيئة التطوير `serverVersion` بنسخة PostgreSQL — إثبات مباشر أن القراءة من القاعدة.

### 5) اختبار كامل يثبت أن الـ API يقرأ من القاعدة

1. أضف صفًّا **من SQL Editor مباشرة** (لا من الـ API):
   ```sql
   INSERT INTO "Edu_Users" (name, email, password, role, states, access)
   VALUES ('مدرس تجريبي', 'from-sql@edulink.test', crypt('Teacher@12345', gen_salt('bf', 10)), 0, 1, 1);
   ```
2. `curl http://localhost:5279/api/health/db` → لاحظ أن `usersCount` زاد.
3. سجّل الدخول بهذا الحساب ← نجاح الدخول يثبت أن الـ API قرأ الصف من القاعدة الحقيقية.
4. غيّر `access` إلى `0` في Supabase وأعد المحاولة → يجب أن تُرفض بـ **403**.

---

## التحويل إلى SQL Server (سيرفر الشركة)

### 1) أنشئ القاعدة وشغّل المخطط (ملف واحد يعمل Run)

الملف المُسلَّم: **`RUN-ON-SQL-SERVER.sql`** (في جذر المستودع، ونسخة منه `deploy/EduLink-SQLServer-ascii.sql`) — قسم T-SQL من `database/schema.sql` مع ترويسة `CREATE DATABASE` + `USE`. مُهيّأ لـ **SQL Server 2014**: لا `CREATE OR ALTER` ولا `DROP … IF EXISTS` ولا `FOR JSON` ولا تريجرات.

**لا تلصق المخطط يدويًا في SSMS — شغّله بالملف مباشرة:** اللصق اليدوي هو ما أوقع جولة `Msg 156/102/178/111` كاملة، لأن الملصوق كان قسم PostgreSQL من `schema.sql` (993 سطرًا بصيغة `CREATE TABLE IF NOT EXISTS` و`TEXT` و`RETURN NEW`) لا قسم T-SQL:

```bash
sqlcmd -S "SERVER,1433" -U sa -P "PASSWORD" -f 65001 -I -b -i RUN-ON-SQL-SERVER.sql
```

`-f 65001` يقرأ العربية UTF-8، و`-I` يلزم الفهارس المفلترة، و`-b` يوقف الصمت عند الخطأ. الملف تراكمي: تشغيله ثانية يعطي صفر أخطاء.

> **لتوليد الملف بعد أي تغيير مخطط:** عدّل `database/schema.sql` (الملف الوحيد للجداول) ثم استخرج قسم T-SQL بالأمر نفسه المستخدم في `deploy/run.sh`:
> ```bash
> sed -n '/^-- >>> BEGIN SQL SERVER/,/^-- <<< END SQL SERVER/p' database/schema.sql \
>   | grep -v '^/\*$' | grep -v '^\*/$' > RUN-ON-SQL-SERVER.sql
> ```

### 2) ملف الربط: `apps/api/.env`

المنصة تقرأ الربط من ملف **`apps/api/.env`** (مستثنى من Git — السطر 27 في `.gitignore`) يحلّه `Configuration/DotEnv.cs` قبل بناء التطبيق، **ومتغيّرات البيئة الحقيقية أعلى أولوية منه** فلا يُلغي إعدادًا مضروبًا من `deploy/run.sh` أو systemd. القالب الكامل في `apps/api/.env.example`؛ المطلوب منك سطر واحد — كلمة السر:

```ini
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://localhost:5279

Database__Provider=SqlServer
ConnectionStrings__SqlServer=Server=nile-server.com,1433;Database=nile-old;User ID=sa;Password=REPLACE_WITH_SA_PASSWORD;Encrypt=True;TrustServerCertificate=True;MultipleActiveResultSets=True

Network__UseForwardedHeaders=true
Network__ForwardedHeadersLimit=1
Meeting__TurnUrls__0=
Meeting__TurnSecret=
Meeting__TurnTtlSeconds=86400
```

- **`ASPNETCORE_URLS` إلزامي هنا:** بدونه لا يربط Kestrel على 5279 فتبدو كل نداءات `curl` فاشلة (`000`) كأن الـ API مات — وهو فخّ مقيس.
- المنفذ بفاصلة `Server=...,1433` (لا نقطتان).
- **التشفير — مقيس من هذا الجهاز على `nile-server.com,1433` (2026-10-18):** بـ **`Encrypt=True;TrustServerCertificate=True`** تمت مصافحة TLS بنجاح ووصل الـ API إلى التحقق من الدخول؛ الفشل الوحيد كان `Error 18456, State:1 — Login failed for user 'sa'` (كلمة السر). **فلا حاجة إلى إطفاء التشفير** مع هذا السيرفر. أما موثّق ما سبق («السائق يرفض المصافحة») فلم أُعِده اليوم ولا أعرف أي تركيبة أخرجته تحديدًا — والتركيبة التي تستخدم `Encrypt=True` **بلا** `TrustServerCertificate` على شهادة غير موثوقة **لم أختبرها**، فلا تُبنى عليها قرارات.
  ⚠️ **ما لا يضمنه هذا:** `TrustServerCertificate=True` = تشفير **بلا تحقّق من هوية السيرفر**، فالمسار محمي من القراءة لا من الانتحال. واللوج يطبع `The negotiated TLS 1.0 is an insecure protocol` — أي أن السيرفر يخدم TLS 1.0؛ الصواب عند التسليم: تفعيل **TLS 1.2** على السيرفر + شهادة موثوقة، ثم `Encrypt=True;TrustServerCertificate=False`. الـ API لا يضيف أيًّا من العلمين تلقائيًا، و`appsettings.json` يبقى بلا سرّ.
- لا يُنشئ الـ API أي جدول: المخطط من `schema.sql` وحده (`EnsureCreated` يعمل على SQLite المحلي فقط).

### 3) شغّل وتحقّق

```bash
cd apps/api && dotnet run -c Release            # يقرأ apps/api/.env تلقائيًا
curl http://localhost:5279/api/health/db
```

`"provider":"SqlServer"` و`"canConnect":true` و`serverVersion` بنسخة SQL Server. **مقيس (2026-10-02)** على قاعدة محليّة باسم `nile-old` أُنشئت من `RUN-ON-SQL-SERVER.sql` وحده: `canConnect:true` ⇒ `POST /api/setup/owner` بـ **200** ⇒ دخول المالك ⇒ `/api/auth/me` و`/api/students` بـ **200**، والقراءة الخلفية تعطي `LEN=11 · DATALENGTH=22 · qmark=0` (عربية الاسم حرفية) وبادئ تجزئة `$2a$11$`.

### فرق سلوكية تخصّ هذا الـ API

| الفرق | السبب |
|---|---|
| `updated_at` يضبطه `EduDbContext.SaveChangesAsync` (لا تريجر) | أي تريجر مُفعَّل يجعل الحفظ يفشل: EF يرسل `INSERT ... OUTPUT INSERTED.id` والمحرّك يرفضه على جدول له تريجر (خطأ 334) |
| أعمدة `token` = `NVARCHAR(200)` | لا فهرس على عمود `MAX`، والتوكن يُبحث عليه بالمساواة في كل طلب (طوله الفعلي 43) |
| حذف حصة مرجعية (تسوية) يدوي | `makeupOfId` مفتاحه `NO ACTION` لأن SQL Server يرفض تعدد مسارات `CASCADE` (خطأ 1785) |

---

## نقاط النهاية (Endpoints)

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| `POST` | `/api/setup/owner` | عام (لبناء أول حساب فقط) | إنشاء حساب الأونر الأول |
| `POST` | `/api/auth/login` | عام | دخول موظفي المنصة (Edu_Users) |
| `POST` | `/api/auth/students/login` | عام | دخول الطلاب (Edu_Students) — الواجهة تجرّبه تلقائيًا عند فشل دخول الموظفين |
| `GET` | `/api/auth/me` | توكن | بيانات الحساب الحالي (موظف أو طالب) |
| `POST` | `/api/auth/logout` | توكن | إلغاء التوكن |
| `GET` | `/api/users` | مشرف فأعلى | قائمة حسابات الموظفين — المشرف يرى المدرسين فقط |
| `POST` | `/api/users` | مشرف فأعلى | إنشاء حساب موظف (لا دور مساوٍ لدورك أو أعلى) |
| `PATCH` | `/api/users/{id}` | مشرف فأعلى | اسم/دور/`states`/`access`/تصفير كلمة المرور — المشرف يدير المدرسين فقط، والمدير من هم أدنى منه، ولا يغيّر أحد دور حساب نفسه |
| `GET` | `/api/students` | موظف | قائمة الطلاب — **المدرس: طلاب حصصه فقط** |
| `GET` | `/api/students/{id}` | موظف (أو الطالب نفسه) | تفاصيل طالب — **المدرس خارج حصصه ⇒ 403** |
| `POST` | `/api/students` | مشرف فأعلى | إضافة طالب |
| `PATCH` | `/api/students/{id}` | مشرف فأعلى | تعديل اسم/`states`/`access`/كلمة مرور طالب |
| `GET` | `/api/sessions` | توكن | الحصص — المدرس حصصه، الطالب حصصه، الإدارة الكل |
| `POST` | `/api/sessions` | **مشرف فأعلى** | إنشاء حصة لأي مدرس/طالب (كود غرفة فريد تلقائيًا) — المدرس يُرفض 403 |
| `GET` | `/api/sessions/{id}` | التوكن المناسب | حصة + سجل حضورها |
| `PATCH` | `/api/sessions/{id}` | موظف | تغيير حالة الحصة — المدرس في حصته فقط، والإلغاء للإدارة |
| `POST` | `/api/sessions/{id}/cancel` | **مشرف فأعلى** | إلغاء مع سبب (قرار إداري) |
| `POST` | `/api/sessions/{id}/reschedule` | **مشرف فأعلى** | تأجيل حصة مجدولة (`startsAt`, `durationMin?`) — يرفض الماضي والتعارض على الخادم ويُشعر الطالب وأولياءه والمدرس |
| `POST` | `/api/sessions/{id}/end` | مدرس حصته / إدارة | إنهاء + حفظ الغياب وملخص metadata — **يجب إرسال جسم JSON ولو `{}`** مع `Content-Type: application/json`، وإلا يرجّع `415` |
| `POST` | `/api/sessions/{id}/attendance` | توكن | تسجيل حضور (الطالب لنفسه فقط) |
| `POST` | `/api/sessions/{id}/attendance/{studentId}/leave` | توكن | تسجيل مغادرة (الطالب لنفسه فقط) |
| `GET` | `/api/sessions/stats` | توكن | إحصائيات ساعات/التزام (الطالب: نفسه فقط · **المدرس: حصصه فقط — أي `teacherId` آخر يتجاهله الخادم**) |
| `GET` | `/api/reports/overview` | **مشرف فأعلى** | إحصائيات المؤسسة: `?from&to` (unix ms، default 90 يومًا) `&teacherId&studentId&gradeKey&subject` ← `{range, filters, totals, previous, teachers[], students[], subjects[], grades[], weekly[], weekdayHours[], alerts[]}` — النسب `0..100` |
| `GET` | `/api/reports/teachers/{id}` | **مشرف فأعلى** | بطاقة مدرس داخل الفترة نفسها (طلابُه، حضوره، تأخّر البداية، القادم) |
| `POST` | `/api/auth/parents/login` | عام | دخول ولي الأمر (Edu_Parents) |
| `GET` | `/api/parents` | موظف | قائمة أولياء الأمور مع أبنائهم — **المدرس: أولياء أمور طلاب حصصه فقط** (تُصفّى روابط الأبناء أيضًا، لا 403، حتى يعمل عمود «ولي الأمر» في شاشته) |
| `POST` | `/api/parents` | مشرف فأعلى | إنشاء ولي أمر — الربط الاختياري بـ **`studentId` + `relation`** في الجسم؛ الجسم **لا يملك حقل `children`** (يظهر في الاستجابة فقط)، وأي خاصية أخرى تُتجاهل بصمت من JSON binding، فللربط المتعدد استخدم `POST /api/parents/{id}/link` — بريد مكرّر يرجّع `409` |
| `PATCH` | `/api/parents/{id}` | مشرف فأعلى | تعديل اسم/`states`/`access`/كلمة مرور ولي أمر |
| `POST` | `/api/parents/{id}/link` | مشرف فأعلى | ربط طالب |
| `DELETE` | `/api/parents/{id}/link/{studentId}` | مشرف فأعلى | فك ربط |
| `GET` | `/api/parents/children?mine=1` | ولي الأمر (أو موظف بـ ?student=) | الأبناء وحصصهم — **المدرس: بطالب من حصصه فقط، وأي معرّف آخر ⇒ 403** |
| `GET` | `/api/notifications` | توكن | إشعارات الحساب (unreadOnly/take) |
| `POST` | `/api/notifications/{id}/read` · `/read-all` | توكن | تعليم مقروء |
| `GET` | `/api/messages/conversations` | توكن | صندوق الوارد |
| `GET` | `/api/messages/conversations/{id}` | أطراف الخيط | الرسائل + تعليم مقروء |
| `POST` | `/api/messages/send` | توكن | إرسال/بدء خيط (القواعد سيرفرية: طالب↔مدرّسه، ولي↔مدرّسي أبنائه، موظف↔الكل) |
| `GET` | `/api/meeting/ice` | توكن | قائمة ICE (STUN + TURN بتوقيع مؤقت إذا ضُبط السر) |
| `WS` | `/hubs/meetings?access_token=…&room=…` | توكن | غرفة الحصة — الدور يُحدَّد من القاعدة، والانضمام يسجّل الحضور |
| `GET` | `/api/health/db` | عام | حالة الاتصال بالقاعدة |

### المصادقة

توكن عشوائي 256-bit يمثّل **جلسة جهاز واحد** ويُخزَّن في `Edu_Tokens` (kind = staff/student/parent)، ويُرسل في كل طلب:

```
Authorization: Bearer <token>
```

- **الدخول من أكثر من جهاز مسموح** (حد 10 جلسات للحساب؛ الأقدم يُلغى تلقائيًا). تسجيل الخروج يُلغي جلسة الجهاز الحالي فقط.
- عمود `token` في جداول الحسابات = آخر توكن منشأ (عرض/توافق فقط؛ الصلاحية تُقرأ من `Edu_Tokens`).
- الحساب الذي `access = 0` **لا يستطيع الدخول إطلاقًا** (يرجّع `403`).
- كلمات المرور تُجزَّأ بـ **bcrypt** في التطبيق — لا يُخزَّن نص صريح في القاعدة أبدًا.

### الأدوار

| القيمة | الدور |
|---|---|
| 0 | مدرس |
| 1 | مشرف |
| 2 | مدير |
| 3 | أونر |

القيمة الأعلى = صلاحية أوسع. الطالب `role = -1` وولي الأمر `role = -2` مع claim `edu:aud` (staff/student/parent).

**مصفوفة الصلاحيات (قرار صاحب المشروع — الخطوة 26):** القرار يُتَّخذ هنا في الخادم، والواجهة تُخفي الأزرار وفق نفس الحارس (`lib/roles.ts`) ولا يُعتمد على الإخفاء وحده.

| الدور | حصص | حسابات | إحصائيات |
|---|---|---|---|
| **مدرس (0)** | ينفّذ حصصه فقط: دخول الغرفة، إنهاء، حضور. **لا** إنشاء/إلغاء/تأجيل | لا شيء | `GET /api/sessions/stats` لنفسه |
| **مشرف (1)** | جدولة/إلغاء/تأجيل لأي مدرس وطالب | تكويد طلاب/أولياء أمور + إدارة **حسابات المدرسين فقط** | كونسول الإدارة `/api/reports/*` |
| **مدير (2)** | مثل المشرف | إدارة من هم أدنى منه (مشرفون ومدرسون) | مثل المشرف |
| **أونر (3)** | مثل المشرف | كل شيء | كل شيء |

### حسابات ومواد

- **`states`** في `Edu_Users`/`Edu_Students`/`Edu_Parents`: 0 = غير ظاهر، 1 = ظاهر. أي حساب يُنشأ من الواجهة يُخزَّن بـ `states=1` (ما تُنشئه الإدارة ظاهر بطبيعته)، والتسجيل يُتحقق من `access=1` فقط.
- **`subject`** في `Edu_Sessions` نص حر بطبيعته (VARCHAR) — لا توجد قائمة مواد مغلقة، لأن المنصة تُباع لمؤسسات بقوائم مختلفة. الواجهة تعرض الاسم الحرفي لأي مادة خارج المواد الخمس المعروفة.

---

## نقاط مفتوحة في الباك اند

1. **لا مدة صلاحية للتوكن** — الجلسة تُلغى بالخروج أو عند تجاوز حد الأجهزة؛ لا تجديد تلقائي. (موثّق في `docs/11` قائمة ما قبل التسليم)
2. ~~جلسة واحدة لكل مستخدم~~ — **مُطبَّق**: `Edu_Tokens` يجلس لكل جهاز (حد 10، الأقدم يُلغى) للموظف والطالب وولي الأمر.
3. **الدخول برقم الهاتف** غير مدعوم في الخادم بعد (البريد فقط).
4. **Google Sign-In** غير مدعوم بعد.
5. ~~لا يوجد Rate limiting~~ — **مُطبَّق بثلاث حصص من `RateLimit:*`**: الدخول `LoginPermitPerMinute=120` لكل IP، وباقي `/api` `ApiPermitPerMinute=600` لكل جلسة (والمجهول بالـ IP)، واتصالات الغرف `/hubs` `HubPermitPerMinute=3000` **لكل جهاز** (مفتاحه `access_token`)، **وقفل لكل حساب** بعد `LoginFailuresPerAccount=8` محاولات داخل `LoginLockoutMinutes=5` (`LoginAttemptTracker`، يرفض `429 + Retry-After` حتى بالكلمة الصحيحة أثناء القفل). **خلف nginx يجب** `Network:UseForwardedHeaders=true` مع تحديد الوسيط، وإلا تُحسب المؤسسة كلها IPًا واحدًا — التفاصيل والقياس في `docs/11` §6. **والحارس الفعلي ضد التزوير هو `Network:ForwardedHeadersLimit`** (= عدد الوسائط المأمونة: 1 لخطة `deploy/nginx.conf`، 2 فقط خلف CDN): به تُقرأ القيمة التي أضافها الوسيط وحدها، فيبقى تزوير `X-Forwarded-For` بلا أثر — `python tools/verify-xff-spoof.py green` يقيس ذلك (حدّ 1 ⇒ 429 عند المحاولة 121 رغم ترويسة مزوَّرة مختلفة كل مرة؛ حدّ 4 ⇒ صفر 429 أي الحدّ متجاوَز).
6. ~~الطلاب وأولياء الأمر بلا نقاط نهاية~~ — **مُطبَّق**: دخول/عزل/حضور للطلاب، ودخول/أبناء/ربط لأولياء الأمور، ورسائل وإشعارات للأدوار الثلاثة (`docs/11` §6).
7. **إعداد الخطة الباردة (`GET /api/meeting/ice`، يتطلب توكنًا):** يعيد `iceServers`؛ ومع `Meeting:TurnSecret` يوقّع لكل مستخدم `username = "<unix expiry>:<userId>"` (القيمة **مطلقة** لا مدة) و`credential = base64(HMAC-SHA1(secret, username))` — نفس ما يفحصه coturn بوضع `use-auth-secret`. لا أسرار ثابتة في المتصفح، والتوكن ينتهي بعد `Meeting:TurnTtlSeconds` (افتراضي 86400). **مقيس بـ** `python tools/verify-ice-turn.py green` (إعادة حساب مستقلة للتوقيع + صيغة username + العمر = TTL + `401` بلا توكن) و`red` لإثبات أن الفحص يرفض عند اختلاف السرّ؛ و`deploy/run.sh` يشغّلها ويقاطع `Meeting__TurnSecret` مع `static-auth-secret` في `deploy/turnserver.conf`. إن تعذّرت قراءة الإعداد لا تسقط الواجهة بصمت: تعرض تنبيهًا أن الغرفة تعمل بـ STUN العام فقط.
8. **عقد الانضمام في الغرفة (`join`):** الوسيط `participantRole` الذي يرسله المتصفح **لا يُقرأ للترخيص إطلاقًا** — الخادم يحسب الدور من القاعدة (طالب الحصة = `student`، ولي الأمر المرتبط = `observer`، مدرّس الحصة = `teacher`، وكل من `supervisor` فأعلى = `observer`، وغير هؤلاء `HubException`). و`RoomInfo` المُرجعة **تحتوي الآخرين فقط** (لا نفس المشارك)، فالدور المحسوب لا يُقرأ من نتيجة `join` بل يصل بقية الغرفة من رسالة `peer-joined` التي يكتبها الخادم بنفسه؛ وكل تطبيق داخلي (إنهاء الحصة، الحالة، الحضور) يستخدم الدور المحسوب المخزَّن على الاتصال. `tools/hub-through-proxy-check.mjs` يقيس الاتجاهين: مطالعة `'teacher'` من مالك ⇒ `'observer'`، ومطالبة `'student'` من مدرّس الحصة ⇒ `'teacher'`.
9. **إبطال الجلسات عند تغيير كلمة السر — غير مطبَّق (مقيس 2026-10-01):** `PATCH /api/users/{id}` (ومسارا الطالب وولي الأمر) يستبدل تجزئة كلمة السر وحدها، وصفوف `Edu_Tokens` لذلك الحساب تبقى كما هي، والتوكن لا ينتهي بالزمن ⇒ **جهاز مسجَّل دخولًا قبل التغيير يبقى يعمل** حتى الخروج أو بلوغ حدّ 10 أجهزة. عند التسليم: دوِّر كلمات السر ثم `DELETE FROM dbo.[Edu_Tokens];` (أو بـ `userId`) واختبر دخولًا حقيقيًا من كل جهاز. جعل ذلك أوتوماتيكيًا قرار مؤجَّل من صاحب المشروع. **والخطوة البديلة مُثبتة:** بعد `DELETE FROM dbo.[Edu_Tokens];` رجع التوكن القديم **401** على `/api/auth/me` (كان 200 قبله). و`tools/verify-default-credentials.py` بوابة آلية تقيس البند: تخرج 1 إن قبل النظام أي كلمة افتراضية موثّقة (كشفت 24 حسابًا على قاعدة مزروعة)، و0 بعد التدوير — موصولة في خطوة الحالة بـ`deploy/run.sh`.
10. **البريد/Push للإشعارات** غير مُنفَّذ — `Edu_Notifications` داخلي فقط.
11. **بصمات بيانات التطوير تُقاس قبل التسليم (`tools/verify-no-dev-data.py`):** لا تعتمد على عدد صفوف، بل تقرأ بريد الزرع من `apps/api/seed_dev.py` (وتُوسّع سلسلة `seed.student{i:02d}@…` المُولَّدة من نص المصدر) ثم تعدّ `/api/users|students|parents` وتخرج **1** على أي حساب مزروع أو أي بريد `@edulink.test` عدا بريد من شغّل الفحص. **مقيس (2026-10-01):** على قاعدة LocalDB مزروعة (`users=8 · students=12 · parents=4 · sessions=80 · notifications=403`) كشفت **23 بصمة** وخرجت 1؛ وبعد الحذف بالترتيب الذي أُقرأ من `sys.foreign_keys` (لا ترتيبًا مُخمَّنًا — `Edu_Sessions` مقيدة بـ `Edu_Users` و`Edu_Students`، و`Edu_Relations` بـ `Edu_Students` و`Edu_Parents`، بينما `Edu_Notifications`/`Edu_Tokens` بلا قيود فتُحذف للوقاية من اليتيم) صارت `users=1` والبقية صفرًا فخرجت **0**. تعذّر الدخول (`401`) أو أصل غير reachable أو شكل استجابة مجهول ⇒ **خروج 1**، فلا يُحسب «لم أُتحقق» نجاحًا. موصولة في خطوة الحالة بـ`deploy/run.sh`، والإجراء الكامل في `docs/11` §7.
