# قاعدة البيانات — EduLink

**`schema.sql` هو الملف الوحيد لكل تغييرات قاعدة البيانات.** لا تُنشأ ملفات migrations منفصلة.

## كيف تشغّل الملف (على Supabase الآن)

1. افتح مشروعك على Supabase.
2. من القائمة الجانبية: **SQL Editor** → **New query**.
3. الصق محتوى `schema.sql` **كاملاً**.
4. اضغط **Run**.

الملف قابل لإعادة التشغيل بأمان — كل عبارة محميّة بـ `IF NOT EXISTS` / `DROP IF EXISTS`، فتشغيله أكثر من مرة لا يخطئ ولا يمسح بيانات.

## القواعد الإلزامية

| القاعدة | التفصيل |
|---|---|
| **ملف واحد** | كل جدول أو عمود أو فهرس جديد يُضاف إلى `schema.sql` في قسم «إضافات جديدة». الملف تراكمي ولا يُحذف منه شيء. |
| **قابل لإعادة التشغيل** | كل عبارة جديدة تُكتب محميّة: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. |
| **اسم الجدول** | يبدأ بـ `Edu_` ثم اسم الجدول: `Edu_Users`, `Edu_Sessions`, `Edu_Notifications` ... |
| **سبب التسمية بحالة أحرف** | الأسماء بين علامتي تنصيص `"Edu_Users"` للحفاظ على `PascalCase` كما ستكون على SQL Server. |

⚠️ بسبب التنصيص، اكتب الأسماء دائمًا بين علامتي تنصيص في PostgreSQL:

```sql
SELECT * FROM "Edu_Users";   -- ✅ صحيح
SELECT * FROM Edu_Users;     -- ❌ يبحث عن جدول باسم edu_users
```

## التشغيل على SQL Server (مُجرَّب — 2026-09-30)

قسم SQL Server كامل في آخر `schema.sql` بين علامتي `>>> BEGIN SQL SERVER` و`<<< END SQL SERVER`، **مُعلَّق بين `/*` و`*/`** حتى يُلصق الملف كله على Supabase بلا خطأ. للاستخراج والتشغيل من جذر المستودع:

```bash
sed -n '/^-- >>> BEGIN SQL SERVER/,/^-- <<< END SQL SERVER/p' database/schema.sql \
  | grep -v '^/\*$' | grep -v '^\*/$' > edulink-sqlserver.sql

sqlcmd -S "SERVER,1433" -U sa -P "PASSWORD" -Q "CREATE DATABASE [Edulink]"
sqlcmd -S "SERVER,1433" -U sa -P "PASSWORD" -d Edulink -f 65001 -I -b -i edulink-sqlserver.sql
```

| العلم | لزم لأنه |
|---|---|
| `-f 65001` | يقرأ الملف UTF-8؛ بدونه تتحوَّل النصوص العربية إلى `?` عند الإدراج |
| `-I` | يفعّل `QUOTED_IDENTIFIER` — بدونه تُرفض الفهارس المفلترة (خطأ 1934) |
| `-b` | يُرجع كود خطأ عند فشل أي عبارة؛ بدونه يكمّل بصمت وتُبنى قاعدة ناقصة |

أو من **SSMS**: انسخ السطور بين `>>> BEGIN` و`<<< END` (عدا سطري `/*` و`*/`) → Execute.

**الملف تراكمي:** شغّلته مرتين على نفس القاعدة ⇒ صفر أخطاء في المرتين.

## النسخ الاحتياطي واختبار الاستعادة

الملفان في `deploy/`: **`backup.sql`** (نسخة كاملة + `CHECKSUM` + بصمة المخطط داخل وصف
النسخة) و**`restore-drill.sql`** (يستعيد لأحدث نسخة في قاعدة ظل ويقارن البصمة).
**النسخ وحده ليس دليلًا:** الدليل أن يخرج الـ drill بصفر — ومع `StrictLive=1` يثبت أن
النسخة تكفي لإعادة مخطط اليوم. الجدولة بمهمة SQL Agent، أو Task Scheduler على Express
(بلا Agent). التفاصيل والأرقام المقيسة: `docs/11-production-deployment.md` §9.

