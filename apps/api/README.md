# Eduspace API — الباك اند

ASP.NET Core Web API (.NET 10) يخدم تطبيق الويب في `../` (مشروع Vite).

> **قاعدة البيانات:** المصدر الوحيد للمخطط هو `../db/schema.sql`. **لا تُستخدم EF Migrations إطلاقًا** — الكيانات تقرأ وتكتب فقط.

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

هذا المسار **يُعطِّل نفسه تلقائيًا**: يعمل فقط إذا كانت قاعدة البيانات بلا أي مستخدم، وبعدها يرجّع `409`.

---

## التحويل إلى Supabase (PostgreSQL)

### 1) أنشئ الجداول
**Supabase → SQL Editor → New query**، والصق محتوى **`database/schema.sql`** كاملًا ثم **Run**.
الملف قابل لإعادة التشغيل بأمان. (اختياري: `database/seed-test-users.sql` لإنشاء حسابات تجريبية.)

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

## نقاط النهاية (Endpoints)

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| `POST` | `/api/setup/owner` | عام (لبناء أول حساب فقط) | إنشاء حساب الأونر الأول |
| `POST` | `/api/auth/login` | عام | تسجيل الدخول — يرجّع التوكن وبيانات المستخدم |
| `GET` | `/api/auth/me` | توكن | بيانات المستخدم الحالي |
| `POST` | `/api/auth/logout` | توكن | إلغاء التوكن |
| `GET` | `/api/users` | مدير فأعلى | قائمة الحسابات (مع `role` و`search` اختياريين) |
| `POST` | `/api/users` | مدير فأعلى | إنشاء حساب (لا يمكن إنشاء دور مساوٍ لدورك أو أعلى) |

### المصادقة

توكن عشوائي يُخزَّن في عمود `token` بجدول `Edu_Users` (كما في تصميم قاعدة البيانات المتفق عليه)، ويُرسل في كل طلب:

```
Authorization: Bearer <token>
```

- تسجيل دخول جديد **يُلغي التوكن القديم** (جلسة واحدة فعّالة لكل مستخدم).
- الحساب الذي `access = 0` **لا يستطيع الدخول إطلاقًا** (يرجّع `403`).
- كلمات المرور تُجزَّأ بـ **bcrypt** في التطبيق — لا يُخزَّن نص صريح في القاعدة أبدًا.

### الأدوار

| القيمة | الدور |
|---|---|
| 0 | مدرس |
| 1 | مشرف |
| 2 | مدير |
| 3 | أونر |

القيمة الأعلى = صلاحية أوسع.

---

## نقاط مفتوحة في الباك اند

1. **لا يوجد تجديد تلقائي للتوكن ولا مدة صلاحية** — التوكن يبقى صالحًا حتى يُلغى بتسجيل دخول جديد أو خروج.
2. **جلسة واحدة لكل مستخدم** — الدخول من أكثر من جهاز يحتاج جدول `Edu_Sessions`.
3. **الدخول برقم الهاتف** غير مدعوم في الخادم بعد (البريد فقط).
4. **Google Sign-In** غير مدعوم بعد.
5. **لا يوجد Rate limiting** على محاولات الدخول.
6. الطلاب وأولياء الأمور لهم جداول في القاعدة لكن لا نقاط نهاية لهم بعد.
