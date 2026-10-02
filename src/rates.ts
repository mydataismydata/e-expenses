import type { FxRate, Receipt } from './types'

/**
 * Exchange rates come from Frankfurter (https://frankfurter.dev), a free service
 * without keys. The ECB's daily reference rate is used for the ~30 currencies the
 * ECB quotes. Any other currency gets Frankfurter's blend of central-bank rates
 * for the same day. A weekend or holiday gets the last rate published before it.
 */
const API = 'https://api.frankfurter.dev/v2/rates'

interface Row {
  date: string
  quote: string
  rate: number
}

const cache = new Map<string, Promise<FxRate | null>>()

async function query(currency: string, date: string, ecbOnly: boolean, fetcher: typeof fetch): Promise<Row | undefined> {
  const url = `${API}?base=${encodeURIComponent(currency)}&quotes=USD&date=${date}${ecbOnly ? '&providers=ECB' : ''}`
  let res: Response
  try {
    res = await fetcher(url)
  } catch {
    throw new Error('Could not reach the exchange-rate service.')
  }
  if (res.status === 422) throw new Error(`No exchange rates are published for ${currency}.`)
  if (!res.ok) throw new Error(`The exchange-rate service answered ${res.status}.`)
  const rows = (await res.json()) as Row[]
  return rows.find((r) => r.quote === 'USD' && r.rate > 0)
}

/** US dollars for one unit of `currency` on `date`, or null when no rate is published yet. */
export function fetchUsdRate(currency: string, date: string, fetcher: typeof fetch = fetch): Promise<FxRate | null> {
  const key = `${currency}|${date}`
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      const ecb = await query(currency, date, true, fetcher)
      if (ecb) return { rate: ecb.rate, date: ecb.date, source: 'ECB' }
      const blend = await query(currency, date, false, fetcher)
      return blend ? { rate: blend.rate, date: blend.date, source: 'Central banks' } : null
    })()
    // Failures are not remembered, so the next attempt asks again.
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

const DAY = 86400000
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)

/**
 * A receipt needs a (new) rate when it has none, or when its rate is older than its
 * date and the date is recent: that day's rate may not have been published yet when
 * the receipt was saved. Rates typed by hand are left alone.
 */
export function needsRate(r: Pick<Receipt, 'currency' | 'fx' | 'date'>, today: string): boolean {
  if (r.currency === 'USD') return false
  if (!r.fx) return true
  return r.fx.source !== 'Manual' && r.fx.date < r.date && daysBetween(r.date, today) <= 7
}

/**
 * Fetch rates for the receipts that need one and save those that changed.
 * Returns how many receipts still have no rate. Network errors leave receipts as they are.
 */
export async function refreshRates<T extends Pick<Receipt, 'currency' | 'fx' | 'date'>>(
  receipts: T[],
  today: string,
  save: (r: T) => Promise<void>,
  fetcher: typeof fetch = fetch,
): Promise<{ updated: number; missing: number; error?: string }> {
  let updated = 0
  let error: string | undefined
  for (const r of receipts) {
    if (!needsRate(r, today)) continue
    try {
      const fx = await fetchUsdRate(r.currency, r.date, fetcher)
      if (fx && (fx.date !== r.fx?.date || fx.rate !== r.fx?.rate || fx.source !== r.fx?.source)) {
        r.fx = fx
        await save(r)
        updated++
      }
    } catch (e) {
      error ??= e instanceof Error ? e.message : String(e)
    }
  }
  return { updated, missing: receipts.filter((r) => r.currency !== 'USD' && !r.fx).length, error }
}

/** One line on where a rate came from, for hints and the report view. */
export function describeRate(fx: FxRate, receiptDate: string, fmt: (iso: string) => string): string {
  if (fx.source === 'Manual') return 'Rate entered by hand.'
  const what = fx.source === 'ECB' ? 'ECB reference rate' : 'Average central-bank rate'
  return fx.date === receiptDate ? `${what} for ${fmt(fx.date)}.` : `${what} of ${fmt(fx.date)}, the last one published before ${fmt(receiptDate)}.`
}
