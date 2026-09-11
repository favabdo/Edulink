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
        user.Property(x => x.Token).HasColumnName("token");
        user.Property(x => x.States).HasColumnName("states");
        user.Property(x => x.Access).HasColumnName("access");
        user.Property(x => x.ImgUrl).HasColumnName("img_url");
        user.Property(x => x.Notifications).HasColumnName("notifications");
        user.Property(x => x.CreatedAt).HasColumnName("created_at");
        user.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        user.HasIndex(x => x.Email).IsUnique().HasDatabaseName("uq_edu_users_email");
        user.HasIndex(x => x.Token).HasDatabaseName("ix_Edu_Users_token");
        user.HasIndex(x => x.Role).HasDatabaseName("ix_Edu_Users_role");
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        // الجداول الحقيقية فيها DEFAULT now() وتريجر يحدّث updated_at.
        // نضبط القيم في الكود أيضًا حتى يعمل التطوير المحلي (SQLite) بلا تريجرات.
        var now = DateTimeOffset.UtcNow;
        foreach (var entry in ChangeTracker.Entries<EduUser>())
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
