using System.Collections.Concurrent;

namespace EduspaceApi.Hubs;

/// <summary>
/// سجل المستندات المعروضة الآن داخل غرف نشطة.
///
/// لماذا هو موجود: تحميل ملف مشارَك في الحصة يجب أن يظل مقفولًا على **هذه** الغرفة
/// و**طالما هي معروضة**. لو اكتفينا بفحص «الملف ملك مدرس الحصة» لقدر أي طالب أن
/// يمسح معرّفات `Edu_Files` لمدرّسه وينزّل ملفات لم تُعرض له قط. المنح إذن يُمنح
/// عند `ShareDocument` ويُلغى عند استبدال المستند أو إخفائه أو إخلاء الغرفة.
///
/// الذاكرة وحدها تكفي: عمر هذا السجل هو عمر الغرفة نفسها، ولا يُقرأ بعد إعادة الإقلاع.
/// </summary>
public static class RoomSharedDocs
{
    private static readonly ConcurrentDictionary<string, byte> Grants = new();

    private static string Key(long sessionId, long fileId) => $"{sessionId}:{fileId}";

    public static void Grant(long sessionId, long fileId) => Grants[Key(sessionId, fileId)] = 0;

    public static void Revoke(long sessionId, long fileId) => Grants.TryRemove(Key(sessionId, fileId), out _);

    public static void RevokeAllOfSession(long sessionId)
    {
        foreach (var key in Grants.Keys)
        {
            if (key.StartsWith($"{sessionId}:", StringComparison.Ordinal)) Grants.TryRemove(key, out _);
        }
    }

    public static bool IsShared(long sessionId, long fileId) => Grants.ContainsKey(Key(sessionId, fileId));
}
