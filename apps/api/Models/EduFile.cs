namespace EduspaceApi.Models;

/// <summary>جدول Edu_Files — ميتاداتا ملف مكتبة حساب. المحتوى على قرص السيرفر.</summary>
public class EduFile : EduTimestamped
{
    public long Id { get; set; }
    public long TenantId { get; set; } = 1;
    public long OwnerId { get; set; }
    public required string FileName { get; set; }
    public string Mime { get; set; } = "application/octet-stream";
    public long SizeBytes { get; set; }
    /// <summary>مسار نسبي على القرص يولّده الخادم (GUID) — لا يُقرأ من العميل ولا يُرجَع له.</summary>
    public required string StoragePath { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public virtual EduUser? Owner { get; set; }
}
