# 13 — الوسائط خلف NAT صارم: تغريق TURN (coturn) وخيار الـ SFU

> **حالة هذا الملف (2026-11-07):** **تصميم و runbook جاهز للتغريق، ولا شيء فيه مُنفَّذ أو مقيس على العربة.**
> كل رقم أو أمر هنا مكتوب ليُنفَّذ على **عربة نايل شات** (`www.niletechno.com`، AlmaLinux، nginx موجود،
> الـ API عملية `dotnet` تحت systemd تسمع `127.0.0.1:5279`، والمنصة تحت بادئة `/edulink`) أو على عربة TURN
> مستقلة. ما قِيس فعلًا هو المذكور صراحةً في §6 فقط.
>
> **لماذا هذا الملف أصلًا:** حتى الخطوة 64 كل قياسات الغرفة تمت على **شبكة واحدة** (host candidates)،
> فالصوت والصورة يسلمان بلا وسيط. في شبكتين خلف NAT صارم لا يصل ICE إلا بخادم وسيط، وهذا بالضبط الفارق
> المتبقّي في «زي زووم بالظبط».

---

## 0) قرار أول: TURN إلزامي، و SFU اختيار مُكلِّف

| الطبقة | ما تُصلحه | تكلفتها | حالة EduLink |
|---|---|---|---|
| **STUN عام** (`stun.l.google.com:19302`) | كشف العنوان العام عند NAT مخبر (full-cone) | صفر | **مُفعّل الآن**، ولا يكفي وحده |
| **TURN** (coturn) | الوسائط حين يفشل الاتصال المباشر تمامًا (symmetric NAT، شبكات موبايل، شركات) | مدى UDP على عربة واحدة | **مطلوب — §1 إلى §5** |
| **SFU** (LiveKit) | تخفيض استهلاك العميل عند عدد مشاركين كبير (بثّ واحد لكل مشارك بدل N) | عربة/Docker + خادم إشارة + تحويل الاستراكشر | **مؤجَّل — §7**، والسبب مقاس |

**التسلسل إلزامي:** TURN أولًا لأنه يُصلح ما بلغ عنه صاحب المشروع («الصوت والصورة بتقطع» بين شبكتين)،
والـ SFU لا يُصلّح شيئًا إذا كان ICE نفسه لا يصل. ولا تخلط بينهما: TURN يمرّر البتّات ولا يفسّرها،
والـ SFU يستقبلها ويفسّرها ويعيد بثّها.

---

## 1) أين يوضع coturn

1. **عربة مستقلة (الموصى):** أي VPS بسيط (2 vCPU / 2 GB تكفي مئات المشاركين المرحّلين لأن coturn يحرّك
   بايتات ولا يفيقها). السبب العملي: مدى UDP `49160-49200` على استضافة مشتركة غالبًا مغلق، وفتحه عند
   المستضيف ليس بيدنا.
2. **على نفس عربة نايل شات:** ممكن إذا كان `firewalld`/لوحة المستضيف تسمح بفتح المدى. **لا يوضع داخل
   `/home/niletechno/public_html`** لأن nginx يخدم من هناك، ومجلد coturn ليس محتوى ويب.

⚠️ **قاعدة هذا المشروع على العربة:** كل شيء يبقى داخل مجلد المشروع ولا ملفات في `/usr/local` ولا
تعديلات نظام عامّة. coturn استثناء اضطراري لأنه يحتاج (أ) حزمة نظام و(ب) صلاحيات فتح بوابات UDP؛
ولهذا تُكتب كل ملفاته في `/home/niletechno/edulink-turn/` ويُستدعى بـ `--conf` صريحًا، ولا drop-in
لأي خدمة أخرى.

---

## 2) install + تشغيل (كل خطوة بلوك واحد قابل للصق)

**الخطوة 2-أ — فحص العربة قبل أي شيء** (لا تفترض توزعًا ولا إصدارًا):

```bash
cat /etc/os-release | head -3
command -v coturn-turnserver || command -v turnserver || echo NO_COTURN
firewall-cmd --state 2>/dev/null || echo NO_FIREWALLD
```

