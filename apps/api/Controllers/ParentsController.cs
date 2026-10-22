using System.Security.Claims;
using EduspaceApi.Auth;
using EduspaceApi.Contracts;
using EduspaceApi.Data;
using EduspaceApi.Models;
using EduspaceApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Controllers;

/// <summary>
/// أولياء الأمور: إدارة الحسابات والربط بالأبناء (المشرف فأعلى)،
/// وولي الأمر نفسه يرى أبناءه وحصصهم فقط.
/// </summary>
[ApiController]
[Route("api/parents")]
[Authorize]
public class ParentsController(EduDbContext db, PasswordService passwords) : ControllerBase
{
    private long CurrentUserId =>
        long.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0L;

    private string Aud =>
        User.FindFirstValue(TokenAuthenticationHandler.AudClaim) ?? "staff";

    private short CurrentRole =>
        short.TryParse(User.FindFirstValue(ClaimTypes.Role), out var role) ? role : (short)-1;

    private IActionResult? DenyNotStaff() =>
        Aud == AccountKinds.Staff ? null : StatusCode(403, new { message = "هذه الإدارة للموظفين فقط." });

    private bool IsTeacher => CurrentRole == UserRoles.Teacher;

    /// <summary>
    /// معرّفات طلاب المدرس الحالي من حصصه — نفس حارس `GET /api/students`.
    /// المدرس «ينفّذ حصصه» فقط، فليس من حقّه دفتر أولياء أمور المؤسسة كاملًا.
    /// </summary>
    private IQueryable<long> OwnStudentIds() =>
        db.Sessions.AsNoTracking()
            .Where(s => s.TeacherId == CurrentUserId)
            .Select(s => s.StudentId)
            .Distinct();

