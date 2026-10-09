import { h } from './dom'
import { pdfPages } from './extract'

const MAX_PAGES = 30
/** Zooming makes the page this many times its fitted width. */
const ZOOM = 2.5
let isOpen = false

/**
 * Shows a receipt over the whole screen: an image, or a PDF one page at a time starting at page `start` (from 0).
 * Swipe or use the arrow keys between pages; tap to zoom in and out. The close button, Escape or the phone's
 * Back button closes it.
 */
export async function openViewer(file: Blob, pdf: boolean, start = 0): Promise<void> {
  if (isOpen) return
  isOpen = true
  const returnFocus = document.activeElement as HTMLElement | null
  const label = h('span', { class: 'viewer-label', 'aria-live': 'polite' })
  const closeBtn = h('button', { class: 'viewer-close', type: 'button', 'aria-label': 'Close full screen' }, '✕')
  const track = h('div', { class: 'viewer-track' })
  const el = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Receipt, full screen' }, h('div', { class: 'viewer-bar' }, label, closeBtn), track)

  // Pages: one image, or a slot per PDF page that is drawn when it comes near.
  let doc: Awaited<ReturnType<typeof pdfPages>> | undefined
  let url = ''
  const slots: HTMLElement[] = []
  const drawn = new Set<number>()
  if (pdf) {
    try {
      doc = await pdfPages(file)
    } catch {
      isOpen = false
      return
    }
    for (let i = 0; i < Math.min(doc.count, MAX_PAGES); i++) slots.push(h('div', { class: 'viewer-page' }))
  } else {
    url = URL.createObjectURL(file)
    slots.push(h('div', { class: 'viewer-page' }, h('img', { class: 'viewer-media', src: url, alt: 'Receipt' })))
    drawn.add(0)
  }
  track.append(...slots)
  const width = Math.min(1800, Math.round(Math.max(innerWidth, innerHeight) * (devicePixelRatio || 1)))
  function ensure(i: number) {
    if (!doc || i < 0 || i >= slots.length || drawn.has(i)) return
    drawn.add(i)
    doc.draw(i + 1, width).then(
      (canvas) => {
        canvas.className = 'viewer-media'
        slots[i].replaceChildren(canvas)
      },
      () => slots[i].replaceChildren(h('p', { class: 'viewer-note' }, 'This page could not be drawn.')),
    )
  }

  let zoomed = false
  const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth))
  function update() {
    const i = current()
    const tip = zoomed ? 'Tap to fit' : 'Tap to zoom'
    label.textContent = slots.length > 1 ? `Page ${i + 1} of ${slots.length} · ${tip}` : tip
    for (const n of [i, i + 1, i - 1]) ensure(n)
  }
  track.addEventListener('scroll', update, { passive: true })

  // Tap to zoom, keeping the tapped point under the finger.
  track.addEventListener('click', (e) => {
    const media = (e.target as HTMLElement).closest<HTMLElement>('.viewer-media')
    if (!media) return
    const page = media.parentElement!
    const r = media.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    zoomed = !zoomed
    el.classList.toggle('zoomed', zoomed)
    for (const m of track.querySelectorAll<HTMLElement>('.viewer-media')) m.style.width = ''
    if (zoomed) {
      media.style.width = `${r.width * ZOOM}px`
      const pr = page.getBoundingClientRect()
      page.scrollLeft = fx * media.offsetWidth - (e.clientX - pr.left)
      page.scrollTop = fy * media.offsetHeight - (e.clientY - pr.top)
    }
    update()
  })

  // Closing goes through history, so the phone's Back button closes the viewer instead of leaving the form.
  const others = [...document.body.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.inert)
  function finish() {
    removeEventListener('popstate', finish)
    removeEventListener('keydown', onKey)
    el.remove()
    for (const o of others) o.inert = false
    document.documentElement.style.overflow = ''
    doc?.close()
    if (url) URL.revokeObjectURL(url)
    isOpen = false
    returnFocus?.focus()
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') history.back()
    else if (!zoomed && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      track.scrollTo({ left: (current() + (e.key === 'ArrowRight' ? 1 : -1)) * track.clientWidth, behavior: 'smooth' })
    }
  }
  closeBtn.onclick = () => history.back()
  history.pushState({ viewer: true }, '')
  addEventListener('popstate', finish)
  addEventListener('keydown', onKey)

  document.body.append(el)
  for (const o of others) o.inert = true
  document.documentElement.style.overflow = 'hidden'
  track.scrollLeft = Math.min(start, slots.length - 1) * track.clientWidth
  update()
  closeBtn.focus()
}