**الخطوة 2-ب — الحزمة:**

```bash
dnf -y install coturn
```

**الخطوة 2-ج — مجلد المشروع + توليد سرّ واحد طويل** (لا سرّ في المستودع، ولا سرّ في أمر ظاهر —
يُكتب في ملف بحماية 600 ويُقرأ منه):

```bash
mkdir -p /home/niletechno/edulink-turn
openssl rand -hex 32 > /home/niletechno/edulink-turn/turn.secret
chmod 600 /home/niletechno/edulink-turn/turn.secret
```

**الخطوة 2-د — إعداد coturn:** الملف المرجعي في المستودع `deploy/turnserver.conf` (realm،
`use-auth-secret`، `static-auth-secret`، المدى، `no-cli`, `fingerprint`). على العربة يُنسخ منه نسخة
محلية ويُعدَّل ثلاثة قيم فقط:

```bash
cp deploy/turnserver.conf /home/niletechno/edulink-turn/turnserver.conf
```

```bash
sed -i "s/^realm=.*/realm=niletechno.com/" /home/niletechno/edulink-turn/turnserver.conf
```

```bash
sed -i "s|^relay-ip-mdev=.*||" /home/niletechno/edulink-turn/turnserver.conf
```

ولا تُسلّم `use-auth-secret` مع سرّ مكتوب في نفس الملف — بل أسطر الإعداد النهائية (تُكتب مرة، ولا
تُنسخ إلى أي مكان آخر):

```bash
printf '%s\n' 'use-auth-secret' "static-auth-secret=$(cat /home/niletechno/edulink-turn/turn.secret)" 'listening-port=3478' 'tls-listening-port=5349' 'relay-udp-port-min=49160' 'relay-udp-port-max=49200' 'fingerprint' 'no-loopback-peers' 'no-multicast-peers' 'denied-peer-ip=0.0.0.0-0.0.0.0' 'allowed-peer-ip=127.0.0.1' 'no-tcp-relay' >> /home/niletechno/edulink-turn/turnserver.conf
```

> `allowed-peer-ip=127.0.0.1`: coturn لا يُرحّل إلى عناوين داخلية — منع SSRF من داخل البروتوكول نفسه.
> `denied-peer-ip=0.0.0.0-0.0.0.0` مع `allowed-peer-ip` هو النمط الموثوق: ارفض الكل ثم اسمح بما هو
> خارج الحلقة المحلية فعليًا عندك (عدّل حسب قياس الشبكة على العربة، ولا تنسخه أعمى).

**الخطوة 2-هـ — systemd وحدة واحدة باسم المشروع** (لا تعديل خدمة عامة):

```bash
printf '%s\n' '[Unit]' 'Description=EduLink coturn' 'After=network-online.target' '[Service]' 'Type=simple' 'ExecStart=/usr/bin/turnserver --conf=/home/niletechno/edulink-turn/turnserver.conf' 'Restart=always' 'RestartSec=3' 'User=turnuser' 'Group=turnuser' 'LimitNOFILE=65536' '[Install]' 'WantedBy=multi-user.target' > /etc/systemd/system/edulink-turn.service
```

```bash
id turnuser || useradd -r -s /sbin/nologin turnuser
```

```bash
chown -R turnuser:turnuser /home/niletechno/edulink-turn && systemctl daemon-reload && systemctl enable --now edulink-turn && systemctl status edulink-turn --no-pager | head -12
```

**الخطوة 2-و — جدار النار** (المنفذان + المدى، لا غير):

```bash
firewall-cmd --permanent --add-port=3478/udp --add-port=3478/tcp --add-port=5349/tcp --add-port=49160-49200/udp
```

```bash
firewall-cmd --reload && firewall-cmd --list-ports
```

---

## 3) ربط الـ API بـ coturn (ثلاثة أماكن معًا — قاعدة المشروع)

