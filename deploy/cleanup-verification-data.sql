-- ============================================================================
--  EduLink — حذف بصمات أدوات التحقق من قاعدة الإنتاج (خطوة ما قبل التسليم)
-- ============================================================================
--  جولة البوابات في docs/06 §7 تُنشئ حسابات وحصصًا اختبارية بنطاق بريد modelّي
--  (@edulink.test / @tila.test) وحسابات «الوسيط» التي تنشئها أدوات الفحص.
--  وجودها بعد التسليم عيب مُصرَّح به: `tools/verify-no-dev-data.py` يُخرج
--  خروجًا غير صفري على أي بصمة منها، لذلك هذا الملف هو خطوة التصفير الرسمية.
--
--  ⚠️ لا تُشغِّله قبل إتمام الترتيب: تحقق ⇒ هذا الملف ⇒ تدوير كلمات السر +
--     تصفير Edu_Tokens ⇒ إنشاء حسابات المؤسسة الحقيقية ⇒ إعادة البوابتين
--     (verify-default-credentials و verify-no-dev-data) ويجب أن تخرجا بصفر.
--
--  الاستخدام (SQL Server 2014+، من SSMS أو sqlcmd):
--    sqlcmd -S "SERVER,1433" -U <login> -P "<password>" -d <قاعدة المنصة> -I -b \
--           -i deploy/cleanup-verification-data.sql
--
--  -I إلزامية: على جداول Edu_ فهارس مفلترة ترفض QUOTED_IDENTIFIER OFF (Msg 1934).
--  -b يجعل أي خطأ خروجًا غير صفري بدل الصمت، والمعاملة تُرجَع كلها عند الخطأ.
--
--  الترتيب من sys.foreign_keys فعليًا لا من الذاكرة: رسائل → أعضاء المحادثة →
--  المحادثات → الحضور → الحصص → الإشعارات → التوكنات → Relations → أولياء الأمور
--  → الطلاب → الموظفون. صف المالك مُستثنى صراحةً (لا يُحذف ولا يُمَس).
-- ============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
GO

BEGIN TRANSACTION;

-- 0) ما الذي سيُحذف؟ يُطبع أولًا حتى يرى المُشغِّل النطاق قبل أي كتابة.
DECLARE @devDomains TABLE (pattern NVARCHAR(64) NOT NULL PRIMARY KEY);
INSERT INTO @devDomains (pattern) VALUES (N'@edulink.test'), (N'@tila.test');

SELECT N'قبل الحذف' AS step,
       staff   = (SELECT COUNT(*) FROM dbo.[Edu_Users]   u WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE u.[email] LIKE N'%' + d.pattern)),
       students= (SELECT COUNT(*) FROM dbo.[Edu_Students] s WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE s.[email] LIKE N'%' + d.pattern)),
       parents = (SELECT COUNT(*) FROM dbo.[Edu_Parents]  p WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE p.[email] LIKE N'%' + d.pattern));

-- 1) الرسائل ثم أعضاء المحادثة ثم المحادثات — المحادثة «اختبارية» إن كان أحد
--    أعضائها حسابًا على نطاق نموذجي (لا تُخمَّن من عنوانها)
DECLARE @devConv TABLE (id BIGINT NOT NULL PRIMARY KEY);

INSERT INTO @devConv (id)
SELECT DISTINCT cm.[conversationId]
  FROM dbo.[Edu_ConversationMembers] cm
 WHERE (cm.[memberKind] = N'staff'   AND cm.[memberId] IN (SELECT u.[id] FROM dbo.[Edu_Users]   u WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE u.[email] LIKE N'%' + d.pattern)))
    OR (cm.[memberKind] = N'student' AND cm.[memberId] IN (SELECT s.[id] FROM dbo.[Edu_Students] s WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE s.[email] LIKE N'%' + d.pattern)))
    OR (cm.[memberKind] = N'parent'  AND cm.[memberId] IN (SELECT p.[id] FROM dbo.[Edu_Parents]  p WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE p.[email] LIKE N'%' + d.pattern)));

DELETE m FROM dbo.[Edu_Messages] m WHERE m.[conversationId] IN (SELECT id FROM @devConv);
DELETE cm FROM dbo.[Edu_ConversationMembers] cm WHERE cm.[conversationId] IN (SELECT id FROM @devConv);
DELETE c FROM dbo.[Edu_Conversations] c WHERE c.[id] IN (SELECT id FROM @devConv);

-- 2) الحضور ثم الحصص التي لأصحاب النطاق النموذجي (طالب الحصة أو مدرّسها)
DELETE a FROM dbo.[Edu_SessionAttendance] a
 WHERE a.[sessionId] IN (
     SELECT s.[id] FROM dbo.[Edu_Sessions] s
       JOIN dbo.[Edu_Students] st ON st.[id] = s.[studentId]
       LEFT JOIN dbo.[Edu_Users]  tu ON tu.[id] = s.[teacherId]
      WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE st.[email] LIKE N'%' + d.pattern)
         OR EXISTS (SELECT 1 FROM @devDomains d WHERE tu.[email] LIKE N'%' + d.pattern));

