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
public class SetupController(EduDbContext db, PasswordService passwords, IConfiguration config) : ControllerBase
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

        // أول مالك = تأسيس أول شركة على القاعدة (قسم 11).
        var tenant = new EduTenant
        {
            Name = string.IsNullOrWhiteSpace(request.Name) ? "المؤسسة الأولى" : request.Name!.Trim(),
        };
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var owner = new EduUser
        {
            TenantId = tenant.Id,
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

    public record ProvisionTenantRequest(string? Name, string? Email, string? Password);

    /// <summary>
    /// تهيئة شركة إضافية (مالك + شركة جديدة) على نفس القاعدة — نموذج white-label.
    /// محمية بمفتاح توفير يعيش في بيئة الخادم فقط (`Setup:ProvisionKey`)؛
    /// بلا مفتاح مضبوط تتصرف النقطة كأنها غير موجودة.
    /// </summary>
    [HttpPost("tenant")]
    [AllowAnonymous]
    public async Task<IActionResult> ProvisionTenant([FromBody] ProvisionTenantRequest request)
    {
        var provisionKey = config["Setup:ProvisionKey"];
        if (string.IsNullOrWhiteSpace(provisionKey))
            return NotFound();

        var headerKey = Request.Headers["X-Provision-Key"].ToString();
        if (string.IsNullOrWhiteSpace(headerKey) || headerKey != provisionKey)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "مفتاح التوفير غير صحيح." });

        var email = request.Email?.Trim().ToLowerInvariant();
        var password = request.Password ?? string.Empty;

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            return BadRequest(new { message = "البريد الإلكتروني وكلمة المرور مطلوبان." });
        if (password.Length < 8)
            return BadRequest(new { message = "كلمة المرور يجب ألا تقل عن 8 أحرف." });
        if (await db.Users.AnyAsync(u => u.Email == email))
            return Conflict(new { message = "هذا البريد الإلكتروني مستخدم بالفعل." });

        var tenant = new EduTenant
        {
            Name = string.IsNullOrWhiteSpace(request.Name) ? "مؤسسة جديدة" : request.Name!.Trim(),
        };
        db.Tenants.Add(tenant);
        // الحفظ هنا لا في الأخير: tenant.Id يُولَّد عند الإدراج، ومالك الشركة يحتاجه فورًا
        await db.SaveChangesAsync();

        var owner = new EduUser
        {
            TenantId = tenant.Id,
            Name = string.IsNullOrWhiteSpace(request.Name) ? "مالك المنصة" : request.Name!.Trim(),
            Email = email,
            Password = passwords.Hash(password),
            Role = UserRoles.Owner,
            States = 1,
            Access = 1,
        };
        db.Users.Add(owner);
        await db.SaveChangesAsync();

        return Ok(new { tenantId = tenant.Id, tenantName = tenant.Name, owner = owner.ToDto() });
    }
}
