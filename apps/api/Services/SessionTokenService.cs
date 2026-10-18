using System.Security.Cryptography;
using EduspaceApi.Data;
using EduspaceApi.Models;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Services;

/// <summary>
/// جلسات الدخول متعددة الأجهزة (Edu_Tokens): كل جهاز يسجّل دخولە بتوكن مستقل،
/// فالدخول من الهاتف لا يُبطل جلسة الحاسوب — والعمود `token` في جداول الحسابات
/// يبقى مجرد آخر توكن منشأ لأغراض العرض والتوافق.
/// الحد 10 أجهزة للحساب الواحد؛ الأقدم يُلغى أولًا.
/// </summary>
public class SessionTokenService(EduDbContext db)
{
    private const int TokenBytes = 32;
    private const int MaxSessionsPerAccount = 10;

    public string CreateToken()
    {
        var raw = RandomNumberGenerator.GetBytes(TokenBytes);
        return Convert.ToBase64String(raw)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    public async Task<string> IssueAsync(string kind, long accountId, CancellationToken ct = default)
    {
        var token = CreateToken();
        db.Tokens.Add(new EduToken { Kind = kind, AccountId = accountId, Value = token });

        var stale = await db.Tokens
            .Where(t => t.Kind == kind && t.AccountId == accountId)
            .OrderByDescending(t => t.Id)
            .Skip(MaxSessionsPerAccount - 1)
            .ToListAsync(ct);
        if (stale.Count > 0) db.Tokens.RemoveRange(stale);

        await db.SaveChangesAsync(ct);
        return token;
    }

    public Task<EduToken?> FindAsync(string token, CancellationToken ct = default) =>
        db.Tokens.AsNoTracking().FirstOrDefaultAsync(t => t.Value == token, ct);

    public async Task RevokeAsync(string token, CancellationToken ct = default)
    {
        var row = await db.Tokens.FirstOrDefaultAsync(t => t.Value == token, ct);
        if (row is null) return;
        db.Tokens.Remove(row);
        await db.SaveChangesAsync(ct);
    }
}
