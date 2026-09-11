using EduspaceApi.Contracts;
using EduspaceApi.Data;
using EduspaceApi.Models;
using EduspaceApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Controllers;

/// <summary>
/// تهيئة أول حساب في المنصة.
/// لا يمكن استخدامه إلا إذا كانت قاعدة البيانات **بلا أي مستخدم** — فهو يُعطِّل
/// نفسه تلقائيًا بعد إنشاء أول حساب (الأونر).
/// </summary>
[ApiController]
[Route("api/setup")]
public class SetupController(EduDbContext db, PasswordService passwords) : ControllerBase
{
    [HttpPost("owner")]
    [AllowAnonymous]
    public async Task<IActionResult> CreateFirstOwner([FromBody] BootstrapOwnerRequest request)
    {
        if (await db.Users.AnyAsync())
            return Conflict(new { message = "توجد حسابات بالفعل في المنصة — استخدم تسجيل الدخول." });

        var email = request.Email?.Trim().ToLowerInvariant();
        var password = request.Password ?? string.Empty;

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            return BadRequest(new { message = "البريد الإلكتروني وكلمة المرور مطلوبان." });
        if (password.Length < 8)
            return BadRequest(new { message = "كلمة المرور يجب ألا تقل عن 8 أحرف." });

        var owner = new EduUser
        {
            Name = string.IsNullOrWhiteSpace(request.Name) ? "مالك المنصة" : request.Name!.Trim(),
            Email = email,
            Password = passwords.Hash(password),
            Role = UserRoles.Owner,
            States = 1,
            Access = 1,
        };

        db.Users.Add(owner);
        await db.SaveChangesAsync();

        return Ok(owner.ToDto());
    }
}
