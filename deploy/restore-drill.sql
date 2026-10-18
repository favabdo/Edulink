/* ============================================================================
   EduLink — اختبار الاستعادة (restore drill): يُثبت أن النسخة ترجع المنصة
   ----------------------------------------------------------------------------
   النسخ وحده ليس دليلًا. هذا السكربت يستعيد أحدث نسخة إلى **قاعدة ظل** باسم
   مستقل (لا يمسّ الإنتاج)، ثم يفرض:
     1) مخطط الظل يطابق **البصمة المسجلة داخل وصف النسخة** لحظة نسخها.
     2) مع StrictLive=1: يطابق مخطط الإنتاج الحالي — فشلها يعني النسخة لا تكفي اليوم.
     3) فروق صفوف كل جدول تُطبع (كم فقدنا بين النسخة والآن) كمعلومة، لا كفشل.
   يُشغَّل بـ -b فيخرج non-zero عند أي تناقض — لا «تمّ بحمد الله» صامتة.

     sqlcmd -S "SERVER,1433" -E -f 65001 -I -b -i deploy/restore-drill.sql
   نفس قيود deploy/backup.sql المقيسة: لا `-v` للمسارات (`:` تقسمها sqlcmd)، و`?`
   التي يطبعها `PRINT` هي ترميز الطرفية لا إفساد. الأسماء المنطقية تُقرأ من
   msdb.dbo.backupfile لأن شكل نتائج RESTORE FILELISTONLY يختلف بين الإصدارات
   (مقيس: Msg 213 على SQL Server 2025)، فالنسخة يجب أن تكون من هذا السيرفر.
============================================================================ */
:setvar Db          "Edulink"
:setvar BackupDir   "D:\\SqlBackup\\Edulink"
:setvar ShadowDb    "EdulinkRestoreDrill"
:setvar RestoreDir  "D:\\SqlBackup\\Edulink\\drill"
:setvar StrictLive  "0"
:setvar KeepShadow  "0"
:setvar BackupFile  ""

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @db nvarchar(128)   = N'$(Db)';
DECLARE @dir nvarchar(400)  = N'$(BackupDir)';
DECLARE @shadow nvarchar(128)= N'$(ShadowDb)';
DECLARE @rdir nvarchar(400) = N'$(RestoreDir)';
DECLARE @bak nvarchar(520)  = NULLIF(N'$(BackupFile)', N'');
DECLARE @strict int         = ISNULL(TRY_CAST(N'$(StrictLive)' AS int), 0);
DECLARE @keepShadow int     = ISNULL(TRY_CAST(N'$(KeepShadow)' AS int), 0);
DECLARE @q nvarchar(2)      = NCHAR(39);
DECLARE @sql nvarchar(max);

IF RIGHT(@dir, 1)  = N'\'  SET @dir  = LEFT(@dir,  LEN(@dir)  - 1);
IF RIGHT(@rdir, 1) = N'\' SET @rdir = LEFT(@rdir, LEN(@rdir) - 1);

IF @shadow = @db
BEGIN
  RAISERROR(N'قاعدة الظل يجب أن تختلف عن الإنتاج — صحّح $(ShadowDb) (الاستعادة فوق الإنتاج تمحو عمله).', 16, 1);
  RETURN;
END

/* ---- 1) أحدث نسخة إن لم تُمرَّر صراحة: الأسماء بتاريخ مرتب تصاعديًا ---- */
IF @bak IS NULL
BEGIN
  CREATE TABLE #tree (name nvarchar(512), depth int, isfile bit);
  INSERT INTO #tree EXEC master.dbo.xp_dirtree @dir, 1, 1;
  SELECT @bak = @dir + N'\' + MAX(name) FROM #tree WHERE isfile = 1 AND name LIKE @db + N'_full_%.bak';
  IF @bak IS NULL
  BEGIN
    RAISERROR(N'لا ملف .bak بالمجلد %s — شغّل deploy/backup.sql أولًا.', 16, 1, @dir);
    RETURN;
  END
END
PRINT N'النسخة تحت الاختبار: ' + @bak;

IF NOT EXISTS (SELECT 1 FROM sys.dm_os_file_exists(@bak) WHERE file_exists = 1)
BEGIN
  RAISERROR(N'مسار النسخة المحددة غير موجود: %s', 16, 1, @bak);
  RETURN;
END

/* ---- 2) الصفحات سليمة فعلًا، لا الاسم وحده ---- */
EXEC (N'RESTORE VERIFYONLY FROM DISK = N' + @q + @bak + @q + N' WITH CHECKSUM;');

