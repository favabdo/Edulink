namespace EduspaceApi.Models;

/// <summary>كيانات تستخدم created_at/updated_at بتوقيت DateTime UTC (بخلاف Edu_Users).</summary>
public interface EduTimestamped
{
    DateTime CreatedAt { get; set; }
    DateTime UpdatedAt { get; set; }
}

/// <summary>مالك حساب في أي من الجداول الثلاثة — مستخدم في الإشعارات والرسائل.</summary>
public static class AccountKinds
{
    public const string Staff = "staff";
    public const string Student = "student";
    public const string Parent = "parent";

    public static bool IsValid(string? kind) =>
        kind is Staff or Student or Parent;
}

/// <summary>جدول Edu_Notifications — إشعار موجّه لحساب واحد.</summary>
public class EduNotification : EduTimestamped
{
    public long Id { get; set; }
    public required string RecipientKind { get; set; }
    public long RecipientId { get; set; }
    public string Kind { get; set; } = "system";
    public required string Title { get; set; }
    public string? Body { get; set; }
    public string? Link { get; set; }
    public DateTime? ReadAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>جدول Edu_Conversations — خيط مراسلة بين حسابَين فأكثر.</summary>
public class EduConversation : EduTimestamped
{
    public long Id { get; set; }
    public string? Subject { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>جدول Edu_ConversationMembers — عضوية حساب في محادثة.</summary>
public class EduConversationMember : EduTimestamped
{
    public long Id { get; set; }
    public long ConversationId { get; set; }
    public required string MemberKind { get; set; }
    public long MemberId { get; set; }
    public DateTime? LastReadAt { get; set; }
    public short States { get; set; } = 1;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public virtual EduConversation? Conversation { get; set; }
}

/// <summary>جدول Edu_Messages — رسالة داخل محادثة. الحذف المادي غير مطروح.</summary>
public class EduMessage : EduTimestamped
{
    public long Id { get; set; }
    public long ConversationId { get; set; }
    public required string SenderKind { get; set; }
    public long SenderId { get; set; }
    public required string Body { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public virtual EduConversation? Conversation { get; set; }
}

/// <summary>
/// جدول Edu_Tokens — توكن جلسة واحد لكل جهاز (المتطلبات: الدخول من أكثر من جهاز مسموح).
/// kind: staff | student | parent — وaccountId يشير لجدول الحساب المطابق.
/// </summary>
public class EduToken : EduTimestamped
{
    public long Id { get; set; }
    public required string Kind { get; set; }
    public long AccountId { get; set; }
    public required string Value { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
