/* ============================================================================
   EduLink — نسخة احتياطية كاملة قابلة للإثبات (SQL Server)
   ----------------------------------------------------------------------------
   لا تكتفي بكتابة الملف: تُسجّل **بصمة المخطط** داخل وصف النسخة، فيقدر
   deploy/restore-drill.sql أن يثبت بعد أسابيع أن هذا الملف يعيد بناء المنصة
   كما كانت لحظة نسخها — لا أن حجمه معقول فقط.

   التشغيل (سيرفر الشركة، دخول Windows أو مستخدم/كلمة سر كما في run.sh):
     sqlcmd -S "SERVER,1433" -E -f 65001 -I -b -i deploy/backup.sql
   مجدولًا: SQL Agent Job، أو Task Scheduler على Express — الأمر أعلاه حرفيًا.
   **-b مطلوبة**: بدونها لا يخرج sqlcmd بغير صفر عند الفشل، فتصير النسخة
   الفاشلة الصامتة نجاحًا في عين المشغّل.

   ثلاث ملاحظات مقيسة على هذا الجهاز (لا تنظير):
     • لا تستخدم `-v` للمسارات: sqlcmd 17 يقسم القيمة على `:` فيفسد `C:\...`.
       لذا القيم الافتراضية هنا في أسطر `:setvar` عدّلها كما تريد.
     • `?????` التي قد تراها من `PRINT` هي ترميز مخرج الطرفية لا إفساد للملف:
       الحرفية العربية تصل سليمة مع أو بدون BOM تحت `-f 65001` (مقيس بـ
       `DATALENGTH` ومقارنة بالقيمة نفسها). لا تحكم على العربية بالعين هنا.
     • COMPRESSION غير مدعومة على Express/LocalDB (مقيس: Msg 1844) — تُفحص
       قبل استخدامها، وإلا انهار كل نسخ مجدول عند عميل على Express.
============================================================================ */
:setvar Db         "Edulink"
:setvar BackupDir  "D:\\SqlBackup\\Edulink"
:setvar KeepDays   "0"          -- 0 = لا يُحذف أي ملف؛ قيمة > 0 تحذف الأقدم داخل BackupDir وحده

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @db nvarchar(128) = N'$(Db)';
DECLARE @dir nvarchar(400) = N'$(BackupDir)';
DECLARE @keep int = ISNULL(TRY_CAST(N'$(KeepDays)' AS int), 0);
DECLARE @q nvarchar(2) = NCHAR(39);   /* علامة اقتباس مفردة — لا هروب متداخل */

IF DB_ID(@db) IS NULL
BEGIN
  RAISERROR(N'لا توجد قاعدة باسم %s — صحّح $(Db) في deploy/backup.sql قبل التشغيل.', 16, 1, @db);
  RETURN;
END
IF RIGHT(@dir, 1) = N'\' SET @dir = LEFT(@dir, LEN(@dir) - 1);

/* ---- البصمة تُحسب في $(Db) نفسها لا في قاعدة الاتصال (مقيس: بلا ذلك أعطت master tables=0|idx=209) ---- */
DECLARE @t int, @c int, @f int, @i int, @sql nvarchar(max);
SET @sql = N'SELECT @t = COUNT(*) FROM ' + QUOTENAME(@db) + N'.sys.tables WHERE is_ms_shipped = 0;'
         + N' SELECT @c = COUNT(*) FROM ' + QUOTENAME(@db) + N'.sys.check_constraints;'
         + N' SELECT @f = COUNT(*) FROM ' + QUOTENAME(@db) + N'.sys.foreign_keys;'
         + N' SELECT @i = COUNT(*) FROM ' + QUOTENAME(@db)
         + N'.sys.indexes WHERE name IS NOT NULL AND is_hypothetical = 0;';
