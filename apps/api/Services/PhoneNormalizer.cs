using System.Text;

namespace EduspaceApi.Services;

/// <summary>
/// تطبيع رقم الهاتف قبل التخزين — المصدر الوحيد لصيغة الرقم في المنصة.
///
/// الرقم المقبول: 8..15 رقمًا، مع «+» اختياري في أوله، ويُتحمَّل الفواصل
/// والمسافات والأقواس والأرقام العربية (٠١٢…) لأن الواجهة عربية. الناتج دائمًا
/// أرقام ASCII مع «+» إن كان في المدخل — وهو ما يقارن به الفهرس الفريد
/// الجزئي في <c>database/schema.sql</c> (القسم 9).
///
/// لماذا في طبقة التطبيق لا في القاعدة؟ دوال إزالة الرموز مختلفة تمامًا بين
/// PostgreSQL وSQL Server، وقاعدة المشروع أن يبقى السلوك متطابقًا على المحرّكين.
/// </summary>
public static class PhoneNormalizer
{
    /// <summary>
    /// يعيد الرقم مطبَّعًا، أو <c>null</c> إذا كان المدخل فارغًا (لا رقم).
    /// عند الخطأ تبقى النتيجة <c>null</c> وتُملأ <paramref name="error"/> برسالة تصلح للشاشة.
    /// </summary>
    public static string? Normalize(string? raw, out string? error)
    {
        error = null;
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var digits = new StringBuilder(16);
        var hasPlus = false;

        foreach (var ch in raw.Trim())
        {
            if (ch == '+' && digits.Length == 0 && !hasPlus) { hasPlus = true; continue; }
            if (ch is ' ' or '-' or '(' or ')' or '.' or '‎' or '‏') continue;

            var value = DigitOf(ch);
            if (value is null)
            {
                error = "رقم الهاتف يقبل الأرقام فقط، و«+» اختياري في أوله.";
                return null;
            }
            digits.Append((char)('0' + value.Value));
        }

        if (digits.Length is < 8 or > 15)
        {
            error = "رقم الهاتف يجب أن يكون بين 8 و15 رقمًا — الأفضل بالصيغة الدولية مثل ‎+201012345678.";
            return null;
        }

        return (hasPlus ? "+" : "") + digits;
    }

    /// <summary>رسالة تُطبع في الشاشة عند طلب رقم ولم يُدخل — الفصل بين «لا رقم» و«رقم خاطئ».</summary>
    public const string RequiredMessage = "رقم الهاتف مطلوب — التنبيهات بالحصص تحتاج رقمًا صحيحًا.";

    /// <summary>
    /// مثل <see cref="Normalize"/> لكن الفراغ خطأ لا «لا رقم» — للتكويد الأولي، لأن حسابًا
    /// بلا رقم لا تصل إليه رسالة تنبيه بالحصة أبدًا. التعديل يبقى على <see cref="Normalize"/>
    /// لأن غياب القيمة هناك يعني «لا تغيّر» لا «امسح».
    /// </summary>
    public static string? NormalizeRequired(string? raw, out string? error)
    {
        var phone = Normalize(raw, out error);
        if (error is null && phone is null) error = RequiredMessage;
        return phone;
    }

    private static int? DigitOf(char ch)
    {
        if (ch is >= '0' and <= '9') return ch - '0';
        if (!char.IsDigit(ch)) return null;
        var value = char.GetNumericValue(ch);
        return value is >= 0 and <= 9 ? (int)value : null;
    }
}
