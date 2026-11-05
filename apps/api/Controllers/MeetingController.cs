using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EduspaceApi.Controllers;

/// <summary>
/// إعداد الخطة الباردة (ICE) لاجتماعات WebRTC.
///
/// بلا TURN يظهر فشل الاتصال على شبكات NAT الصارمة (مشغّلي الاتصالات والشركات)،
/// لذلك تُقرأ الخوادم من الإعدادات بدل أن تكون ثابتة في الواجهة:
///   Meeting:StunUrls    — قائمة STUN عامة (افتراضية إن لم تُضبط)
///   Meeting:TurnUrls    — urls خادم coturn (turn:host:3478?transport=udp ، وturns للتوكن TLS)
///   Meeting:TurnSecret  — مفتاح use-auth-secret في coturn (TURN REST API)
///   Meeting:TurnTtlSeconds — عمر التوكن الموقّع (افتراضي 86400)
///
/// لو وُجد TurnUrls بلا TurnSecret تُرسل بحسابات ثابتة (للتنزيل فقط)،
/// ولو وُجد السر وُلِّد لكل مستخدم username/credential محدود بزمن — وهو وضع الإنتاج.
/// </summary>
[ApiController]
[Route("api/meeting")]
[Authorize]
public class MeetingController(IConfiguration config) : ControllerBase
{
    private static readonly string[] DefaultStun =
    [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
    ];

    [HttpGet("ice")]
    public IActionResult IceServers()
    {
        var servers = new List<object>();

        var stun = ReadList("Meeting:StunUrls");
        servers.Add(new { urls = stun.Length > 0 ? stun : DefaultStun });

        var turnUrls = ReadList("Meeting:TurnUrls");
        // سطر فارغ في الإعداد (`Meeting__TurnUrls__0=`) كان يصل للمتصفح كـ `[""]`
        // فيرفض بناء RTCPeerConnection أصلًا — والقائمة الفارغة لا تُرسل أبدًا.
        if (turnUrls.Length > 0)
        {
            var secret = config["Meeting:TurnSecret"];
            if (!string.IsNullOrWhiteSpace(secret))
            {
                var ttl = config.GetValue("Meeting:TurnTtlSeconds", 86_400);
                var userId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anon";
                var username = $"{DateTimeOffset.UtcNow.ToUnixTimeSeconds() + ttl}:{userId}";
                //TURN REST API: credential = base64(HMAC-SHA1(secret, username)) وusername = ttl:id
                var credential = Convert.ToBase64String(HMACSHA1.HashData(
                    Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(username)));
                servers.Add(new { urls = turnUrls, username, credential });
            }
            else
            {
                servers.Add(new { urls = turnUrls });
            }
        }

        return Ok(new { iceServers = servers });
    }

    /// <summary>
    /// يقبل مصفوفة JSON أو سلسلة مفصولة بفواصل — والإعدادان صالحان.
    /// القيم الفارغة تُستبعد هنا لا في الشاشة: سطر معلَّق فارغ في ملف البيئة
    /// يبقى عنصرًا `""`، وهو السم الذي كان يُسقط الغرفة.
    /// </summary>
    private string[] ReadList(string key)
    {
        var rows = config.GetSection(key).Get<string[]>()
            ?? config[key]?.Split(',')
            ?? [];
        return rows
            .Where((row) => !string.IsNullOrWhiteSpace(row))
            .Select((row) => row.Trim())
            .ToArray();
    }
}
