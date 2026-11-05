import { Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchFiles, uploadFile, type FileItem } from '../../features/files/api'
import type { SharedDoc } from '../../features/meeting/documents'
import styles from './ClassroomPage.module.css'

/**
 * اختيار ملف لعرضه داخل الحصة: من مكتبة الحساب أو من الجهاز (يُرفع أولًا ثم يُعرض).
 *
 * القائمة والرفع كلاهما `/api/files` — فلا مسار جديد ولا صلاحية جديدة: المدرس يعرض
 * ملفه هو فقط، والطالب يقرأه من طريق القراءة المقيَّد بغرفة نشطة (`/api/files/{id}/shared`).
 */
const SHARABLE = /^image\/(png|jpeg|webp|gif)$|^application\/pdf$/;

export function FilePickerDialog({
  onPick,
  onClose,
}: {
  onPick: (doc: SharedDoc) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [items, setItems] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    fetchFiles()
      .then((rows) => {
        setItems(rows)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('classroom:file.loadFailed')))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => {
    reload()
  }, [reload])

  const shareable = items.filter(
    (file) => SHARABLE.test(file.mime) || /\.(png|jpe?g|webp|gif|pdf)$/i.test(file.fileName),
  )

  const pick = (file: FileItem) => {
    onPick({ fileId: file.id, fileName: file.fileName, mime: file.mime, page: 1 })
  }

  const onDeviceFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!SHARABLE.test(file.type)) {
      setNotice(t('classroom:file.onlyImagesPdf'))
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const created = await uploadFile(file)
      pick(created)
    } catch (err) {
      // السبب الكامل يظهر على الشاشة: «الرفع فشل» وحده لا يكفي المدرس وقت الحصة
      setNotice(err instanceof Error ? err.message : t('classroom:file.uploadFailed'))
      setBusy(false)
    }
  }

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('classroom:file.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogTitle}>{t('classroom:file.title')}</h2>
          <button type="button" className={styles.ghostButton} onClick={onClose} aria-label={t('classroom:file.close')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <p className={styles.dialogDesc}>{t('classroom:file.desc')}</p>

        {notice && (
          <p className={styles.fileNotice} role="alert">
            {notice}
          </p>
        )}
        {error && (
          <p className={styles.fileNotice} role="alert">
            {error}
          </p>
        )}

        <button type="button" className={styles.primaryButton} onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload size={15} aria-hidden="true" />
          {busy ? t('classroom:file.uploading') : t('classroom:file.fromDevice')}
        </button>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" hidden onChange={(event) => void onDeviceFile(event)} />

        <ul className={styles.fileList}>
          {loading && <li className={styles.fileEmpty}>{t('common:loading')}</li>}
          {!loading && shareable.length === 0 && (
            <li className={styles.fileEmpty}>
              {t('classroom:file.libraryEmpty')}
              <button type="button" className={styles.ghostButton} onClick={reload}>
                {t('classroom:file.retry')}
              </button>
            </li>
          )}
          {shareable.map((file) => (
            <li key={file.id} className={styles.fileRow}>
              <button type="button" className={styles.fileOpen} onClick={() => pick(file)}>
                <span className={styles.fileName}>{file.fileName}</span>
                <span className={styles.fileMeta}>{Math.max(1, Math.round(file.sizeBytes / 1024))} KB</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
