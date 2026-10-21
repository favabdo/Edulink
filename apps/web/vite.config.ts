import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv لا process.env: ملف apps/web/.env يجب أن يُقرأ هنا بنفس نتيجة متغيّر البيئة
  // في الصدفة، وإلا اختلفت بادئة النشر حسب كيفية تشغيل الأمر.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    // السيرفر يخدم المنصة تحت بادئة مسار على نفس الأصل (مثل `/edulink/`)؛ بلا هذا الخيار
    // تطلب الحزمة `/login-showcase.jpg` فتسقط على جذر الدومين لا على مجلد التطبيق.
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    server: {
      // في التطوير نمرّر نداءات الـ API إلى مشروع الباك اند (api/) فلا نحتاج CORS
      proxy: {
        '/api': {
          target: 'http://localhost:5279',
          changeOrigin: true,
        },
        '/hubs': {
          target: 'http://localhost:5279',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