/* ---- 3) البصمة التي سجلها backup.sql لحظة النسخ ---- */
DECLARE @manifest nvarchar(2000);
SELECT TOP (1) @manifest = bs.description
FROM msdb.dbo.backupset bs
JOIN msdb.dbo.backupmediafamily bf ON bf.media_set_id = bs.media_set_id
WHERE bs.database_name = @db AND bf.physical_device_name = @bak
ORDER BY bs.backup_finish_date DESC;

IF @manifest IS NULL
  PRINT N'تنبيه: لا وصف مسجل لهذه النسخة في msdb (نُسخت من خارج deploy/backup.sql) — المقارنة مع الإنتاج هي الحكم.';
ELSE
  PRINT N'بصمة لحظة النسخ: ' + @manifest;

/* ---- 4) الأسماء المنطقية من msdb (عمود مستقر)، لا من RESTORE FILELISTONLY ----
   شكل نتائج FILELISTONLY يختلف بين الإصدارات — مقيس: Msg 213 على 2025 ضد جدول
   كُتب على وثيقة 2016. الاعتماد على msdb أأمن، ونطاقه أن النسخة من هذا السيرفر. */
CREATE TABLE #fl (logical_name nvarchar(256), file_type char(1));
INSERT INTO #fl (logical_name, file_type)
SELECT DISTINCT bf.logical_name, bf.file_type
FROM msdb.dbo.backupset bs
JOIN msdb.dbo.backupmediafamily mf ON mf.media_set_id = bs.media_set_id
JOIN msdb.dbo.backupfile bf ON bf.backup_set_id = bs.backup_set_id
WHERE bs.database_name = @db AND mf.physical_device_name = @bak;

