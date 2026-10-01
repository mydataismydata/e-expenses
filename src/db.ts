import { openDB, type DBSchema } from 'idb'
import { DEFAULT_CAPS, type Receipt, type Report, type Settings } from './types'

interface Schema extends DBSchema {
  reports: { key: string; value: Report }
  receipts: { key: string; value: Receipt; indexes: { reportId: string } }
  settings: { key: string; value: Settings }
}

const dbp = openDB<Schema>('expense-reports', 1, {
  upgrade(db) {
    db.createObjectStore('reports', { keyPath: 'id' })
    db.createObjectStore('receipts', { keyPath: 'id' }).createIndex('reportId', 'reportId')
    db.createObjectStore('settings')
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

export const listReceipts = async (reportId: string) => (await dbp).getAllFromIndex('receipts', 'reportId', reportId)
export const getReceipt = async (id: string) => (await dbp).get('receipts', id)
export const saveReceipt = async (r: Receipt) => void (await (await dbp).put('receipts', r))
export const deleteReceipt = async (id: string) => (await dbp).delete('receipts', id)
export const allReceipts = async () => (await dbp).getAll('receipts')

export async function getSettings(): Promise<Settings> {
  const s = await (await dbp).get('settings', 'main')
  return { userName: s?.userName ?? '', caps: s?.caps ?? { ...DEFAULT_CAPS } }
}
export const saveSettings = async (s: Settings) => void (await (await dbp).put('settings', s, 'main'))
