# ============================================================
#  EduLink API — صورة Docker متعددة المراحل للنشر الإنتاجي
#  البناء من جذر المستودع:  docker build -f apps/api/Dockerfile .
# ============================================================
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# النسخ الانتقائي: مشاريع الـ API فقط (لا حاجة لحزم الواجهة هنا)
COPY apps/api/EduspaceApi.csproj apps/api/
RUN dotnet restore apps/api/EduspaceApi.csproj

COPY apps/api/ apps/api/
RUN dotnet publish apps/api/EduspaceApi.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish ./

# المنفذ: Render يمرّر منفذ الخدمة في `PORT`، و`deploy/docker-compose.yml` + nginx
# يتوقعان 80 — فالافتراضي 80. الصيغة shell لأن متغيّر بيئة يحتاج صدفة، و`exec` تجعل
# `dotnet` هو العملية نفسها فيتلقّى SIGTERM مباشرة؛ بدونها يبقى الصدفة فوقه والإيقاف
# القوي بعد 10 ثوانٍ يقطع الطلبات أثناءها.
CMD ["bash", "-c", "exec dotnet EduspaceApi.dll --urls \"http://0.0.0.0:${PORT:-80}\""]

ENV DOTNET_gcServer=1
EXPOSE 80

# فحص صحة حي (يعتمد /api/health — يُقرأ من HealthController)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost/api/health/db || exit 1
