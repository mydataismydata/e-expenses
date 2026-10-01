/** Heuristics that turn raw receipt text (PDF text layer or OCR) into pre-filled form guesses. */

export interface Guess {
  date?: string
  amount?: number
  payee?: string
  place?: string
  type: string
  ref?: string
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '),
)

function iso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const monthNum = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1

function datesInLine(line: string): string[] {
  const found: { i: number; d: string }[] = []
  const add = (i: number, d: string | null) => d && found.push({ i, d })
  for (const m of line.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) add(m.index!, iso(+m[1], +m[2], +m[3]))
  for (const m of line.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    add(m.index!, iso(y, +m[1], +m[2]))
  }
  for (const m of line.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'))) add(m.index!, iso(+m[3], monthNum(m[1]), +m[2]))
  for (const m of line.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE},?\\s+(\\d{4})\\b`, 'gi'))) add(m.index!, iso(+m[3], monthNum(m[2]), +m[1]))
  return found.sort((a, b) => a.i - b.i).map((f) => f.d)
}

export function guessDate(lines: string[]): string | undefined {
  let best: { score: number; line: number; d: string } | undefined
  lines.forEach((line, idx) => {
    const ds = datesInLine(line)
    if (ds.length === 0) return
    let score = 0
    if (/\b(invoice|receipt|transaction|purchase|order|issue|issued|billing|bill)?\s*date\b/i.test(line)) score += 2
    if (/\b(due|period|through|expires?|expiry|service|statement|from|to)\b/i.test(line) && score === 0) score -= 1
    if (/\bdue\b/i.test(line)) score -= 2
    if (!best || score > best.score) best = { score, line: idx, d: ds[0] }
  })
  return best?.d
}

const MONEY_RE = /(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g
const TOTAL_LABEL = /\b(grand\s*total|total|amount|balance|paid|payment|charged?|charges)\b/i
const NOT_TOTAL = /sub\s*-?\s*total|\btax\b|\btip\b|gratuity|discount|saving|change|cash|tender|due\s+date|unit\s+price|\bfee\s+rate/i

export function guessAmount(lines: string[]): number | undefined {
  const moneyIn = (line: string) => [...line.matchAll(MONEY_RE)].map((m) => Number(m[1].replace(/,/g, '') + '.' + m[2]))
  const totals: number[] = []
  const all: number[] = []
  for (const line of lines) {
    const vals = moneyIn(line).filter((v) => v > 0)
    all.push(...vals)
    if (TOTAL_LABEL.test(line) && !NOT_TOTAL.test(line)) totals.push(...vals)
  }
  const pool = totals.length ? totals : all
  return pool.length ? Math.max(...pool) : undefined
}

const COMPANY_SUFFIX = /\b(inc|llc|corp|corporation|co|ltd|company|restaurant|cafe|grill|hotel|airlines?)\b\.?/i
const NOT_NAME = /,\s*[A-Z]{2}\b\s*\d{0,5}$|\b(ln|st|ave|rd|blvd|drive)\b|invoice|receipt|attn|bill\s*to|sold\s*to|date|order|tel\b|phone|www\.|http|@|^\d|^[^a-z]*$|thank|customer|account|total|amount|table|server|guest/i

const VENDORS: [RegExp, string][] = [
  [/starlink/i, 'Starlink'],
  [/\buber\b/i, 'Uber'],
  [/\blyft\b/i, 'Lyft'],
  [/amtrak/i, 'Amtrak'],
  [/\bhertz\b/i, 'Hertz'],
  [/\bavis\b/i, 'Avis'],
  [/marriott/i, 'Marriott'],
  [/hilton/i, 'Hilton'],
  [/hyatt/i, 'Hyatt'],
  [/airbnb/i, 'Airbnb'],
  [/delta air/i, 'Delta Air Lines'],
  [/united air/i, 'United Airlines'],
  [/southwest/i, 'Southwest Airlines'],
  [/american airlines/i, 'American Airlines'],
  [/staples/i, 'Staples'],
  [/office depot/i, 'Office Depot'],
  [/starbucks/i, 'Starbucks'],
  [/verizon/i, 'Verizon'],
  [/t-mobile/i, 'T-Mobile'],
  [/\busps\b/i, 'USPS'],
]

export function guessPayee(lines: string[]): string | undefined {
  const text = lines.join('\n')
  for (const [re, name] of VENDORS) if (re.test(text)) return name
  const norm = lines.map((l) => l.replace(/\s+/g, ' ').trim())
  const bad = (l: string) => NOT_NAME.test(l) || /\d+\.\d{2}/.test(l) || datesInLine(l).length > 0
  const clean = (s: string) => s.slice(0, 40).trim()
  const suffixed = norm.find((l) => COMPANY_SUFFIX.test(l) && !bad(l) && l.length <= 50)
  if (suffixed) return clean(suffixed)
  const first = norm.slice(0, 14).find((l) => /[a-z]{3}/i.test(l) && !bad(l) && l.length >= 3)
  return first ? clean(first) : undefined
}

export function guessPlace(lines: string[]): string | undefined {
  const STREET = /^(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|way|ct|court|hwy|suite|ste|pkwy|colony)$/i
  for (const line of lines) {
    for (const m of line.matchAll(/\b([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,3}),\s*([A-Z]{2})\b/g)) {
      if (!US_STATES.has(m[2])) continue
      // "123 Main St Austin" -> keep only what follows the last street word
      const words = m[1].split(' ')
      const city = words.slice(words.map((w) => STREET.test(w)).lastIndexOf(true) + 1).join(' ')
      if (city) return `${city}, ${m[2]}, USA`
    }
  }
  return undefined
}

export function guessRef(lines: string[]): string | undefined {
  const text = lines.join('\n')
  const hasDigit = (s: string) => /\d/.test(s) && s.length >= 5
  const inv = text.match(/\bINV[-A-Z0-9]*\d[-A-Z0-9]*/)
  if (inv) return inv[0]
  const re = /\b(?:invoice|receipt|order|confirmation|reference|ref|check|transaction|trans|folio)\s*(?:no\.?|number|num|#|id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-_/]{3,})/gi
  for (const m of text.matchAll(re)) if (hasDigit(m[1]) && !datesInLine(m[1]).length) return m[1]
  return undefined
}

const TYPE_RULES: [string, RegExp][] = [
  ['Internet fees', /starlink|internet|broadband|xfinity|comcast|spectrum|\bcox\b|fiber|wi-?fi/i],
  ['Phone fees', /verizon|t-mobile|tmobile|at&t|wireless|cellular|mobile service|\bphone\b/i],
  ['Plane tickets', /airlines?|airways|flight|boarding|itinerary|jetblue|e-?ticket|delta air|southwest/i],
  ['Housing (hotel, airbnb, etc.)', /hotel|motel|\binn\b|suites|marriott|hilton|hyatt|airbnb|lodging|resort|room (charge|rate)|folio/i],
  ['Rental car', /hertz|\bavis\b|enterprise rent|budget rent|national car|rental car|car rental|sixt/i],
  ['Highway toll', /\btolls?\b|sunpass|e-?z-?pass/i],
  ['Parking', /parking|garage|parkmobile|parkwhiz|spothero/i],
  ['Taxi', /\buber\b|\blyft\b|\btaxi\b|\bcab\b|rideshare/i],
  ['Train tickets', /amtrak|railway|railroad|\btrain\b|rail europe/i],
  ['Gas', /gasoline|unleaded|diesel|\bfuel\b|\bgallons?\b|\bshell\b|exxon|chevron|\bbp\b|mobil|sunoco|wawa|racetrac|speedway|pilot|love's/i],
  ['Stamps', /\busps\b|postage|\bstamps?\b|post office/i],
  ['Office supplies', /staples|office depot|officemax|toner|stationery/i],
]
const MEAL = /restaurant|cafe|café|grill|diner|bistro|pizza|burger|kitchen|tavern|steakhouse|sushi|taqueria|bakery|coffee|starbucks|mcdonald|subway|chipotle|panera|\bfood\b|dine|server|gratuity|\btip\b/i

export function guessType(text: string): string {
  for (const [type, re] of TYPE_RULES) if (re.test(text)) return type
  if (MEAL.test(text)) {
    let hour = 12
    const t = /\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i.exec(text)
    if (t) {
      hour = +t[1] % 24
      if (/pm/i.test(t[3] ?? '') && hour < 12) hour += 12
      if (/am/i.test(t[3] ?? '') && hour === 12) hour = 0
    }
    const group = /\bguests?:?\s*([2-9]|\d{2})\b|party of|\bcovers?:?\s*([2-9])\b/i.test(text)
    return `${hour >= 16 ? 'Dinner' : 'Lunch'} (${group ? 'group' : 'alone'})`
  }
  return 'Others'
}

export function guessFields(text: string): Guess {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return {
    date: guessDate(lines),
    amount: guessAmount(lines),
    payee: guessPayee(lines),
    place: guessPlace(lines),
    type: guessType(text),
    ref: guessRef(lines),
  }
}
