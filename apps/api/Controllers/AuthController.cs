using System.Security.Claims;
using EduspaceApi.Contracts;
using EduspaceApi.Data;
using EduspaceApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(
    EduDbContext db,
    PasswordService passwords,
    SessionTokenService tokens,
    LoginAttemptTracker attempts) : ControllerBase
{
    /// <summary>تسجيل دخول موظفي المنصة (Edu_Users).</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("strict")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        var email = request.Email?.Trim().ToLowerInvariant();
        var password = request.Password ?? string.Empty;

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            return BadRequest(new { message = "من فضلك أدخل البريد الإلكتروني وكلمة المرور." });

        // القفل لكل حساب — يُطبَّق قبل bcrypt حتى لا يدفع المهاجم تكلفة التجزئة عنّا
        var lockSeconds = attempts.LockoutSecondsLeft(Models.AccountKinds.Staff, email);
        if (lockSeconds > 0)
        {
            Response.Headers.RetryAfter = lockSeconds.ToString();
            return StatusCode(StatusCodes.Status429TooManyRequests,
                new { message = "محاولات كثيرة على هذا الحساب. انتظر دقائق ثم أعد المحاولة." });
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);

        // رسالة واحدة للحالتين حتى لا نكشف ما إذا كان البريد مسجَّلًا أم لا
        if (user is null || !passwords.Verify(password, user.Password))
        {
            attempts.RecordFailure(Models.AccountKinds.Staff, email);
            return Unauthorized(new { message = "البريد الإلكتروني أو كلمة المرور غير صحيحة." });
        }

        attempts.RecordSuccess(Models.AccountKinds.Staff, email);

        // access = 0 يعني الحساب غير مفعّل ولا يستطيع الدخول إطلاقًا
        if (user.Access != 1)
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "الحساب غير مفعّل. تواصل مع إدارة مؤسستك." });

        var staffToken = await tokens.IssueAsync(Models.AccountKinds.Staff, user.Id);
        user.Token = staffToken;
        await db.SaveChangesAsync();

        return Ok(new AuthResponse(staffToken, user.ToDto()));
    }

    /// <summary>تسجيل دخول الطالب — جدول Edu_Students له توكنه المستقل.</summary>
    [HttpPost("students/login")]
    [AllowAnonymous]
    [EnableRateLimiting("strict")]
    public async Task<IActionResult> LoginStudent([FromBody] LoginRequest request)
    {
        var email = request.Email?.Trim().ToLowerInvariant();
        var password = request.Password ?? string.Empty;

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            return BadRequest(new { message = "من فضلك أدخل البريد الإلكتروني وكلمة المرور." });

        var lockStudent = attempts.LockoutSecondsLeft(Models.AccountKinds.Student, email);
        if (lockStudent > 0)
        {
            Response.Headers.RetryAfter = lockStudent.ToString();
            return StatusCode(StatusCodes.Status429TooManyRequests,
                new { message = "محاولات كثيرة على هذا الحساب. انتظر دقائق ثم أعد المحاولة." });
        }

        var student = await db.Students.FirstOrDefaultAsync(s => s.Email == email);
        if (student is null || !passwords.Verify(password, student.Password))
        {
            attempts.RecordFailure(Models.AccountKinds.Student, email);
            return Unauthorized(new { message = "البريد الإلكتروني أو كلمة المرور غير صحيحة." });
        }

        attempts.RecordSuccess(Models.AccountKinds.Student, email);

        if (student.Access != 1)
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "الحساب غير مفعّل. تواصل مع إدارة مؤسستك." });

        var studentToken = await tokens.IssueAsync(Models.AccountKinds.Student, student.Id);
        student.Token = studentToken;
        await db.SaveChangesAsync();

        return Ok(new AuthResponse(studentToken, student.ToAuthDto()));
    }

    /// <summary>تسجيل دخول ولي الأمر — جدول Edu_Parents.</summary>
    [HttpPost("parents/login")]
    [AllowAnonymous]
    [EnableRateLimiting("strict")]
    public async Task<IActionResult> LoginParent([FromBody] LoginRequest request)
    {
        var email = request.Email?.Trim().ToLowerInvariant();
        var password = request.Password ?? string.Empty;

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            return BadRequest(new { message = "من فضلك أدخل البريد الإلكتروني وكلمة المرور." });

        var lockParent = attempts.LockoutSecondsLeft(Models.AccountKinds.Parent, email);
        if (lockParent > 0)
        {
            Response.Headers.RetryAfter = lockParent.ToString();
            return StatusCode(StatusCodes.Status429TooManyRequests,
                new { message = "محاولات كثيرة على هذا الحساب. انتظر دقائق ثم أعد المحاولة." });
        }

        var parent = await db.Parents.FirstOrDefaultAsync(p => p.Email == email);
        if (parent is null || !passwords.Verify(password, parent.Password))
        {
            attempts.RecordFailure(Models.AccountKinds.Parent, email);
            return Unauthorized(new { message = "البريد الإلكتروني أو كلمة المرور غير صحيحة." });
        }

        attempts.RecordSuccess(Models.AccountKinds.Parent, email);

        if (parent.Access != 1)
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "الحساب غير مفعّل. تواصل مع إدارة مؤسستك." });

        var parentToken = await tokens.IssueAsync(Models.AccountKinds.Parent, parent.Id);
        parent.Token = parentToken;
        await db.SaveChangesAsync();

        return Ok(new AuthResponse(parentToken, parent.ToAuthDto()));
    }

    /// <summary>بيانات المستخدم الحالي حسب التوكن المرسل (موظف أو طالب أو ولي أمر).</summary>
    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> Me()
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();

        if (IsParent)
        {
            var parent = await db.Parents.AsNoTracking().FirstOrDefaultAsync(p => p.Id == userId);
            return parent is null ? Unauthorized() : Ok(parent.ToAuthDto());
        }

        if (IsStudent)
        {
            var student = await db.Students.AsNoTracking().FirstOrDefaultAsync(s => s.Id == userId);
            return student is null ? Unauthorized() : Ok(student.ToAuthDto());
        }

        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        return user is null ? Unauthorized() : Ok(user.ToDto());
    }

    /// <summary>تسجيل الخروج لهذا الجهاز فقط — بقية الأجهزة تبقى داخلة (Edu_Tokens).</summary>
    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();

        var header = Request.Headers.Authorization.ToString();
        if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            await tokens.RevokeAsync(header["Bearer ".Length..].Trim());

        if (IsParent)
        {
            var parent = await db.Parents.FirstOrDefaultAsync(p => p.Id == userId);
            if (parent is not null)
            {
                parent.Token = null;
                await db.SaveChangesAsync();
            }
            return NoContent();
        }

        if (IsStudent)
        {
            var student = await db.Students.FirstOrDefaultAsync(s => s.Id == userId);
            if (student is not null)
            {
                student.Token = null;
                await db.SaveChangesAsync();
            }
            return NoContent();
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user is not null)
        {
            user.Token = null;
            await db.SaveChangesAsync();
        }

        return NoContent();
    }

    private bool IsStudent =>
        User.FindFirstValue(Auth.TokenAuthenticationHandler.AudClaim) == "student";

    private bool IsParent =>
        User.FindFirstValue(Auth.TokenAuthenticationHandler.AudClaim) == "parent";

    private bool TryGetUserId(out long userId)
    {
        userId = 0;
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return long.TryParse(raw, out userId);
    }
}
