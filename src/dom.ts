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

/** "$1,234.50"; other currencies show their code, e.g. "€12.50" or "CHF 12.50". */
export const money = (n: number, currency = 'USD') => n.toLocaleString('en-US', { style: 'currency', currency })

/** The short symbol a currency is written with: "$" for USD and CAD, "€", "£", or the code (CHF). */
export const currencySymbol = (currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency

/** Decimal places a currency uses: 2 for most, 0 for JPY, 3 for TND. */
export const currencyDigits = (currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2

export const roundTo = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits

/** Currencies listed first in pickers: US travel plus the template's own list. */
const COMMON_CURRENCIES = ['USD', 'EUR', 'CAD', 'GBP', 'CHF', 'MXN', 'DKK', 'SEK', 'NOK', 'TND', 'MAD', 'JPY']
const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' })

/** [code, "EUR · Euro"] for the currency picker: the common ones, then the rest by code. */
export function currencyOptions(): [string, string][] {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : COMMON_CURRENCIES
  const rest = all.filter((c) => !COMMON_CURRENCIES.includes(c))
  return [...COMMON_CURRENCIES, ...rest].map((c) => [c, `${c} · ${currencyNames.of(c) ?? c}`])
}

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
