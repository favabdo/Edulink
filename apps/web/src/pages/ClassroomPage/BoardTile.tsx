import {
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Maximize2,
  Minimize2,
  PenOff,
  X,
} from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { measureDoc, paintDoc, type SharedDoc } from '../../features/meeting/documents'
import type { Annotation, AnnotationTool, BoardTool } from '../../features/meeting/whiteboard'
import {
  BOARD_COLORS,
  BOARD_TOOLBAR,
  BOARD_WIDTHS,
  drawAll,
  drawAnnotation,
  hitAnnotation,
} from '../../features/meeting/whiteboard'
import {
  ArrowGlyph,
  ClearGlyph,
  EllipseGlyph,
  EraserGlyph,
  HighlighterGlyph,
  LineGlyph,
  PenGlyph,
  RectGlyph,
  TextGlyph,
  UndoGlyph,
} from './ToolIcons'
import styles from './ClassroomPage.module.css'

/**
 * واجهة الشرح — نسخة مطابقة لسلوك شريط أدوات زووم على السبورة والمستند.
 *
 * السطح **مُركَّب دائمًا** (لا يُستبدل بشاشة الفيديو): هذا شرط أن ترى الضربات live،
 * لأن الـ canvas المختفي لا سطح له يُرسم عليه. المخزن هنا في `ref` داخل المكوّن،
 * فالرسم لا يمر بلقطة إغلاق قديمة — وهذا تحديدًا ما كان يجعل الضربات تُخزَّن ولا تظهر.
 *
 * الفرق الجوهري عن النموذج الخطّي القديم: الكائن يُرسَم **مرة واحدة عند تحرير المؤشر**
 * لا مقطعًا مقطعًا، فالسطر الحرّ عند زووم كائن واحد يمكن محوه والتراجع عنه، ورسالة
 * واحدة بدل عشرات. المعاينة أثناء السحب تُرسم على نفس اللوح ثم تُثبَّت، فلا وميض.
 */

export type BoardHandle = {
  add: (annotation: Annotation) => void
  remove: (ids: string[]) => void
  clear: () => void
  applySnapshot: (annotations: Annotation[]) => void
};

/** مؤشر مشارك حيّ: يُعرض ويُخفى بالزمن، ولا يدخل مخزن اللوحة أبدًا */
export type RemotePointer = { connId: string; name: string; x: number; y: number; tool: string; at: number };

type Props = {
  sessionCode: string
  doc: SharedDoc | null
  canDraw: boolean
  /** القلم مقفول بقرار المدرس: الفرق عن `canDraw` أن ولي الأمر لا يكتب أصلًا */
  writeBlocked: boolean
  canHost: boolean
  enlarged: boolean
  tool: BoardTool
  color: string
  width: number
  remotePointers: RemotePointer[]
  onTool: (tool: BoardTool) => void
  onColor: (color: string) => void
  onWidth: (width: number) => void
  onAdd: (annotation: Annotation) => void
  onErase: (ids: string[]) => void
  onUndo: () => void
  onPointerMove: (x: number, y: number, tool: string) => void
  onClear: () => void
  onPickFile: () => void
  onDocPage: (page: number) => void
  onCloseDoc: () => void
  onToggleEnlarge: () => void
};

/** معرّف كائن لا يصطدم بمعرّف طرف آخر: بادئة هذا الجهاز + عدّاد محلي */
let idSeq = 0
function nextId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  idSeq += 1
  return `a${Date.now().toString(36)}-${idSeq}`
}

/** الأداة → رسمتها. المفتاح هو اسم الأداة نفسه، فلا قائمة ثانية تُنسى عند إضافة أداة */
const TOOL_GLYPHS: Record<BoardTool, (props: { size?: number }) => ReactElement> = {
  pen: PenGlyph,
  highlighter: HighlighterGlyph,
  line: LineGlyph,
  arrow: ArrowGlyph,
  rect: RectGlyph,
  ellipse: EllipseGlyph,
  text: TextGlyph,
  eraser: EraserGlyph,
}

