import { h } from './dom'

/** The crop area as fractions of the image: 0 to 1 on each side. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
/** What a drag moves: the whole box, one edge, or a corner (two edges). */
export type Grip = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

const MIN = 0.05
/** Room around the photo for the grips on its edges, in px; matches the stage margin in style.css. */
const EDGE = 12
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The crop area after dragging `grip` by (dx, dy), as fractions of the image. It stays inside the image and at least 5% wide and high. */
export function dragRect(r: Rect, grip: Grip, dx: number, dy: number): Rect {
  if (grip === 'move') return { ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) }
  let { x, y, w, h } = r
  if (grip.includes('w')) {
    x = clamp(r.x + dx, 0, r.x + r.w - MIN)
    w = r.x + r.w - x
  }
  if (grip.includes('e')) w = clamp(r.w + dx, MIN, 1 - r.x)
  if (grip.includes('n')) {
    y = clamp(r.y + dy, 0, r.y + r.h - MIN)
    h = r.y + r.h - y
  }
  if (grip.includes('s')) h = clamp(r.h + dy, MIN, 1 - r.y)
  return { x, y, w, h }
}

const GRIPS: [Grip, string][] = [
  ['nw', 'Top-left corner'],
  ['n', 'Top edge'],
  ['ne', 'Top-right corner'],
  ['e', 'Right edge'],
  ['se', 'Bottom-right corner'],
  ['s', 'Bottom edge'],
  ['sw', 'Bottom-left corner'],
  ['w', 'Left edge'],
]

const jpeg = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), 'image/jpeg', 0.85))

/** The image turned a quarter turn clockwise. */
async function turn(src: ImageBitmap): Promise<ImageBitmap> {
  const c = document.createElement('canvas')
  c.width = src.height
  c.height = src.width
  const ctx = c.getContext('2d')!
  ctx.translate(c.width, 0)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(src, 0, 0)
  return createImageBitmap(c)
}

/** A cropped photo, the photo as it was ('keep'), or 'retake' when the user asked for a new photo. */
export type CropResult = Blob | 'keep' | 'retake'

/**
 * Shows the photo in `host` with a box to drag to the receipt's edges, and a button to turn it.
 * `retake` is called from the Retake button's click, so it can open the camera again.
 */
export async function cropImage(host: HTMLElement, image: Blob, retake?: () => void): Promise<CropResult> {
  let source = await createImageBitmap(image)
  let turns = 0
  let rect: Rect = { ...FULL }
  let dispW = 0
  let dispH = 0

  const canvas = h('canvas', { class: 'crop-image', 'aria-hidden': 'true' })
  const box = h(
    'div',
    { class: 'crop-box', 'data-grip': 'move', tabindex: 0, role: 'group', 'aria-label': 'Crop area. Arrow keys move it.' },
    ...GRIPS.map(([g, label]) => h('span', { class: 'crop-grip', 'data-grip': g, tabindex: 0, role: 'button', 'aria-label': `${label}. Arrow keys move it.` })),
  )
  // The shade dims the photo outside the box. It is clipped to the photo; the box and its grips are not, so grips on the photo's edge stay whole.
  const shade = h('div', { class: 'crop-shade' })
  const stage = h('div', { class: 'crop-stage' }, canvas, h('div', { class: 'crop-clip' }, shade), box)

  function place() {
    const at = { left: `${rect.x * dispW}px`, top: `${rect.y * dispH}px`, width: `${rect.w * dispW}px`, height: `${rect.h * dispH}px` }
    Object.assign(box.style, at)
    Object.assign(shade.style, at)
  }
  function layout() {
    const maxW = host.clientWidth - 2 * EDGE
    const maxH = Math.min(window.innerHeight * 0.7, 900)
    if (!maxW) return
    const scale = Math.min(maxW / source.width, maxH / source.height, 2)
    dispW = Math.round(source.width * scale)
    dispH = Math.round(source.height * scale)
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(dispW * dpr)
    canvas.height = Math.round(dispH * dpr)
    Object.assign(canvas.style, { width: `${dispW}px`, height: `${dispH}px` })
    Object.assign(stage.style, { width: `${dispW}px`, height: `${dispH}px` })
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
    place()
  }

  // Dragging with a finger, pen or mouse
  let drag: { grip: Grip; x0: number; y0: number; start: Rect } | null = null
  stage.addEventListener('pointerdown', (e) => {
    const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-grip]')?.dataset.grip as Grip | undefined
    if (!grip) return
    e.preventDefault()
    stage.setPointerCapture(e.pointerId)
    drag = { grip, x0: e.clientX, y0: e.clientY, start: rect }
  })
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return
    rect = dragRect(drag.start, drag.grip, (e.clientX - drag.x0) / dispW, (e.clientY - drag.y0) / dispH)
    place()
  })
  const stop = () => void (drag = null)
  stage.addEventListener('pointerup', stop)
  stage.addEventListener('pointercancel', stop)

  // The keyboard moves whichever edge, corner or box has focus: 1% a press, 5% with Shift.
  const STEP: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  stage.addEventListener('keydown', (e) => {
    const grip = (e.target as HTMLElement).dataset.grip as Grip | undefined
    const step = STEP[e.key]
    if (!grip || !step) return
    e.preventDefault()
    const by = e.shiftKey ? 0.05 : 0.01
    rect = dragRect(rect, grip, step[0] * by, step[1] * by)
    place()
  })

  const observer = new ResizeObserver(layout)
  return new Promise<CropResult>((resolve) => {
    const finish = (result: CropResult) => {
      observer.disconnect()
      source.close()
      host.replaceChildren()
      resolve(result)
    }
    const done = h('button', { class: 'btn', type: 'button' }, 'Done')
    done.onclick = async () => {
      if (!turns && rect.x === 0 && rect.y === 0 && rect.w === 1 && rect.h === 1) return finish('keep')
      done.disabled = true
      const sx = Math.round(rect.x * source.width)
      const sy = Math.round(rect.y * source.height)
      const out = document.createElement('canvas')
      out.width = Math.max(1, Math.round(rect.w * source.width))
      out.height = Math.max(1, Math.round(rect.h * source.height))
      out.getContext('2d')!.drawImage(source, sx, sy, out.width, out.height, 0, 0, out.width, out.height)
      finish(await jpeg(out))
    }
    const rotate = h('button', { class: 'btn quiet', type: 'button' }, 'Rotate')
    rotate.onclick = async () => {
      const next = await turn(source)
      source.close()
      source = next
      turns = (turns + 1) % 4
      rect = { ...FULL }
      layout()
    }
    host.replaceChildren(
      h(
        'div',
        { class: 'crop' },
        h('p', { class: 'hint' }, 'Drag the corners and edges to the edges of the receipt.'),
        stage,
        h(
          'div',
          { class: 'row' },
          done,
          rotate,
          retake ? h('button', { class: 'btn quiet', type: 'button', onclick: () => (retake(), finish('retake')) }, 'Retake') : null,
          h('button', { class: 'btn quiet', type: 'button', onclick: () => finish('keep') }, retake ? 'Use whole photo' : 'Cancel'),
        ),
      ),
    )
    observer.observe(host)
    layout()
  })
}