**أ) الإعداد** (`apps/api/appsettings.json` له قيم افتراضية فارغة؛ القيم الحقيقية في `apps/api/.env`
على العربة، أي في `/home/niletechno/edulink-secrets.env` الذي تحمّله وحدة systemd بـ `EnvironmentFile`):

```
Meeting__TurnUrls__0=turn:niletechno.com:3478?transport=udp
Meeting__TurnUrls__1=turns:niletechno.com:5349?transport=tcp
Meeting__TurnSecret=<نفس محتوى /home/niletechno/edulink-turn/turn.secret>
Meeting__TurnTtlSeconds=86400
```

```bash
systemctl restart edulink-api
```

**ب) `deploy/turnserver.conf` و**ج)** `docs/11` §TURN — والمقاطعة آلية، لا ثقة بالعين:**

```bash
python tools/verify-ice-turn.py green
```

الأداة تعيد حساب `base64(HMAC-SHA1(realm:username, secret))` كما يفحصه coturn بالضبط، وتتأكد أن
`username` = وقت الانتهاء بالثواني وأن عمره يساوي `TurnTtlSeconds`، وتُقاطع `Meeting__TurnSecret` مع
`static-auth-secret` في `deploy/turnserver.conf`. **مقيسة أخضر/أحمر من الخطوة 36** (تضارب السرّ ⇒
خروج 1). ولا تُقرأ خضراء قبل تشغيل حالة حمراء عليها.

⚠️ **لا تترك `Meeting__TurnUrls__0=` فارغًا:** السطر الفارغ كان يصل للمتصفح كـ `{"urls":[""]}`
فيرمي `new RTCPeerConnection` خطأ `'' is not a valid URL` داخل ردّ `peer-joined` (مقيس في الخطوة 62) —
المُخرَج يعلّق مفتاحي TURN بـ `#` والمرشّح في `iceConfig.ts` يرفض الفارغ، لكن **الإعداد الصحيح هو
الحل لا المرشّح**.

---

## 4) التحقق بعد التشغيل — بالترتيب

```bash
curl -s https://www.niletechno.com/edulink/api/health/db
```

```bash
python tools/verify-ice-turn.py green
```

```bash
node tools/hub-through-proxy-check.mjs --proxy https://www.niletechno.com/edulink
```

ثم على الشاشة نفسها، من شبكتين مختلفتين (لابتوب على Wi-Fi + موبايل على بيانات الشريحة): افتح الحصة،
وفي DevTools → Network → WS → إطارات `/hubs/meetings` تأكد أن `ice` من الخادم فيه عنصرا TURN، ثم
في `chrome://webrtc-internals` ابحث عن `iceCandidateType` للطرف البعيد: **`relay` = الوسيط يعمل**،
`host`/`srflx` فقط = ما زلنا على الشبكة المباشرة (وهذا لا يُثبت شيئًا عن NAT صارم).

⚠️ **ما لا تثبته أي أداة من جهاز واحد:** الترحيل الحقيقي يحتاج طرفين على شبكتين مختلفتين. لا تكتب
«التقطيع اتحلّ» قبل هذه الجولة بالذات، ولا تكتفِ بلقطة من متصفح واحد.

---

## 5) التكاليف والأخطار التي تُذكر قبل التشغيل

- **النطاق:** `49160-49200/udp` = 41 منفذًا لكل عملية coturn. مع `relay-threads` الافتراضي تكفي مئات
  الجلسات؛ التوسّع هو رفع المدى لا تشغيل أكثر من عملية على نفس الـ IP.
- **الخصوصية والتسجيل:** coturn **يمرّر** البايتات ولا يخزّنها؛ والقرار المشروع «لا تسجيل» يبقى محترمًا.
  لا تُشغّل `--auth-user` ثابت ولا منحة بلا انتهاء.
- **الأسرار:** `turn.secret` على العربة بحماية 600 ولا يدخل المستودع (المستودع عام). أي سرّ طُبع في
  محادثة يُعتبر محروقًا: ولّد جديدًا وحدّث `Meeting__TurnSecret` و`static-auth-secret` معًا ثم أعد
  تشغيل الوحدتين.
