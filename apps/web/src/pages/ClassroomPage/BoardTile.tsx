import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  FilePlus2,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { measureDoc, paintDoc, type SharedDoc } from '../../features/meeting/documents'
import type { Stroke } from '../../features/meeting/meetingClient'
import { BOARD_COLORS, drawSegments } from '../../features/meeting/whiteboard'
import styles from './ClassroomPage.module.css'

/**
 *واجهة السبورة: مستند تحت + طبقة قلم فوق.
 *
 * السطح **مُركَّب دائمًا** (لا يُستبدل بشاشة الفيديو): هذا شرط أن ترى الضربات live،
 * لأن الـ canvas المختفي لا سطح له يُرسم عليه. المخزن هنا في `ref` داخل المكوّن،
 * فالرسم لا يمر بلقطة إغلاق قديمة — وهذا تحديدًا ما كان يجعل الضربات تُخزَّن ولا تظهر.
 */
export type BoardHandle = {
  addStroke: (stroke: Stroke) => void
  clear: () => void
  applySnapshot: (segments: Stroke[]) => void
};

type Props = {
  sessionCode: string
  doc: SharedDoc | null
  canDraw: boolean
  canHost: boolean
  enlarged: boolean
  color: string
  onColor: (color: string) => void
  onStroke: (stroke: Stroke) => void
  onClear: () => void
  onPickFile: () => void
  onDocPage: (page: number) => void
  onCloseDoc: () => void
  onToggleEnlarge: () => void
};

