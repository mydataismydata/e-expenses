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
  amount: number
  currency?: string
}

const TEMPLATE_ROWS = 20
const FIRST_ROW = 7
const SHEET = 'xl/worksheets/sheet1.xml'

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

/** Replace one cell of the template, keeping its style. */
function setCell(xml: string, ref: string, make: (style: string) => string): string {
  const re = new RegExp(`<c r="${ref}"(?: [^>]*?)?(?:/>|>[\\s\\S]*?</c>)`)
  const m = re.exec(xml)
  if (!m) throw new Error(`Template cell ${ref} not found`)
  const style = /\ss="(\d+)"/.exec(m[0])?.[1] ?? '0'
  return xml.replace(re, () => make(style))
}

function dataRow(r: number, row: SheetRow | undefined): string {
  // The first data row of the template uses slightly different styles than the rest.
  const [sIdx, sDate, sText, sMoney] = r === FIRST_ROW ? ['6', '15', '12', '18'] : ['7', '16', '13', '19']
  const cells = [`<c r="A${r}" s="${sIdx}"><f>ROW()-6</f><v>${r - 6}</v></c>`]
  if (row) {
    cells.push(
      numCell(`B${r}`, sDate, excelDate(row.date)),
      strCell(`C${r}`, sText, row.location),
      strCell(`D${r}`, sText, row.description),
      strCell(`E${r}`, sText, row.projectRef),
      strCell(`F${r}`, sText, row.type),
      numCell(`G${r}`, sMoney, row.amount),
      strCell(`H${r}`, sText, row.currency ?? 'USD'),
    )
  } else {
    cells.push(
      `<c r="B${r}" s="${sDate}"/>`,
      `<c r="C${r}" s="${sText}"/>`,
      `<c r="D${r}" s="${sText}"/>`,
      `<c r="E${r}" s="${sText}"/>`,
      `<c r="F${r}" s="${sText}"/>`,
      `<c r="G${r}" s="${sMoney}"/>`,
      `<c r="H${r}" s="${sText}"/>`,
    )
  }
  cells.push(`<c r="I${r}" s="${sText}"/>`, `<c r="J${r}" s="${sText}"/>`, `<c r="K${r}" s="1"/>`, `<c r="L${r}" s="1"/>`)
  return `<row r="${r}" spans="1:12">${cells.join('')}</row>`
}

const shiftRef = (ref: string, delta: number) => ref.replace(/([A-Z]+)(\d+)/g, (_, c, n) => `${c}${Number(n) + delta}`)

/** Shift a row (and every cell reference inside it) down by `delta` rows. */
function shiftRow(rowXml: string, delta: number): string {
  return rowXml.replace(/<row r="(\d+)"/, (_, n) => `<row r="${Number(n) + delta}"`).replace(/<c r="([A-Z]+\d+)"/g, (_, ref) => `<c r="${shiftRef(ref, delta)}"`)
}

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
  for (let r = FIRST_ROW; r <= lastData; r++) out.push(dataRow(r, rows[r - FIRST_ROW]))
  for (const p of parts) {
    if (p.n < FIRST_ROW + TEMPLATE_ROWS) continue
    let rx = shiftRow(p.xml, delta)
    if (p.n === FIRST_ROW + TEMPLATE_ROWS) rx = rx.replace(/(<c r="G\d+" s="\d+"><f>[^<]*<\/f><v>)[^<]*(<\/v>)/, `$1${total}$2`)
    out.push(rx)
  }
  xml = xml.replace(/<sheetData>[\s\S]*<\/sheetData>/, () => `<sheetData>${out.join('')}</sheetData>`)

  // Dimension, merged cells and validations
  xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:L${33 + delta}"/>`)
  xml = xml.replace(/<mergeCell ref="([^"]+)"\/>/g, (_, ref: string) => {
    const row = Number(/\d+/.exec(ref)![0])
    return `<mergeCell ref="${shiftRef(ref, row >= FIRST_ROW + TEMPLATE_ROWS ? delta : 0)}"/>`
  })
  const list = (col: string, name: string) =>
    `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${col}${FIRST_ROW}:${col}${lastData}"><formula1>${name}</formula1></dataValidation>`
  xml = xml.replace(/<dataValidations[\s\S]*?<\/dataValidations>/, () => `<dataValidations count="2">${list('F', 'Type')}${list('H', 'Devise')}</dataValidations>`)
  zip.file(SHEET, xml, { createFolders: false })

  // Table definition
  const tpath = 'xl/tables/table1.xml'
  const table = (await zip.file(tpath)!.async('string')).replace('ref="A6:J27"', `ref="A6:J${totalRow}"`).replace('<autoFilter ref="A6:J26"/>', `<autoFilter ref="A6:J${lastData}"/>`)
  zip.file(tpath, table, { createFolders: false })

  // Workbook: move named cells below the table, force recalculation, drop the stale calc chain.
  let wb = await zip.file('xl/workbook.xml')!.async('string')
  wb = wb.replace(/(<definedName name="[^"]+">Feuil1!\$[A-Z]+\$)(\d+)(<\/definedName>)/g, (_, a, row, z) => `${a}${Number(row) >= FIRST_ROW + TEMPLATE_ROWS ? Number(row) + delta : row}${z}`)
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