- **دوران التوكن:** `TurnTtlSeconds=86400` كبير على جلسة قصيرة. الأنسب 3600–7200 لأن الـ API يوقّع لكل
  انضمّام؛ لو طالت الحصة أكثر من TTL يعيد العميل طلب `GET /api/meeting/ice` (تأكد من ذلك في الجولة
  الحيّة، فهو سلوك لم يُقس بعد على TURN فعلي).

---

## 6) ما قِيس فعلًا في هذه الخطوة (ولا يُنسب لغيره)

- **مقيس (الخطوة 62):** أن عنصر ICE فارغًا كان يُسقط بناء `RTCPeerConnection` داخل ردّ `peer-joined`
  بلا أي علامة على الشاشة، وأن المرشّح + التنبيه الظاهر يغلقان ذلك.
- **مقيس (الخطوة 36):** `tools/verify-ice-turn.py` يعيد حساب التوقيع كما يفحصه coturn، ويخرج 1 عند
  تضارب السرّ، و0 عند التطابق.
- **غير مقيس بعد:** أي ترحيل فعلي عبر coturn، وأي `relay candidate` على شاشة، وأي مكالمة بين شبكتين.
  هذه الجولة هي المتبقّي في «زي زووم بالظبط» ولا تُستبدل بقياس شبكة واحدة.

---

## 7) SFU (LiveKit): القرار المؤجَّل وأسبابه بالأرقام

**ما يُلغيه الـ mesh:** عند أربعة مشاركين يرسل كل عميل ثلاثة تدفقات ويستقبل ثلاثة. عند عشرة يصبح
11 إرسالًا و11 استقبالًا على نفس الجهاز — وهنا يظهر التقطيع حتى مع سقف `maxBitrate`. قياس الحمل الحالي
(2000 حصة = 4000 اتصال WebSocket) **يقس غرفة المدرس + الطالب** لا غرفة عشرة، فلا يثبت شيئًا عن هذا.

**لماذا لم يُبنَ الآن (لا تسويفًا):**
1. المنصة multi-tenant بقاعدة واحدة وقرارات صلاحيات في `MeetingHub`؛ نقل الوسائط إلى LiveKit يعني
   مصدرين للحقيقة (من مكتوم؟ من على المسرح؟) حتى لا تتناقض شاشة المدرس مع `RoomState.Blocks` — وهذا
   شغل استراكشر لا سطر إعداد.
2. LiveKit يحتاج `udp 50000-60000` + `7881/tcp` (WebRTC over TCP/TLS) وعربة تدعم host networking أو
   port range كاملًا، وهي القيود نفسها التي تنطبق على coturn في الاستضافة المشتركة، بل أثقل.
3. القرار الوظيفي «مدرس + طالب دائمًا، والمراقب يراقب فقط» يجعل الـ mesh كافيًا **رياضيًا** لمعظم الحصص؛
   الـ SFU قيمته تظهر في غرف العشرة، وهي غير مطلوبة بعد.

**شكل التنفيذ لو طُلِب** (ثلاثة أسطر لا أكثر لكل منها، كي يبقى القرار واضحًا):
- `apps/api`: خدمة `ILiveKitToken` توقّع token لكل انضمّام بـ grant على room = معرّف الحصة + tenantId،
  ونقطة `POST /api/meeting/livekit-token` بدل `negotiate`.
- `apps/web`: `mediaShare.ts` يبقى مصدر الأجهزة، ويحلّ `LiveKitRoom` محل `RTCPeerConnection` في
  `meetingClient.ts`؛ والسبورة والـ Hub والصلاحيات لا تتغير لأنها أصلاً في قنوات مستقلة.
- المراقب: `publish=false` في الـ grant بدل حجب الزرّ في الواجهة — وهي النقطة التي تجعل القرار في الخادم.

**ومتى يُبنى:** عند أول طلب فعلي لغرفة أكثر من طالبين، أو عند قياس موثّق على شبكتين يُظهر أن TURN
وحده لا يكفي. لا قبل ذلك.
