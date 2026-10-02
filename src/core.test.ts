import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { claimedAmount, matchingReports, sortReceipts, totalClaimed } from './claim'
import { receiptFileName, reportBaseName, userTag } from './naming'
import { guessCurrency, guessFields } from './parse'
import { describeRate, fetchUsdRate, needsRate, refreshRates } from './rates'
import { checkTemplate, fillTemplate, excelDate, type SheetRow } from './xlsx'

const STARLINK = `Attn: Jane Doe
12 Example Ln
Springfield, FL 32000
Invoice
INV-USA-00000001-00000-00
Invoice Date: Wednesday, May 14, 2025
Payment Due Date: Wednesday, May 14, 2025
Customer Account: ACC-1234567-00000-0
Product Description Qty Amount
Residential (Wednesday, May 14, 2025 - Saturday, June 14, 2025) 1 USD 120.00
Subtotal USD 120.00
Total Tax USD 0.00
Total Charges USD 120.00
Payment USD 120.00
Total Due USD 0.00
Space Exploration Technologies Corp.
1 Rocket Road
Hawthorne, California 90250
Starlink is a division of SpaceX.`

describe('parse', () => {
  it('reads the Starlink invoice', () => {
    const g = guessFields(STARLINK)
    expect(g).toMatchObject({ date: '2025-05-14', amount: 120, payee: 'Starlink', place: 'Springfield, FL, USA', type: 'Internet fees', ref: 'INV-USA-00000001-00000-00' })
  })

  it('reads a dinner receipt', () => {
    const g = guessFields(`Joe's Steakhouse
123 Main St
Austin, TX 78701
Date: 03/09/2025 7:42 PM
Server: Amy  Guests: 3
Subtotal 90.00
Tax 7.43
Tip 18.00
Total 115.43`)
    expect(g).toMatchObject({ date: '2025-03-09', amount: 115.43, payee: "Joe's Steakhouse", place: 'Austin, TX, USA', type: 'Dinner (group)' })
  })

  it('does not treat a zero balance as the total', () => {
    expect(guessFields('Shop\nTotal 12.50\nBalance 0.00').amount).toBe(12.5)
  })

  it('reads a French receipt: euros, day-first date, decimal comma', () => {
    const g = guessFields(`BRASSERIE DU PORT
12 quai de la Fosse
44000 Nantes
Le 03/05/2025 à 20:15
Couverts: 2
2 Menu du jour 90,00
Total HT 81,82
TVA 10% 8,18
TOTAL TTC 1.090,00 €
CB 1.090,00 €`)
    expect(g).toMatchObject({ currency: 'EUR', date: '2025-05-03', amount: 1090, type: 'Dinner (group)' })
  })

  it('reads French month names and keeps US dates month-first', () => {
    expect(guessFields('Hôtel Bellevue\nFacture du 1er juin 2025\nMontant 120,00 EUR').date).toBe('2025-06-01')
    expect(guessFields('Hôtel Bellevue\nFacture du 1er juin 2025').type).toBe('Housing (hotel, airbnb, etc.)')
    expect(guessFields('Shop\nDate 03/05/2025\nTotal 9.99').date).toBe('2025-03-05')
    expect(guessFields('Shop\nDate 25/12/2025\nTotal 9.99').date).toBe('2025-12-25')
  })

  it('guesses the currency from symbols and codes, not from a bare dollar sign', () => {
    expect(guessCurrency(STARLINK)).toBe('USD')
    expect(guessCurrency('Total £12.00')).toBe('GBP')
    expect(guessCurrency('Total CHF 12.00')).toBe('CHF')
    expect(guessCurrency('Total $12.00')).toBeUndefined()
  })
})

