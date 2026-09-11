using EduspaceApi.Auth;
using EduspaceApi.Data;
using EduspaceApi.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();

// ---------------------------------------------------------------------------
// قاعدة البيانات: نفس الكود يعمل على Supabase (PostgreSQL) الآن، وعلى
// SQL Server لاحقًا — والتبديل من الإعدادات فقط، بدون أي تغيير في الكود.
//
// ⚠️ المصدر الوحيد لمخطط قاعدة البيانات هو db/schema.sql. لا تُستخدم
//    EF Migrations إطلاقًا في هذا المشروع.
//
//    Provider = Sqlite   → تطوير محلي فقط (ينشئ ملف قاعدة بيانات من الكيانات)
//    Provider = Postgres → Supabase
//    Provider = SqlServer→ سيرفر الشركة (يُضاف الحزمة عند الحاجة)
// ---------------------------------------------------------------------------
var provider = builder.Configuration["Database:Provider"] ?? "Sqlite";
var connectionString = builder.Configuration.GetConnectionString(provider) ?? string.Empty;

builder.Services.AddDbContext<EduDbContext>(options =>
{
    if (provider.Equals("Postgres", StringComparison.OrdinalIgnoreCase) ||
        provider.Equals("PostgreSQL", StringComparison.OrdinalIgnoreCase))
    {
        options.UseNpgsql(connectionString);
    }
    else
    {
        options.UseSqlite(string.IsNullOrWhiteSpace(connectionString)
            ? "Data Source=eduspace.dev.db"
            : connectionString);
    }
});

builder.Services.AddScoped<PasswordService>();
builder.Services.AddScoped<TokenService>();

builder.Services
    .AddAuthentication(TokenAuthenticationHandler.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, TokenAuthenticationHandler>(
        TokenAuthenticationHandler.SchemeName, _ => { });
builder.Services.AddAuthorization();

var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

// التطوير المحلي فقط: إنشاء ملف SQLite من نموذج الكيانات.
// على Supabase / SQL Server يتم تشغيل db/schema.sql يدويًا — ولا يُنشئ التطبيق شيئًا.
if (app.Configuration.GetValue("Database:EnsureCreated", false))
{
    using var scope = app.Services.CreateScope();
    var devDb = scope.ServiceProvider.GetRequiredService<EduDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");

    await devDb.Database.EnsureCreatedAsync();

    // SQLite قد يُنشئ ملفًا فارغًا فيظنّ EnsureCreated أن القاعدة موجودة ولا ينشئ
    // الجداول. لذلك نتأكد صراحةً من وجود الجداول وننشئها إن لم تكن موجودة.
    var creator = devDb.GetService<IRelationalDatabaseCreator>();
    if (!await creator.HasTablesAsync())
    {
        await creator.CreateTablesAsync();
        logger.LogInformation("Dev database schema created.");
    }
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
