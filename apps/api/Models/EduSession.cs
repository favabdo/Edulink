namespace EduspaceApi.Models;

/// <summary>حالات الحصة.</summary>
public static class SessionStatuses
{
    public const string Scheduled = "scheduled";
    public const string Live = "live";
    public const string Completed = "completed";
    public const string Cancelled = "cancelled";
    public const string NoShow = "no_show";
}

/// <summary>
/// جدول Edu_Sessions — الحصص المجدولة والمنفذة.
///
/// الأوقات DateTime بتوقيت UTC (وليس DateTimeOffset) عمدًا: SQLite لا يترجم
/// مقارنات/ترتيب DateTimeOffset إلى SQL، بينما DateTime UTC مدعوم في المحرّكات
/// الثلاثة (SQLite للتطوير، PostgreSQL/Supabase مع timestamptz، SQL Server DATETIME2).
/// </summary>
public class EduSession : EduTimestamped
{
    public long Id { get; set; }
    public required string Code { get; set; }
    public required string Subject { get; set; }
    public long TeacherId { get; set; }
    public long StudentId { get; set; }
    public string GradeKey { get; set; } = "g7";
    public short DurationMin { get; set; } = 45;
    public string Status { get; set; } = SessionStatuses.Scheduled;
    public string? Attendance { get; set; }
    public string? RoomCode { get; set; }
    public DateTime StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public DateTime? JoinedAt { get; set; }
    public long? MakeupOfId { get; set; }
    public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    /// <summary>الطالب المرتبط (للعرض).</summary>
    public virtual EduStudent? Student { get; set; }
    /// <summary>المدرس المرتبط (للعرض).</summary>
    public virtual EduUser? Teacher { get; set; }
}

/// <summary>جدول Edu_Students — الطلاب.</summary>
public class EduStudent : EduTimestamped
{
    public long Id { get; set; }
    public string? Name { get; set; }
    public required string Email { get; set; }
    public required string Password { get; set; }
    public string? Token { get; set; }
    public short States { get; set; }
    public short Access { get; set; }
    public string? ImgUrl { get; set; }
    public short Notifications { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>سجل حضور كل طالب في كل حصة.</summary>
public class EduSessionAttendance : EduTimestamped
{
    public long Id { get; set; }
    public long SessionId { get; set; }
    public long StudentId { get; set; }
    public string Mark { get; set; } = "absent";
    public DateTime? JoinedAt { get; set; }
    public DateTime? LeftAt { get; set; }
    public long DurationMs { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public virtual EduSession? Session { get; set; }
    public virtual EduStudent? Student { get; set; }
}