describe('naming', () => {
  it('matches the existing convention', () => {
    expect(receiptFileName(1, { date: '2025-05-14', ref: 'INV-USA-00000001-00000-00', payee: 'Starlink' })).toBe('01 - 2025-05 INV-USA-00000001-00000-00.pdf')
    expect(receiptFileName(12, { date: '2025-06-02', ref: '', payee: 'Uber/Lyft: ride?' })).toBe('12 - 2025-06 Uber Lyft ride.pdf')
  })
  it('builds the workbook name', () => {
    expect(userTag('Jane Doe')).toBe('J_DOE')
    expect(reportBaseName({ from: '2025-05-01', to: '2025-12-31' }, 'Jane Doe')).toBe('2025-05_to_2025-12_Expenses_J_DOE')
  })
})

describe('claims', () => {
  const caps = { 'Internet fees': 70 }
  it('caps by type and honours overrides', () => {
    expect(claimedAmount({ amount: 120, type: 'Internet fees', claimedOverride: null }, caps)).toBe(70)
    expect(claimedAmount({ amount: 50, type: 'Internet fees', claimedOverride: null }, caps)).toBe(50)
    expect(claimedAmount({ amount: 120, type: 'Internet fees', claimedOverride: 90 }, caps)).toBe(90)
    expect(claimedAmount({ amount: 120, type: 'Taxi', claimedOverride: null }, caps)).toBe(120)
  })
  it('converts foreign receipts before applying the cap', () => {
    const fx = { rate: 1.1214, date: '2025-05-14', source: 'ECB' }
    expect(claimedAmount({ amount: 100, type: 'Taxi', claimedOverride: null, currency: 'EUR', fx }, caps)).toBe(112.14)
    expect(claimedAmount({ amount: 100, type: 'Internet fees', claimedOverride: null, currency: 'EUR', fx }, caps)).toBe(70)
    expect(claimedAmount({ amount: 100, type: 'Taxi', claimedOverride: null, currency: 'EUR', fx: null }, caps)).toBeNull()
    expect(claimedAmount({ amount: 100, type: 'Taxi', claimedOverride: 50, currency: 'EUR', fx: null }, caps)).toBe(50)
    expect(totalClaimed([{ amount: 10, type: 'Taxi', claimedOverride: null }, { amount: 5, type: 'Taxi', claimedOverride: null, currency: 'EUR', fx: null }], caps)).toEqual({ total: 10, pending: 1 })
  })
  it('sorts by date then entry order and finds overlapping reports', () => {
    expect(sortReceipts([{ date: '2025-02-01', addedAt: 2 }, { date: '2025-01-01', addedAt: 3 }, { date: '2025-02-01', addedAt: 1 }]).map((r) => r.addedAt)).toEqual([3, 1, 2])
    const reports = [{ from: '2025-01-01', to: '2025-03-31' }, { from: '2025-03-01', to: '2025-04-30' }]
    expect(matchingReports(reports, '2025-03-15')).toHaveLength(2)
    expect(matchingReports(reports, '2025-05-01')).toHaveLength(0)
  })
})

