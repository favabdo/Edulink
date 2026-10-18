using EduspaceApi.Models;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Data;

/// <summary>
/// سياق قاعدة البيانات.
///
/// ⚠️ المصدر الوحيد لمخطط قاعدة البيانات هو الملف <c>db/schema.sql</c> — لا تُستخدم
/// EF Migrations في هذا المشروع إطلاقًا. الكيانات هنا تُقرأ وتُكتب فقط، وأسماء
/// الأعمدة مربوطة صراحةً بأسماء قاعدة البيانات الحقيقية.
/// </summary>
public class EduDbContext(DbContextOptions<EduDbContext> options) : DbContext(options)
{
    public DbSet<EduUser> Users => Set<EduUser>();
    public DbSet<EduStudent> Students => Set<EduStudent>();
    public DbSet<EduParent> Parents => Set<EduParent>();
    public DbSet<EduRelation> Relations => Set<EduRelation>();
    public DbSet<EduSession> Sessions => Set<EduSession>();
    public DbSet<EduSessionAttendance> SessionAttendances => Set<EduSessionAttendance>();
    public DbSet<EduNotification> Notifications => Set<EduNotification>();
    public DbSet<EduConversation> Conversations => Set<EduConversation>();
    public DbSet<EduConversationMember> ConversationMembers => Set<EduConversationMember>();
    public DbSet<EduMessage> Messages => Set<EduMessage>();
    public DbSet<EduToken> Tokens => Set<EduToken>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var user = modelBuilder.Entity<EduUser>();

        // اسم الجدول بحالة أحرف محفوظة كما في db/schema.sql
        user.ToTable("Edu_Users");
        user.HasKey(x => x.Id);

        user.Property(x => x.Id).HasColumnName("id");
        user.Property(x => x.Name).HasColumnName("name").HasMaxLength(255);
        user.Property(x => x.Email).HasColumnName("email").HasMaxLength(255).IsRequired();
        user.Property(x => x.Password).HasColumnName("password").HasMaxLength(255).IsRequired();
        user.Property(x => x.Role).HasColumnName("role");
        // 200 عمدًا: SQL Server لا يبني فهرسًا على NVARCHAR(MAX) — والعمود TEXT في PostgreSQL
        user.Property(x => x.Token).HasColumnName("token").HasMaxLength(200);
        user.Property(x => x.States).HasColumnName("states");
        user.Property(x => x.Access).HasColumnName("access");
        user.Property(x => x.ImgUrl).HasColumnName("img_url");
        user.Property(x => x.Notifications).HasColumnName("notifications");
        user.Property(x => x.CreatedAt).HasColumnName("created_at");
        user.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        user.HasIndex(x => x.Email).IsUnique().HasDatabaseName("uq_edu_users_email");
        user.HasIndex(x => x.Token).HasDatabaseName("ix_Edu_Users_token");
        user.HasIndex(x => x.Role).HasDatabaseName("ix_Edu_Users_role");

