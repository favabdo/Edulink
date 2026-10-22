using System.Threading.RateLimiting;
using EduspaceApi.Auth;
using EduspaceApi.Configuration;
using EduspaceApi.Data;
using EduspaceApi.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
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

// الأسرار (كلمة سر قاعدة البيانات، المفاتيح) **لا تُكتب في الكود إطلاقًا**.
// تُقرأ من متغيّرات البيئة أو من ملف .env المحلي (المستثنى من Git).
// يُحمَّل .env قبل إنشاء الـ builder لتكون الأولوية:
//     متغيّرات البيئة الحقيقية > .env > appsettings*.json
DotEnv.ApplyToEnvironment();

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();

// ---------------------------------------------------------------------------
// قاعدة البيانات: نفس الكود يعمل على Supabase (PostgreSQL) وعلى SQL Server،
// والتبديل من الإعدادات فقط (`Database:Provider`) بلا أي تغيير في الكود.
//
// ⚠️ المصدر الوحيد لمخطط قاعدة البيانات هو database/schema.sql. لا تُستخدم
//    EF Migrations إطلاقًا في هذا المشروع، ولا يُنشئ التطبيق جداول على
//    Postgres/SqlServer أبدًا (الحاجز في أسفل هذا الملف).
//
//    Provider = Sqlite    → تطوير محلي فقط (ينشئ ملف قاعدة بيانات من الكيانات)
//    Provider = Postgres  → Supabase
//    Provider = SqlServer → سيرفر الشركة: قسم T-SQL في آخر database/schema.sql
// ---------------------------------------------------------------------------
var provider = builder.Configuration["Database:Provider"] ?? "Sqlite";
var connectionString = builder.Configuration.GetConnectionString(provider) ?? string.Empty;

var isPostgres =
    provider.Equals("Postgres", StringComparison.OrdinalIgnoreCase) ||
    provider.Equals("PostgreSQL", StringComparison.OrdinalIgnoreCase);
var isSqlServer = provider.Equals("SqlServer", StringComparison.OrdinalIgnoreCase);

// ---------------------------------------------------------------------------
// حارس الإنتاج: خارج بيئة Development لا يُقبل إلا قاعدة حقيقية صريحة.
// الثلاثة التي تجعل شاشة تعرض بيانات ليست قاعدة المؤسسة:
//   1) provider ضمني/SQLite  → يعمل على ملف `eduspace.dev.db` المحلي بصمت
//   2) سلسلة اتصال فارغة     → اتصال يفشل متأخرًا عند أول طلب بدل الإقلاع
//   3) EnsureCreated = true   → التطبيق يبني جداول من الكيانات بدل schema.sql
// فالرفض هنا عند الإقلاع برسالة عربية محددة، لا تصحيح صامت ولا تشغيل ناقص.
// ---------------------------------------------------------------------------
if (!builder.Environment.IsDevelopment())
{
    var problems = new List<string>();

    if (!isPostgres && !isSqlServer)
        problems.Add(
            $"Database:Provider = \"{provider}\" — خارج Development المسموح \"SqlServer\" أو \"Postgres\" فقط " +
            "(SQLite للتطوير المحلي وحده، وإلا تعمل المنصة على ملف قاعدة بيانات محلّي بدل قاعدة المؤسسة).");

    if (string.IsNullOrWhiteSpace(connectionString))
        problems.Add($"ConnectionStrings:{provider} فارغة أو غير موجودة.");

    if (builder.Configuration.GetValue("Database:EnsureCreated", false))
        problems.Add("Database:EnsureCreated = true — المخطط من database/schema.sql وحده، والمسموح false.");

    if (problems.Count > 0)
    {
        var startupLogger = LoggerFactory.Create(b => b.AddConsole()).CreateLogger("Startup");
        startupLogger.LogCritical(
            "الإقلاع مرفوض في بيئة {Environment}:\n{Reasons}\nالعبارة الجاهزة: انسخ apps/api/.env.example إلى apps/api/.env واملأ Provider وسلسلة الاتصال.",
            builder.Environment.EnvironmentName,
            string.Join("\n", problems.Select(p => "  • " + p)));
        Environment.Exit(1);
    }
}

// Supabase تعطي سلسلة بصيغة URI — تُحوَّل هنا إلى صيغة Npgsql تلقائيًا،
// فيكفي لصق سلسلة Supabase كما هي بلا أي تعديل.
var postgresConnectionString = ConnectionStringNormalizer.ForNpgsql(connectionString);

// SQL Server: السلسلة تُترك كما كُتبت (Server/Database/User ID/Password)،
// ويُضاف ما يلزم لاتصال مستقر إن لم يُذكر صراحةً.
var sqlServerConnectionString = ConnectionStringNormalizer.ForSqlServer(connectionString);

