using System.Security.Claims;
using EduspaceApi.Contracts;
using EduspaceApi.Data;
using EduspaceApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(EduDbContext db, PasswordService passwords, TokenService tokens) : ControllerBase
{
    /// <summary>تسجيل الدخول — يرجّع التوكن وبيانات المستخدم.</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        var email = request.Email?.Trim().ToLowerInvariant();
        var password = request.Password ?? string.Empty;

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            return BadRequest(new { message = "من فضلك أدخل البريد الإلكتروني وكلمة المرور." });

        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);

        // رسالة واحدة للحالتين حتى لا نكشف ما إذا كان البريد مسجَّلًا أم لا
        if (user is null || !passwords.Verify(password, user.Password))
            return Unauthorized(new { message = "البريد الإلكتروني أو كلمة المرور غير صحيحة." });

        // access = 0 يعني الحساب غير مفعّل ولا يستطيع الدخول إطلاقًا
        if (user.Access != 1)
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "الحساب غير مفعّل. تواصل مع إدارة مؤسستك." });

        user.Token = tokens.CreateToken();
        await db.SaveChangesAsync();

        return Ok(new AuthResponse(user.Token, user.ToDto()));
    }

    /// <summary>بيانات المستخدم الحالي حسب التوكن المرسل.</summary>
    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> Me()
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();

        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        return user is null ? Unauthorized() : Ok(user.ToDto());
    }

    /// <summary>تسجيل الخروج — يُلغي التوكن.</summary>
    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user is not null)
        {
            user.Token = null;
            await db.SaveChangesAsync();
        }

        return NoContent();
    }

    private bool TryGetUserId(out long userId)
    {
        userId = 0;
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return long.TryParse(raw, out userId);
    }
}
