using EduspaceApi.Models;

namespace EduspaceApi.Contracts;

public record LoginRequest(string? Email, string? Password);

public record CreateUserRequest(string? Name, string? Email, string? Password, short Role, short Access = 1, short States = 1, string? Phone = null);

public record BootstrapOwnerRequest(string? Name, string? Email, string? Password);

public record UserDto(
    long Id,
    string? Name,
    string Email,
    short Role,
    string RoleName,
    short States,
    short Access,
    string? ImgUrl,
    /// <summary>رقم مطبَّع من PhoneNormalizer، أو null إذا لم يُسجَّل بعد.</summary>
    string? Phone,
    DateTimeOffset CreatedAt,
    /// <summary>staff = موظفو Edu_Users بأدوارهم الرقمية — student = Edu_Students (Role = -1).</summary>
    string Aud = "staff");

public record AuthResponse(string Token, UserDto User);

public static class UserMapping
{
    public static UserDto ToDto(this EduUser u) => new(
        u.Id,
        u.Name,
        u.Email,
        u.Role,
        UserRoles.ToArabicName(u.Role),
        u.States,
        u.Access,
        u.ImgUrl,
        u.Phone,
        u.CreatedAt);

    /// <summary>الطالب يُقدَّم للواجهة بنفس عقد المستخدم — الدور ثابت «طالب» والتوكن من جدول الطلاب.</summary>
    public static UserDto ToAuthDto(this EduStudent s) => new(
        s.Id,
        s.Name,
        s.Email,
        -1,
        "طالب",
        s.States,
        s.Access,
        s.ImgUrl,
        s.Phone,
        new DateTimeOffset(
            s.CreatedAt.Kind == DateTimeKind.Unspecified ? s.CreatedAt : DateTime.SpecifyKind(s.CreatedAt, DateTimeKind.Utc),
            TimeSpan.Zero),
        "student");

    /// <summary>ولي الأمر — نفس العقد، الدور الثابت «ولي أمر» والتوكن من Edu_Parents.</summary>
    public static UserDto ToAuthDto(this EduParent p) => new(
        p.Id,
        p.Name,
        p.Email,
        -2,
        "ولي أمر",
        p.States,
        p.Access,
        p.ImgUrl,
        p.Phone,
        new DateTimeOffset(
            p.CreatedAt.Kind == DateTimeKind.Unspecified ? p.CreatedAt : DateTime.SpecifyKind(p.CreatedAt, DateTimeKind.Utc),
            TimeSpan.Zero),
        "parent");
}

// ============================ الجلسات ============================

public record SessionDto(
    long Id,
    string Code,
    string Subject,
    long TeacherId,
    long StudentId,
    string GradeKey,
    short DurationMin,
    string Status,
    string? Attendance,
    string? RoomCode,
    DateTimeOffset StartsAt,
    DateTimeOffset? EndsAt,
    DateTimeOffset? JoinedAt,
    long? MakeupOfId,
    string Metadata,
    DateTimeOffset CreatedAt,
    string? TeacherName,
    string? StudentName);

public record SessionAttendanceDto(
    long Id,
    long SessionId,
    long StudentId,
    string Mark,
    DateTimeOffset? JoinedAt,
    DateTimeOffset? LeftAt,
    long DurationMs,
    string? Note);

public record StudentDto(
    long Id,
    string? Name,
    string Email,
    short States,
    short Access,
    string? ImgUrl,
    string? Phone,
    DateTimeOffset CreatedAt);

public record CreateStudentRequest(
    string? Name,
    string? Email,
    string? Password,
    short Access = 1,
    // 1 = ظاهر للطالب — الحساب الذي يُنشئه الإدارة ظاهر بطبيعته إلا لو طُلب غير ذلك صراحةً
    short States = 1,
    string? Phone = null);

public static class StudentMapping
{
    public static StudentDto ToDto(this EduStudent s) => new(
        s.Id,
        s.Name,
        s.Email,
        s.States,
        s.Access,
        s.ImgUrl,
        s.Phone,
        new DateTimeOffset(s.CreatedAt.Kind == DateTimeKind.Unspecified
            ? s.CreatedAt
            : DateTime.SpecifyKind(s.CreatedAt, DateTimeKind.Utc)));
}

public static class SessionMapping
{
    // الكيانات تخزّن DateTime UTC (متوافق مع SQLite/Postgres/SQL Server)،
    // والعقد تُخرج DateTimeOffset بإزاحة صفرية حتى يصل "Z" للواجهة.
    private static DateTimeOffset ToUtc(DateTime value) =>
        value.Kind == DateTimeKind.Unspecified
            ? new DateTimeOffset(value, TimeSpan.Zero)
            : new DateTimeOffset(value);

    private static DateTimeOffset? ToUtc(DateTime? value) =>
        value.HasValue ? ToUtc(value.Value) : null;

    public static SessionDto ToDto(this EduSession s) => new(
        s.Id,
        s.Code,
        s.Subject,
        s.TeacherId,
        s.StudentId,
        s.GradeKey,
        s.DurationMin,
        s.Status,
        s.Attendance,
        s.RoomCode,
        ToUtc(s.StartsAt),
        ToUtc(s.EndsAt),
        ToUtc(s.JoinedAt),
        s.MakeupOfId,
        s.Metadata,
        ToUtc(s.CreatedAt),
        s.Teacher?.Name,
        s.Student?.Name);

    public static SessionAttendanceDto ToDto(this EduSessionAttendance a) => new(
        a.Id,
        a.SessionId,
        a.StudentId,
        a.Mark,
        ToUtc(a.JoinedAt),
        ToUtc(a.LeftAt),
        a.DurationMs,
        a.Note);
}
