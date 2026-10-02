import type { FxRate, Receipt, Settings } from './types'

const round2 = (n: number) => Math.round(n * 100) / 100

type Amounts = Pick<Receipt, 'amount' | 'type' | 'claimedOverride'> & { currency?: string; fx?: FxRate | null }

/**
 * The receipt total in the report's currency: as printed when the receipt is already
 * in that currency, else converted. Null while the exchange rate is unknown.
 */
export function convertedAmount(r: Pick<Amounts, 'amount' | 'currency' | 'fx'>, reportCurrency: string): number | null {
  if ((r.currency || 'USD') === reportCurrency) return round2(r.amount)
  return r.fx && r.fx.to === reportCurrency ? round2(r.amount * r.fx.rate) : null
}

/**
 * Amount that goes on the expense report, in the report's currency: the override,
 * else the converted total limited by the type's maximum. Maximums are plain amounts
 * in the report's currency. Null while the exchange rate is unknown.
 */
export function claimedAmount(r: Amounts, caps: Settings['caps'], reportCurrency: string): number | null {
  if (r.claimedOverride !== null) return round2(r.claimedOverride)
  const total = convertedAmount(r, reportCurrency)
  if (total === null) return null
  const cap = caps[r.type]
  return round2(cap !== undefined && cap >= 0 ? Math.min(total, cap) : total)
}

/** Sum of the known claims, and how many receipts still wait for a rate. */
export function totalClaimed(list: Amounts[], caps: Settings['caps'], reportCurrency: string): { total: number; pending: number } {
  let total = 0
  let pending = 0
  for (const r of list) {
    const c = claimedAmount(r, caps, reportCurrency)
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
