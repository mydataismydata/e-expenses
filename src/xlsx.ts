import JSZip from 'jszip'

export interface SheetHeader {
  name: string
  title: string
  created: string
  from: string
  to: string
  projectRef: string
  invoiced: string
}

export interface SheetRow {
  date: string
  location: string
  description: string
  projectRef: string
  type: string
  /** Claimed amount in the report's currency. */
  amount: number
  /** Receipt currency; defaults to USD. */
  currency?: string
  /** Report currency per unit of `currency`; only for a converted receipt. */
  rate?: number
  /** Receipt total in `currency`; only for a converted receipt. */
  localAmount?: number
}

const TEMPLATE_ROWS = 20
const FIRST_ROW = 7
const SHEET = 'xl/worksheets/sheet1.xml'
const TABLE = 'xl/tables/table1.xml'
/** Excel's built-in "#,##0.00". Built-in formats follow the reader's locale. */
const FMT_2DP = '4'

const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Excel serial number for an ISO date (YYYY-MM-DD). */
export function excelDate(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000)
}

const strCell = (ref: string, s: string, text: string) =>
  text === '' ? `<c r="${ref}" s="${s}"/>` : `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`
const numCell = (ref: string, s: string, n: number) => `<c r="${ref}" s="${s}"><v>${n}</v></c>`

const HEADER_CELLS = ['B3', 'F3', 'H3', 'J3', 'B4', 'H4', 'J4']
const cellRe = (ref: string) => new RegExp(`<c r="${ref}"(?: [^>]*?)?(?:/>|>[\\s\\S]*?</c>)`)

/** Replace one cell of the template, keeping its style. */
function setCell(xml: string, ref: string, make: (style: string) => string): string {
  const re = cellRe(ref)
  const m = re.exec(xml)
  if (!m) throw new Error(`Template cell ${ref} not found`)
  const style = /\ss="(\d+)"/.exec(m[0])?.[1] ?? '0'
  return xml.replace(re, () => make(style))
}

/**
 * Why a file cannot be used as the expense-report template, or null when it can.
 * The filler edits the sheet XML in place, so the layout must match the original:
 * header cells in rows 3-4 and a 20-row table from row 7 with its totals on row 27.
 */
export async function checkTemplate(bytes: ArrayBuffer | Uint8Array): Promise<string | null> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    return 'This is not an Excel (.xlsx) file.'
  }
  const sheet = await zip.file(SHEET)?.async('string')
  const table = await zip.file(TABLE)?.async('string')
  if (!sheet || !table || !zip.file('xl/workbook.xml') || !zip.file('xl/styles.xml')) return 'The workbook does not have the expense-report sheet and table.'
  const missing = HEADER_CELLS.filter((ref) => !cellRe(ref).test(sheet))
  if (missing.length) return `The header cells ${missing.join(', ')} are missing.`
  if (!table.includes('ref="A6:J27"')) return 'The expense table must run from A6 to J27 (20 rows plus totals), as in the original template.'
  if (!/<c r="G27" s="\d+"><f>/.test(sheet)) return 'The total formula in G27 is missing.'
  return null
}

/**
 * The currency symbol the template's amount column (G7) is formatted with, e.g. "$"
 * or "€", or undefined when its format shows none.
 */
export async function templateAmountSymbol(bytes: ArrayBuffer | Uint8Array): Promise<string | undefined> {
  const zip = await JSZip.loadAsync(bytes)
  const sheet = await zip.file(SHEET)?.async('string')
  const styles = await zip.file('xl/styles.xml')?.async('string')
  if (!sheet || !styles) return undefined
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) ?? []
  const fmtId = /numFmtId="(\d+)"/.exec(xfs[Number(styleOf(sheet, 'G7', '0'))] ?? '')?.[1]
  const code = fmtId && new RegExp(`<numFmt numFmtId="${fmtId}" formatCode="([^"]*)"`).exec(styles)?.[1]
  if (!code) return undefined
  const format = code.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  // [$€-40C] is Excel's locale-tagged symbol; "$" is a quoted literal.
  return (/\[\$([^\]-]+)/.exec(format) ?? /"([^"0#]+)"/.exec(format))?.[1].trim() || undefined
}

/** Clone cell style `base` with another number format and return the new style's index. */
function addNumberStyle(styles: string, base: string, numFmtId: string): { styles: string; index: string } {
  const m = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(styles)
  if (!m) return { styles, index: base }
  const xfs = m[2].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) ?? []
  const src = xfs[Number(base)]
  if (!src) return { styles, index: base }
  const clone = src.replace(/numFmtId="\d+"/, `numFmtId="${numFmtId}"`).replace(/<xf\b(?![^>]*applyNumberFormat)/, '<xf applyNumberFormat="1"')
  const index = String(xfs.length)
  return { styles: styles.replace(m[0], () => `<cellXfs count="${xfs.length + 1}">${m[2]}${clone}</cellXfs>`), index }
}