IF NOT EXISTS (SELECT 1 FROM #fl)
BEGIN
  RAISERROR(N'لا سجل ملفات لهذه النسخة في msdb (%s) — النسخة أُنشئت من سيرفر آخر؛ انسخها بنفس السيرفر أو استخرج الأسماء يدويًا من RESTORE FILELISTONLY ومررها في @move.', 16, 1, @bak);
  RETURN;
END

EXEC master.dbo.xp_create_subdir @rdir;

DECLARE @move nvarchar(max) = N'';
SELECT @move = @move + N', MOVE N' + @q + logical_name + @q + N' TO N' + @q + @rdir + N'\'
             + REPLACE(CAST(NEWID() AS nvarchar(36)), N'-', N'')
             + CASE WHEN file_type = N'L' THEN N'.ldf' ELSE N'.mdf' END + @q
FROM #fl;

/* ---- 5) الاستعادة إلى الظل: اسم مختلف، وREPLACE على الظل وحده ---- */
IF @strict = 1 AND DB_ID(@db) IS NULL
BEGIN
  RAISERROR(N'StrictLive=1 يتطلب قاعدة الإنتاج %s على هذا السيرفر للمقارنة.', 16, 1, @db);
  RETURN;
END
IF DB_ID(@shadow) IS NOT NULL
  EXEC (N'ALTER DATABASE [' + @shadow + N'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;');

PRINT N'استعادة إلى قاعدة الظل [' + @shadow + N'] ...';
EXEC (N'RESTORE DATABASE [' + @shadow + N'] FROM DISK = N' + @q + @bak + @q
    + N' WITH REPLACE' + @move + N';');
PRINT N'✓ تمت الاستعادة.';

/* ---- 6) بصمة كل قاعدة بنفس تعريف backup.sql (عدّادات لا نصوص متداخلة) ---- */
DECLARE @t int, @c int, @f int, @i int;
DECLARE @fpShadow nvarchar(2000), @fpLive nvarchar(2000);

SET @sql = N'SELECT @t = COUNT(*) FROM ' + QUOTENAME(@shadow) + N'.sys.tables WHERE is_ms_shipped = 0;'
         + N' SELECT @c = COUNT(*) FROM ' + QUOTENAME(@shadow) + N'.sys.check_constraints;'
         + N' SELECT @f = COUNT(*) FROM ' + QUOTENAME(@shadow) + N'.sys.foreign_keys;'
         + N' SELECT @i = COUNT(*) FROM ' + QUOTENAME(@shadow)
         + N'.sys.indexes WHERE name IS NOT NULL AND is_hypothetical = 0;';
EXEC sp_executesql @sql, N'@t int OUTPUT, @c int OUTPUT, @f int OUTPUT, @i int OUTPUT',
     @t = @t OUTPUT, @c = @c OUTPUT, @f = @f OUTPUT, @i = @i OUTPUT;
SET @fpShadow = N'fingerprint:' + CONVERT(nvarchar(20), @t) + N'|' + CONVERT(nvarchar(20), @c)
              + N'|' + CONVERT(nvarchar(20), @f) + N'|' + CONVERT(nvarchar(20), @i);
PRINT N'بصمة الظل المستعاد:  ' + @fpShadow;

IF DB_ID(@db) IS NOT NULL
BEGIN
  SET @sql = N'SELECT @t = COUNT(*) FROM ' + QUOTENAME(@db) + N'.sys.tables WHERE is_ms_shipped = 0;'
           + N' SELECT @c = COUNT(*) FROM ' + QUOTENAME(@db) + N'.sys.check_constraints;'
           + N' SELECT @f = COUNT(*) FROM ' + QUOTENAME(@db) + N'.sys.foreign_keys;'
           + N' SELECT @i = COUNT(*) FROM ' + QUOTENAME(@db)
           + N'.sys.indexes WHERE name IS NOT NULL AND is_hypothetical = 0;';
  EXEC sp_executesql @sql, N'@t int OUTPUT, @c int OUTPUT, @f int OUTPUT, @i int OUTPUT',
       @t = @t OUTPUT, @c = @c OUTPUT, @f = @f OUTPUT, @i = @i OUTPUT;
  SET @fpLive = N'fingerprint:' + CONVERT(nvarchar(20), @t) + N'|' + CONVERT(nvarchar(20), @c)
              + N'|' + CONVERT(nvarchar(20), @f) + N'|' + CONVERT(nvarchar(20), @i);
  PRINT N'بصمة الإنتاج الآن:   ' + @fpLive;
END

/* ---- 7) الأحكام ---- */
IF @manifest IS NOT NULL AND @manifest <> @fpShadow
BEGIN
  RAISERROR(N'النسخة لا تعيد المخطط الذي نُسخت منه: المتوقع %s والمُستعاد %s — النسخة تالفة أو من قاعدة أخرى.', 16, 1, @manifest, @fpShadow);
  RETURN;
END
IF @strict = 1 AND @fpLive IS NOT NULL AND @fpLive <> @fpShadow
BEGIN
  RAISERROR(N'النسخة لا تكفي لاستعادة الإنتاج الحالي: الإنتاج %s والنسخة %s — شغّل backup.sql أو أصلح المخطط.', 16, 1, @fpLive, @fpShadow);
  RETURN;
END

/* ---- 8) كم فقدنا بين النسخة والآن؟ (معلومة، لا فشل) ---- */
IF DB_ID(@db) IS NOT NULL
BEGIN
  /* قائمة الجداول من الظل نفسه: الإنتاج قد يحمل جدولًا أحدث من النسخة */
  CREATE TABLE #tbl (sch nvarchar(128), name nvarchar(128));
  SET @sql = N'SELECT SCHEMA_NAME(t.schema_id), t.name FROM ' + QUOTENAME(@shadow)
           + N'.sys.tables t WHERE t.is_ms_shipped = 0';
  INSERT INTO #tbl EXEC (@sql);

  DECLARE @diff nvarchar(max) = N'';
  SELECT @diff = @diff + N'UNION ALL SELECT N' + @q + REPLACE(name, @q, @q + @q) + @q
                 + N' AS table_name, (SELECT COUNT(*) FROM ' + QUOTENAME(@shadow) + N'.'
                 + QUOTENAME(sch) + N'.' + QUOTENAME(name) + N') AS in_restore, (SELECT COUNT(*) FROM '
                 + QUOTENAME(@db) + N'.' + QUOTENAME(sch) + N'.' + QUOTENAME(name) + N') AS in_live '
  FROM #tbl;

  IF @diff IS NOT NULL
  BEGIN
    SET @diff = STUFF(@diff, 1, 10, N'');   -- يسقط «UNION ALL » الأولى (10 أحرف)
    EXEC (N'SELECT table_name, in_restore, in_live, in_live - in_restore AS lost_since_backup FROM ('
        + @diff + N') AS d WHERE in_live <> in_restore ORDER BY lost_since_backup DESC;');
  END
  ELSE
    PRINT N'لا جداول في الظل للمقارنة — راجع النسخة.';
END

PRINT N'✓ اختبار الاستعادة ناجح: النسخة تحقق ذاتها وتعيد المخطط المسجل فيها.';

/* ---- 9) التنظيف: قاعدة الظل مؤقتة بطبيعتها ---- */
IF @keepShadow = 0
BEGIN
  EXEC (N'ALTER DATABASE [' + @shadow + N'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;');
  EXEC (N'DROP DATABASE [' + @shadow + N'];');
  PRINT N'حُذفت قاعدة الظل [' + @shadow + N'] (اضبط KeepShadow=1 لإبقائها لفحص يدوي).';
END
