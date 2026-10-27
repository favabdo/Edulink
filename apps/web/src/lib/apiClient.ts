import type { ApiErrorBody } from '@eduspace/shared-types'
import { API_BASE_URL, TOKEN_STORAGE_KEY } from './constants'

/**
 * عميل الـ API الموحّد لكل نداءات الخادم.
 *
 * في التطوير: المسار النسبي `/api` يمرّ عبر بروكسي Vite إلى مشروع الباك اند (apps/api).
 * في الإنتاج: يُضبط `VITE_API_BASE_URL` على عنوان الـ API المنشور.
 */

export function readToken(): string | null {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY)
}

export function saveToken(token: string): void {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY)
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = readToken()
  const headers: Record<string, string> = {}

  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(0, 'تعذّر الاتصال بالخادم. تأكد من تشغيل خدمة الـ API.')
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  const data = text ? safeJson(text) : null

  if (!response.ok) throw new ApiError(response.status, readErrorMessage(data))

  return data as T
}

/** رفع ملف multipart بحقل `file` — نفس التوكن ونفس معالجة الأخطاء مثل apiFetch */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const token = readToken()
  const body = new FormData()
  body.append('file', file)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body,
    })
  } catch {
    throw new ApiError(0, 'تعذّر الاتصال بالخادم. تأكد من تشغيل خدمة الـ API.')
  }

  const text = await response.text()
  const data = text ? safeJson(text) : null
  if (!response.ok) throw new ApiError(response.status, readErrorMessage(data))
  return data as T
}

/** تنزيل ملف محمي بالتوكن إلى قرص الجهاز — لا يصلح وسم <a> مباشر لأن المصادقة ترويسة لا كوكيز */
export async function apiDownload(path: string, fileName: string): Promise<void> {
  const token = readToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { headers })
  } catch {
    throw new ApiError(0, 'تعذّر الاتصال بالخادم. تأكد من تشغيل خدمة الـ API.')
  }

  if (!response.ok) {
    const text = await response.text()
    throw new ApiError(response.status, readErrorMessage(safeJson(text)))
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function readErrorMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const raw = (data as ApiErrorBody).message
    if (typeof raw === 'string' && raw.trim().length > 0) return raw
  }
  return 'حدث خطأ غير متوقع.'
}
