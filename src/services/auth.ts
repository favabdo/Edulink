/**
 * طبقة المصادقة — غير متصلة بالخادم بعد.
 *
 * الخطوة الحالية واجهة فقط. عند بناء خدمة المصادقة (ASP.NET Core) يُستبدل
 * جسم الدالة باستدعاء الـ API الحقيقي، ويبقى نفس التوقيع حتى لا تتغير الواجهة.
 */

export type SignInPayload = {
  identifier: string
  password: string
  remember: boolean
}

export class AuthServiceNotConnectedError extends Error {
  constructor() {
    super('AUTH_SERVICE_NOT_CONNECTED')
    this.name = 'AuthServiceNotConnectedError'
  }
}

export async function signIn(_payload: SignInPayload): Promise<never> {
  throw new AuthServiceNotConnectedError()
}

/**
 * الدخول بحساب Google — جزء من المتطلبات، ويحتاج تشغيل تدفق OAuth على الخادم.
 */
export async function signInWithGoogle(): Promise<never> {
  throw new AuthServiceNotConnectedError()
}