DELETE s FROM dbo.[Edu_Sessions] s
  JOIN dbo.[Edu_Students] st ON st.[id] = s.[studentId]
  LEFT JOIN dbo.[Edu_Users] tu ON tu.[id] = s.[teacherId]
 WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE st.[email] LIKE N'%' + d.pattern)
    OR EXISTS (SELECT 1 FROM @devDomains d WHERE tu.[email] LIKE N'%' + d.pattern);

-- 3) إشعارات وتوكنات الحسابات النموذجية
DELETE n FROM dbo.[Edu_Notifications] n
 WHERE (n.[recipientKind] = N'staff'    AND n.[recipientId] IN (SELECT u.[id] FROM dbo.[Edu_Users]   u WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE u.[email] LIKE N'%' + d.pattern)))
    OR (n.[recipientKind] = N'student'  AND n.[recipientId] IN (SELECT s.[id] FROM dbo.[Edu_Students] s WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE s.[email] LIKE N'%' + d.pattern)))
    OR (n.[recipientKind] = N'parent'   AND n.[recipientId] IN (SELECT p.[id] FROM dbo.[Edu_Parents]  p WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE p.[email] LIKE N'%' + d.pattern)));

DELETE t FROM dbo.[Edu_Tokens] t
 WHERE (t.[kind] = N'staff'   AND t.[accountId] IN (SELECT u.[id] FROM dbo.[Edu_Users]   u WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE u.[email] LIKE N'%' + d.pattern)))
    OR (t.[kind] = N'student' AND t.[accountId] IN (SELECT s.[id] FROM dbo.[Edu_Students] s WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE s.[email] LIKE N'%' + d.pattern)))
    OR (t.[kind] = N'parent'  AND t.[accountId] IN (SELECT p.[id] FROM dbo.[Edu_Parents]  p WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE p.[email] LIKE N'%' + d.pattern)));

-- 4) الربط ثم أولياء الأمور ثم الطلاب ثم الموظفون (المالك مُستثنى)
DELETE r FROM dbo.[Edu_Relations] r
 WHERE r.[student_id] IN (SELECT s.[id] FROM dbo.[Edu_Students] s WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE s.[email] LIKE N'%' + d.pattern))
    OR r.[parent_id]  IN (SELECT p.[id] FROM dbo.[Edu_Parents]  p WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE p.[email] LIKE N'%' + d.pattern));

DELETE p FROM dbo.[Edu_Parents] p
 WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE p.[email] LIKE N'%' + d.pattern);

DELETE s FROM dbo.[Edu_Students] s
 WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE s.[email] LIKE N'%' + d.pattern);

DELETE u FROM dbo.[Edu_Users] u
 WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE u.[email] LIKE N'%' + d.pattern)
   AND u.[role] <> 3;   -- الأدوار الأعلى (المالك) لا تُمَس من هذا الملف إطلاقًا

-- 5) الإثبات: لا بصمة باقية، والمالك ما زال موجودًا — وإلا تُرجَع المعاملة كلها
IF EXISTS (
     SELECT 1 FROM dbo.[Edu_Users]   u WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE u.[email] LIKE N'%' + d.pattern)
     UNION ALL SELECT 1 FROM dbo.[Edu_Students] s WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE s.[email] LIKE N'%' + d.pattern)
     UNION ALL SELECT 1 FROM dbo.[Edu_Parents]  p WHERE EXISTS (SELECT 1 FROM @devDomains d WHERE p.[email] LIKE N'%' + d.pattern))
BEGIN
   ROLLBACK TRANSACTION;
   RAISERROR (N'بقيت بصمات نموذجية بعد الحذف — أُلغيت العملية كلها', 16, 1);
   RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.[Edu_Users] WHERE [role] = 3)
BEGIN
   ROLLBACK TRANSACTION;
   RAISERROR (N'لا حساب مالك في القاعدة — هذا الملف لا يحذف المالك، راجع من حذفه', 16, 1);
   RETURN;
END

COMMIT TRANSACTION;

SELECT N'بعد الحذف' AS step,
       staff    = (SELECT COUNT(*) FROM dbo.[Edu_Users]),
       students = (SELECT COUNT(*) FROM dbo.[Edu_Students]),
       parents  = (SELECT COUNT(*) FROM dbo.[Edu_Parents]),
       sessions = (SELECT COUNT(*) FROM dbo.[Edu_Sessions]),
       owners   = (SELECT COUNT(*) FROM dbo.[Edu_Users] WHERE [role] = 3);
GO

-- الخطوة التالية إلزامية بعد هذا الملف (docs/06 §7): تدوير كلمات السر،
-- ثم DELETE FROM dbo.[Edu_Tokens]; ثم إنشاء حسابات المؤسسة الحقيقية،
-- ثم إعادة تشغيل البوابتين ويجب أن تخرجا بصفر.
