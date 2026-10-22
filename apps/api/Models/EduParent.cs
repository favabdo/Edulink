namespace EduspaceApi.Models;

/// <summary>جدول Edu_Parents — أولياء الأمور (نفس بنية حسابات الطلاب، بدون دور).</summary>
public class EduParent : EduTimestamped
{
    public long Id { get; set; }
    public string? Name { get; set; }
    public required string Email { get; set; }
    public required string Password { get; set; }
    public string? Token { get; set; }
    public short States { get; set; }
    public short Access { get; set; }
    public string? ImgUrl { get; set; }

    /// <summary>رقم ولي الأمر مطبَّعًا — القناة الأساسية لتنبيهات الحصص (واتساب).</summary>
    public string? Phone { get; set; }

    public short Notifications { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// جدول Edu_Relations — ربط طالب بولي أمر (متعدد لمتعدد في الاتجاهين).
/// relation: 0=أب، 1=أم، 2=وصي، 3=أخرى — وis_primary واحد فقط لكل طالب (فهرس فريد جزئي).
/// </summary>
public class EduRelation : EduTimestamped
{
    public long Id { get; set; }
    public long StudentId { get; set; }
    public long ParentId { get; set; }
    public short Relation { get; set; }
    public short IsPrimary { get; set; } = 1;
    public short States { get; set; } = 1;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public virtual EduStudent? Student { get; set; }
    public virtual EduParent? Parent { get; set; }
}
