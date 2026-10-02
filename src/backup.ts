import JSZip from 'jszip'
import { allReceipts, getSettings, listReports, listTemplates, saveReceipt, saveReport, saveSettings, saveTemplate, withDefaults } from './db'
import type { Receipt, Report, Settings, Template } from './types'

type StoredReceipt = Omit<Receipt, 'file'> & { path: string; mime: string }
type StoredTemplate = Omit<Template, 'file'> & { path: string }

/** Everything (reports, receipts with their files, Excel templates, settings) as one ZIP. */
export async function createBackup(): Promise<Blob> {
  const zip = new JSZip()
  const receipts = await allReceipts()
  const templates = await listTemplates()
  const data = {
    version: 2,
    reports: await listReports(),
    settings: await getSettings(),
    receipts: receipts.map(({ file, ...r }): StoredReceipt => ({ ...r, path: `files/${r.id}`, mime: file.type })),
    templates: templates.map(({ file, ...t }): StoredTemplate => ({ ...t, path: `templates/${t.id}.xlsx` })),
  }
  zip.file('data.json', JSON.stringify(data, null, 1))
  for (const r of receipts) zip.file(`files/${r.id}`, r.file)
  for (const t of templates) zip.file(`templates/${t.id}.xlsx`, t.file)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

/** Merge a backup into the local database (same ids are overwritten). Backups from before templates still restore. */
export async function restoreBackup(file: Blob): Promise<{ reports: number; receipts: number; templates: number }> {
  const zip = await JSZip.loadAsync(file)
  const entry = zip.file('data.json')
  if (!entry) throw new Error('Not an expense-report backup (data.json missing).')
  const data = JSON.parse(await entry.async('string')) as { reports: Report[]; receipts: StoredReceipt[]; settings: Settings; templates?: StoredTemplate[] }
  for (const r of data.reports) await saveReport(r)
  for (const { path, mime, ...r } of data.receipts) {
    const f = zip.file(path)
    if (!f) continue
    await saveReceipt(withDefaults({ ...r, file: new Blob([await f.async('arraybuffer')], { type: mime }) }))
  }
  const templates = data.templates ?? []
  for (const { path, ...t } of templates) {
    const f = zip.file(path)
    if (f) await saveTemplate({ ...t, file: new Blob([await f.async('arraybuffer')], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) })
  }
  if (data.settings) {
    // An old backup has no default template; keep the one on this device.
    const current = await getSettings()
    await saveSettings({ ...current, ...data.settings, defaultTemplateId: data.settings.defaultTemplateId || current.defaultTemplateId })
  }
  return { reports: data.reports.length, receipts: data.receipts.length, templates: templates.length }
}