// تجميع سياق قاعدة البيانات: تحت الضغط (مئات اتصالات الإشارة المتزامنة)
// إنشاء سياق لكل طلب مكلف — القياسات عند 500 غرفة هي التي ستثبت الرقم،
// وسعة التجميع تُضبط أكبر قليلًا من مجمع اتصالات Npgsql (100 افتراضيًا).
builder.Services.AddDbContextPool<EduDbContext>(options =>
{
    if (isPostgres)
    {
        options.UseNpgsql(postgresConnectionString);
    }
    else if (isSqlServer)
    {
        options.UseSqlServer(sqlServerConnectionString);
    }
    else
    {
        options.UseSqlite(string.IsNullOrWhiteSpace(connectionString)
            ? "Data Source=eduspace.dev.db"
            : connectionString);
    }
}, poolSize: 128);

builder.Services.AddSingleton<LoginAttemptTracker>();
builder.Services.AddScoped<PasswordService>();
builder.Services.AddScoped<SessionTokenService>();
builder.Services.AddScoped<NotificationService>();

// الحصص التي مرّ موعدها دون أن تُفتح: تُقفل no_show ويُشعَر بها الطالب وولي أمره والمدرس
builder.Services.AddHostedService<MissedSessionWatcher>();

builder.Services
    .AddAuthentication(TokenAuthenticationHandler.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, TokenAuthenticationHandler>(
        TokenAuthenticationHandler.SchemeName, _ => { });
builder.Services.AddAuthorization();

// SignalR (غرف الاجتماعات): الهدف 500 حصة متزامنة ≈ 1500-2000 اتصال WebSocket.
//نبضات KeepAlive قصيرة تصفّي الاتصالات الميتة سريعًا، وسقف الرسالة يكفي الإشارات والقلم.
builder.Services.AddSignalR(options =>
{
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(30);
    options.HandshakeTimeout = TimeSpan.FromSeconds(10);
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
    options.MaximumReceiveMessageSize = 32 * 1024;
});

// ---------------------------------------------------------------------------
// عنوان العميل الحقيقي خلف nginx (X-Forwarded-For).
//
// بدونه يكون RemoteIpAddress = عنوان حاوية nginx لكل الزوار: مدرسة كاملة
// تُحسب عميلًا واحدًا عند حدّ الدخول (30 محاولة/دقيقة للجميع معًا) وتُرفض
// طلباتها بـ 429، ولا يبقى لأي حماية مبنية على الـ IP أي معنى.
//
//   Network:UseForwardedHeaders = true
//   Network:TrustedProxies      = ["127.0.0.1"]      عناوين الوسيط مباشرة
//   Network:TrustedNetworks     = ["172.18.0.0/16"]  شبكة Docker bridge
//   Network:TrustAllProxies     = true  ← فقط حين لا منفذ مكشوف للـ API
//                                          (nginx هو المدخل الوحيد كما في compose)
// يُقبل الترويسة من المصادر المعروفة فقط، فلا يستطيع العميل أن يزيّف IPه.
// ---------------------------------------------------------------------------
var useForwardedHeaders = builder.Configuration.GetValue("Network:UseForwardedHeaders", false);
if (useForwardedHeaders)
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;

        // nginx يضيف عنوان العميل الحقيقي في **آخر** القائمة (`$proxy_add_x_forwarded_for`)،
        // فيُؤخَذ منها ذلك الأخير فقط. بدون هذا القيد يستطيع العميل أن يرسل
        // `X-Forwarded-For` من عنده ويصنع حزنة جديدة لكل محاولة فيفلت من حدّ الدخول.
        // (لو وُضع CDN أمام nginx: أضف مداه إلى TrustedNetworks وارفع الحدّ إلى 2.)
        options.ForwardLimit = builder.Configuration.GetValue("Network:ForwardedHeadersLimit", 1);

        var trustAll = builder.Configuration.GetValue("Network:TrustAllProxies", false);
        if (trustAll)
        {
            // لا قوائم معروفة: نتوسّط أن كل من يصل للـ API هو الوسيط نفسه
            options.KnownProxies.Clear();
            options.KnownIPNetworks.Clear();
            return;
        }

        foreach (var proxy in builder.Configuration.GetSection("Network:TrustedProxies").Get<string[]>() ?? [])
        {
            if (System.Net.IPAddress.TryParse(proxy, out var ip)) options.KnownProxies.Add(ip);
        }

        foreach (var cidr in builder.Configuration.GetSection("Network:TrustedNetworks").Get<string[]>() ?? [])
        {
            if (System.Net.IPNetwork.TryParse(cidr, out var network)) options.KnownIPNetworks.Add(network);
        }
    });
}

