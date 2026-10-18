using System.Security.Claims;
using System.Text.Encodings.Web;
using EduspaceApi.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace EduspaceApi.Auth;

/// <summary>
/// مصادقة بالتوكن: يبحث في Edu_Tokens (جلسات متعددة الأجهزة)، ثم يسحب الحساب
/// المالك للتوكن من جدول نوعه — Edu_Users للموظفين وEdu_Students للطلاب
/// وEdu_Parents لأولياء الأمر — ويُضاف claim باسم <c>edu:aud</c> يميّز الجدولَين.
/// العميل يرسل:  Authorization: Bearer &lt;token&gt;
/// </summary>
public class TokenAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "EduToken";

    /// <summary>يميّز توكن الموظفين (staff) عن توكن الطلاب (student) — المعرّفات رقمية في جدولين.</summary>
    public const string AudClaim = "edu:aud";

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

        var session = await _db.Tokens.AsNoTracking().FirstOrDefaultAsync(t => t.Value == token);
        if (session is null) return AuthenticateResult.Fail("توكن غير صالح.");

        List<Claim>? claims = session.Kind switch
        {
            Models.AccountKinds.Staff => (await _db.Users.AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == session.AccountId))is { } u && u.Access == 1
                ? StaffClaims(u) : null,
            Models.AccountKinds.Student => (await _db.Students.AsNoTracking()
                .FirstOrDefaultAsync(s => s.Id == session.AccountId)) is { } st && st.Access == 1
                ? AccountClaims(st.Id, st.Name ?? st.Email, st.Email, "student") : null,
            Models.AccountKinds.Parent => (await _db.Parents.AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == session.AccountId)) is { } pa && pa.Access == 1
                ? AccountClaims(pa.Id, pa.Name ?? pa.Email, pa.Email, "parent") : null,
            _ => null,
        };

        return claims is null
            ? AuthenticateResult.Fail("توكن غير صالح أو الحساب غير مفعّل.")
            : Success(claims);
    }

    private static List<Claim> StaffClaims(Models.EduUser u) =>
    [
        new(ClaimTypes.NameIdentifier, u.Id.ToString()),
        new(ClaimTypes.Name, u.Name ?? u.Email),
        new(ClaimTypes.Email, u.Email),
        new(ClaimTypes.Role, u.Role.ToString()),
        new(AudClaim, "staff"),
    ];

    private static List<Claim> AccountClaims(long id, string name, string email, string aud) =>
    [
        new(ClaimTypes.NameIdentifier, id.ToString()),
        new(ClaimTypes.Name, name),
        new(ClaimTypes.Email, email),
        new(ClaimTypes.Role, aud),
        new(AudClaim, aud),
    ];

    private AuthenticateResult Success(List<Claim> claims)
    {
        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
    }
}