        // ---- Edu_Sessions ----
        var session = modelBuilder.Entity<EduSession>();
        session.ToTable("Edu_Sessions");
        session.HasKey(x => x.Id);
        session.Property(x => x.Id).HasColumnName("id");
        session.Property(x => x.Code).HasColumnName("code").HasMaxLength(16);
        session.Property(x => x.Subject).HasColumnName("subject").HasMaxLength(120);
        session.Property(x => x.TeacherId).HasColumnName("teacherId");
        session.Property(x => x.StudentId).HasColumnName("studentId");
        session.Property(x => x.GradeKey).HasColumnName("gradeKey").HasMaxLength(4);
        session.Property(x => x.DurationMin).HasColumnName("durationMin");
        session.Property(x => x.Status).HasColumnName("status").HasMaxLength(16);
        session.Property(x => x.Attendance).HasColumnName("attendance").HasMaxLength(16);
        session.Property(x => x.RoomCode).HasColumnName("roomCode").HasMaxLength(32);
        session.Property(x => x.StartsAt).HasColumnName("startsAt");
        session.Property(x => x.EndsAt).HasColumnName("endsAt");
        session.Property(x => x.JoinedAt).HasColumnName("joinedAt");
        session.Property(x => x.MakeupOfId).HasColumnName("makeupOfId");
        session.Property(x => x.Metadata).HasColumnName("metadata");
        session.Property(x => x.CreatedAt).HasColumnName("created_at");
        session.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        session.HasIndex(x => x.Code).HasDatabaseName("uq_edu_sessions_code");
        session.HasIndex(x => x.TeacherId).HasDatabaseName("ix_Edu_Sessions_teacher");
        session.HasIndex(x => x.StudentId).HasDatabaseName("ix_Edu_Sessions_student");
        session.HasIndex(x => x.Status).HasDatabaseName("ix_Edu_Sessions_status");
        session.HasIndex(x => x.StartsAt).HasDatabaseName("ix_Edu_Sessions_startsAt");
        session.HasIndex(x => x.RoomCode).HasDatabaseName("ix_Edu_Sessions_roomCode");

        session.HasOne(s => s.Teacher).WithMany().HasForeignKey(s => s.TeacherId);
        session.HasOne(s => s.Student).WithMany().HasForeignKey(s => s.StudentId);

        // ---- Edu_Students (EF needs this for the FK relationship) ----
        var student = modelBuilder.Entity<EduStudent>();
        student.ToTable("Edu_Students");
        student.HasKey(x => x.Id);
        student.Property(x => x.Id).HasColumnName("id");
        student.Property(x => x.Name).HasColumnName("name").HasMaxLength(255);
        student.Property(x => x.Email).HasColumnName("email").HasMaxLength(255).IsRequired();
        student.Property(x => x.Password).HasColumnName("password").HasMaxLength(255).IsRequired();
        student.Property(x => x.Token).HasColumnName("token").HasMaxLength(200);
        student.Property(x => x.States).HasColumnName("states");
        student.Property(x => x.Access).HasColumnName("access");
        student.Property(x => x.ImgUrl).HasColumnName("img_url");
        student.Property(x => x.Notifications).HasColumnName("notifications");
        student.Property(x => x.CreatedAt).HasColumnName("created_at");
        student.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        // ---- Edu_SessionAttendance ----
        var sa = modelBuilder.Entity<EduSessionAttendance>();
        sa.ToTable("Edu_SessionAttendance");
        sa.HasKey(x => x.Id);
        sa.Property(x => x.Id).HasColumnName("id");
        sa.Property(x => x.SessionId).HasColumnName("sessionId");
        sa.Property(x => x.StudentId).HasColumnName("studentId");
        sa.Property(x => x.Mark).HasColumnName("mark").HasMaxLength(16);
        sa.Property(x => x.JoinedAt).HasColumnName("joinedAt");
        sa.Property(x => x.LeftAt).HasColumnName("leftAt");
        sa.Property(x => x.DurationMs).HasColumnName("durationMs");
        sa.Property(x => x.Note).HasColumnName("note");
        sa.Property(x => x.CreatedAt).HasColumnName("created_at");
        sa.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        sa.HasIndex(x => x.SessionId).HasDatabaseName("ix_Edu_SA_session");
        sa.HasIndex(x => x.StudentId).HasDatabaseName("ix_Edu_SA_student");
        sa.HasIndex(x => x.Mark).HasDatabaseName("ix_Edu_SA_mark");

        sa.HasOne(a => a.Session).WithMany().HasForeignKey(a => a.SessionId);
        sa.HasOne(a => a.Student).WithMany().HasForeignKey(a => a.StudentId);

        // فهرس فريد لجلسة+طالب
        sa.HasIndex(a => new { a.SessionId, a.StudentId }).IsUnique();

