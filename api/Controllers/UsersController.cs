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

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] short? role, [FromQuery] string? search)
    {
        if (CurrentRole < UserRoles.Manager) return Forbid();

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
        if (CurrentRole < UserRoles.Manager) return Forbid();

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
}