**بصمة التحقق بعد التشغيل** (قياس فعلي على قاعدة نظيفة):

```
tables=11 · triggers=0 · checks=21 · foreign_keys=9 · unique_keys=8 · defaults=43
```

ولا تُنشئ أي بيانات: أول حساب مالك من `POST /api/setup/owner` (وكلمات المرور تُجزَّأ bcrypt في التطبيق).

> الفروق المقصودة بين المحرّكين (بلا تريجرات، `token` بحجم 200 لا `MAX`، مسار حذف واحد لـ `makeupOfId`) مشروحة في `docs/07-database.md` §2-ب.

## جداول موجودة

| الجدول | الوصف |
|---|---|
| `Edu_Users` | **موظفو المنصة**: المدرسون والمشرفون والمديرون والأونر — مع `role` والتفعيل والظهور والتوكن والصورة والإشعارات |
| `Edu_Students` | **الطلاب** — نفس أعمدة الحساب بدون `role` |
| `Edu_Parents` | **أولياء الأمور** — نفس أعمدة الطلاب تمامًا |
| `Edu_Relations` | **جدول الربط** بين الطالب وولي الأمر (علاقة متعدد لمتعدد) |
| `Edu_Sessions` | **الحصص** — كود الغرفة `code`، المادة نص حر، الحالة والحضور والأوقات (UTC) |
| `Edu_SessionAttendance` | **حضور فعلي لكل طالب في حصة** — انضمام الغرفة يسجّله آليًا (`joinedAt`/`leftAt`/`durationMs`) |
| `Edu_Notifications` | **إشعار موجّه** لحساب: `recipientKind` (staff/student/parent) + `recipientId` + `read_at` |
| `Edu_Conversations` | **رأس خيط مراسلة** (`subject` + التوقيتات) |
| `Edu_ConversationMembers` | **أعضاء الخيط** + `last_read_at` لحساب غير المقروء |
| `Edu_Messages` | **الرسائل** داخل الخيط (مرسِل ونص ووقت) |
| `Edu_Tokens` | **جلسات الدخول** — صف لكل جهاز (`kind` + `accountId` + `token`)، الحد 10 لكل حساب |

**أعمدة الحساب الثلاثة** (`Edu_Users` / `Edu_Students` / `Edu_Parents`) — بنفس الترتيب:
`id` · **`name`** · `email` · `password` · (`role` في Users فقط) · `token` · `states` ·
`access` · `img_url` · `notifications` · `created_at` · `updated_at`

خريطة `role` في `Edu_Users`: **0 = مدرس · 1 = مشرف · 2 = مدير · 3 = أونر**

**معنى عمود `notifications`:** هل **إنشاء هذا السجل تحديدًا** أُرسل كإشعار للكل أم لا
(`0` = لا · `1` = نعم). وهو **ليس** إشعارات موجّهة لصاحب الحساب.

> ⚠️ جدول الربط `Edu_Relations` **ليس فيه عمود `name`** — فهو جدول ربط لا كيان له اسم.

## كيف يُربط الطالب بولي الأمر

العلاقة **متعدد لمتعدد**، فلها جدول ربط مستقل `Edu_Relations`:

```
Edu_Students ──< Edu_Relations >── Edu_Parents
```

| عمود الربط | المعنى |
|---|---|
| `student_id` | الطالب (مفتاح خارجي) |
| `parent_id` | ولي الأمر (مفتاح خارجي) |
| `relation` | `0` = أب · `1` = أم · `2` = وصي · `3` = أخرى |
| `is_primary` | `1` = ولي الأمر الأساسي — **واحد فقط لكل طالب** |
| `states` | `0` = الرابط موقوف · `1` = فعّال |

قيد `UNIQUE (student_id, parent_id)` يمنع تكرار نفس الربط مرتين، وفهرس فريد جزئي يضمن ولي أمر أساسي واحد فقط لكل طالب.