        // ---- Edu_Parents ----
        var parent = modelBuilder.Entity<EduParent>();
        parent.ToTable("Edu_Parents");
        parent.HasKey(x => x.Id);
        parent.Property(x => x.Id).HasColumnName("id");
        parent.Property(x => x.Name).HasColumnName("name").HasMaxLength(255);
        parent.Property(x => x.Email).HasColumnName("email").HasMaxLength(255).IsRequired();
        parent.Property(x => x.Password).HasColumnName("password").HasMaxLength(255).IsRequired();
        parent.Property(x => x.Token).HasColumnName("token").HasMaxLength(200);
        parent.Property(x => x.States).HasColumnName("states");
        parent.Property(x => x.Access).HasColumnName("access");
        parent.Property(x => x.ImgUrl).HasColumnName("img_url");
        parent.Property(x => x.Notifications).HasColumnName("notifications");
        parent.Property(x => x.CreatedAt).HasColumnName("created_at");
        parent.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        // ---- Edu_Relations ----
        var rel = modelBuilder.Entity<EduRelation>();
        rel.ToTable("Edu_Relations");
        rel.HasKey(x => x.Id);
        rel.Property(x => x.Id).HasColumnName("id");
        rel.Property(x => x.StudentId).HasColumnName("student_id");
        rel.Property(x => x.ParentId).HasColumnName("parent_id");
        rel.Property(x => x.Relation).HasColumnName("relation");
        rel.Property(x => x.IsPrimary).HasColumnName("is_primary");
        rel.Property(x => x.States).HasColumnName("states");
        rel.Property(x => x.CreatedAt).HasColumnName("created_at");
        rel.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        rel.HasIndex(x => new { x.StudentId, x.ParentId }).IsUnique().HasDatabaseName("uq_edu_relations_pair");
        rel.HasIndex(x => x.StudentId).HasDatabaseName("ix_Edu_Relations_student");
        rel.HasIndex(x => x.ParentId).HasDatabaseName("ix_Edu_Relations_parent");
        rel.HasOne(r => r.Student).WithMany().HasForeignKey(r => r.StudentId);
        rel.HasOne(r => r.Parent).WithMany().HasForeignKey(r => r.ParentId);

        // ---- Edu_Notifications ----
        var notif = modelBuilder.Entity<EduNotification>();
        notif.ToTable("Edu_Notifications");
        notif.HasKey(x => x.Id);
        notif.Property(x => x.Id).HasColumnName("id");
        notif.Property(x => x.RecipientKind).HasColumnName("recipientKind").HasMaxLength(16);
        notif.Property(x => x.RecipientId).HasColumnName("recipientId");
        notif.Property(x => x.Kind).HasColumnName("kind").HasMaxLength(32);
        notif.Property(x => x.Title).HasColumnName("title").HasMaxLength(255);
        notif.Property(x => x.Body).HasColumnName("body");
        notif.Property(x => x.Link).HasColumnName("link").HasMaxLength(255);
        notif.Property(x => x.ReadAt).HasColumnName("read_at");
        notif.Property(x => x.CreatedAt).HasColumnName("created_at");
        notif.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        notif.HasIndex(x => new { x.RecipientKind, x.RecipientId, x.ReadAt }).HasDatabaseName("ix_Edu_Notif_recipient");

