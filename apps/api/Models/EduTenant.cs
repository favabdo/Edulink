namespace EduspaceApi.Models;

/// <summary>
/// جدول Edu_Tenants — الشركة (المؤسسة) على القاعدة المشتركة.
///
/// كل صف في كل جدول Edu_ يحمل TenantId بنفسه، وكل استعلام يُفلتر عليه —
/// فشركتان على نفس القاعدة لا تريان بعضهما إطلاقًا. البريد يبقى فريدًا
/// عالميًا (توحيد الدخول) والهاتف فريدًا داخل الشركة.
/// </summary>
public class EduTenant : EduTimestamped
{
    public long Id { get; set; }
    public required string Name { get; set; }
    public short States { get; set; } = 1;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