describe('exchange rates', () => {
  const answer = (rows: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(rows), { status }))

  it('prefers the ECB rate and falls back to the central-bank blend', async () => {
    const urls: string[] = []
    const fetcher = ((url: string) => {
      urls.push(url)
      if (url.includes('base=EUR')) return answer([{ date: '2025-05-16', base: 'EUR', quote: 'USD', rate: 1.1194 }])
      return answer(url.includes('providers=ECB') ? [] : [{ date: '2025-05-16', base: 'TND', quote: 'USD', rate: 0.3314 }])
    }) as typeof fetch
    expect(await fetchUsdRate('EUR', '2025-05-17', fetcher)).toEqual({ rate: 1.1194, date: '2025-05-16', source: 'ECB' })
    expect(await fetchUsdRate('TND', '2025-05-17', fetcher)).toEqual({ rate: 0.3314, date: '2025-05-16', source: 'Central banks' })
    expect(urls).toHaveLength(3)
    expect(urls[0]).toBe('https://api.frankfurter.dev/v2/rates?base=EUR&quotes=USD&date=2025-05-17&providers=ECB')
  })

  it('reports unknown currencies and does not cache failures', async () => {
    let calls = 0
    const fetcher = (() => (++calls, answer({ status: 422, message: 'invalid currency: XYZ' }, 422))) as typeof fetch
    await expect(fetchUsdRate('XYZ', '2025-05-14', fetcher)).rejects.toThrow('No exchange rates are published for XYZ.')
    await expect(fetchUsdRate('XYZ', '2025-05-14', fetcher)).rejects.toThrow()
    expect(calls).toBe(2)
  })

  it('knows which receipts need a rate', () => {
    const fx = (date: string, source = 'ECB') => ({ rate: 1.1, date, source })
    expect(needsRate({ currency: 'USD', fx: null, date: '2025-05-14' }, '2025-05-14')).toBe(false)
    expect(needsRate({ currency: 'EUR', fx: null, date: '2025-05-14' }, '2025-05-14')).toBe(true)
    // Saved before that day's rate was out: ask again for a week.
    expect(needsRate({ currency: 'EUR', fx: fx('2025-05-13'), date: '2025-05-14' }, '2025-05-15')).toBe(true)
    expect(needsRate({ currency: 'EUR', fx: fx('2025-05-13'), date: '2025-05-14' }, '2025-06-15')).toBe(false)
    expect(needsRate({ currency: 'EUR', fx: fx('2025-05-13', 'Manual'), date: '2025-05-14' }, '2025-05-15')).toBe(false)
    expect(needsRate({ currency: 'EUR', fx: fx('2025-05-14'), date: '2025-05-14' }, '2025-05-15')).toBe(false)
  })

  it('fills missing rates and saves only what changed', async () => {
    const fetcher = (() => answer([{ date: '2025-05-15', base: 'GBP', quote: 'USD', rate: 1.33 }])) as typeof fetch
    const saved: unknown[] = []
    const list = [
      { currency: 'GBP', fx: null, date: '2025-05-15' },
      { currency: 'USD', fx: null, date: '2025-05-15' },
    ]
    expect(await refreshRates(list, '2025-05-20', async (r) => void saved.push(r), fetcher)).toEqual({ updated: 1, missing: 0, error: undefined })
    expect(list[0].fx).toEqual({ rate: 1.33, date: '2025-05-15', source: 'ECB' })
    expect(saved).toHaveLength(1)
  })

  it('says where a rate came from', () => {
    const fmt = (d: string) => d
    expect(describeRate({ rate: 1, date: '2025-05-16', source: 'ECB' }, '2025-05-17', fmt)).toBe('ECB reference rate of 2025-05-16, the last one published before 2025-05-17.')
    expect(describeRate({ rate: 1, date: '2025-05-17', source: 'Central banks' }, '2025-05-17', fmt)).toBe('Average central-bank rate for 2025-05-17.')
  })
})

// Templates are not in the repository. Put local copies in templates/ to run these.
const TEMPLATE_DIR = 'templates'
const templates = existsSync(TEMPLATE_DIR) ? readdirSync(TEMPLATE_DIR).filter((f) => f.toLowerCase().endsWith('.xlsx')) : []

describe('xlsx', () => {
  it('computes Excel dates', () => {
    expect(excelDate('2025-05-14')).toBe(45791)
  })

  it('rejects files that are not the expense template', async () => {
    expect(await checkTemplate(new TextEncoder().encode('not a zip'))).toBe('This is not an Excel (.xlsx) file.')
    const zip = new JSZip()
    zip.file('xl/workbook.xml', '<workbook/>')
    expect(await checkTemplate(await zip.generateAsync({ type: 'uint8array' }))).toBe('The workbook does not have the expense-report sheet and table.')
  })

  it.skipIf(templates.length > 0)('has no local template to test with (add one to templates/)', () => {})
})

