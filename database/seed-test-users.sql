-- ============================================================================
--  EduLink — بيانات تجريبية للاختبار
-- ============================================================================
--
--  ⚠️ هذا ملف **بيانات** وليس مخططًا. لا يُشغَّل على قاعدة الإنتاج.
--     المخطط (الجداول والأعمدة) يبقى في `schema.sql` وحده كما اتفقنا.
--
--  الغرض: إنشاء حسابات للدخول والتجربة فقط.
--
--  كلمة المرور تُجزَّأ بـ bcrypt عبر إضافة pgcrypto في PostgreSQL — والناتج
--  بصيغة $2a$ القياسية التي يفهمها الباك اند (BCrypt.Net) عند التحقق.
--  أما في التشغيل العادي فالتجزئة تتم في **طبقة التطبيق** كما هو معتمد،
--  وهذا الاستخدام هنا للتجربة فقط ولا يُنشئ اعتمادًا على دوال القاعدة.
--
--  التشغيل: Supabase → SQL Editor → الصق الملف → Run
-- ============================================================================

-- pgcrypto موجودة في Supabase — نضمن أن دوال crypt/gen_salt في مسار البحث
SET search_path = public, extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
--  حساب مدرس — role = 0
--  المدرس يستطيع تسجيل الدخول ورؤية اللوحة، لكنه لا يستطيع إضافة مستخدمين
--  (إضافة المستخدمين تحتاج دور «مدير» فأعلى).
-- ============================================================================
INSERT INTO "Edu_Users" (name, email, password, role, states, access, notifications)
VALUES (
    'أحمد محمد',
    'teacher@edulink.test',
    crypt('Teacher@12345', gen_salt('bf', 10)),
    0,   -- 0 = مدرس | 1 = مشرف | 2 = مدير | 3 = أونر
    1,   -- ظاهر
    1,   -- مفعّل (بدون 1 لا يستطيع الدخول إطلاقًا)
    0
)
ON CONFLICT (email) DO UPDATE
    SET password   = EXCLUDED.password,
        role       = EXCLUDED.role,
        states     = 1,
        access     = 1,
        updated_at = now();

-- ============================================================================
--  حساب أونر — role = 3  (مطلوب لإضافة بقية المستخدمين من داخل المنصة)
--  يُنشأ أيضًا من الـ API عبر POST /api/setup/owner عند قاعدة فارغة.
-- ============================================================================
INSERT INTO "Edu_Users" (name, email, password, role, states, access, notifications)
VALUES (
    'مالك المنصة',
    'owner@edulink.test',
    crypt('Owner@12345', gen_salt('bf', 10)),
    3,
    1,
    1,
    0
)
ON CONFLICT (email) DO UPDATE
    SET password   = EXCLUDED.password,
        role       = EXCLUDED.role,
        states     = 1,
        access     = 1,
        updated_at = now();

-- ============================================================================
--  للتحقق بعد التشغيل
-- ============================================================================
-- SELECT id, name, email, role, states, access, created_at FROM "Edu_Users" ORDER BY id;
-- SELECT email, left(password, 7) AS hash_prefix, length(password) AS hash_length FROM "Edu_Users";
--   المتوقع أن يبدأ الهاش بـ $2a$10$ وطوله 60 حرفًا