export const BoardTile = forwardRef<BoardHandle, Props>(function BoardTile(
  {
    sessionCode,
    doc,
    canDraw,
    canHost,
    enlarged,
    color,
    onColor,
    onStroke,
    onClear,
    onPickFile,
    onDocPage,
    onCloseDoc,
    onToggleEnlarge,
  },
  ref,
) {
  const { t } = useTranslation()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const inkRef = useRef<HTMLCanvasElement | null>(null)
  const docRef = useRef<HTMLCanvasElement | null>(null)
  const segments = useRef<Stroke[]>([])
  const drawing = useRef<{ x: number; y: number } | null>(null)
  const aspectRef = useRef(4 / 3)
  const [pageCount, setPageCount] = useState(1)
  const [docMissing, setDocMissing] = useState(false)

  /**
   * مقاس السطح = أكبر مستطيل بنسبة الصفحة داخل المسرح — فلا تُمدّ صفحة طولية على
   * عرض عريض. تُكتب الأبعاد على العنصر مباشرة (لا حالة React): القياس التالي لـ
   * getBoundingClientRect يكون على تخطيط مُستقر، فلا يُرسم المستند بمقاس قديم.
   */
  const applyFit = useCallback(() => {
    const stage = stageRef.current
    const box = boxRef.current
    if (!stage || !box) return
    const rect = stage.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    if (!doc) {
      box.style.width = ''
      box.style.height = ''
      return
    }
    const ratio = aspectRef.current
    const w = Math.round(Math.min(rect.width, rect.height * ratio))
    box.style.width = `${w}px`
    box.style.height = `${Math.round(w / ratio)}px`
  }, [doc])

  const redrawInk = useCallback(() => {
    const canvas = inkRef.current
    const box = boxRef.current
    if (!canvas || !box) return
    const rect = box.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const ratio = window.devicePixelRatio || 1
    const w = Math.round(rect.width * ratio)
    const h = Math.round(rect.height * ratio)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    drawSegments(ctx, w, h, segments.current, ratio)
  }, [])

  const repaintDoc = useCallback(async () => {
    const canvas = docRef.current
    const box = boxRef.current
    if (!canvas || !box) return
    if (!doc) {
      applyFit()
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
      redrawInk()
      return
    }
    try {
      const geometry = await measureDoc(doc, sessionCode)
      if (Number.isFinite(geometry.aspect) && geometry.aspect > 0) aspectRef.current = geometry.aspect
      setPageCount(geometry.pageCount)
      applyFit()
      const rect = box.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
      await paintDoc(canvas, doc, sessionCode)
      redrawInk()
      setDocMissing(false)
    } catch {
      // المستند لم يعد مُمنوحًا (أُغلق أو تبدلت الغرفة): السطح يبقى صالحًا للكتابة فوقه
      setDocMissing(true)
    }
  }, [doc, sessionCode, applyFit, redrawInk])

  // المقاس يتغير بالتكبير/النوافذ، والمستند يتغير بإعادة إنشاء المراقب:
  // ResizeObserver يُبلّغ مرة فور observe() — فهذه طريق الرسم الأولى واللاحقة معًا.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(() => {
      void repaintDoc()
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [repaintDoc])

  useImperativeHandle(
    ref,
    () => ({
      addStroke: (stroke) => {
        segments.current.push(stroke)
        redrawInk()
      },
      clear: () => {
        segments.current = []
        redrawInk()
      },
      applySnapshot: (list) => {
        segments.current = list
        redrawInk()
      },
    }),
    [redrawInk],
  )

  const relative = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  return (
    <div className={`${styles.board} ${enlarged ? styles.boardLarge : ''}`} data-doc={doc ? 'on' : 'off'}>
      <div className={styles.boardTools}>
        <span className={styles.boardTitle}>{doc ? doc.fileName : t('classroom:board.title')}</span>
        <div className={styles.boardColors} role="group" aria-label={t('classroom:board.color')}>
          {BOARD_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.colorDot} ${color === value ? styles.colorActive : ''}`}
              style={{ background: value }}
              aria-label={value}
              aria-pressed={color === value}
              disabled={!canDraw}
              onClick={() => onColor(value)}
            />
          ))}
        </div>
        {doc && pageCount > 1 && (
          <div className={styles.pageNav} role="group" aria-label={t('classroom:board.page')} dir="ltr">
            <button type="button" disabled={!canHost || doc.page <= 1} onClick={() => onDocPage(doc.page - 1)} aria-label={t('classroom:board.prevPage')}>
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
            <span className={styles.pageNow} dir="ltr">
              {doc.page} / {pageCount}
            </span>
            <button type="button" disabled={!canHost || doc.page >= pageCount} onClick={() => onDocPage(doc.page + 1)} aria-label={t('classroom:board.nextPage')}>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className={styles.boardSpacer} aria-hidden="true" />
        {docMissing && <span className={styles.docMissing}>{t('classroom:board.docMissing')}</span>}
        {canHost && (
          <button type="button" className={styles.boardBtn} onClick={onPickFile}>
            <FilePlus2 size={15} aria-hidden="true" />
            {t('classroom:board.file')}
          </button>
        )}
        {doc && canHost && (
          <button type="button" className={styles.boardBtn} onClick={onCloseDoc}>
            <X size={15} aria-hidden="true" />
            {t('classroom:board.closeFile')}
          </button>
        )}
        {canHost && (
          <button type="button" className={styles.boardBtn} onClick={onClear}>
            <Eraser size={15} aria-hidden="true" />
            {t('classroom:board.clear')}
          </button>
        )}
        <button
          type="button"
          className={styles.boardBtn}
          onClick={onToggleEnlarge}
          aria-pressed={enlarged}
          aria-label={enlarged ? t('classroom:board.shrink') : t('classroom:board.enlarge')}
        >
          {enlarged ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
        </button>
      </div>

      <div ref={stageRef} className={styles.boardStage}>
        <div ref={boxRef} className={styles.boardBox}>
        <canvas ref={docRef} className={styles.boardDoc} aria-hidden="true" />
        <canvas
          ref={inkRef}
          className={styles.boardInk}
          aria-label={t('classroom:board.title')}
          onPointerDown={(event) => {
            if (!canDraw) return
            const point = relative(event)
            if (!point) return
            drawing.current = point
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const previous = drawing.current
            if (!previous || !canDraw) return
            const point = relative(event)
            if (!point) return
            const stroke: Stroke = { x1: previous.x, y1: previous.y, x2: point.x, y2: point.y, color }
            segments.current.push(stroke)
            redrawInk()
            onStroke(stroke)
            drawing.current = point
          }}
          onPointerUp={() => {
            drawing.current = null
          }}
          onPointerCancel={() => {
            drawing.current = null
          }}
        />
        </div>
      </div>
    </div>
  )
});
