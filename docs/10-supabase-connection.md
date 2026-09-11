# ربط Supabase بالمشروع — كيف يقرأ المشروع الداتا بيز

> **السؤال:** إزاي المشروع هيقرا الداتا بيز وإحنا مش رابطينهم؟
> **الجواب:** الرابط بينهم هو **سلسلة الاتصال (Connection String)** — وهي مفتاح الدخول للقاعدة.
> مفيش "ربط" بصري في اللوحة ولا زر «Connect»؛ بيديها سطر واحد فيه العنوان والمستخدم
> وكلمة المرور، والـ API بيفتح بيه اتصال مباشر بقاعدة Postgres في Supabase.

---

## 1) الصورة كاملة — مين بيتكلم مع مين

```
   المتصفح (المستخدم)
        │  http://localhost:5173  →  يمرّر /api عبر بروكسي Vite
        ▼
   الواجهة  apps/web  (React)
        │  نداءات HTTP:  POST /api/auth/login
        ▼
   الـ API  apps/api  (ASP.NET Core)
        │  ← هنا «الربط»: سلسلة الاتصال في appsettings.Development.json
        │    Npgsql يفتح اتصال TCP بقاعدة PostgreSQL
        ▼
   قاعدة البيانات  Supabase (PostgreSQL)
        الجداول: Edu_Users · Edu_Students · Edu_Parents · Edu_Relations
```

**الواجهة لا تتصل بـ Supabase إطلاقًا** — ولا تحتاج مفاتيح Supabase ولا `anon key`.
كل القراءة والكتابة بتمرّ من الـ API، ولذلك قواعد الصلاحيات والتجزئة والتفعيل كلها في مكان واحد.

---

## 2) شكل السلسلة — والمشكلة التي حُلّت

Supabase تعطي السلسلة بصيغة **URI**:

```
postgresql://postgres.<REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres
```

بينما Npgsql (مكتبة PostgreSQL في .NET) موثّق أنه يتوقّع صيغة **key=value**:

```
Host=...;Port=5432;Database=postgres;Username=...;Password=...
```

ولصق صيغة Supabase كما هي كان **يفشل** بخطأ «صيغة سلسلة الاتصال غير صحيحة».

**الحل المنفَّذ:** الكود يحوّل الصيغة تلقائيًا في
`apps/api/Data/ConnectionStringNormalizer.cs` — فتستطيع لصق سلسلة Supabase
**كما هي من اللوحة بلا أي تعديل**، وإن كانت بصيغة key=value تعمل كذلك.

---

## 3) أي سلسلة تختار من Supabase؟ (موصى به)

Supabase تعرض أربع سلاسل. للـ API بتاعنا:

| النوع | المنفذ | متى تستخدمه |
|---|---|---|
| **Shared pooler — Session mode** ⭐ | **5432** | **الأنسب للـ API**: يعمل على IPv4، ويدعم كل المزايا |
| Direct connection | 5432 | جيد لكنه **IPv6 فقط** إلا لو فعّلت إضافة IPv4 — قد يفشل على شبكات كثيرة |
| Shared pooler — Transaction mode | 6543 | للـ serverless/edge. **لا يدعم Prepared statements** ولا حالة الجلسة |
| Dedicated pooler | 6543 | مدفوع |

للتشغيل مرة واحدة من SQL Editor (تشغيل `schema.sql`) **الاتصال المباشر هو المفضّل** كما توصي Supabase.

**الفرق في اسم المستخدم:** الاتصال المباشر يستخدم `postgres`، والـ Shared pooler يستخدم `postgres.<PROJECT-REF>`.

---

## 4) الخطوات (دقيقتان)

### أ) أنشئ الجداول
Supabase → **SQL Editor** → الصق **`database/schema.sql`** كاملًا → **Run**.

### ب) انسخ السلسلة
**Connect** (أو Project Settings → Database) → **Connection string → URI** → استبدل `[YOUR-PASSWORD]` بكلمة سر القاعدة.

### ج) ألصقها في الإعدادات
في `apps/api/appsettings.Development.json` (مستثنى من Git):

```json
"Database": { "Provider": "Postgres", "EnsureCreated": false, "ProbeOnStartup": true },
"ConnectionStrings": {
  "Postgres": "postgresql://postgres.<REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres"
}
```

> `EnsureCreated` لا تأثير له مع Postgres — الإنشاء التلقائي **محجوب في الكود** على SQLite المحلي فقط.

### د) شغّل وتأكّد
```bash
cd apps/api && dotnet run --launch-profile http
```

في الطرفية يجب أن ترى:
```
جهة الاتصال: aws-0-<REGION>.pooler.supabase.com:5432 | المستخدم: postgres.<REF> | القاعدة: postgres
قاعدة البيانات: Postgres — الاتصال ناجح ✓ — عدد المستخدمين: <العدد>
```

ولو ظهر `تعذّر الاتصال ✗` فالسبب في السلسلة أو أن `schema.sql` لم يُشغَّل.

---

## 5) كيف تتأكد أن القراءة من Supabase فعلًا

```bash
curl http://localhost:5279/api/health/db
```

- `provider: "Postgres"` ← الـ API على PostgreSQL لا على SQLite
- `canConnect: true` ← الاتصال ناجح
- `serverVersion` ← نسخة PostgreSQL الحقيقية (في بيئة التطوير)
- `usersCount` ← عدد الصفوف **الحقيقي** في `Edu_Users`

واختبار قاطع: أضف صفًّا من SQL Editor مباشرة، ثم أعد النداء — يجب أن يزيد `usersCount`،
ثم سجّل الدخول بذلك الحساب. نجاح الدخول يثبت أن الـ API قرأ الصف من Supabase نفسها.

---

## 6) أخطاء شائعة وحلولها

| الأعراض | السبب | الحل |
|---|---|---|
| `صيغة سلسلة الاتصال غير صحيحة` | سلسلة URI أُرسلت لـ Npgsql كما هي | لم يعد يحدث — التحويل في الكود |
| `تعذّر الاتصال ✗` مع `canConnect: false` | كلمة مرور خطأ، أو سلسلة ناقصة | راجع السلسلة أو أعد تعيين كلمة سر القاعدة |
| `relation "Edu_Users" does not exist` | `database/schema.sql` لم يُشغَّل | شغّله في SQL Editor |
| الاتصال يفشل من شبكة IPv4 فقط | استُخدم الاتصال المباشر (IPv6) | استخدم **Shared pooler — Session mode** |
| `provider: "Sqlite"` رغم اللصق | `Provider` لم يتغيّر | اجعله `"Postgres"` وأعد التشغيل |
