import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { claimedAmount, matchingReports, sortReceipts } from './claim'
import { receiptFileName, reportBaseName, userTag } from './naming'
import { guessFields } from './parse'
import { fillTemplate, excelDate, type SheetRow } from './xlsx'

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
  it('sorts by date then entry order and finds overlapping reports', () => {
    expect(sortReceipts([{ date: '2025-02-01', addedAt: 2 }, { date: '2025-01-01', addedAt: 3 }, { date: '2025-02-01', addedAt: 1 }]).map((r) => r.addedAt)).toEqual([3, 1, 2])
    const reports = [{ from: '2025-01-01', to: '2025-03-31' }, { from: '2025-03-01', to: '2025-04-30' }]
    expect(matchingReports(reports, '2025-03-15')).toHaveLength(2)
    expect(matchingReports(reports, '2025-05-01')).toHaveLength(0)
  })
})

describe('xlsx', () => {
  const template = readFileSync('src/assets/ExpenseReportForm_Template_US.xlsx')
  const header = { name: 'Jane Doe', title: 'May-Dec', created: '2025-12-18', from: '2025-05-01', to: '2025-12-31', projectRef: '', invoiced: '' }
  const mk = (n: number): SheetRow[] =>
    Array.from({ length: n }, (_, i) => ({ date: `2025-05-${String((i % 28) + 1).padStart(2, '0')}`, location: 'Springfield, FL, USA', description: `Item <${i}> & co`, projectRef: '', type: 'Internet fees', amount: 70 }))

  it('computes Excel dates', () => {
    expect(excelDate('2025-05-14')).toBe(45791)
  })

  it('fills the template and keeps the table intact', async () => {
    const out = await fillTemplate(template, header, mk(16))
    mkdirSync(process.env.XLSX_OUT ?? 'out', { recursive: true })
    writeFileSync(`${process.env.XLSX_OUT ?? 'out'}/test16.xlsx`, out)
    const z = await JSZip.loadAsync(out)
    const sheet = await z.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toContain('Item &lt;0&gt; &amp; co')
    expect(sheet).toContain('<c r="G27" s="20"><f>SUBTOTAL(109,Tableau1[Amount $])</f><v>1120</v></c>')
    expect(z.file('xl/calcChain.xml')).toBeNull()
  })

  it('grows past 20 rows', async () => {
    const out = await fillTemplate(template, header, mk(25))
    writeFileSync(`${process.env.XLSX_OUT ?? 'out'}/test25.xlsx`, out)
    const z = await JSZip.loadAsync(out)
    const sheet = await z.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toContain('<c r="A31" ')
    expect(sheet).toContain('<c r="A32" s="3"') // totals label moved from row 27 to 32
    expect(sheet).toContain('<mergeCell ref="G34:I34"/>')
    expect(await z.file('xl/tables/table1.xml')!.async('string')).toContain('ref="A6:J32"')
    expect(await z.file('xl/workbook.xml')!.async('string')).toContain('Feuil1!$D$34')
  })
})
