import { openDB, type DBSchema } from 'idb'
import { DEFAULT_CAPS, type Receipt, type Report, type Settings, type Template } from './types'

interface Schema extends DBSchema {
  reports: { key: string; value: Report }
  receipts: { key: string; value: Receipt; indexes: { reportId: string } }
  settings: { key: string; value: Settings }
  templates: { key: string; value: Template }
}

const dbp = openDB<Schema>('expense-reports', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('reports', { keyPath: 'id' })
      db.createObjectStore('receipts', { keyPath: 'id' }).createIndex('reportId', 'reportId')
      db.createObjectStore('settings')
    }
    if (oldVersion < 2) db.createObjectStore('templates', { keyPath: 'id' })
  },
})

export const uid = () => crypto.randomUUID()

export async function listReports(): Promise<Report[]> {
  return (await (await dbp).getAll('reports')).sort((a, b) => b.from.localeCompare(a.from))
}
export const getReport = async (id: string) => (await dbp).get('reports', id)
export const saveReport = async (r: Report) => void (await (await dbp).put('reports', r))

export async function deleteReport(id: string) {
  const db = await dbp
  const tx = db.transaction(['reports', 'receipts'], 'readwrite')
  for (const r of await tx.objectStore('receipts').index('reportId').getAll(id)) await tx.objectStore('receipts').delete(r.id)
  await tx.objectStore('reports').delete(id)
  await tx.done
}

/** Receipts saved before currencies existed are in USD. */
export const withDefaults = (r: Receipt): Receipt => ({ ...r, currency: r.currency || 'USD', fx: r.fx ?? null })

export const listReceipts = async (reportId: string) => (await (await dbp).getAllFromIndex('receipts', 'reportId', reportId)).map(withDefaults)
export async function getReceipt(id: string) {
  const r = await (await dbp).get('receipts', id)
  return r && withDefaults(r)
}
export const saveReceipt = async (r: Receipt) => void (await (await dbp).put('receipts', r))
export const deleteReceipt = async (id: string) => (await dbp).delete('receipts', id)
export const allReceipts = async () => (await (await dbp).getAll('receipts')).map(withDefaults)

export async function getSettings(): Promise<Settings> {
  const s = await (await dbp).get('settings', 'main')
  return { userName: s?.userName ?? '', caps: s?.caps ?? { ...DEFAULT_CAPS }, defaultTemplateId: s?.defaultTemplateId ?? '' }
}
export const saveSettings = async (s: Settings) => void (await (await dbp).put('settings', s, 'main'))

export async function listTemplates(): Promise<Template[]> {
  return (await (await dbp).getAll('templates')).sort((a, b) => a.name.localeCompare(b.name))
}
export const getTemplate = async (id: string) => (await dbp).get('templates', id)
export const saveTemplate = async (t: Template) => void (await (await dbp).put('templates', t))
export const deleteTemplate = async (id: string) => (await dbp).delete('templates', id)
