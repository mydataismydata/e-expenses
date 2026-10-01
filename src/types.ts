export const EXPENSE_TYPES = [
  'Dinner (alone)',
  'Dinner (group)',
  'Gas',
  'Gift for customer',
  'Highway toll',
  'Housing (hotel, airbnb, etc.)',
  'Internet fees',
  'Lunch (alone)',
  'Lunch (group)',
  'Mileage allowances',
  'Office supplies',
  'Other travel',
  'Others',
  'Parking',
  'Phone fees',
  'Plane tickets',
  'Rental car',
  'Stamps',
  'Taxi',
  'Train tickets',
] as const

/** Maximum claimable amount per expense type, seeded from the existing report. */
export const DEFAULT_CAPS: Record<string, number> = {
  'Internet fees': 70,
  'Phone fees': 40,
}

/** Dates are stored as ISO strings (YYYY-MM-DD). */
export interface Report {
  id: string
  name: string
  from: string
  to: string
  projectRef: string
  invoiced: string
  createdAt: number
}

export interface Receipt {
  id: string
  reportId: string
  date: string
  payee: string
  place: string
  description: string
  type: string
  /** Vendor invoice/receipt number; used in the file name when present. */
  ref: string
  /** Total printed on the receipt. */
  amount: number
  /** Manually entered claim that overrides the cap rule, or null. */
  claimedOverride: number | null
  /** PDF, or a normalised JPEG. */
  file: Blob
  fileName: string
  addedAt: number
}

export interface Settings {
  userName: string
  caps: Record<string, number>
}
