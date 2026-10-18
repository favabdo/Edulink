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
/// إدارة حسابات موظفي المنصة (مدرس، مشرف، مدير، أونر).
/// الإدارة هي التي تضيف الحسابات يدويًا — لا يوجد تسجيل ذاتي.
/// </summary>
[ApiController]
[Route("api/users")]
[Authorize]
public class UsersController(EduDbContext db, PasswordService passwords) : ControllerBase
{
    private short CurrentRole =>
        short.TryParse(User.FindFirstValue(ClaimTypes.Role), out var role) ? role : (short)-1;

    private long CurrentUserId =>
        long.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0L;

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] short? role, [FromQuery] string? search)
    {
        if (CurrentRole < UserRoles.Supervisor) return Forbid();

        var query = db.Users.AsNoTracking().AsQueryable();

        if (role is not null) query = query.Where(u => u.Role == role);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(u =>
                u.Email.Contains(term) ||
                (u.Name != null && u.Name.ToLower().Contains(term)));
        }

        var rows = await query.OrderBy(u => u.Id).ToListAsync();
        return Ok(rows.Select(u => u.ToDto()));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateUserRequest request)
    {
        // المشرف يضيف مدرسين فقط (الحارس أدناه يمنع إنشاء دور >= دوره)
        if (CurrentRole < UserRoles.Supervisor) return Forbid();

        // لا يجوز إنشاء دور مساوٍ لدورك أو أعلى منه
        if (request.Role >= CurrentRole)
            return BadRequest(new { message = "لا يمكنك إنشاء حساب بدور مساوٍ لدورك أو أعلى منه." });

        var email = request.Email?.Trim().ToLowerInvariant();
        var password = request.Password ?? string.Empty;

        if (string.IsNullOrWhiteSpace(email))
            return BadRequest(new { message = "البريد الإلكتروني مطلوب." });
        if (password.Length < 8)
            return BadRequest(new { message = "كلمة المرور يجب ألا تقل عن 8 أحرف." });

        if (await db.Users.AnyAsync(u => u.Email == email))
            return Conflict(new { message = "هذا البريد الإلكتروني مستخدم بالفعل." });

        var user = new EduUser
        {
            Name = string.IsNullOrWhiteSpace(request.Name) ? null : request.Name!.Trim(),
            Email = email,
            Password = passwords.Hash(password),
            Role = request.Role,
            States = (short)(request.States == 1 ? 1 : 0),
            Access = (short)(request.Access == 1 ? 1 : 0),
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        return CreatedAtAction(nameof(List), new { id = user.Id }, user.ToDto());
    }

    /// <summary>
    /// تعديل حساب موظف: الاسم/الدور/الحالة/الصلاحية، وتصفير كلمة المرور إذا أُرسلت.
    /// المشرف يدير المدرسين فقط؛ المدير فأعلى يدير من هم أدنى منه؛ لا أحد يرفع نفسه ولا يعبث بحسابه الدورِيًا.
    /// </summary>
    [HttpPatch("{id}")]
    public async Task<IActionResult> Update(long id, [FromBody] UpdateUserRequest request)
    {
        if (CurrentRole < UserRoles.Supervisor) return Forbid();

        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound(new { message = "الحساب غير موجود." });

        // المشرف (1) لا يمس غير المدرسين (0)؛ المدير فأعلى لا يمس من يساويه أو يعلوه
        if (CurrentRole == UserRoles.Supervisor && user.Role != UserRoles.Teacher)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "المشرف يدير حسابات المدرسين فقط." });
        if (CurrentRole > UserRoles.Supervisor && user.Role >= CurrentRole && user.Id != CurrentUserId)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "لا يمكنك تعديل حساب بدور مساوٍ لدورك أو أعلى." });
        if (user.Id == CurrentUserId && request.Role is not null && request.Role != user.Role)
            return BadRequest(new { message = "لا يمكنك تغيير دور حسابك." });

        if (!string.IsNullOrWhiteSpace(request.Name)) user.Name = request.Name!.Trim();

        if (request.Role is not null)
        {
            if (request.Role >= CurrentRole)
                return BadRequest(new { message = "لا يمكنك تعيين دور مساوٍ لدورك أو أعلى." });
            user.Role = request.Role.Value;
        }

        if (request.States is not null) user.States = request.States.Value;
        if (request.Access is not null) user.Access = request.Access.Value;

        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            if (request.Password.Length < 8)
                return BadRequest(new { message = "كلمة المرور يجب ألا تقل عن 8 أحرف." });
            user.Password = passwords.Hash(request.Password);
        }

        await db.SaveChangesAsync();
        return Ok(user.ToDto());
    }
}

public record UpdateUserRequest(
    string? Name,
    short? Role,
    short? States,
    short? Access,
    string? Password);
