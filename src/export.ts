import JSZip from 'jszip'
import { claimedAmount, sortReceipts } from './claim'
import { receiptFileName, reportBaseName } from './naming'
import { imageToPdf } from './pdf'
import type { Receipt, Report, Settings } from './types'
import { fillTemplate } from './xlsx'

export const isPdf = (f: Blob) => f.type === 'application/pdf'

/** The receipt as a PDF (images are wrapped in a one-page PDF). */
export async function receiptPdfBytes(file: Blob): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (isPdf(file)) return bytes
  return imageToPdf(bytes, file.type === 'image/png' ? 'png' : 'jpg')
}

export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** One ZIP: the report filled into the chosen Excel template, plus one correctly named PDF per receipt. */
export async function buildExport(report: Report, receipts: Receipt[], settings: Settings, template: Blob): Promise<{ blob: Blob; name: string }> {
  const sorted = sortReceipts(receipts)
  const claim = (r: Receipt) => claimedAmount(r, settings.caps, report.currency)
  const unpriced = sorted.flatMap((r, i) => (claim(r) === null ? [i + 1] : []))
  if (unpriced.length) throw new Error(`Line${unpriced.length > 1 ? 's' : ''} ${unpriced.join(', ')} still need${unpriced.length > 1 ? '' : 's'} an exchange rate. Go online, or type the rate on the receipt.`)
  const xlsx = await fillTemplate(
    await template.arrayBuffer(),
    { name: settings.userName, title: report.name, created: todayIso(), from: report.from, to: report.to, projectRef: report.projectRef, invoiced: report.invoiced },
    sorted.map((r) => {
      const converted = r.currency !== report.currency
      return {
        date: r.date,
        location: r.place,
        description: r.description,
        projectRef: report.projectRef,
        type: r.type,
        amount: claim(r)!,
        currency: r.currency,
        rate: converted ? r.fx?.rate : undefined,
        localAmount: converted ? r.amount : undefined,
      }
    }),
  )
  const base = reportBaseName(report, settings.userName)
  const zip = new JSZip()
  const dir = zip.folder(base)!
  dir.file(`${base}.xlsx`, xlsx)
  for (const [i, r] of sorted.entries()) dir.file(receiptFileName(i + 1, r), await receiptPdfBytes(r.file))
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), name: `${base}.zip` }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