export const BoardTile = forwardRef<BoardHandle, Props>(function BoardTile(
  {
    sessionCode,
    doc,
    canDraw,
    writeBlocked,
    canHost,
    enlarged,
    tool,
    color,
    width,
    remotePointers,
    onTool,
    onColor,
    onWidth,
    onAdd,
    onErase,
    onUndo,
    onPointerMove,
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
  /** لوح شفاف فوق الحبر للمعاينة الجارية فقط — يُمسح كل حركة ولا يُنسخ منه شيء */
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const docRef = useRef<HTMLCanvasElement | null>(null)
  const objects = useRef<Map<string, Annotation>>(new Map())
  const order = useRef<string[]>([])
  /** ما سُحب من المؤشر منذ الضغط: نقاطًا نسبية تُثبَّت كائنًا واحدًا عند التحرير */
  const draft = useRef<{ points: number[]; anchor: { x: number; y: number } } | null>(null)
  const aspectRef = useRef(4 / 3)
  const [pageCount, setPageCount] = useState(1)
  const [docMissing, setDocMissing] = useState(false)
  const [caret, setCaret] = useState<{ x: number; y: number; value: string } | null>(null)
  const caretRef = useRef<HTMLInputElement | null>(null)

  // autoFocus يعمل عند التركيب الأول فقط، فلمسة ثانية على اللوحة تضع caret بلا تركيز
  useEffect(() => {
    if (caret && document.activeElement !== caretRef.current) caretRef.current?.focus()
  }, [caret])

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

  /**
   * مقاس السطح بالبكسل الفعلي. يُبلّغ عن تغيّره حتى يعرف الراسم هل يكمل فوق ما
   * رسمه فعلًا أم أن الكانفس فُرم فلا بدّ من رسم المخزن كله من جديد.
   */
  const syncCanvasSize = useCallback(() => {
    const canvas = inkRef.current
    const box = boxRef.current
    if (!canvas || !box) return null
    const rect = box.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const ratio = window.devicePixelRatio || 1
    const w = Math.round(rect.width * ratio)
    const h = Math.round(rect.height * ratio)
    const changed = canvas.width !== w || canvas.height !== h
    if (changed) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    return ctx ? { ctx, w, h, ratio, changed } : null
  }, [])

  /** رسم المخزن كاملًا: تغيّر مقاس، أو استبدال حالة، أو مسح، أو محو كائن */
  const redrawAll = useCallback(() => {
    const surface = syncCanvasSize()
    if (!surface) return
    surface.ctx.clearRect(0, 0, surface.w, surface.h)
    drawAll(surface.ctx, surface.w, surface.h, order.current.map((id) => objects.current.get(id)!).filter(Boolean), surface.ratio)
  }, [syncCanvasSize])

  /**
   * تثبيت كائن فوق القائم بلا إعادة رسم اللوحة. هذا وحده هو الفرق بين كتابة ثقيلة
   * على نفس الجهاز الذي يفكّ شيفرة الفيديو وكتابة لا تُكلّف أكثر من سطر واحد.
   */
  const appendInk = useCallback((annotation: Annotation) => {
    const surface = syncCanvasSize()
    if (!surface) return
    if (surface.changed) {
      redrawAll()
      return
    }
    drawAnnotation(surface.ctx, surface.w, surface.h, annotation, surface.ratio)
  }, [syncCanvasSize, redrawAll])

  const commit = useCallback((annotation: Annotation) => {
    objects.current.set(annotation.id, annotation)
    order.current.push(annotation.id)
    appendInk(annotation)
    onAdd(annotation)
  }, [appendInk, onAdd])

  /**
   * معاينة أثناء السحب على **لوح شفاف فوق الحبر**: يُمسح ويُعاد رسم الكائن الجاري
   * فقط. النسخ البديل (حفظ صورة اللوح كل حركة) هو بعينه ما كان يُثقل الكتابة على
   * نفس الجهاز الذي يفكّ شيفرة الفيديو، فمُنع هنا لا هناك.
   */
  const drawPreview = useCallback((points: number[], shape: AnnotationTool) => {
    const canvas = previewRef.current
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
    drawAnnotation(ctx, w, h, { id: 'preview', tool: shape, color, width, points }, ratio)
  }, [color, width])

  const clearPreview = useCallback(() => {
    const canvas = previewRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  const repaintDoc = useCallback(async () => {
    const canvas = docRef.current
    const box = boxRef.current
    if (!canvas || !box) return
    if (!doc) {
      applyFit()
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
      redrawAll()
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
      redrawAll()
      setDocMissing(false)
    } catch {
      // المستند لم يعد مُمنوحًا (أُغلق أو تبدلت الغرفة): السطح يبقى صالحًا للكتابة فوقه
      setDocMissing(true)
    }
  }, [doc, sessionCode, applyFit, redrawAll])

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
      add: (annotation) => {
        if (objects.current.has(annotation.id)) return
        objects.current.set(annotation.id, annotation)
        order.current.push(annotation.id)
        appendInk(annotation)
      },
      remove: (ids) => {
        let touched = false
        for (const id of ids) {
          if (!objects.current.has(id)) continue
          objects.current.delete(id)
          order.current = order.current.filter((existing) => existing !== id)
          touched = true
        }
        if (touched) {
          clearPreview()
          redrawAll()
        }
      },
      clear: () => {
        objects.current.clear()
        order.current = []
        clearPreview()
        redrawAll()
      },
      applySnapshot: (list) => {
        objects.current = new Map(list.map((a) => [a.id, a]))
        order.current = list.map((a) => a.id)
        clearPreview()
        redrawAll()
      },
    }),
    [appendInk, redrawAll, clearPreview],
  )

  /**
   * إحداثيات نسبية داخل 0..1. القصّ ضروري لا تجميلي: المؤشر يخرج من اللوحة أثناء
   * السحب المستمر فيعطي قيمًا سالبة، والخادم صار يرفض ما خرج عن 0..1 — فالغير
   * مقصوص يعني كائنًا يُرفض عند الطرف الآخر فيظهر النصف فقط.
   */
  const relativeFrom = (rect: DOMRect, clientX: number, clientY: number) => {
    if (rect.width === 0 || rect.height === 0) return null
    const x = (clientX - rect.left) / rect.width
    const y = (clientY - rect.top) / rect.height
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
  }

  const relative = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return relativeFrom(rect, event.clientX, event.clientY)
  }

  /** الممحاة: نقطة واحدة تمسح الكائن كله كما في زووم، لا بكسلات من منتصفه */
  const eraseAt = (x: number, y: number) => {
    const hits = order.current.filter((id) => {
      const annotation = objects.current.get(id)
      return annotation ? hitAnnotation(annotation, x, y) : false
    })
    if (hits.length === 0) return
    for (const id of hits) {
      objects.current.delete(id)
    }
    order.current = order.current.filter((id) => !hits.includes(id))
    clearPreview()
    redrawAll()
    onErase(hits)
  }

  /** الكتابة قرار الخادم: مقفولة بمنع المدرس أو بسقف الدور (ولي الأمر لا يكتب أصلًا) */
  const canWrite = canDraw && !writeBlocked

  return (
    <div className={`${styles.board} ${enlarged ? styles.boardLarge : ''}`} data-doc={doc ? 'on' : 'off'}>
      <div className={styles.boardTools}>
        <span className={styles.boardTitle}>{doc ? doc.fileName : t('classroom:board.title')}</span>
        {writeBlocked && (
          <span className={styles.writeBlocked} role="status">
            <PenOff size={13} aria-hidden="true" />
            {t('classroom:board.writeBlocked')}
          </span>
        )}
        <div className={styles.toolRow} role="group" aria-label={t('classroom:board.tools')}>
          {BOARD_TOOLBAR.map((value) => {
            const Glyph = TOOL_GLYPHS[value]
            const active = tool === value
            return (
              <button
                key={value}
                type="button"
                data-tool={value}
                className={`${styles.toolBtn} ${active ? styles.toolActive : ''}`}
                aria-pressed={active}
                disabled={!canWrite}
                aria-label={t(`classroom:tool.${value}`)}
                title={t(`classroom:tool.${value}`)}
                onClick={() => onTool(value)}
              >
                <Glyph size={22} />
                <span className={styles.toolLabel}>{t(`classroom:tool.${value}`)}</span>
              </button>
            )
          })}
          <button
            type="button"
            className={styles.toolBtn}
            disabled={!canWrite}
            aria-label={t('classroom:tool.undo')}
            title={t('classroom:tool.undo')}
            onClick={onUndo}
          >
            <UndoGlyph size={22} />
            <span className={styles.toolLabel}>{t('classroom:tool.undo')}</span>
          </button>
          {/* على الموبايل تُخفى الأسماء فلا بدّ من سطر واحد يقول الأداة الجارية:
              بلاهُ لا يعرف المدرس أي وضع دخل بإصبعه */}
          <span className={styles.toolNow} data-tool-caption={tool} aria-hidden="true">{t(`classroom:tool.${tool}`)}</span>
        </div>
        <div className={styles.boardColors} role="group" aria-label={t('classroom:board.color')}>
          {BOARD_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.colorDot} ${color === value ? styles.colorActive : ''}`}
              style={{ background: value }}
              aria-label={value}
              aria-pressed={color === value}
              disabled={!canWrite}
              onClick={() => onColor(value)}
            />
          ))}
        </div>
        <div className={styles.widthRow} role="group" aria-label={t('classroom:board.width')}>
          {BOARD_WIDTHS.map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.widthBtn} ${width === value ? styles.widthActive : ''}`}
              aria-pressed={width === value}
              disabled={!canWrite}
              aria-label={t('classroom:board.widthN', { n: value })}
              onClick={() => onWidth(value)}
            >
              <span className={styles.widthMark} style={{ height: `${value}px` }} aria-hidden="true" />
            </button>
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
          <button type="button" data-board-clear="" className={styles.boardBtn} onClick={onClear}>
            <ClearGlyph size={16} />
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
          data-tool={tool}
          aria-label={t('classroom:board.title')}
          onPointerDown={(event) => {
            if (!canWrite) return
            const point = relative(event)
            if (!point) return
            if (tool === 'eraser') {
              eraseAt(point.x, point.y)
              event.currentTarget.setPointerCapture(event.pointerId)
              draft.current = { points: [], anchor: point }
              return
            }
            if (tool === 'text') {
              // بلا preventDefault ينقل الفعل الافتراضي للنقرة التركيز إلى body،
              // فيُطلق onBlur على caret وُلِد للتو ويُغلقه قبل أن يُكتب فيه حرف:
              // النص لا يُكتب بالموس إطلاقًا (مقيس في بوابة المتصفح).
              event.preventDefault()
              setCaret({ x: point.x, y: point.y, value: '' })
              return
            }
            draft.current = { points: [point.x, point.y, point.x, point.y], anchor: point }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) return
            // حدث React واحد قد يخبّئ تحركات حقيقية عدة حدثت في نفس الإطار؛
            // أخذ واحدة منها فقط = خط مفقّع ونقاط ضائعة عند الطرف الآخر.
            const coalesced = typeof event.nativeEvent.getCoalescedEvents === 'function'
              ? event.nativeEvent.getCoalescedEvents()
              : []
            const sources: { clientX: number; clientY: number }[] = coalesced.length > 0
              ? coalesced
              : [event.nativeEvent]

            const active = draft.current
            if (active && canWrite) {
              if (tool === 'eraser') {
                for (const source of sources) {
                  const point = relativeFrom(rect, source.clientX, source.clientY)
                  if (point) eraseAt(point.x, point.y)
                }
                return
              }
              // الأشكال تُحدَّد بطرفيها فقط، والحرّي يجمع كل النقاط التي مرّت
              for (const source of sources) {
                const point = relativeFrom(rect, source.clientX, source.clientY)
                if (!point) break
                if (tool === 'pen' || tool === 'highlighter') {
                  active.points.push(point.x, point.y)
                } else {
                  active.points = [active.anchor.x, active.anchor.y, point.x, point.y]
                }
              }
              drawPreview(active.points, tool)
              onPointerMove(active.points[active.points.length - 2], active.points[active.points.length - 1], tool)
              return
            }
            if (canWrite) {
              const point = relativeFrom(rect, event.clientX, event.clientY)
              if (point) onPointerMove(point.x, point.y, tool)
            }
          }}
          onPointerUp={() => {
            const active = draft.current
            draft.current = null
            clearPreview()
            if (!active || tool === 'eraser') return
            if (active.points.length < 4) return
            if (tool !== 'pen' && tool !== 'highlighter' && active.points[2] === active.points[0] && active.points[3] === active.points[1]) return
            commit({ id: nextId(), tool, color, width, points: active.points })
          }}
          onPointerCancel={() => {
            draft.current = null
            clearPreview()
            redrawAll()
          }}
        />
        <canvas ref={previewRef} className={styles.boardPreview} aria-hidden="true" />
        {caret && (
          <input
            ref={caretRef}
            className={styles.textCaret}
            style={{ left: `${caret.x * 100}%`, top: `${caret.y * 100}%`, color, fontSize: `${width * 6 + 10}px` }}
            autoFocus
            aria-label={t('classroom:tool.text')}
            value={caret.value}
            onChange={(event) => setCaret({ ...caret, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const value = caret.value.trim()
                if (value) commit({ id: nextId(), tool: 'text', color, width, points: [caret.x, caret.y], text: value })
                setCaret(null)
              } else if (event.key === 'Escape') {
                setCaret(null)
              }
            }}
            onBlur={() => {
              const value = caret.value.trim()
              if (value) commit({ id: nextId(), tool: 'text', color, width, points: [caret.x, caret.y], text: value })
              setCaret(null)
            }}
          />
        )}
        {/* المؤشرات الحيّة: طبقة DOM لا بكسلات على اللوح، فلا تُمسح بمسح ولا تُخزَّن */}
        {remotePointers.map((pointer) => (
          <span
            key={pointer.connId}
            className={`${styles.remotePointer} ${pointer.tool === 'eraser' ? styles.pointerEraser : ''}`}
            data-pointer={pointer.connId}
            style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }}
            dir="auto"
          >
            {pointer.name}
          </span>
        ))}
        </div>
      </div>
    </div>
  )
});
