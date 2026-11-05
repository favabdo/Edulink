using System.Security.Claims;
using EduspaceApi.Auth;
using EduspaceApi.Data;
using EduspaceApi.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Controllers;

/// <summary>
/// مكتبة ملفات الحساب (الموظفين): رفع وقائمة وتنزيل وحذف.
/// المحتوى على قرص السيرفر (Files:StoragePath) والقاعدة تحفظ الميتاداتا.
/// كل عمليات القراءة والكتابة مقيّدة على مالك الملف نفسه — لا يرى الحساب
/// إلا ملفاته، وأي معرّف غريب يعود 404 بلا أي معلومة عن وجوده.
/// </summary>
[ApiController]
[Route("api/files")]
[Authorize]
public class FilesController(EduDbContext db, IConfiguration config, IWebHostEnvironment env) : ControllerBase
{
    private long CurrentUserId =>
        long.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0L;

    private string Aud => User.FindFirstValue(TokenAuthenticationHandler.AudClaim) ?? "staff";

    private long CurrentTenantId =>
        long.TryParse(User.FindFirstValue(TokenAuthenticationHandler.TenantClaim), out var t) ? t : 1L;

    private string StorageRoot()
    {
        var configured = config["Files:StoragePath"];
        if (string.IsNullOrWhiteSpace(configured)) configured = "App_Data/files";
        var root = Path.IsPathRooted(configured)
            ? configured
            : Path.Combine(env.ContentRootPath, configured);
        // تطبيع الفواصل: GetFullPath وحده لا يكفي للمقارنة، والـ root يُقارَن ببادئة
        // fullPath لاحقًا — بلا فاصل نهائي ثابت تفشل المقارنة على اختلاف / و \
        Directory.CreateDirectory(root);
        root = Path.GetFullPath(root);
        return root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
    }

    private long MaxBytes() =>
        Math.Clamp(config.GetValue("Files:MaxFileMb", 50), 1, 500) * 1024L * 1024L;

