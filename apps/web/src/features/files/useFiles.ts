/**
 * حالة شاشة «ملفاتي» — نمط useNotifications: نداءات الشبكة هنا لا في المكوّن.
 *
 * الرفع يضيف الصف الجديد أعلى القائمة محليًا بعد نجاحه من الخادم، والحذف
 * يزيله فورًا (optimistic) ويُعاد القراءة عند أي فشل حتى لا تبقى القائمة
 * مخالفة للخادم.
 */
import { useCallback, useEffect, useState } from 'react'
import { deleteFile, downloadFile, fetchFiles, uploadFile, type FileItem } from './api'

export type UseFilesResult = {
  items: FileItem[]
  loading: boolean
  /** رسالة خطأ القراءة أو آخر عملية رفع/حذف/تنزيل — تظهر للشاشة كما هي */
  error: string | null
  uploading: boolean
  /** معرّف الملف قيد التنزيل حاليًا (لتعطيل زره وحده) */
  downloadingId: number | null
  upload: (file: File) => Promise<void>
  remove: (id: number) => Promise<void>
  download: (item: FileItem) => Promise<void>
  refresh: () => void
}

export function useFiles(): UseFilesResult {
  const [items, setItems] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((current) => current + 1), [])

  useEffect(() => {
    let alive = true

    fetchFiles()
      .then((rows) => {
        if (!alive) return
        setItems(rows)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : null)
        setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [nonce])

  const upload = useCallback(
    async (file: File) => {
      setUploading(true)
      setError(null)
      try {
        const row = await uploadFile(file)
        setItems((current) => [row, ...current])
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : null)
      } finally {
        setUploading(false)
      }
    },
    [],
  )

  const remove = useCallback(
    async (id: number) => {
      const snapshot = items
      setItems((current) => current.filter((item) => item.id !== id))
      setError(null)
      try {
        await deleteFile(id)
      } catch (err: unknown) {
        setItems(snapshot)
        setError(err instanceof Error ? err.message : null)
      }
    },
    [items],
  )

  const download = useCallback(
    async (item: FileItem) => {
      setDownloadingId(item.id)
      setError(null)
      try {
        await downloadFile(item.id, item.fileName)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : null)
      } finally {
        setDownloadingId(null)
      }
    },
    [],
  )

  return { items, loading, error, uploading, downloadingId, upload, remove, download, refresh }
}
