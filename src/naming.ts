import type { Receipt, Report } from './types'

const pad2 = (n: number) => String(n).padStart(2, '0')

export function sanitizeName(s: string, max = 80): string {
  return s
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '')
}

/** "<row> - <YYYY-MM> <invoice number, else payee, else description>.pdf" - the row matches the line on the expense report. */
export function receiptFileName(row: number, r: Pick<Receipt, 'date' | 'ref' | 'payee' | 'description'>): string {
  const label = sanitizeName(r.ref) || sanitizeName(r.payee) || sanitizeName(r.description) || 'receipt'
  return `${pad2(row)} - ${r.date.slice(0, 7)} ${label}.pdf`
}

/** "Uber CDG to Paris office": the payee, then the route. Either end may be missing ("Uber to Paris office"). */
export function tripDescription(payee: string, from: string, to: string): string {
  const route = from && to ? `${from} to ${to}` : from ? `from ${from}` : to ? `to ${to}` : ''
  return [payee, route].filter(Boolean).join(' ')
}

/** "J_DOE" from "Jane Doe". */
export function userTag(name: string): string {
  const parts = sanitizeName(name).split(' ').filter(Boolean)
  if (parts.length === 0) return 'USER'
  if (parts.length === 1) return parts[0].toUpperCase()
  return `${parts[0][0].toUpperCase()}_${parts[parts.length - 1].toUpperCase()}`
}

/** "2025-05_to_2025-12_Expenses_J_DOE" */
export function reportBaseName(report: Pick<Report, 'from' | 'to'>, userName: string): string {
  return `${report.from.slice(0, 7)}_to_${report.to.slice(0, 7)}_Expenses_${userTag(userName)}`
}