    /// <summary>قائمة أولياء الأمور مع أبنائهم (للموظفين). مع ?child=StudentId تُصفّى.</summary>
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] long? child)
    {
        if (DenyNotStaff() is { } deny) return deny;

        var query = db.Parents.AsNoTracking().AsQueryable();
        if (child.HasValue)
            query = query.Where(p => db.Relations.Any(r => r.ParentId == p.Id && r.StudentId == child.Value));

        // المدرس: أولياء أمور طلابه فقط
        if (IsTeacher)
            query = query.Where(p => db.Relations.Any(r => r.ParentId == p.Id && OwnStudentIds().Contains(r.StudentId)));

        var parents = await query.OrderBy(p => p.Id).ToListAsync();
        var relationsQuery = db.Relations.AsNoTracking();
        if (IsTeacher)
            relationsQuery = relationsQuery.Where(r => OwnStudentIds().Contains(r.StudentId));
        var relations = await relationsQuery.ToListAsync();

        return Ok(parents.Select(p => ToDto(p, relations)));
    }

    /// <summary>إنشاء ولي أمر + ربط اختياري بابن (مشرف فأعلى).</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateParentRequest request)
    {
        if (DenyNotStaff() is { } deny) return deny;
        if (CurrentRole < UserRoles.Supervisor)
            return StatusCode(403, new { message = "المشرف فأعلى فقط يضيف أولياء الأمور." });

        var email = request.Email?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(email))
            return BadRequest(new { message = "البريد الإلكتروني مطلوب." });
        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 8)
            return BadRequest(new { message = "كلمة المرور يجب ألا تقل عن 8 أحرف." });
        if (await db.Parents.AnyAsync(p => p.Email == email))
            return Conflict(new { message = "هذا البريد الإلكتروني مستخدم بالفعل." });

        var phone = PhoneNormalizer.NormalizeRequired(request.Phone, out var phoneError);
        if (phoneError is not null) return BadRequest(new { message = phoneError });
        if (await db.Parents.AnyAsync(p => p.Phone == phone))
            return Conflict(new { message = "رقم الهاتف مسجَّل لولي أمر آخر — الرقم لا يتكرّر في المنصة." });

        var parent = new EduParent
        {
            Name = string.IsNullOrWhiteSpace(request.Name) ? null : request.Name!.Trim(),
            Email = email,
            Password = passwords.Hash(request.Password),
            Access = (short)(request.Access == 1 ? 1 : 0),
            States = 1,
            Phone = phone,
        };
        db.Parents.Add(parent);
        await db.SaveChangesAsync();

        if (request.StudentId.HasValue)
        {
            var linked = await LinkInternalAsync(parent.Id, request.StudentId.Value, request.Relation ?? 0, true);
            if (linked is not null) return linked;
        }

        var relations = await db.Relations.AsNoTracking().ToListAsync();
        return Created($"/api/parents/{parent.Id}", ToDto(parent, relations));
    }

    /// <summary>ربط ولي أمر بطالب (مشرف فأعلى). relation: 0 أب · 1 أم · 2 وصي · 3 أخرى.</summary>
    [HttpPost("{id}/link")]
    public async Task<IActionResult> Link(long id, [FromBody] LinkStudentRequest request)
    {
        if (DenyNotStaff() is { } deny) return deny;
        if (CurrentRole < UserRoles.Supervisor)
            return StatusCode(403, new { message = "المشرف فأعلى فقط يربط الأبناء." });

        var error = await LinkInternalAsync(id, request.StudentId, request.Relation, request.IsPrimary);
        return error ?? NoContent();
    }

    private async Task<IActionResult?> LinkInternalAsync(long parentId, long studentId, short relation, bool isPrimary)
    {
        var parent = await db.Parents.FirstOrDefaultAsync(p => p.Id == parentId);
        if (parent is null) return NotFound(new { message = "ولي الأمر غير موجود." });
        if (!await db.Students.AnyAsync(s => s.Id == studentId))
            return BadRequest(new { message = "الطالب غير موجود." });
        if (relation is < 0 or > 3) return BadRequest(new { message = "نوع العلاقة غير صالح." });
        if (await db.Relations.AnyAsync(r => r.ParentId == parentId && r.StudentId == studentId))
            return Conflict(new { message = "الربط موجود بالفعل." });

        if (isPrimary)
        {
            var others = await db.Relations
                .Where(r => r.StudentId == studentId && r.IsPrimary == 1)
                .ToListAsync();
            foreach (var other in others) other.IsPrimary = 0;
        }

        db.Relations.Add(new EduRelation
        {
            StudentId = studentId,
            ParentId = parentId,
            Relation = relation,
            IsPrimary = (short)(isPrimary ? 1 : 0),
            States = 1,
        });
        await db.SaveChangesAsync();
        return null;
    }

    /// <summary>فك ربط (المشرف فأعلى).</summary>
    [HttpDelete("{id}/link/{studentId}")]
    public async Task<IActionResult> Unlink(long id, long studentId)
    {
        if (DenyNotStaff() is { } deny) return deny;
        if (CurrentRole < UserRoles.Supervisor)
            return StatusCode(403, new { message = "المشرف فأعلى فقط يفك الربط." });

        var rel = await db.Relations.FirstOrDefaultAsync(r => r.ParentId == id && r.StudentId == studentId);
        if (rel is null) return NotFound(new { message = "لا يوجد هذا الربط." });

        db.Relations.Remove(rel);
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// أبناؤه وحصصهم — لولي الأمر نفسه (?mine=1) أو لأي موظف بـ ?student=StudentId.
    /// ولي الأمر لا يرى غير بيانات أبنائه المرتبطين.
    /// </summary>
    [HttpGet("children")]
    public async Task<IActionResult> Children([FromQuery] int mine, [FromQuery] long? student)
    {
        var isStaff = Aud == AccountKinds.Staff;
        if (!isStaff && Aud != AccountKinds.Parent)
            return StatusCode(403, new { message = "هذه البيانات لأولي الأمر والموظفين." });

        List<long> studentIds;
        if (mine == 1)
        {
            if (Aud != AccountKinds.Parent)
                return BadRequest(new { message = "mine=1 لولي الأمر فقط." });
            studentIds = await db.Relations
                .Where(r => r.ParentId == CurrentUserId && r.States == 1)
                .Select(r => r.StudentId).ToListAsync();
        }
        else if (student.HasValue && isStaff)
        {
            if (IsTeacher && !await db.Sessions.AsNoTracking()
                    .AnyAsync(s => s.TeacherId == CurrentUserId && s.StudentId == student.Value))
            {
                return StatusCode(StatusCodes.Status403Forbidden,
                    new { message = "المدرس يقرأ بيانات طالب من حصصه فقط." });
            }
            studentIds = [student.Value];
        }
        else
        {
            return BadRequest(new { message = "حدّد student (للموظف) أو mine=1 (لولي الأمر)." });
        }

        var students = await db.Students.AsNoTracking()
            .Where(s => studentIds.Contains(s.Id)).ToListAsync();

        var sessions = await db.Sessions.AsNoTracking()
            .Where(s => studentIds.Contains(s.StudentId))
            .OrderByDescending(s => s.StartsAt)
            .Take(500)
            .ToListAsync();

        return Ok(students.Select(s => new
        {
            student = s.ToDto(),
            sessions = sessions.Where(x => x.StudentId == s.Id).Select(x => x.ToDto()),
        }));
    }

    /// <summary>تعديل ولي أمر: الاسم/الظهور/الصلاحية/تصفير كلمة المرور — المشرف فأعلى.</summary>
    [HttpPatch("{id}")]
    public async Task<IActionResult> Update(long id, [FromBody] UpdateParentRequest request)
    {
        if (DenyNotStaff() is { } deny) return deny;
        if (CurrentRole < UserRoles.Supervisor)
            return StatusCode(403, new { message = "المشرف فأعلى فقط يعدّل أولياء الأمور." });

        var parent = await db.Parents.FindAsync(id);
        if (parent is null) return NotFound(new { message = "ولي الأمر غير موجود." });

        if (!string.IsNullOrWhiteSpace(request.Name)) parent.Name = request.Name!.Trim();
        if (request.States is not null) parent.States = request.States.Value;
        if (request.Access is not null) parent.Access = request.Access.Value;
        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            if (request.Password.Length < 8)
                return BadRequest(new { message = "كلمة المرور يجب ألا تقل عن 8 أحرف." });
            parent.Password = passwords.Hash(request.Password);
        }

        // null = لا تغيير، "" = مسح الرقم، غير ذلك = تطبيع ثم فحص تكرار
        if (request.Phone is not null)
        {
            var phone = PhoneNormalizer.Normalize(request.Phone, out var phoneError);
            if (phoneError is not null) return BadRequest(new { message = phoneError });
            if (phone is not null && await db.Parents.AnyAsync(p => p.Phone == phone && p.Id != id))
                return Conflict(new { message = "رقم الهاتف مسجَّل لولي أمر آخر — الرقم لا يتكرّر في المنصة." });
            parent.Phone = phone;
        }

        await db.SaveChangesAsync();
        var relations = await db.Relations.AsNoTracking().ToListAsync();
        return Ok(ToDto(parent, relations));
    }

    private static ParentDto ToDto(EduParent p, IReadOnlyCollection<EduRelation> relations) => new(
        p.Id,
        p.Name,
        p.Email,
        p.States,
        p.Access,
        p.Phone,
        relations.Where(r => r.ParentId == p.Id)
            .Select(r => new RelationDto(r.Id, r.StudentId, r.Relation, r.IsPrimary == 1))
            .ToList());
}

public record CreateParentRequest(
    string? Name,
    string? Email,
    string? Password,
    short Access = 1,
    long? StudentId = null,
    short? Relation = null,
    string? Phone = null);

public record LinkStudentRequest(long StudentId, short Relation, bool IsPrimary = false);

public record UpdateParentRequest(string? Name, short? States, short? Access, string? Password, string? Phone);

public record RelationDto(long Id, long StudentId, short Relation, bool IsPrimary);

public record ParentDto(
    long Id,
    string? Name,
    string Email,
    short States,
    short Access,
    /// <summary>رقم ولي الأمر — القناة الأساسية لتنبيهات الحصص، أو null إن لم يُسجَّل.</summary>
    string? Phone,
    IReadOnlyList<RelationDto> Children);
