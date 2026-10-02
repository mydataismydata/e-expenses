import type { FxRate, Receipt, Settings } from './types'

const round2 = (n: number) => Math.round(n * 100) / 100

type Amounts = Pick<Receipt, 'amount' | 'type' | 'claimedOverride'> & { currency?: string; fx?: FxRate | null }

/** The receipt total in US dollars, or null while a foreign receipt has no exchange rate yet. */
export function usdAmount(r: Pick<Amounts, 'amount' | 'currency' | 'fx'>): number | null {
  if (!r.currency || r.currency === 'USD') return round2(r.amount)
  return r.fx ? round2(r.amount * r.fx.rate) : null
}

/**
 * Amount that goes on the expense report, in US dollars: the override, else the
 * USD total limited by the type's maximum. Null while the exchange rate is unknown.
 */
export function claimedAmount(r: Amounts, caps: Settings['caps']): number | null {
  if (r.claimedOverride !== null) return round2(r.claimedOverride)
  const usd = usdAmount(r)
  if (usd === null) return null
  const cap = caps[r.type]
  return round2(cap !== undefined && cap >= 0 ? Math.min(usd, cap) : usd)
}

/** Sum of the known claims, and how many receipts still wait for a rate. */
export function totalClaimed(list: Amounts[], caps: Settings['caps']): { total: number; pending: number } {
  let total = 0
  let pending = 0
  for (const r of list) {
    const c = claimedAmount(r, caps)
    if (c === null) pending++
    else total += c
  }
  return { total: round2(total), pending }
}

export function sortReceipts<T extends Pick<Receipt, 'date' | 'addedAt'>>(list: T[]): T[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.addedAt - b.addedAt)
}

export function matchingReports<T extends { from: string; to: string }>(reports: T[], date: string): T[] {
  return reports.filter((r) => r.from <= date && date <= r.to)
}