// ---------------------------------------------------------------------------
// تحديد معدل الطلبات: حماية نقاط الدخول من التخمين والتكرار الآلي.
//
//   strict  → محاولات تسجيل الدخول: لكل **IP** (لا يُقسم بالمستخدم: التوكن
//             يُنشأ بحرية، فهو مِقياس هجوم التخمين).
//   default → بقية /api: لكل **جلسة** (بوابة Bearer) وإن لم توجد فلكل IP.
//             السبب: مدرسة كاملة خلف NAT واحد تشترك IPًا واحدًا — لو قُسِّم
//             بالـ IP لكانت 200 طلب/دقيقة لكل طلاب المدرسة ومدرسيها معًا.
//
// الحدّان قابلان للضبط لكل عميل بلا تعديل كود:
//   RateLimit:LoginPermitPerMinute   (افتراضي الإنتاج 120 لكل IP)
//   RateLimit:ApiPermitPerMinute     (افتراضي الإنتاج 600 لكل جلسة)
//   RateLimit:HubPermitPerMinute     (افتراضي الإنتاج 3000 لكل جهاز)
//   + قفل لكل حساب: RateLimit:LoginFailuresPerAccount / LoginLockoutMinutes
//   اتصال الغرفة (/hubs) له حصّة مستقلة **لكل جهاز** (مفتاحها access_token من
//   استعلام الاتصال، ومع غيابه بالـ IP) — انظر المفاتيح أدناه.
// ---------------------------------------------------------------------------
var allowLocalDev = builder.Environment.IsDevelopment();
// 120/دقيقة/IP لا 30: مدرسة كاملة تدخل من NAT واحد عند بداية اليوم، وكل تحقق
// كلمة مرور bcrypt مكلف CPU — الحدّ الضيق هنا قطع للخدمة لا حماية.
// التكملة لكل حساب (لا لكل IP وحده) في LoginAttemptTracker.
var loginPermit = builder.Configuration.GetValue("RateLimit:LoginPermitPerMinute", 120);
var apiPermit = builder.Configuration.GetValue("RateLimit:ApiPermitPerMinute", 600);
var hubPermit = builder.Configuration.GetValue("RateLimit:HubPermitPerMinute", 3_000);

// مفتاح الـ IP وحده — يُستخدم لحدّ الدخول واتصالات الغرفة
static string IpPartitionKey(HttpContext http) =>
    $"ip:{http.Connection.RemoteIpAddress?.ToString() ?? "unknown"}";

// مفتاح التجزئة: اتصال الغرفة بحصّته، ثم بصمة الجلسة المُصادَق عليها، ثم الـ IP
static string RateLimitPartitionKey(HttpContext http)
{
    if (http.Request.Path.StartsWithSegments("/hubs"))
    {
        // SignalR يمرّر التوكن في query string — الجهاز هو وحدة الحساب هنا:
        // مدرسة كاملة خلف NAT واحد كانت ستصطدم بسقف اتصالات العنوان كله
        // (4000 اتصال من IP واحد > 3000/دقيقة) رغم أن كل جهاز يفتح اتصالًا واحدًا.
        var qtoken = http.Request.Query["access_token"].ToString();
        if (qtoken.Length >= 16) return $"hub:session:{qtoken.AsSpan(0, 16)}";
        return "hub:" + IpPartitionKey(http);
    }

    var header = http.Request.Headers.Authorization.ToString();
    if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
    {
        var token = header.Substring(7);
        if (token.Length >= 16) return $"session:{token.AsSpan(0, 16)}";
    }

    return IpPartitionKey(http);
}

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // المُقيِّد العام: يعمل على كل طلب مستقلًا عن بيانات Endpoint، فلا تُلغِيه
    // سياسة مسارية أخرى (هذا كان سبب أن حدّ الدخول لم يُطبَّق أبدًا — انظر §أدناه).
    //
    // اتصال الـ WebSocket (‎/hubs) خارج حصّة REST: كل جهاز يفتح اتصالًا واحدًا
    // طويل الأمد، والمدرسة كلها خلف IP واحد — لو حُسب الاتصال ضمن حدّ الـ API
    // لكانت إعادة الاتصال بعد انقطاع = «اختراق». لذا له حصّته وحده:
    //   RateLimit:HubPermitPerMinute (افتراضي 3000 لكل IP)
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: RateLimitPartitionKey(http),
            factory: key => new FixedWindowRateLimiterOptions
            {
                PermitLimit = key.StartsWith("hub:", StringComparison.Ordinal)
                    ? (allowLocalDev ? 100_000 : hubPermit)
                    : (allowLocalDev ? 10_000 : apiPermit),
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));

    // سياسة مسارية لنقاط الدخول فقط — تُضاف فوق العام فلا تتنافسان على التفسير
    options.AddPolicy("strict", http =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: IpPartitionKey(http),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = allowLocalDev ? 1_000 : loginPermit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
});

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
var isLocalSqlite = !isPostgres && !isSqlServer;

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
        else if (isSqlServer)
        {
            dbLogger.LogInformation("جهة الاتصال: {Target}",
                ConnectionStringNormalizer.DescribeSqlServer(connectionString));
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

// يجب أن يعمل قبل أي Middleware يقرأ عنوان العميل (محدّدات المعدل أعلاه تعتمد عليه)
if (useForwardedHeaders) app.UseForwardedHeaders();

app.UseRateLimiter();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<EduspaceApi.Hubs.MeetingHub>("/hubs/meetings");

app.Run();
