import type { Receipt, Settings } from './types'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Amount that goes on the expense report: override, else receipt total limited by the type's maximum. */
export function claimedAmount(r: Pick<Receipt, 'amount' | 'type' | 'claimedOverride'>, caps: Settings['caps']): number {
  if (r.claimedOverride !== null) return round2(r.claimedOverride)
  const cap = caps[r.type]
  return round2(cap !== undefined && cap >= 0 ? Math.min(r.amount, cap) : r.amount)
}

export function sortReceipts<T extends Pick<Receipt, 'date' | 'addedAt'>>(list: T[]): T[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.addedAt - b.addedAt)
}

export function matchingReports<T extends { from: string; to: string }>(reports: T[], date: string): T[] {
  return reports.filter((r) => r.from <= date && date <= r.to)
}