describe.each(templates)('xlsx with %s', (file) => {
  const template = readFileSync(`${TEMPLATE_DIR}/${file}`)
  const tag = file.replace(/\.xlsx$/i, '')
  const header = { name: 'Jane Doe', title: 'May-Dec', created: '2025-12-18', from: '2025-05-01', to: '2025-12-31', projectRef: '', invoiced: '' }
  const mk = (n: number): SheetRow[] =>
    Array.from({ length: n }, (_, i) => ({ date: `2025-05-${String((i % 28) + 1).padStart(2, '0')}`, location: 'Springfield, FL, USA', description: `Item <${i}> & co`, projectRef: '', type: 'Internet fees', amount: 70 }))

  it('passes the template check', async () => {
    expect(await checkTemplate(template)).toBeNull()
  })

  it('fills the template and keeps the table intact', async () => {
    const out = await fillTemplate(template, header, mk(16))
    mkdirSync(process.env.XLSX_OUT ?? 'out', { recursive: true })
    writeFileSync(`${process.env.XLSX_OUT ?? 'out'}/${tag}-16.xlsx`, out)
    const z = await JSZip.loadAsync(out)
    const sheet = await z.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toContain('Item &lt;0&gt; &amp; co')
    expect(sheet).toMatch(/<c r="G27" s="\d+"><f>SUBTOTAL\(109,[^<]+\)<\/f><v>1120<\/v><\/c>/)
    expect(sheet).toContain('<c r="H7" s="12" t="inlineStr"><is><t xml:space="preserve">USD</t></is></c><c r="I7" s="12"/><c r="J7" s="12"/>')
    expect(z.file('xl/calcChain.xml')).toBeNull()
  })

  it('writes the currency, rate and local amount of a foreign receipt', async () => {
    const rows: SheetRow[] = [
      { ...mk(1)[0], currency: 'EUR', rate: 1.1214, localAmount: 100, amount: 112.14 },
      { ...mk(1)[0], currency: 'USD', amount: 20 },
    ]
    const out = await fillTemplate(template, header, rows)
    writeFileSync(`${process.env.XLSX_OUT ?? 'out'}/${tag}-currency.xlsx`, out)
    const z = await JSZip.loadAsync(out)
    const sheet = await z.file('xl/worksheets/sheet1.xml')!.async('string')
    const styles = await z.file('xl/styles.xml')!.async('string')
    const xfCount = Number(/<cellXfs count="(\d+)">/.exec(styles)![1])
    expect(sheet).toContain('<c r="G7" s="18"><v>112.14</v></c><c r="H7" s="12" t="inlineStr"><is><t xml:space="preserve">EUR</t></is></c><c r="I7" s="12"><v>1.1214</v></c>')
    expect(sheet).toMatch(new RegExp(`<c r="J7" s="${xfCount - 2}"><v>100</v></c>`))
    expect(sheet).toContain('<c r="I8" s="13"/><c r="J8" s="13"/>')
    // The new styles are copies of the text styles with two decimals.
    const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)![1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)!
    expect(xfs).toHaveLength(xfCount)
    expect(xfs[xfCount - 2]).toContain('numFmtId="4"')
    expect(sheet).toContain('<c r="G27" s="20"><f>')
    expect(sheet).toMatch(/<v>132.14<\/v>/)
  })

  it('grows past 20 rows', async () => {
    const out = await fillTemplate(template, header, mk(25))
    writeFileSync(`${process.env.XLSX_OUT ?? 'out'}/${tag}-25.xlsx`, out)
    const z = await JSZip.loadAsync(out)
    const sheet = await z.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toContain('<c r="A31" ')
    expect(sheet).toContain('<c r="A32" s="3"') // totals label moved from row 27 to 32
    expect(sheet).toContain('<mergeCell ref="G34:I34"/>')
    expect(await z.file('xl/tables/table1.xml')!.async('string')).toContain('ref="A6:J32"')
    expect(await z.file('xl/workbook.xml')!.async('string')).toContain('Feuil1!$D$34')
  })
})
