using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace EduspaceApi.Services;

/// <summary>تجزئة كلمة المرور — bcrypt كما هو معتمد في قواعد المشروع (التجزئة في التطبيق لا في القاعدة).</summary>
public class PasswordService
{
    public string Hash(string password) => BCrypt.Net.BCrypt.HashPassword(password);

    public bool Verify(string password, string hash)
    {
        try
        {
            return BCrypt.Net.BCrypt.Verify(password, hash);
        }
        catch
        {
            // هاش غير صالح أو تالف — نعتبر التحقق فاشلًا بدل رمي استثناء
            return false;
        }
    }
}

/// <summary>
/// حدّ محاولات الدخول **لكل حساب** — لأن حدّ الـ IP لا يمنع تخمين حساب واحد:
/// مهاجم يوزّع طلباته على عشرات العناوين لا يصطدم بـ <c>LoginPermitPerMinute</c> أبدًا.
/// الفارق هنا أنه يمنع أيضًا **استهلاك الـ CPU**: bcrypt مكلف، والقفل يرفض قبل التجزئة.
///
/// المفتاح = نوع الحساب + بصمة البريد (SHA-256) — لا يُخزَّن البريد نفسه في الذاكرة.
/// الحالة داخل العملية فقط: إعادة التشغيل تفتح النوافذ من جديد، وهذا مقبول
/// (لا يُستخدم كسجل تدقيق). تُنظَّف القيود القديمة تلقائيًا حتى لا يكبر المخزن.
/// </summary>
public sealed class LoginAttemptTracker(IConfiguration config)
{
    private readonly int _maxFailures = config.GetValue("RateLimit:LoginFailuresPerAccount", 8);
    private readonly TimeSpan _window = TimeSpan.FromMinutes(config.GetValue("RateLimit:LoginLockoutMinutes", 5));
    private readonly ConcurrentDictionary<string, Entry> _entries = new();

    private sealed class Entry
    {
        public DateTime FirstFailureUtc;
        public int Failures;
    }

    private static string KeyOf(string kind, string email)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{kind}|{email.ToLowerInvariant()}"));
        return Convert.ToHexString(bytes.AsSpan(0, 12));
    }

    /// <summary>كم ثانية تفصل انتهاء القفل على هذا الحساب؟ (0 = غير مقفول)</summary>
    public int LockoutSecondsLeft(string kind, string email)
    {
        if (_maxFailures <= 0) return 0;
        if (!_entries.TryGetValue(KeyOf(kind, email), out var entry)) return 0;

        lock (entry)
        {
            var elapsed = DateTime.UtcNow - entry.FirstFailureUtc;
            if (elapsed >= _window || entry.Failures < _maxFailures) return 0;
            return Math.Max(1, (int)Math.Ceiling((_window - elapsed).TotalSeconds));
        }
    }

    public void RecordFailure(string kind, string email)
    {
        if (_maxFailures <= 0) return;

        var key = KeyOf(kind, email);
        var entry = _entries.GetOrAdd(key, _ => new Entry());

        lock (entry)
        {
            var now = DateTime.UtcNow;
            if (entry.Failures == 0 || now - entry.FirstFailureUtc >= _window)
            {
                entry.FirstFailureUtc = now;
                entry.Failures = 1;
            }
            else
            {
                entry.Failures += 1;
            }
        }

        PruneIfNeeded();
    }

    /// <summary>دخول ناجح يصفّر العدّاد — حتى لا يتراكم على حساب مستخدم طبيعي.</summary>
    public void RecordSuccess(string kind, string email) =>
        _entries.TryRemove(KeyOf(kind, email), out _);

    private void PruneIfNeeded()
    {
        if (_entries.Count < 10_000) return;

        var cutoff = DateTime.UtcNow - _window;
        foreach (var pair in _entries)
        {
            lock (pair.Value)
            {
                if (pair.Value.Failures == 0 || pair.Value.FirstFailureUtc < cutoff)
                    _entries.TryRemove(pair.Key, out _);
            }
        }
    }
}
