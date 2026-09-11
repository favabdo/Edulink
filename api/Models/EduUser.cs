namespace EduspaceApi.Models;

/// <summary>أدوار موظفي المنصة — الرقم يزيد كلما ارتفع الدور.</summary>
public static class UserRoles
{
    public const short Teacher = 0;
    public const short Supervisor = 1;
    public const short Manager = 2;
    public const short Owner = 3;

    public static string ToArabicName(short role) => role switch
    {
        Teacher => "مدرس",
        Supervisor => "مشرف",
        Manager => "مدير",
        Owner => "أونر",
        _ => "غير معروف",
    };
}

/// <summary>صف في جدول "Edu_Users" — موظفو المنصة (مدرس، مشرف، مدير، أونر).</summary>
public class EduUser
{
    public long Id { get; set; }
    public string? Name { get; set; }
    public required string Email { get; set; }

    /// <summary>هاش كلمة المرور (bcrypt) — لا يُخزَّن النص الصريح أبدًا.</summary>
    public required string Password { get; set; }

    /// <summary>0=مدرس, 1=مشرف, 2=مدير, 3=أونر</summary>
    public short Role { get; set; }

    /// <summary>توكن الدخول الحالي — null يعني لا توجد جلسة.</summary>
    public string? Token { get; set; }

    /// <summary>0 = غير ظاهر للناس، 1 = ظاهر.</summary>
    public short States { get; set; }

    /// <summary>0 = غير مفعّل (لا يستطيع الدخول)، 1 = مفعّل.</summary>
    public short Access { get; set; }

    public string? ImgUrl { get; set; }

    /// <summary>هل إنشاء هذا المستخدم أُرسل كإشعار للكل: 0=لا، 1=نعم.</summary>
    public short Notifications { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
