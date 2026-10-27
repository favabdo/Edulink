import { apiDownload, apiFetch, apiUpload } from '../../lib/apiClient'

/**
 * نداءات مكتبة الملفات — `/api/files` (موظفون فقط، والملفات ملك الحساب نفسه).
 */

export type ApiFile = {
  id: number
  fileName: string
  mime: string
  sizeBytes: number
  at: string
}

export type FileItem = {
  id: number
  fileName: string
  mime: string
  sizeBytes: number
  at: number
}

type ApiListResponse = { items: ApiFile[] }

export function toFileItem(row: ApiFile): FileItem {
  return {
    id: row.id,
    fileName: row.fileName,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    at: Date.parse(row.at),
  }
}

export function fetchFiles(): Promise<FileItem[]> {
  return apiFetch<ApiListResponse>('/api/files?take=200').then((data) =>
    (data.items ?? []).map(toFileItem),
  )
}

export function uploadFile(file: File): Promise<FileItem> {
  return apiUpload<ApiFile>('/api/files', file).then(toFileItem)
}

export function deleteFile(id: number): Promise<void> {
  return apiFetch<void>(`/api/files/${id}`, { method: 'DELETE' })
}

export function downloadFile(id: number, fileName: string): Promise<void> {
  return apiDownload(`/api/files/${id}/download`, fileName)
}
