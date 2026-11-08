import type { ReactElement } from 'react'

/**
 * رسومات الأدوات — مرسومة يدًا لا مأخوذة من مكتبة أيقونات عامة.
 *
 * السبب مقيس من شاشة المدرس: الأيقونة العامة داخل زر 30px كانت تُقرأ «علامة زائد»
 * لا قلمًا، ففقدت كل أداة مميزها. كل رسمة هنا لها ظلّ يسمّي فعلها وحده: طرف nib
 * للقلم، وشريط عريض للمظلل، ونقطتا طرف للخط، ورأس سهم، ومربع، وبيضاوي، وحرف A
 * للنص، وقطعة ممحاة فوق خطّ.
 */

type IconProps = { size?: number }

function frame(size: number, children: ReactElement | ReactElement[]) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const PenGlyph = ({ size = 22 }: IconProps) =>
  frame(size, [
    <path key="body" d="M4.6 19.4l1-4L15.8 4.2l3 3L8.6 18.4z" />,
    <path key="ferrule" d="M13.8 6.2l3 3" />,
    <path key="tip" d="M5.6 15.4l2.2 2.2" />,
  ])

export const HighlighterGlyph = ({ size = 22 }: IconProps) =>
  frame(size, [
    <path key="band" d="M4.4 20.2h7.2" strokeWidth={3.4} opacity={0.55} />,
    <path key="chisel" d="M9.4 15.2l5.6-5.6 3.2 3.2-5.6 5.6z" />,
    <path key="cap" d="M15.6 8.6l2.2-2.2 2.6 2.6-2.2 2.2" />,
  ])

export const LineGlyph = ({ size = 22 }: IconProps) =>
  frame(size, [
    <path key="line" d="M7.4 12h9.2" />,
    <circle key="a" cx="5.4" cy="12" r="2" />,
    <circle key="b" cx="18.6" cy="12" r="2" />,
  ])

export const ArrowGlyph = ({ size = 22 }: IconProps) =>
  frame(size, [
    <path key="shaft" d="M5.6 18.4L17 7" />,
    <path key="head" d="M10.4 6.4H18v7.6" />,
  ])

export const RectGlyph = ({ size = 22 }: IconProps) =>
  frame(size, <path d="M4.4 6.6h15.2v10.8H4.4z" />)

export const EllipseGlyph = ({ size = 22 }: IconProps) =>
  frame(size, <ellipse cx="12" cy="12" rx="8" ry="6.2" />)

export const TextGlyph = ({ size = 22 }: IconProps) =>
  frame(size, [
    <path key="a" d="M7 18.6l5-13.2 5 13.2" />,
    <path key="bar" d="M9.2 14.2h5.6" />,
  ])

export const EraserGlyph = ({ size = 22 }: IconProps) =>
  frame(size, [
    <path key="block" d="M12.6 5.6l5.8 5.8a1.7 1.7 0 0 1 0 2.4l-4.6 4.6H9.4l-4-4a1.7 1.7 0 0 1 0-2.4l5.2-5.2a1.7 1.7 0 0 1 2 0z" />,
    <path key="split" d="M8.2 10.4l5.4 5.4" />,
    <path key="floor" d="M4.6 21h12" />,
  ])

export const UndoGlyph = ({ size = 22 }: IconProps) =>
  frame(size, [
    <path key="arc" d="M4.4 9.6h10.4a5 5 0 0 1 0 10H9" />,
    <path key="head" d="M8.6 5.2L4 9.8l4.6 4.6" />,
  ])

/** «مسح الكل» سلة، لا ممحاة: وضع الممحاة له رسمته في الأداة ولا يجوز أن يتكرر شكلان */
export const ClearGlyph = ({ size = 20 }: IconProps) =>
  frame(size, [
    <path key="lid" d="M4.6 7.2h14.8" />,
    <path key="handle" d="M9.4 7.2V5.2a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v2" />,
    <path key="bin" d="M6.6 7.2l1.1 12.2a1.6 1.6 0 0 0 1.6 1.4h5.4a1.6 1.6 0 0 0 1.6-1.4l1.1-12.2" />,
  ])
