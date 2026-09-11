using System.Security.Claims;
using System.Text.Encodings.Web;
using EduspaceApi.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace EduspaceApi.Auth;

/// <summary>
/// مصادقة بالتوكن المخزَّن في عمود <c>token</c> بجدول Edu_Users.
/// العميل يرسل:  Authorization: Bearer &lt;token&gt;
/// وهذه مطابقة لتصميم قاعدة البيانات المتفق عليه (عمود توكن لكل مستخدم).
/// </summary>
public class TokenAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "EduToken";

    private readonly EduDbContext _db;

    public TokenAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        EduDbContext db) : base(options, logger, encoder)
    {
        _db = db;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (string.IsNullOrWhiteSpace(header) ||
            !header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.NoResult();
        }

        var token = header["Bearer ".Length..].Trim();
        if (token.Length == 0) return AuthenticateResult.NoResult();

        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Token == token);
        if (user is null) return AuthenticateResult.Fail("توكن غير صالح.");
        if (user.Access != 1) return AuthenticateResult.Fail("الحساب غير مفعّل.");

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Name ?? user.Email),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Role, user.Role.ToString()),
        };

        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
    }
}
