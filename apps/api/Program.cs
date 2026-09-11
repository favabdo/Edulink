using EduspaceApi.Auth;
using EduspaceApi.Data;
using EduspaceApi.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;

// رسائل السجل مكتوبة بالعربية — نضبط ترميز الطرفية على UTF-8 حتى تظهر صحيحة
// على Windows (بدون هذا تظهر ؟؟؟؟ في الطرفية).
try
{
    Console.OutputEncoding = System.Text.Encoding.UTF8;
}
catch
{
    // بعض البيئات لا تملك طرفية — نتجاهل
}

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

var isPostgres =
    provider.Equals("Postgres", StringComparison.OrdinalIgnoreCase) ||
    provider.Equals("PostgreSQL", StringComparison.OrdinalIgnoreCase);

// Supabase تعطي سلسلة بصيغة URI — تُحوَّل هنا إلى صيغة Npgsql تلقائيًا،
// فيكفي لصق سلسلة Supabase كما هي بلا أي تعديل.
var postgresConnectionString = ConnectionStringNormalizer.ForNpgsql(connectionString);

builder.Services.AddDbContext<EduDbContext>(options =>
{
    if (isPostgres)
    {
        options.UseNpgsql(postgresConnectionString);
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
// ---------------------------------------------------------------------------
// إنشاء الجداول من نموذج الكيانات — **للتطوير المحلي على SQLite فقط**.
//
// على Supabase (PostgreSQL) أو SQL Server لا يُنشئ التطبيق ولا يعدّل أي جدول
// إطلاقًا: المخطط يأتي من `database/schema.sql` وحده. هذا الحاجز موضوع في الكود
// نفسه حتى لا يحدث الإنشاء بالخطأ لو نُسي إعداد EnsureCreated.
// ---------------------------------------------------------------------------
var isLocalSqlite =
    !provider.Equals("Postgres", StringComparison.OrdinalIgnoreCase) &&
    !provider.Equals("PostgreSQL", StringComparison.OrdinalIgnoreCase) &&
    !provider.Equals("SqlServer", StringComparison.OrdinalIgnoreCase);

if (isLocalSqlite && app.Configuration.GetValue("Database:EnsureCreated", false))
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

// ---------------------------------------------------------------------------
// فحص قاعدة البيانات عند الإقلاع.
// يطبع في الطرفية على أي محرّك يعمل الـ API وهل الاتصال ناجح فعلًا — بدل التخمين.
// ولو فشل الاتصال يطبع سببًا واضحًا ويستمر في العمل، فتبقى /api/health/db قادرة
// على إخبارك بالحالة.
// ---------------------------------------------------------------------------
if (app.Configuration.GetValue("Database:ProbeOnStartup", true))
{
    using var probeScope = app.Services.CreateScope();
    var probeDb = probeScope.ServiceProvider.GetRequiredService<EduDbContext>();
    var dbLogger = probeScope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Database");

    try
    {
        if (isPostgres)
        {
            // يوضّح للمطوّر أنه متصل فعلًا بأي خادم — بلا كلمة المرور
            dbLogger.LogInformation(
                "جهة الاتصال: {Target}", ConnectionStringNormalizer.Describe(connectionString));
        }

        if (await probeDb.Database.CanConnectAsync())
        {
            var usersCount = await probeDb.Users.CountAsync();
            dbLogger.LogInformation(
                "قاعدة البيانات: {Provider} — الاتصال ناجح ✓ — عدد المستخدمين: {Count}",
                provider, usersCount);
        }
        else
        {
            dbLogger.LogError(
                "قاعدة البيانات: {Provider} — تعذّر الاتصال ✗. راجع ConnectionStrings:{Provider} في appsettings.Development.json",
                provider, provider);
        }
    }
    catch (Exception ex)
    {
        dbLogger.LogError(ex,
            "قاعدة البيانات: {Provider} — فشل الاتصال ✗. تأكد من صحة سلسلة الاتصال ومن تشغيل database/schema.sql",
            provider);
    }
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