    private static object Item(EduFile f) => new
    {
        id = f.Id,
        fileName = f.FileName,
        mime = f.Mime,
        sizeBytes = f.SizeBytes,
        at = new DateTimeOffset(DateTime.SpecifyKind(f.CreatedAt, DateTimeKind.Utc)),
    };

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int take = 100)
    {
        if (Aud != AccountKinds.Staff)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "مكتبة الملفات للموظفين فقط." });

        take = Math.Clamp(take, 1, 200);
        var rows = await db.Files.AsNoTracking()
            .Where(f => f.OwnerId == CurrentUserId)
            .OrderByDescending(f => f.CreatedAt)
            .Take(take)
            .ToListAsync();

        return Ok(new { items = rows.Select(Item) });
    }

    [HttpPost]
    public async Task<IActionResult> Upload([FromForm] IFormFile? file)
    {
        if (Aud != AccountKinds.Staff)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "مكتبة الملفات للموظفين فقط." });

        if (file is null || file.Length == 0)
            return BadRequest(new { message = "لم يُرفَق ملف." });

        var max = MaxBytes();
        if (file.Length > max)
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new
            {
                message = $"حجم الملف يتجاوز الحد المسموح ({max / (1024 * 1024)} ميجابايت).",
            });

        // الاسم الأصلي يُحفظ كما هو (وقد يكون عربيًا) — يُنظَّف من فواصل المسار فقط.
        var name = Path.GetFileName(file.FileName)?.Trim() ?? "";
        if (name.Length == 0) name = "ملف";
        if (name.Length > 255) name = name[^255..];

        // الامتداد على القرص: حروف وأرقام فقط حتى 10 — وإلا يُسقَط. اسم الملف
        // الفعلي GUID يولّده الخادم، فلا يصل العميل لأي مسار يتحكم فيه.
        var ext = Path.GetExtension(name);
        if (ext.Length is < 2 or > 11 || !ext[1..].All(char.IsAsciiLetterOrDigit)) ext = "";
        var storageName = $"{Guid.NewGuid():N}{ext}";

        var root = StorageRoot();
        var fullPath = Path.Combine(root, storageName);
        await using (var stream = System.IO.File.Create(fullPath))
        {
            await file.CopyToAsync(stream);
        }

        try
        {
            var row = new EduFile
            {
                OwnerId = CurrentUserId,
                FileName = name,
                Mime = SanitizeMime(file.ContentType),
                SizeBytes = file.Length,
                StoragePath = storageName,
                TenantId = CurrentTenantId,
            };
            db.Files.Add(row);
            await db.SaveChangesAsync();
            return StatusCode(StatusCodes.Status201Created, Item(row));
        }
        catch
        {
            try { System.IO.File.Delete(fullPath); } catch { /* صف الخادم غير مكتمل */ }
            throw;
        }
    }

    [HttpGet("{id}/download")]
    public async Task<IActionResult> Download(long id)
    {
        if (Aud != AccountKinds.Staff)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "مكتبة الملفات للموظفين فقط." });

        var row = await db.Files.AsNoTracking()
            .FirstOrDefaultAsync(f => f.Id == id && f.OwnerId == CurrentUserId);
        if (row is null) return NotFound();

        var root = StorageRoot();
        var fullPath = Path.GetFullPath(Path.Combine(root, row.StoragePath));
        if (!fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase) ||
            !System.IO.File.Exists(fullPath))
        {
            return NotFound();
        }

        // PhysicalFile يولّد Content-Disposition بترميز filename* فيصل الاسم
        // العربي كما هو للمتصفح.
        return PhysicalFile(fullPath, row.Mime, row.FileName);
    }

    /// <summary>
    /// قراءة مستند **معروض الآن** داخل غرفة حصة يحضرها الحساب — الطريق الذي يسمح
    /// للطالب أن يرى ورقة المدرس وهو يكتب عليها.
    ///
    /// الحراسة ثلاثية عمداً: (1) غرفة نشطة منحت هذا الملف (`RoomSharedDocs`)،
    /// (2) السائل له علاقة فعلية بالحصة (مدرسها / طالبها / ولي أمر مرتبط / مشرف فأعلى
    /// في نفس الشركة)، (3) نوع المحتوى مما يُعرض داخل الصفحة فقط — لأن الاستجابة
    /// inline بلا `Content-Disposition: attachment`، ولو سُمح بـ `text/html` لتحوّل
    /// رفعٌ خبيث إلى تنفيذ على أصل المنصة. أي فشل ⇒ **404** بلا تفصيل.
    /// </summary>
    [HttpGet("{id}/shared")]
    public async Task<IActionResult> SharedDocument(long id, [FromQuery(Name = "session")] string? sessionCode)
    {
        var code = (sessionCode ?? "").Trim();
        if (code.Length == 0 || code.Length > 64) return NotFound();

        var tenantId = CurrentTenantId;
        var room = await db.Sessions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Code == code && s.TenantId == tenantId);
        if (room is null) return NotFound();

        if (!Hubs.RoomSharedDocs.IsShared(room.Id, id)) return NotFound();

        var row = await db.Files.AsNoTracking()
            .FirstOrDefaultAsync(f => f.Id == id && f.TenantId == tenantId);
        if (row is null) return NotFound();

        if (!await MayAttend(room)) return NotFound();

        if (!InlineSafeMimes.Contains(row.Mime))
            return StatusCode(StatusCodes.Status415UnsupportedMediaType,
                new { message = "هذا النوع لا يُعرض داخل الحصة (الصور وPDF فقط)." });

        var root = StorageRoot();
        var fullPath = Path.GetFullPath(Path.Combine(root, row.StoragePath));
        if (!fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase) ||
            !System.IO.File.Exists(fullPath))
        {
            return NotFound();
        }

        Response.Headers["X-Content-Type-Options"] = "nosniff";
        // بلا اسم تنزيل: المحتوى يُعرض في الصفحة (pdfjs / img) لا يُحفظ
        return PhysicalFile(fullPath, row.Mime, enableRangeProcessing: true);
    }

    /// <summary>نفس قواعد الدور في `MeetingHub.Join` — من له أن يكون في هذه الغرفة أصلًا.</summary>
    private async Task<bool> MayAttend(EduSession room)
    {
        var userId = CurrentUserId;
        switch (Aud)
        {
            case AccountKinds.Student:
                return room.StudentId == userId;
            case AccountKinds.Parent:
                return await db.Relations.AnyAsync(r =>
                    r.ParentId == userId && r.StudentId == room.StudentId && r.TenantId == CurrentTenantId);
            case AccountKinds.Staff:
                var staffRole = await db.Users.Where(u => u.Id == userId)
                    .Select(u => (int)u.Role).FirstOrDefaultAsync();
                if (staffRole >= UserRoles.Supervisor) return true;
                return staffRole == UserRoles.Teacher && room.TeacherId == userId;
            default:
                return false;
        }
    }

    private static readonly HashSet<string> InlineSafeMimes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf",
    };

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(long id)
    {
        if (Aud != AccountKinds.Staff)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "مكتبة الملفات للموظفين فقط." });

        var row = await db.Files
            .FirstOrDefaultAsync(f => f.Id == id && f.OwnerId == CurrentUserId);
        if (row is null) return NotFound();

        var root = StorageRoot();
        var fullPath = Path.GetFullPath(Path.Combine(root, row.StoragePath));
        db.Files.Remove(row);
        await db.SaveChangesAsync();

        if (fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            try { System.IO.File.Delete(fullPath); } catch { /* قد يكون حُذف من القرص */ }
        }

        return NoContent();
    }

    private static string SanitizeMime(string? contentType)
    {
        var mime = contentType?.Trim() ?? "";
        if (mime.Length == 0 || mime.Length > 120 || mime.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('/' or '-' or '.' or '+' or '*')))
        {
            return "application/octet-stream";
        }
        return mime;
    }
}
