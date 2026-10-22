using System.Security.Claims;
using EduspaceApi.Contracts;
using EduspaceApi.Data;
using EduspaceApi.Models;
using EduspaceApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Controllers;

/// <summary>
/// إدارة الطلاب — المشرف فأعلى يضيف الطلاب يدويًا (لا تسجيل ذاتي).
/// الطلاب في جدول Edu_Students منفصلين عن موظفي المنصة.
/// </summary>
[ApiController]
[Route("api/students")]
[Authorize]
public class StudentsController(EduDbContext db, PasswordService passwords) : ControllerBase
{
    private short CurrentRole =>
        short.TryParse(User.FindFirstValue(ClaimTypes.Role), out var role) ? role : (short)-1;

    private long CurrentUserId =>
        long.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : -1;

    private bool IsTeacher => CurrentRole == UserRoles.Teacher;

    /// <summary>قوائم الطلاب للموظفين فقط — الطالب وولي الأمر لا يقرآن بيانات غيرهم.</summary>
    private bool IsStudent =>
        User.FindFirstValue(Auth.TokenAuthenticationHandler.AudClaim) == "student";

    private bool IsParent =>
        User.FindFirstValue(Auth.TokenAuthenticationHandler.AudClaim) == "parent";

    /// <summary>
    /// معرّفات طلاب المدرس الحالي = من له حصة معه في `Edu_Sessions`.
    /// قاعدة الصلاحيات: **المدرس ينفّذ حصصه فقط** — فقائمة الطلاب ودفاتر التواصل
    /// ليست من اختصاصه (كانت القائمة ترجع كل طلاب المؤسسة لأي موظف، والمدرس موظف).
    /// </summary>
    private IQueryable<long> OwnStudentIds() =>
        db.Sessions.AsNoTracking()
            .Where(s => s.TeacherId == CurrentUserId)
            .Select(s => s.StudentId)
            .Distinct();

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? search)
    {
        if (IsStudent || IsParent)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "هذه القائمة للإدارة والمدرسين." });

        var query = db.Students.AsNoTracking().AsQueryable();

        // المدرس: طلاب حصصه هو فقط — لا إيميلات طلاب مدرسين آخرين في المؤسسة
        if (IsTeacher)
            query = query.Where(s => OwnStudentIds().Contains(s.Id));

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(s =>
                s.Email.Contains(term) ||
                (s.Name != null && s.Name.ToLower().Contains(term)));
        }

        var rows = await query.OrderBy(s => s.Id).ToListAsync();
        return Ok(rows.Select(s => s.ToDto()));
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> Get(long id)
    {
        var student = await db.Students.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id);
        if (student is null) return NotFound(new { message = "الطالب غير موجود." });
        // الطالب لا يقرأ إلا سجله هو
        if (IsStudent)
        {
            var ownId = long.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var oid) ? oid : -1;
            if (id != ownId)
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "لا يمكنك عرض غير بياناتك." });
        }
        // والمدرس لا يقرأ إلا سجل طلاب حصصه
        if (IsTeacher && !await db.Sessions.AsNoTracking().AnyAsync(s => s.TeacherId == CurrentUserId && s.StudentId == id))
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "المدرس يقرأ بيانات الطلاب المسندة له في حصصه فقط." });
        return Ok(student.ToDto());
    }

    /// <summary>إنشاء طالب — المشرف فأعلى فقط.</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateStudentRequest request)
    {
        if (CurrentRole < UserRoles.Supervisor)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "المشرف فأعلى فقط يضيف الطلاب." });

        var email = request.Email?.Trim().ToLowerInvariant();
        var password = request.Password ?? string.Empty;

        if (string.IsNullOrWhiteSpace(email))
            return BadRequest(new { message = "البريد الإلكتروني مطلوب." });
        if (password.Length < 8)
            return BadRequest(new { message = "كلمة المرور يجب ألا تقل عن 8 أحرف." });

        if (await db.Students.AnyAsync(s => s.Email == email))
            return Conflict(new { message = "هذا البريد الإلكتروني مستخدم بالفعل." });

        var phone = PhoneNormalizer.NormalizeRequired(request.Phone, out var phoneError);
        if (phoneError is not null) return BadRequest(new { message = phoneError });
        if (await db.Students.AnyAsync(s => s.Phone == phone))
            return Conflict(new { message = "رقم الهاتف مسجَّل لطالب آخر — الرقم لا يتكرّر في المنصة." });

        var student = new EduStudent
        {
            Name = string.IsNullOrWhiteSpace(request.Name) ? null : request.Name!.Trim(),
            Email = email,
            Password = passwords.Hash(password),
            States = (short)(request.States == 1 ? 1 : 0),
            Access = (short)(request.Access == 1 ? 1 : 0),
            Phone = phone,
        };

        db.Students.Add(student);
        await db.SaveChangesAsync();

        return Created($"/api/students/{student.Id}", student.ToDto());
    }

    /// <summary>تعديل طالب: الاسم/الظهور/الصلاحية/تصفير كلمة المرور — المشرف فأعلى.</summary>
    [HttpPatch("{id}")]
    public async Task<IActionResult> Update(long id, [FromBody] UpdateStudentRequest request)
    {
        if (CurrentRole < UserRoles.Supervisor)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "المشرف فأعلى فقط يعدّل الطلاب." });

        var student = await db.Students.FindAsync(id);
        if (student is null) return NotFound(new { message = "الطالب غير موجود." });

        if (!string.IsNullOrWhiteSpace(request.Name)) student.Name = request.Name!.Trim();
        if (request.States is not null) student.States = request.States.Value;
        if (request.Access is not null) student.Access = request.Access.Value;
        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            if (request.Password.Length < 8)
                return BadRequest(new { message = "كلمة المرور يجب ألا تقل عن 8 أحرف." });
            student.Password = passwords.Hash(request.Password);
        }

        // null = لا تغيير، "" = مسح الرقم، غير ذلك = تطبيع ثم فحص تكرار
        if (request.Phone is not null)
        {
            var phone = PhoneNormalizer.Normalize(request.Phone, out var phoneError);
            if (phoneError is not null) return BadRequest(new { message = phoneError });
            if (phone is not null && await db.Students.AnyAsync(s => s.Phone == phone && s.Id != id))
                return Conflict(new { message = "رقم الهاتف مسجَّل لطالب آخر — الرقم لا يتكرّر في المنصة." });
            student.Phone = phone;
        }

        await db.SaveChangesAsync();
        return Ok(student.ToDto());
    }
}

public record UpdateStudentRequest(string? Name, short? States, short? Access, string? Password, string? Phone);
