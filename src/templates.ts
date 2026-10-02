import { getSettings, getTemplate, listTemplates, saveSettings, saveTemplate, uid } from './db'
import type { Report, Settings, Template } from './types'
import { checkTemplate } from './xlsx'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Store an Excel template picked by the user. A file with the same name replaces
 * the stored one and keeps its id, so reports that use it pick up the new file.
 * The first template added becomes the default.
 */
export async function addTemplate(file: File): Promise<{ template: Template; replaced: boolean }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const problem = await checkTemplate(bytes)
  if (problem) throw new Error(`${file.name} cannot be used. ${problem}`)
  const name = file.name.replace(/\.xlsx$/i, '').trim() || 'Template'
  const same = (await listTemplates()).find((t) => t.name === name)
  const template: Template = { id: same?.id ?? uid(), name, file: new Blob([bytes], { type: XLSX_MIME }), addedAt: Date.now() }
  await saveTemplate(template)
  const settings = await getSettings()
  if (!settings.defaultTemplateId || !(await getTemplate(settings.defaultTemplateId))) await saveSettings({ ...settings, defaultTemplateId: template.id })
  return { template, replaced: !!same }
}

/** The template a report exports with: its own pick, else the default, else the first one stored. */
export function templateFor(report: Pick<Report, 'templateId'>, settings: Settings, templates: Template[]): Template | undefined {
  const byId = (id: string | undefined) => (id ? templates.find((t) => t.id === id) : undefined)
  return byId(report.templateId) ?? byId(settings.defaultTemplateId) ?? templates[0]
}
