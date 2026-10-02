import { createBackup, restoreBackup } from '../backup'
import { deleteTemplate, getSettings, listTemplates, saveSettings } from '../db'
import { fmtDate, h } from '../dom'
import { download, todayIso } from '../export'
import { addTemplate } from '../templates'
import { EXPENSE_TYPES } from '../types'
import { askFirst, card, field, input, notice, refresh, shell } from './shell'

declare global {
  interface Window {
    /** Set by public/theme.js (Clean grids). */
    gridsTheme?: { get(): 'light' | 'dark' | 'system'; set(choice: 'light' | 'dark' | 'system'): void }
  }
}

/** A message to show once after the page redraws, e.g. "Added US template." */
let flash = ''

export async function settingsPage(): Promise<HTMLElement> {
  const [settings, templates] = await Promise.all([getSettings(), listTemplates()])
  const userName = input({ type: 'text', value: settings.userName, placeholder: 'First Last', autocomplete: 'name' })
  const status = h('div')
  const capsStatus = h('div')
  const templateStatus = h('div')
  const backupStatus = h('div')

  const capInputs = EXPENSE_TYPES.map((t) => ({
    type: t,
    input: input({ type: 'number', min: 0, step: '0.01', inputmode: 'decimal', value: settings.caps[t]?.toString() ?? '', placeholder: 'No limit' }),
  }))

  // Both forms save the name and the maximums together; the message shows under the one used.
  const save = async (saved: HTMLElement) => {
    const caps: Record<string, number> = {}
    for (const { type, input } of capInputs) if (input.value !== '' && Number(input.value) >= 0) caps[type] = Number(input.value)
    await saveSettings({ ...(await getSettings()), userName: userName.value.trim(), caps })
    saved.replaceChildren(notice('ok', 'Saved.'))
  }

  // ---- theme: theme.js keeps the choice and marks the pressed button
  const theme = window.gridsTheme?.get() ?? 'system'
  const themeSwitch = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Theme' },
    ...(['light', 'dark', 'system'] as const).map((t) => h('button', { type: 'button', 'data-theme-set': t, 'aria-pressed': String(t === theme) }, t[0].toUpperCase() + t.slice(1))),
  )

  // ---- Excel templates
  const templatePicker = h('input', {
    type: 'file',
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    onchange: async () => {
      const f = templatePicker.files?.[0]
      templatePicker.value = ''
      if (!f) return
      try {
        const { template, replaced } = await addTemplate(f)
        flash = `${replaced ? 'Replaced' : 'Added'} ${template.name}.`
        refresh()
      } catch (e) {
        templateStatus.replaceChildren(notice('error', e instanceof Error ? e.message : String(e)))
      }
    },
  })
  if (flash) templateStatus.replaceChildren(notice('ok', flash))
  flash = ''
  const templateRows = templates.map((t) => {
    const isDefault = t.id === settings.defaultTemplateId || (!settings.defaultTemplateId && t === templates[0])
    const remove = () =>
      askFirst(line, `Remove the template "${t.name}" from this device? Reports that use it switch to the default.`, 'Remove template', async () => {
        await deleteTemplate(t.id)
        if (isDefault) await saveSettings({ ...(await getSettings()), defaultTemplateId: templates.find((x) => x.id !== t.id)?.id ?? '' })
        refresh()
      })
    const line: HTMLElement = h(
      'li',
      null,
      h('span', { class: 'stack tight' }, h('span', { class: 'row' }, h('strong', null, t.name), isDefault ? h('span', { class: 'tag accent' }, 'Default') : null), h('span', { class: 'meta' }, `Added ${fmtDate(new Date(t.addedAt).toISOString().slice(0, 10))}`)),
      h(
        'span',
        { class: 'row nowrap' },
        isDefault
          ? null
          : h('button', { class: 'link-action', type: 'button', onclick: async () => { await saveSettings({ ...(await getSettings()), defaultTemplateId: t.id }); refresh() } }, 'Make default'),
        h('button', { class: 'link-action danger', type: 'button', onclick: remove }, 'Remove'),
      ),
    )
    return line
  })

  const restoreInput = h('input', {
    type: 'file',
    accept: '.zip',
    onchange: async () => {
      const f = restoreInput.files?.[0]
      if (!f) return
      try {
        const n = await restoreBackup(f)
        backupStatus.replaceChildren(notice('ok', `Restored ${n.reports} report(s), ${n.receipts} receipt(s) and ${n.templates} template(s).`))
      } catch (e) {
        backupStatus.replaceChildren(notice('error', e instanceof Error ? e.message : String(e)))
      }
      restoreInput.value = ''
    },
  })

  const saveForm = (title: string, body: Node[], label: string, saved: HTMLElement) =>
    h(
      'form',
      { onsubmit: (e: Event) => { e.preventDefault(); void save(saved) } },
      card(title, [...body, saved, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, label))]),
    )

  return shell({ title: 'Settings', back: ['/', 'Reports'] }, [
    saveForm('You', [field('Your name', userName, 'Used as "Name" on the report and in the Excel file name (e.g. J_DOE).')], 'Save name', status),
    card('Excel templates', [
      h('p', { class: 'muted' }, 'The Excel file each report is filled into, for example the US or the French form. Templates stay on this device and in your backups. They are not part of the app. Adding a file with the same name replaces the stored one.'),
      templates.length ? h('ul', { class: 'rows' }, ...templateRows) : h('p', { class: 'notice' }, 'No template yet. Add one before you export a report.'),
      templateStatus,
      h('div', { class: 'row' }, h('button', { class: 'btn quiet', type: 'button', onclick: () => templatePicker.click() }, 'Add template…'), templatePicker),
    ]),
    card('Appearance', [h('div', { class: 'field' }, h('span', { class: 'kicker' }, 'Theme'), h('div', null, themeSwitch), h('span', { class: 'hint' }, 'System follows the device setting.'))]),
    saveForm(
      'Maximum claim per expense type',
      [
        h('p', { class: 'muted' }, 'When a type has a maximum, the claimed amount is the receipt total in US dollars or the maximum, whichever is lower. Leave blank for no limit. You can still override the amount on a receipt.'),
        h('div', { class: 'caps' }, ...capInputs.map(({ type, input }) => field(`${type} ($)`, input))),
      ],
      'Save maximums',
      capsStatus,
    ),
    card('Backup', [
      h('p', { class: 'muted' }, 'Data lives only in this browser. Download a backup now and then, and restore it on a new device or after clearing browser data.'),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn quiet', type: 'button', onclick: async () => download(await createBackup(), `expense-backup-${todayIso()}.zip`) }, 'Download backup'),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => restoreInput.click() }, 'Restore backup'),
        restoreInput,
      ),
      backupStatus,
    ]),
  ])
}
