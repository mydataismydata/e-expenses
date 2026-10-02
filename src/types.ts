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

/** Maximum claimable amount per expense type, seeded from the existing report. Applies in each report's own currency. */
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
  /** Excel template used for the export; empty or missing means the default from Settings. */
  templateId?: string
  /** ISO 4217 code every receipt is converted into. Reports made before currencies existed are USD. */
  currency: string
}

/** Exchange rate from a receipt's currency into its report's currency. */
export interface FxRate {
  /** Units of `to` for one unit of the receipt currency. */
  rate: number
  /** The currency the rate converts into. Rates saved before report currencies existed are USD. */
  to: string
  /** Date of the published rate: the receipt date, or the last business day before it. */
  date: string
  /** 'ECB', 'Central banks' (Frankfurter's blend) or 'Manual'. */
  source: string
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
  /** Total printed on the receipt, in `currency`. */
  amount: number
  /** ISO 4217 code of `amount`. Receipts saved before currencies existed are USD. */
  currency: string
  /** Rate into the report's currency, or null until it is known. Null when the receipt is already in that currency. */
  fx: FxRate | null
  /** Manually entered claim, in the report's currency, that overrides the cap rule, or null. */
  claimedOverride: number | null
  /** PDF, or a normalised JPEG. */
  file: Blob
  fileName: string
  addedAt: number
}

/** An Excel starting template. Kept on the device only, never in the app bundle. */
export interface Template {
  id: string
  /** File name without ".xlsx". */
  name: string
  file: Blob
  addedAt: number
}

export interface Settings {
  userName: string
  /** Maximum claim per expense type, in each report's own currency. */
  caps: Record<string, number>
  /** Template used when a report does not pick one; empty when none has been added. */
  defaultTemplateId: string
}
