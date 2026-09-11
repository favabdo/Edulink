using System.Security.Cryptography;

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

/// <summary>توليد توكن الدخول العشوائي الذي يُخزَّن في عمود token.</summary>
public class TokenService
{
    private const int TokenBytes = 32;

    public string CreateToken()
    {
        var raw = RandomNumberGenerator.GetBytes(TokenBytes);
        return Convert.ToBase64String(raw)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }
}