interface RowStyles {
  index: string
  date: string
  text: string
  money: string
  /** Text style with two decimals, for the local amount. */
  local: string
}

function dataRow(r: number, row: SheetRow | undefined, s: RowStyles): string {
  const cells = [`<c r="A${r}" s="${s.index}"><f>ROW()-6</f><v>${r - 6}</v></c>`]
  if (row) {
    const converted = row.rate !== undefined && row.localAmount !== undefined
    cells.push(
      numCell(`B${r}`, s.date, excelDate(row.date)),
      strCell(`C${r}`, s.text, row.location),
      strCell(`D${r}`, s.text, row.description),
      strCell(`E${r}`, s.text, row.projectRef),
      strCell(`F${r}`, s.text, row.type),
      numCell(`G${r}`, s.money, row.amount),
      strCell(`H${r}`, s.text, row.currency ?? 'USD'),
      converted ? numCell(`I${r}`, s.text, row.rate!) : `<c r="I${r}" s="${s.text}"/>`,
      converted ? numCell(`J${r}`, s.local, row.localAmount!) : `<c r="J${r}" s="${s.text}"/>`,
    )
  } else {
    cells.push(
      `<c r="B${r}" s="${s.date}"/>`,
      `<c r="C${r}" s="${s.text}"/>`,
      `<c r="D${r}" s="${s.text}"/>`,
      `<c r="E${r}" s="${s.text}"/>`,
      `<c r="F${r}" s="${s.text}"/>`,
      `<c r="G${r}" s="${s.money}"/>`,
      `<c r="H${r}" s="${s.text}"/>`,
      `<c r="I${r}" s="${s.text}"/>`,
      `<c r="J${r}" s="${s.text}"/>`,
    )
  }
  cells.push(`<c r="K${r}" s="1"/>`, `<c r="L${r}" s="1"/>`)
  return `<row r="${r}" spans="1:12">${cells.join('')}</row>`
}

const shiftRef = (ref: string, delta: number) => ref.replace(/([A-Z]+)(\d+)/g, (_, c, n) => `${c}${Number(n) + delta}`)

/** Shift a row (and every cell reference inside it) down by `delta` rows. */
function shiftRow(rowXml: string, delta: number): string {
  return rowXml.replace(/<row r="(\d+)"/, (_, n) => `<row r="${Number(n) + delta}"`).replace(/<c r="([A-Z]+\d+)"/g, (_, ref) => `<c r="${shiftRef(ref, delta)}"`)
}

/** Style index of a template cell, so data rows keep whatever the template uses. */
const styleOf = (xml: string, ref: string, fallback: string) => /\ss="(\d+)"/.exec(cellRe(ref).exec(xml)?.[0] ?? '')?.[1] ?? fallback

/**
 * Fill the expense-report template. Works on the workbook XML directly so the
 * template's formatting, table, drop-downs and logo stay exactly as designed.
 * More than 20 rows grow the table and push the totals/signature block down.
 */
