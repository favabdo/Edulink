import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { useFiles } from '../../features/files/useFiles'
import type { FileItem } from '../../features/files/api'
import styles from './FilesPage.module.css'

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot === -1 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1, dot + 5)
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function FilesPage() {
  const { t, i18n } = useTranslation()
  const { items, loading, error, uploading, downloadingId, upload, remove, download } = useFiles()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  async function onPick(file: File | undefined) {
    if (!file) return
    await upload(file)
    if (inputRef.current) inputRef.current.value = ''
  }

  function onDelete(item: FileItem) {
    const confirmed = window.confirm(t('files:delete') + ' — ' + item.fileName + '?')
    if (confirmed) void remove(item.id)
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('files:title')}</h1>
          <p className={styles.subtitle}>{t('files:subtitle')}</p>
        </div>
        <span className={styles.count}>{t('files:count', { count: items.length })}</span>
      </header>

      <div className={styles.uploadCard}>
        <input
          ref={inputRef}
          id="files-upload-input"
          type="file"
          className={styles.hiddenInput}
          onChange={(event) => void onPick(event.target.files?.[0])}
        />
        <label htmlFor="files-upload-input" className={styles.uploadZone}>
          <span className={styles.uploadIcon} aria-hidden="true">
            {uploading ? <Loader2 size={22} className={styles.spinner} /> : <Upload size={22} />}
          </span>
          <span className={styles.uploadText}>
            {uploading ? t('files:upload.busy') : t('files:upload.button')}
          </span>
        </label>
        <p className={styles.uploadHint}>{t('files:upload.hint')}</p>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {t('files:error', { message: error })}
        </div>
      )}

      {loading ? (
        <p className={styles.placeholder}>{t('files:loading')}</p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <FileText size={28} aria-hidden="true" />
          <p className={styles.emptyTitle}>{t('files:empty.title')}</p>
          <p className={styles.emptySub}>{t('files:empty.sub')}</p>
        </div>
      ) : (
        <div className={styles.card}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('files:table.name')}</th>
                <th scope="col">{t('files:table.size')}</th>
                <th scope="col">{t('files:table.date')}</th>
                <th scope="col" className={styles.actionsCol}>
                  {t('files:table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const ext = extensionOf(item.fileName)
                return (
                  <tr key={item.id}>
                    <td>
                      <div className={styles.nameCell}>
                        <span className={styles.extBadge} aria-hidden="true">
                          {ext || <FileText size={14} />}
                        </span>
                        <span className={styles.fileName} title={item.fileName}>
                          {item.fileName}
                        </span>
                      </div>
                    </td>
                    <td className={styles.muted}>{sizeText(item.sizeBytes)}</td>
                    <td className={styles.muted}>{dateFormatter.format(item.at)}</td>
                    <td className={styles.actionsCol}>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => void download(item)}
                          disabled={downloadingId === item.id}
                          title={downloadingId === item.id ? t('files:downloading') : t('files:download')}
                          aria-label={`${t('files:download')} — ${item.fileName}`}
                        >
                          {downloadingId === item.id ? (
                            <Loader2 size={16} className={styles.spinner} />
                          ) : (
                            <Download size={16} />
                          )}
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconButton} ${styles.danger}`}
                          onClick={() => onDelete(item)}
                          title={t('files:delete')}
                          aria-label={`${t('files:delete')} — ${item.fileName}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
