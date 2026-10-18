# 12) النشر على Render — ما يقبله وما لا يقبله، بالقياس لا بالوصف

> يُقرأ هذا الملف بعد `docs/11-production-deployment.md`. هو **بديل** لطريقة `deploy/run.sh`
> (عربة واحدة nginx + coturn + SQL Server)، لا إضافة إليها: بعض ما تثبته تلك الطريقة لا
> يقدر Render على أدائه إطلاقًا، وهذا مقسوم صراحةً في §1 حتى لا يُقرأ «اشتغل على Render»
> كأنه «اكتمل التسليم».

---

## 1) الحقيقة التي تُحدّد الشكل كله

| الجزء | على Render | التفصيل المقيس |
|---|---|---|
| الـ API (ASP.NET Core + SignalR) | ✅ **عبر Docker فقط** | `.NET` ليس ضمن محركات Render الأصلية (Node/Python/Ruby/Go/Rust/Elixir/PHP)، فالحل `runtime: docker` على `apps/api/Dockerfile` |
| خطة المجاني | ❌ لا تُستخدم | الحاويات لا تملك خطة `free`؛ والمجاني **ينام بعد الخمول** فيُنهي اتصالات الغرفة الحيّة في منتصف الحصة. الأدنى العملي: `starter` |
| قاعدة **SQL Server** | ❌ **لا يوفّرها Render** | قواعدهم المدارة `Postgres` و`Redis` فقط ⇒ القاعدة تبقى على سيرفرك ويصلها الـ API من الإنترنت. **هذا أخطر بند في الملف كله — انظر §4** |
| الوسيط + TLS | ✅ | Render يُنهي `https` وحده ويضيف `X-Forwarded-For` ⇒ `Network__UseForwardedHeaders=true` و`ForwardedHeadersLimit=1` (وسيط واحد) |
| `coturn` (TURN) | ❌ | حاويات Render بلا `host networking` وبلا مدى بوابات UDP ⇒ لا وسيط وسائط. **الحصص الحيّة خلف NAT صارم تحتاج عربة مستقلة** (§7) |
| الواجهة | ✅ static | أو تبقى على Vercel كما هي؛ في الحالتين يلزم `Cors__Origins__0` (§5) |
| النسخ الاحتياطي MSSQL | ❌ | لا SQL Agent هناك؛ النسخ يصير من مصدر القاعدة نفسها (§7) |

**قبل أي ضغطة Deploy:** النشر على Render يبني من المستودع على GitHub. فكل ما يُراد نشره
يجب أن يكون **مدفوعًا** إلى الفرع الذي يشير إليه Render، ولا شيء يُبنى من القرص المحلي.

---

## 2) الملفات في المستودع لهذا المسار

| الملف | الدور |
|---|---|
| `render.yaml` (جذر المستودع) | Blueprint بخدمتين: `edulink-api` (docker) و`edulink-web` (static). **بلا أسرار**: كل قيمة حساسة `sync: false` فتُملأ من لوحة Render. `healthCheckPath: /api/health/db` يجعل النشر لا يُحسب ناجحًا قبل أن يصل الـ API فعليًا إلى القاعدة |
| `apps/api/Dockerfile` | صورة متعددة المراحل. المنفذ من `${PORT:-80}`: Render يمرّر منفذه في متغيّر بيئة `PORT`، و`docker-compose` يتوقع 80. **مقيس**: `--urls "...:${PORT:-80}"` تجاوز `ASPNETCORE_URLS` وسمع على 5281 في Production على SQL Server |
| `.dockerignore` | يستثني `node_modules` و`bin/obj/dist` و`.env` وكل ما عدا `apps/api`. بدونه ينسخ السياق مئات الميغابايت، و**قد يدخل ملف الأسرار إلى طبقة البناء** |
| `tools/verify-render-deploy.py` | بوابة ما بعد النشر (§6): TLS موثَّق، الصحة، CORS، دخول حقيقي، `negotiate`، **وترقية WebSocket فعلية** |

---

## 3) الخطوات (كل خطوة كتلة واحدة تُتلَقى كما هي)

**1 — القاعدة جاهزة على سيرفرك** (لا شيء هنا يخص Render):

```bash
sqlcmd -S "YOUR-SERVER,1433" -U sa -P "PASSWORD" -f 65001 -I -b -i RUN-ON-SQL-SERVER.sql
```

**2 — ارفع المستودع، ثم Blueprint:** على GitHub ادفع الفرع `main`؛ في Render:
`New +` → `Blueprint` → اختر المستودع → يعرض `edulink-api` و`edulink-web` من `render.yaml`.

**3 — املأ القيم المقفلة** (التي عليها `sync: false`) في لوحة Render، لا في الملف:

