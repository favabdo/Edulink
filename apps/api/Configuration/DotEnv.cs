namespace EduspaceApi.Configuration;

/// <summary>
/// قارئ ملف <c>.env</c> بسيط — **بلا أي حزمة خارجية**.
///
/// الغرض: عدم وضع أي سرّ (كلمة سر قاعدة بيانات، مفتاح، توكن) في الكود مباشرة.
/// الأسرار تأتي من متغيّرات البيئة أو من ملف <c>.env</c> المحلي المستثنى من Git.
///
/// **ترتيب الأولوية** (من الأعلى للأدنى):
///   1. متغيّرات البيئة الحقيقية للعملية
///   2. ملف <c>.env</c> المحلي
///   3. ملفات <c>appsettings*.json</c>
///
/// ويُحقَّق ذلك بتحميل قيم <c>.env</c> إلى متغيّرات البيئة **قبل** إنشاء الـ builder،
/// ودون المساس بأي متغيّر بيئة موجود بالفعل.
/// </summary>
public static class DotEnv
{
    private const string FileName = ".env";

    public static void ApplyToEnvironment()
    {
        foreach (var (key, value) in Read())
        {
            // لا نلغي متغيّر بيئة موجودًا بالفعل — أولويته أعلى
            if (Environment.GetEnvironmentVariable(key) is null)
            {
                Environment.SetEnvironmentVariable(key, value);
            }
        }
    }

    /// <summary>يقرأ الملف من مجلد التشغيل أو من مجلد المشروع (أثناء التطوير).</summary>
    public static IReadOnlyDictionary<string, string> Read()
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var candidate in CandidatePaths())
        {
            if (!File.Exists(candidate)) continue;

            foreach (var rawLine in File.ReadAllLines(candidate))
            {
                var line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith('#')) continue;

                if (line.StartsWith("export ", StringComparison.OrdinalIgnoreCase))
                {
                    line = line["export ".Length..].Trim();
                }

                var separator = line.IndexOf('=');
                if (separator <= 0) continue;

                var key = line[..separator].Trim();
                var value = Unquote(line[(separator + 1)..].Trim());
                if (key.Length > 0) values[key] = value;
            }

            break; // أول ملف موجود يكفي
        }

        return values;
    }

    private static IEnumerable<string> CandidatePaths()
    {
        yield return Path.Combine(Directory.GetCurrentDirectory(), FileName);
        yield return Path.Combine(AppContext.BaseDirectory, FileName);
    }

    private static string Unquote(string value)
    {
        if (value.Length >= 2 &&
            ((value[0] == '"' && value[^1] == '"') || (value[0] == '\'' && value[^1] == '\'')))
        {
            return value[1..^1];
        }

        return value;
    }
}
