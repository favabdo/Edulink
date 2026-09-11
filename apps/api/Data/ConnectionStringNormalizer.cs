using Npgsql;

namespace EduspaceApi.Data;

/// <summary>
/// تطبيع سلسلة الاتصال قبل تمريرها إلى Npgsql.
///
/// **المشكلة:** Supabase تعطي سلسلة بصيغة URI:
///     postgresql://postgres.abcdefg:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
/// بينما Npgsql يتوقّع صيغة key=value:
///     Host=...;Port=...;Username=...;Password=...;Database=...
/// ولصق صيغة Supabase كما هي في Npgsql يفشل بخطأ «صيغة سلسلة الاتصال غير صحيحة».
///
/// **الحل:** إن كانت السلسلة URI تُحوَّل تلقائيًا، وإن كانت key=value تُترك كما هي.
/// فيستطيع صاحب المشروع لصق سلسلة Supabase **كما هي من لوحة Supabase** بلا أي تعديل.
/// </summary>
public static class ConnectionStringNormalizer
{
    public static string ForNpgsql(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;

        var value = raw.Trim();

        var isUri =
            value.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) ||
            value.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase);

        // أصلًا بصيغة key=value — تُترك كما هي
        if (!isUri) return value;

        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return value;

        var userInfo = uri.UserInfo.Split(':', 2);
        var username = Uri.UnescapeDataString(userInfo[0]);
        var password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : string.Empty;

        var database = uri.AbsolutePath.Trim('/');
        if (string.IsNullOrEmpty(database)) database = "postgres";

        var sslMode = ReadSslMode(uri.Query) ?? SslMode.Require;

        var normalized = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Username = username,
            Password = password,
            Database = database,
            SslMode = sslMode,
            // Supabase تستخدم شهادة وسيطة موقّعة — التحقق الكامل منها يفشل،
            // والتشفير نفسه يبقى مطلوبًا عبر SslMode.
            TrustServerCertificate = sslMode != SslMode.Disable,
            Timeout = 15,
            CommandTimeout = 30,
        };

        return normalized.ConnectionString;
    }

    /// <summary>وصف مختصر للجهة المتصل بها — بلا كلمة المرور إطلاقًا (للسجل).</summary>
    public static string Describe(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "(فارغة)";

        var value = raw.Trim();
        var isUri =
            value.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) ||
            value.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase);

        if (isUri)
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return "(صيغة غير صالحة)";
            var user = Uri.UnescapeDataString(uri.UserInfo.Split(':', 2)[0]);
            var db = uri.AbsolutePath.Trim('/');
            return $"{uri.Host}:{uri.Port} | المستخدم: {user} | القاعدة: {(string.IsNullOrEmpty(db) ? "postgres" : db)}";
        }

        try
        {
            var parsed = new NpgsqlConnectionStringBuilder(value);
            return $"{parsed.Host}:{parsed.Port} | المستخدم: {parsed.Username} | القاعدة: {parsed.Database}";
        }
        catch
        {
            return "(تعذّر قراءة السلسلة)";
        }
    }

    private static SslMode? ReadSslMode(string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return null;

        foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = pair.Split('=', 2);
            if (parts.Length != 2) continue;
            if (!parts[0].Equals("sslmode", StringComparison.OrdinalIgnoreCase)) continue;

            return parts[1].ToLowerInvariant() switch
            {
                "disable" => SslMode.Disable,
                "allow" => SslMode.Allow,
                "prefer" => SslMode.Prefer,
                "require" => SslMode.Require,
                "verify-ca" => SslMode.VerifyCA,
                "verify-full" => SslMode.VerifyFull,
                _ => null,
            };
        }

        return null;
    }
}
