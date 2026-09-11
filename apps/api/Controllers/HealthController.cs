using EduspaceApi.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Controllers;

/// <summary>
/// فحص الاتصال بقاعدة البيانات.
/// الغرض: التأكد **من أي قاعدة بيانات فعليًا** يقرأ الـ API — وليس بيانات وهمية.
/// </summary>
[ApiController]
[Route("api/health")]
public class HealthController(
    EduDbContext db,
    IWebHostEnvironment environment,
    IConfiguration configuration) : ControllerBase
{
    /// <summary>المحرّك المتصل + هل الاتصال ناجح. التفاصيل الإضافية في بيئة التطوير فقط.</summary>
    [HttpGet("db")]
    [AllowAnonymous]
    public async Task<IActionResult> Database()
    {
        var provider = configuration["Database:Provider"] ?? "Sqlite";

        var canConnect = false;
        try
        {
            canConnect = await db.Database.CanConnectAsync();
        }
        catch
        {
            canConnect = false;
        }

        var result = new Dictionary<string, object?>
        {
            ["provider"] = provider,
            ["canConnect"] = canConnect,
            // المشروع لا يستخدم EF Migrations إطلاقًا — المخطط من database/schema.sql
            ["usesMigrations"] = false,
        };

        if (canConnect && environment.IsDevelopment())
        {
            result["usersCount"] = await db.Users.CountAsync();

            try
            {
                await db.Database.OpenConnectionAsync();
                result["serverVersion"] = db.Database.GetDbConnection().ServerVersion;
                await db.Database.CloseConnectionAsync();
            }
            catch
            {
                // نسخة السيرفر غير متاحة — نتجاهلها
            }
        }

        return Ok(result);
    }
}