        // ---- Edu_Conversations ----
        var conv = modelBuilder.Entity<EduConversation>();
        conv.ToTable("Edu_Conversations");
        conv.HasKey(x => x.Id);
        conv.Property(x => x.Id).HasColumnName("id");
        conv.Property(x => x.Subject).HasColumnName("subject").HasMaxLength(255);
        conv.Property(x => x.CreatedAt).HasColumnName("created_at");
        conv.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        // ---- Edu_ConversationMembers ----
        var cm = modelBuilder.Entity<EduConversationMember>();
        cm.ToTable("Edu_ConversationMembers");
        cm.HasKey(x => x.Id);
        cm.Property(x => x.Id).HasColumnName("id");
        cm.Property(x => x.ConversationId).HasColumnName("conversationId");
        cm.Property(x => x.MemberKind).HasColumnName("memberKind").HasMaxLength(16);
        cm.Property(x => x.MemberId).HasColumnName("memberId");
        cm.Property(x => x.LastReadAt).HasColumnName("last_read_at");
        cm.Property(x => x.States).HasColumnName("states");
        cm.Property(x => x.CreatedAt).HasColumnName("created_at");
        cm.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        cm.HasIndex(x => new { x.ConversationId, x.MemberKind, x.MemberId }).IsUnique().HasDatabaseName("uq_edu_conv_member");
        cm.HasIndex(x => new { x.MemberKind, x.MemberId }).HasDatabaseName("ix_Edu_ConvMembers_lookup");
        cm.HasOne(x => x.Conversation).WithMany().HasForeignKey(x => x.ConversationId);

        // ---- Edu_Messages ----
        var msg = modelBuilder.Entity<EduMessage>();
        msg.ToTable("Edu_Messages");
        msg.HasKey(x => x.Id);
        msg.Property(x => x.Id).HasColumnName("id");
        msg.Property(x => x.ConversationId).HasColumnName("conversationId");
        msg.Property(x => x.SenderKind).HasColumnName("senderKind").HasMaxLength(16);
        msg.Property(x => x.SenderId).HasColumnName("senderId");
        msg.Property(x => x.Body).HasColumnName("body");
        msg.Property(x => x.CreatedAt).HasColumnName("created_at");
        msg.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        msg.HasIndex(x => x.ConversationId).HasDatabaseName("ix_Edu_Messages_conversation");
        msg.HasOne(x => x.Conversation).WithMany().HasForeignKey(x => x.ConversationId);

        // ---- Edu_Tokens ----
        var tok = modelBuilder.Entity<EduToken>();
        tok.ToTable("Edu_Tokens");
        tok.HasKey(x => x.Id);
        tok.Property(x => x.Id).HasColumnName("id");
        tok.Property(x => x.Kind).HasColumnName("kind").HasMaxLength(16);
        tok.Property(x => x.AccountId).HasColumnName("accountId");
        tok.Property(x => x.Value).HasColumnName("token").HasMaxLength(200);
        tok.Property(x => x.CreatedAt).HasColumnName("created_at");
        tok.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        tok.HasIndex(x => x.Value).IsUnique().HasDatabaseName("uq_edu_tokens_token");
        tok.HasIndex(x => new { x.Kind, x.AccountId }).HasDatabaseName("ix_Edu_Tokens_account");
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        // الجداول الحقيقية فيها DEFAULT now() وتريجر يحدّث updated_at.
        // نضبط القيم في الكود أيضًا حتى يعمل التطوير المحلي (SQLite) بلا تريجرات.
        var nowDto = DateTimeOffset.UtcNow; // كيانات EduUser (DateTimeOffset)
        var now = DateTime.UtcNow;          // بقية الكيانات (EduTimestamped — DateTime UTC)
        foreach (var entry in ChangeTracker.Entries<EduUser>())
        {
            if (entry.State == EntityState.Added)
            {
                if (entry.Entity.CreatedAt == default) entry.Entity.CreatedAt = nowDto;
                entry.Entity.UpdatedAt = nowDto;
            }
            else if (entry.State == EntityState.Modified)
            {
                entry.Entity.UpdatedAt = nowDto;
            }
        }
        foreach (var entry in ChangeTracker.Entries<EduTimestamped>())
        {
            if (entry.State == EntityState.Added)
            {
                if (entry.Entity.CreatedAt == default) entry.Entity.CreatedAt = now;
                entry.Entity.UpdatedAt = now;
            }
            else if (entry.State == EntityState.Modified)
            {
                entry.Entity.UpdatedAt = now;
            }
        }

        return base.SaveChangesAsync(cancellationToken);
    }
}