```
ConnectionStrings__SqlServer = Server=YOUR-SERVER,1433;Database=Edulink;User ID=...;Password=...;Encrypt=True;TrustServerCertificate=True
Meeting__TurnUrls__0        = (اتركه فارغًا حتى تُشغّل coturn على عربة — §7)
Meeting__TurnSecret         = (مثله)
```

**4 — عدّل الأسماء إلى الحقيقية** بعد أول نشر، في مكانين متقابلين حرفيًا:
`Cors__Origins__0` في `edulink-api` = **أصل** `edulink-web`، و`VITE_API_BASE_URL` في
`edulink-web` = **أصل** `edulink-api`. `VITE_API_BASE_URL` **وقت بناء** لا وقت تشغيل: تغييره
يلزمه Deploy جديد، وإلا ظلّت الواجهة تنادي العنوان القديم.

**5 — أنشئ المالك (مرة واحدة على قاعدة فارغة):**

```bash
printf '{"name":"مالك المنصة","email":"OWNER@DOMAIN","password":"<قوية>"}' > owner.json
curl -sS -X POST https://edulink-api.onrender.com/api/setup/owner -H "Content-Type: application/json" --data-binary @owner.json
rm owner.json
```

⚠️ **الجسم العربي لا يُرسَل في وسائط الأوامر على Windows/Git Bash** (`curl` يحوّلها إلى cp1252
فتُخزَّن `?`) — لذا `--data-binary @owner.json` من ملف UTF-8، لا `-d`.

**6 — البوابة** (§6). ثم ادخل الشاشة بنفسك وتحقّق بالعين كما في `docs/11` §8.

---

## 4) التشفير مع قاعدة على الإنترنت — لا تُرخّ هذه الحماية بصمت

سلسلة الاتصال التي ستعمل غالبًا على سيرفرك الحالي هي `Encrypt=False;TrustServerCertificate=True`,
لسبب حقيقي: **SQL Server 2014 لا يخدم TLS حديثًا** والسائق الحديث يرفض المصافحة قبل أن تكتمل
(موثّق في `apps/api/README.md` و`docs/11`).

لكن على Render يعني هذا أن **اسم المستخدم وكلمة السر وكل صف بيانات يعبرون الإنترنت غير
مشفَّرين**. على عربة العميل التي تستضيف القاعدة والـ API معًا كان ذلك مقبولًا؛ عبر الإنترنت
لا. الترتيب المفضّل:

1. **الأفضل:** قاعدة تدعم TLS 1.2+ (ترقية SQL Server، أو نقل EduLink إلى مزوّد SQL مع TLS) ⇒
   `Encrypt=True;TrustServerCertificate=False`.
2. **مقبول وأرخص:** نفق مُؤمَّن بين حاوية Render والقاعدة (IPsec، أو نفق SSH/TLS مُدار عندك) —
   تبقى `Encrypt=False` لكن الحركة داخل النفق.
3. **مرفوض:** `Encrypt=False` على منفذ 1433 مكشوف للعامة بلا نفق، ثم القول إن المنصة «جاهزة
   للإنتاج». هذا خيار التسليم الأسوأ، ولو قَبِلَه صاحبه يجب أن يُذكر في سجل التسليم لا أن يُطوى.

**ولا يُضيف الكود أيًّا من هذين العلمين صمتًا** — السلسلة تُقرأ حرفيًا من الإعدادات، وهذا
مقصود: الترخيص الأمني قرار إنسان، لا سلوك افتراضي.

---

## 5) CORS على أصلين (أول يوم يسقط هنا)

`Program.cs` يقرأ `Cors:Origins`، و`app.UseCors()` بلا وسيط policy على الطلبات كلها. الواجهة
على أصل والـ API على أصل آخر ⇒ **بلا `Cors__Origins__0` صحيح يرفض المتصفح كل نداء `/api`**
وتظهر الشاشة فارغة بلا رسالة خطأ مفيدة (الخطأ في console المتصفح لا في اللوج).

- القيمة **بروتوكول + نطاق فقط**، بلا شرطة مائلة نهائية وبلا مسار، ومطابقة حرفيًا لأصل الواجهة.
- دومين المؤسسة الخاص (white-label) يُضاف `Cors__Origins__1`؛ ومع كل دومين جديد تُضاف قيمته.
- قياس مُجرَّب: تشغيل البوابة بـ `EDULINK_ORIGIN=https://definitely-not-the-web-origin.invalid`
  يُخرج **1** بنص `Access-Control-Allow-Origin = None`.

---

## 6) البوابة: `tools/verify-render-deploy.py`

