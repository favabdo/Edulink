using EduspaceApi.Data;
using EduspaceApi.Models;

namespace EduspaceApi.Services;

/// <summary>
/// ما يحتاجه أي ردّ يصف حصة: وقتها الفعلي وحالتها الآن بالنسبة للنافذة.
/// يُبنى في مكان واحد حتى لا تُعيد شاشة حسابًا للنافذة وأخرى حسابًا ثانيًا.
/// </summary>
public sealed record SessionView(
    double ActualMinutes,
    double StudentMinutes,
    JoinState State,
    DateTimeOffset OpensAt,
    DateTimeOffset ClosesAt,
    int? MinutesUntilOpen);

public static class SessionViews
{
    /// <summary>
    /// لقطة واحدة لكل الحصص المراد إرجاعها: استعلام حضور واحد + وقت واحد
    /// للمقارنة. الفحص الحتمي أن يكون <c>now</c> من الخادم لا من المتصفح —
    /// ساعة جهاز الطالب لا يوثق بها في قفل باب.
    /// </summary>
    public static async Task<Dictionary<long, SessionView>> BuildAsync(
        EduDbContext db,
        ICollection<EduSession> sessions,
        IConfiguration config,
        CancellationToken ct = default)
    {
        var options = SessionWindowOptions.From(config);
        var now = DateTime.UtcNow;
        var facts = await SessionFacts.LoadAsync(db, sessions.Select(s => s.Id).ToList(), ct);

        var views = new Dictionary<long, SessionView>(sessions.Count);
        foreach (var session in sessions)
        {
            var state = SessionWindow.Evaluate(session, now, options);
            views[session.Id] = new SessionView(
                Math.Round(facts.ActualMinutes(session, now), 1),
                Math.Round(facts.StudentMinutes(session, session.StudentId, now), 1),
                state,
                new DateTimeOffset(SessionWindow.OpensAt(session, options), TimeSpan.Zero),
                new DateTimeOffset(SessionWindow.EndsAt(session, options), TimeSpan.Zero),
                state == JoinState.TooEarly ? SessionWindow.MinutesUntil(session, now, options) : null);
        }
        return views;
    }
}