EXEC sp_executesql @sql,
     N'@t int OUTPUT, @c int OUTPUT, @f int OUTPUT, @i int OUTPUT',
     @t = @t OUTPUT, @c = @c OUTPUT, @f = @f OUTPUT, @i = @i OUTPUT;

IF @t = 0
BEGIN
  RAISERROR(N'قاعدة %s بلا أي جدول مستخدم — لا معنى لنسخة احتياطية منها؛ صحّح $(Db) أو شغّل المخطط أولًا.', 16, 1, @db);
  RETURN;
END

DECLARE @desc nvarchar(2000) = N'fingerprint:' + CONVERT(nvarchar(20), @t) + N'|'
                              + CONVERT(nvarchar(20), @c) + N'|'
                              + CONVERT(nvarchar(20), @f) + N'|'
                              + CONVERT(nvarchar(20), @i);
PRINT N'بصمة ' + @db + N' لحظة النسخ: ' + @desc;

/* ---- اسم بتاريخ مرتب تصاعديًا بلا فواصل `:` (ويندوز يرفضها في الاسم — مقيس: OS error 123) ---- */
DECLARE @stamp nvarchar(32) = CONVERT(nvarchar(8), SYSDATETIME(), 112)
                            + N'_' + REPLACE(CONVERT(nvarchar(8), SYSDATETIME(), 108), N':', N'');
DECLARE @bak nvarchar(520) = @dir + N'\' + @db + N'_full_' + @stamp + N'.bak';

EXEC master.dbo.xp_create_subdir @dir;

DECLARE @opts nvarchar(200) = N'INIT, CHECKSUM, STATS = 10';
IF CAST(SERVERPROPERTY('Edition') AS nvarchar(200)) NOT LIKE N'%Express%'
  SET @opts = @opts + N', COMPRESSION';
PRINT N'الإصدار: ' + CAST(SERVERPROPERTY('Edition') AS nvarchar(200)) + N' | خيارات: ' + @opts;

SET @sql =
    N'BACKUP DATABASE [' + @db + N'] TO DISK = N' + @q + @bak + @q
  + N' WITH ' + @opts + N', NAME = N' + @q + @db + N'-full' + @q
  + N', DESCRIPTION = N' + @q + @desc + @q + N';';
EXEC (@sql);

/* ---- النسخ الصامت غير الناجح أسوأ من الانهيار: وجود الملف نفسه فرض يُختبر ---- */
/* (xp_fileexist يُرجّع أعمدة أكثر من المتغيّر الواحد في الإصدارات الحديثة — مقيس: Msg 213) */
IF NOT EXISTS (SELECT 1 FROM sys.dm_os_file_exists(@bak) WHERE file_exists = 1)
BEGIN
  RAISERROR(N'انتهى BACKUP دون أن يُنشئ الملف المتوقع: %s', 16, 1, @bak);
  RETURN;
END

/* ---- التحقق: ملف موجود لا يعني نسخة صالحة — CHECKSUM يقرأ كل صفحة ---- */
EXEC (N'RESTORE VERIFYONLY FROM DISK = N' + @q + @bak + @q + N' WITH CHECKSUM;');
PRINT N'✓ تحققت النسخة (VERIFYONLY + CHECKSUM): ' + @bak;

/* ---- الاحتفاظ: حذف صريح اختياري، نطاقه $(BackupDir) وحده ولا يلمس قاعدة ---- */
IF @keep > 0
BEGIN
  DECLARE @cutoff datetime = DATEADD(day, -@keep, SYSDATETIME());
  PRINT N'حذف نسخ .bak الأقدم من ' + CONVERT(nvarchar(32), @cutoff, 121) + N' داخل ' + @dir + N' فقط';
  EXEC master.dbo.xp_delete_file 0, @dir, N'bak', @cutoff, 0;
END
ELSE
  PRINT N'الاحتفاظ معطّل (KeepDays=0): لا يُحذف أي ملف — اضبطه أو أدر المساحة بنفسك.';
