type Child = Node | string | number | false | null | undefined
type Props = Record<string, unknown>

/** Tiny hyperscript helper: h('button', { class: 'btn', onclick: fn }, 'Label') */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener)
    else if (k === 'class') el.className = String(v)
    else if (k in el && k !== 'list' && k !== 'form') (el as unknown as Props)[k] = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  el.append(...children.filter((c): c is Node | string | number => c !== false && c !== null && c !== undefined).map((c) => (typeof c === 'number' ? String(c) : c)))
  return el
}

export const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })
}

export const monthBounds = (iso: string) => {
  const [y, m] = iso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}