export async function fillTemplate(template: ArrayBuffer | Uint8Array, header: SheetHeader, rows: SheetRow[]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template)
  let xml = await zip.file(SHEET)!.async('string')

  const count = Math.max(TEMPLATE_ROWS, rows.length)
  const delta = count - TEMPLATE_ROWS
  const lastData = FIRST_ROW + count - 1
  const totalRow = lastData + 1

  // The first data row of the template uses slightly different styles than the rest.
  let styles = await zip.file('xl/styles.xml')!.async('string')
  const rowStyles = (r: number): RowStyles => ({
    index: styleOf(xml, `A${r}`, r === FIRST_ROW ? '6' : '7'),
    date: styleOf(xml, `B${r}`, r === FIRST_ROW ? '15' : '16'),
    text: styleOf(xml, `C${r}`, r === FIRST_ROW ? '12' : '13'),
    money: styleOf(xml, `G${r}`, r === FIRST_ROW ? '18' : '19'),
    local: '',
  })
  const first = rowStyles(FIRST_ROW)
  const rest = rowStyles(FIRST_ROW + 1)
  for (const s of first.text === rest.text ? [first] : [first, rest]) {
    const added = addNumberStyle(styles, s.text, FMT_2DP)
    styles = added.styles
    s.local = added.index
  }
  rest.local ||= first.local
  zip.file('xl/styles.xml', styles, { createFolders: false })

  // Header block
  const setStr = (ref: string, v: string) => (xml = setCell(xml, ref, (s) => strCell(ref, s, v)))
  const setDate = (ref: string, iso: string) => (xml = setCell(xml, ref, (s) => (iso ? numCell(ref, s, excelDate(iso)) : `<c r="${ref}" s="${s}"/>`)))
  setStr('B3', header.name)
  setDate('F3', header.created)
  setStr('H3', header.invoiced)
  setDate('J3', header.from)
  setStr('B4', header.title)
  setStr('H4', header.projectRef)
  setDate('J4', header.to)

  // Data rows: rebuild rows 7..(6+count); rows below the table move down by `delta`.
  const parts = [...xml.matchAll(/<row r="(\d+)"[\s\S]*?<\/row>/g)].map((m) => ({ n: Number(m[1]), xml: m[0] }))
  const total = Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100
  const out: string[] = []
  for (const p of parts) if (p.n < FIRST_ROW) out.push(p.xml)
  for (let r = FIRST_ROW; r <= lastData; r++) out.push(dataRow(r, rows[r - FIRST_ROW], r === FIRST_ROW ? first : rest))
  for (const p of parts) {
    if (p.n < FIRST_ROW + TEMPLATE_ROWS) continue
    let rx = shiftRow(p.xml, delta)
    if (p.n === FIRST_ROW + TEMPLATE_ROWS) rx = rx.replace(/(<c r="G\d+" s="\d+"><f>[^<]*<\/f><v>)[^<]*(<\/v>)/, `$1${total}$2`)
    out.push(rx)
  }
  xml = xml.replace(/<sheetData>[\s\S]*<\/sheetData>/, () => `<sheetData>${out.join('')}</sheetData>`)

  // Dimension, merged cells and validations
  xml = xml.replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)(\d+)"\/>/, (_, a, c, n) => `<dimension ref="${a}:${c}${Number(n) + delta}"/>`)
  xml = xml.replace(/<mergeCell ref="([^"]+)"\/>/g, (_, ref: string) => {
    const row = Number(/\d+/.exec(ref)![0])
    return `<mergeCell ref="${shiftRef(ref, row >= FIRST_ROW + TEMPLATE_ROWS ? delta : 0)}"/>`
  })
  // One drop-down per column, stretched over every data row. The list names come from the template.
  xml = xml.replace(/<dataValidations[^>]*>([\s\S]*?)<\/dataValidations>/, (whole, inner: string) => {
    const byCol = new Map<string, string>()
    for (const v of inner.match(/<dataValidation\b[\s\S]*?<\/dataValidation>/g) ?? []) {
      const m = /sqref="([A-Z]+)(\d+)/.exec(v)
      if (!m || Number(m[2]) < FIRST_ROW || Number(m[2]) >= FIRST_ROW + TEMPLATE_ROWS || byCol.has(m[1])) continue
      byCol.set(m[1], v.replace(/sqref="[^"]*"/, `sqref="${m[1]}${FIRST_ROW}:${m[1]}${lastData}"`))
    }
    return byCol.size ? `<dataValidations count="${byCol.size}">${[...byCol.values()].join('')}</dataValidations>` : whole
  })
  zip.file(SHEET, xml, { createFolders: false })

  // Table definition
  const table = (await zip.file(TABLE)!.async('string')).replace('ref="A6:J27"', `ref="A6:J${totalRow}"`).replace('<autoFilter ref="A6:J26"/>', `<autoFilter ref="A6:J${lastData}"/>`)
  zip.file(TABLE, table, { createFolders: false })

  // Workbook: move named cells below the table, force recalculation, drop the stale calc chain.
  let wb = await zip.file('xl/workbook.xml')!.async('string')
  const sheetName = /<sheet name="([^"]+)"/.exec(wb)?.[1].replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  wb = wb.replace(/(<definedName name="[^"]+">)('(?:[^']|'')+'|[^!<]+)(!\$[A-Z]+\$)(\d+)(<\/definedName>)/g, (all, a, sheet: string, col, row, z) => {
    const name = sheet.startsWith("'") ? sheet.slice(1, -1).replace(/''/g, "'") : sheet
    if (name !== sheetName || Number(row) < FIRST_ROW + TEMPLATE_ROWS) return all
    return `${a}${sheet}${col}${Number(row) + delta}${z}`
  })
  wb = wb.replace(/<calcPr [^>]*\/>/, '<calcPr calcId="140001" concurrentCalc="0" fullCalcOnLoad="1"/>')
  zip.file('xl/workbook.xml', wb, { createFolders: false })
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml')
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    zip.file('[Content_Types].xml', ct.replace(/<Override[^>]*calcChain[^>]*\/>/, ''), { createFolders: false })
    const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
    zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship [^>]*calcChain[^>]*\/>/, ''), { createFolders: false })
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
