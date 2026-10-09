import { h } from './dom'
import { renderPdfPages } from './extract'

const MAX_PAGES = 30

/**
 * A PDF shown one page at a time. With more than one page, a swipe (or the buttons, or the arrow keys)
 * moves between them, and "Page n of m" sits under the page. A tap or Enter calls `open` with the page in view
 * (from 0). Resolves once the first page is drawn.
 */
export async function pdfPreview(file: Blob, open?: (page: number) => void): Promise<HTMLElement> {
  const track = h('div', { class: 'pager-track', tabindex: 0, role: 'region', 'aria-label': open ? 'Receipt pages. Enter opens full screen.' : 'Receipt pages' })
  const label = h('span', { class: 'pager-label', 'aria-live': 'polite' })
  const prev = h('button', { class: 'btn quiet sm', type: 'button', 'aria-label': 'Previous page' }, '‹')
  const next = h('button', { class: 'btn quiet sm', type: 'button', 'aria-label': 'Next page' }, '›')
  const note = h('span', { class: 'hint' })
  const bar = h('div', { class: 'pager-bar', hidden: true }, prev, label, next)
  const el = h('div', { class: 'pager' }, track, bar, note)

  const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth))
  function update() {
    const i = current()
    const n = track.children.length
    label.textContent = `Page ${i + 1} of ${n}`
    prev.disabled = i === 0
    next.disabled = i >= n - 1
    bar.hidden = n < 2
  }
  const turn = (by: number) => track.scrollTo({ left: (current() + by) * track.clientWidth, behavior: 'smooth' })
  prev.onclick = () => turn(-1)
  next.onclick = () => turn(1)
  track.addEventListener('scroll', update, { passive: true })
  if (open) {
    track.addEventListener('click', (e) => (e.target as HTMLElement).closest('canvas') && open(current()))
    track.addEventListener('keydown', (e) => e.key === 'Enter' && open(current()))
  }

  let shown!: () => void
  const firstPage = new Promise<void>((r) => (shown = r))
  const all = renderPdfPages(file, 700, MAX_PAGES, (canvas, n, total) => {
    track.append(h('div', { class: 'pager-page' }, canvas))
    if (n === 1 && total > MAX_PAGES) note.textContent = `Showing the first ${MAX_PAGES} of ${total} pages.`
    update()
    if (n === 1) shown()
  })
  // A page after the first that fails to draw is left out; a first page that fails is an error for the caller.
  all.catch(() => {})
  await Promise.race([firstPage, all])
  return el
}