```bash
EDULINK_API_URL=https://edulink-api.onrender.com \
EDULINK_ORIGIN=https://edulink-web.onrender.com \
EDULINK_EMAIL=<المالك> EDULINK_PASSWORD=<كلمته> \
python tools/verify-render-deploy.py green
```

سبعة بنود، كلها **قياس من الخارج** لا قراءة شيفرة: https إجباري، شهادة موثَّقة (بسلسلة النظام
أو بـ `EDULINK_TLS_CA` — **لا** تعطيل تحقق إطلاقًا)، `/api/health/db` يعيد المزوّد المتوقع
و`canConnect=true`، نداء بـ `Origin` يعيد نفس الأصل في `Access-Control-Allow-Origin`، دخول
حقيقي ⇒ توكن ⇒ `/api/auth/me`، `POST /hubs/meetings/negotiate` ⇒ `connectionToken`، وأخيرًا
**ترقية WebSocket يدوية** تطلب `101 Switching Protocols` وتحسب `Sec-WebSocket-Accept` كما في
RFC 6455 (بـ `connectionToken` الذي رجع من negotiate، مثل SignalR تمامًا).

**«لم أُتحقق» = خروج 1** في كل بند: أصل غير reachable، شكل استجابة غريب، حساب بلا توكن. القاعدة
التي حُكم بها في `docs/11` تُطبق هنا: لا أخضر قبل أن تُشغَّل حالة حمراء على نفس الأداة.

**القياس المُجرَّب على هذا الجهاز** (لا يوجد docker/nginx هنا، فاستُخدم `tools/edge-proxy.mjs`
وسيطًا محليًا بـ TLS، وهو يقلّد nginx/Render: ينهي `https` ويضيف `X-Forwarded-For` ويمرّر
الترقية): أخضر **7 بنود / خروج 0** على `https://localhost:8443` فوق الـ API بـ SQL Server.
ثم خمس حالات حمراء مقيسة، كل واحدة خرجت **1**: مزوّد متوقع خاطئ (`Postgres`)، أصل CORS خاطئ،
حساب غير موجود (`401`)، أصل غير reachable (`127.0.0.1:1`)، و**بلا ملف CA** فشهادتنا الذاتية
رُفضت بـ `CERTIFICATE_VERIFY_FAILED` — وهذا الأخير هو الدليل أن التحقق من الشهادة لم يُعطَّل
تحت الغطاء. وأمر `python tools/verify-render-deploy.py red` يعيد الحالات الأربع الأولى
ويُخرج 1 إن اخضرّ إحداها (أداة تفحص الأداة).

---

## 7) ما لا يعمل على Render إطلاقًا — ولا يُقال «انتهى» قبله

1. **وسائط الحصص الحيّة:** بلا TURN لا اجتياز لـ NAT صارم. الحل عربة صغيرة (Hetzner/DO/VPS عندك)
   عليها `coturn` بنفس `deploy/turnserver.conf`، ثم `Meeting__TurnUrls__*` و`Meeting__TurnSecret`
   في Render، و`python tools/verify-ice-turn.py green` (يتقاطع السرّ مع `static-auth-secret`)
   واتصال حيّ من شبكتين مختلفتين.
2. **قياس الحمل على النشر الحقيقي:** رقمنا المرجعي **2000 حصة = 4000 اتصال، صفر فقدان** مقيس على
   جهاز تطوير واحد، **لا على Render**. سقطة الخطة وقيود الحاوية أرقام مختلفة تمامًا:
   `node tools/loadtest/meeting-loadtest.mjs --rooms 1000 --peers 2 --hold 60` ضد رابط Render يجب
   أن تُعاد وتُوثَّق هنا قبل التسليم.
3. **النسخ الاحتياطي MSSQL:** SQL Agent غير موجود ⇒ مهمة عند مصدر القاعدة، مع اختبار استعادة
   فعلي (الإجراء في `docs/11` §9).
4. **حدود الدخول عند الوسيط:** إن أضفت Cloudflare أمام Render يصير عدد الوسائط **2**، فترفع
   `Network__ForwardedHeadersLimit=2`؛ وبقياس `tools/verify-xff-spoof.py` على الرابط العام
   تتأكد أن التزوير لا يفتح حزنة جديدة. لا ترفع الرقم قبل أن تثبته الأداة.

**الخلاصة الصادقة:** إذا كان المراد تسليم منصة تعليمية كاملة (وسائط + نسخ + حمل مقيس) لعميل،
فـ **`deploy/run.sh` على عربة واحدة هو الطريق الأكمل والأرخص**. Render صالح لـ API + واجهة +
دخول وتقارير ورسائل، مع قاعدة خارجية مُؤمَّنة بنفق أو بـ TLS حديث، وTURN خارج بيته.
