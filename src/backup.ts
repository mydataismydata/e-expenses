import JSZip from 'jszip'
import { allReceipts, getSettings, listReports, saveReceipt, saveReport, saveSettings } from './db'
import type { Receipt, Report, Settings } from './types'

type StoredReceipt = Omit<Receipt, 'file'> & { path: string; mime: string }

/** Everything (reports, receipts with their files, settings) as one ZIP. */
export async function createBackup(): Promise<Blob> {
  const zip = new JSZip()
  const receipts = await allReceipts()
  const data = {
    version: 1,
    reports: await listReports(),
    settings: await getSettings(),
    receipts: receipts.map(({ file, ...r }): StoredReceipt => ({ ...r, path: `files/${r.id}`, mime: file.type })),
  }
  zip.file('data.json', JSON.stringify(data, null, 1))
  for (const r of receipts) zip.file(`files/${r.id}`, r.file)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

/** Merge a backup into the local database (same ids are overwritten). */
export async function restoreBackup(file: Blob): Promise<{ reports: number; receipts: number }> {
  const zip = await JSZip.loadAsync(file)
  const entry = zip.file('data.json')
  if (!entry) throw new Error('Not an expense-report backup (data.json missing).')
  const data = JSON.parse(await entry.async('string')) as { reports: Report[]; receipts: StoredReceipt[]; settings: Settings }
  for (const r of data.reports) await saveReport(r)
  for (const { path, mime, ...r } of data.receipts) {
    const f = zip.file(path)
    if (!f) continue
    await saveReceipt({ ...r, file: new Blob([await f.async('arraybuffer')], { type: mime }) })
  }
  if (data.settings) await saveSettings(data.settings)
  return { reports: data.reports.length, receipts: data.receipts.length }
}
