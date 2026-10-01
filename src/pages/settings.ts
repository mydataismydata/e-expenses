import { createBackup, restoreBackup } from '../backup'
import { getSettings, saveSettings } from '../db'
import { h } from '../dom'
import { download, todayIso } from '../export'
import { EXPENSE_TYPES } from '../types'
import { field, notice, shell } from './shell'

export async function settingsPage(): Promise<HTMLElement> {
  const settings = await getSettings()
  const userName = h('input', { type: 'text', value: settings.userName, placeholder: 'Jane Doe', autocomplete: 'name' })
  const status = h('div')

  const capInputs = EXPENSE_TYPES.map((t) => ({
    type: t,
    input: h('input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', value: settings.caps[t]?.toString() ?? '', placeholder: 'no limit' }),
  }))

  const save = async () => {
    const caps: Record<string, number> = {}
    for (const { type, input } of capInputs) if (input.value !== '' && Number(input.value) >= 0) caps[type] = Number(input.value)
    await saveSettings({ userName: userName.value.trim(), caps })
    status.replaceChildren(notice('info', 'Saved.'))
  }

  const restoreInput = h('input', {
    type: 'file',
    accept: '.zip',
    hidden: true,
    onchange: async () => {
      const f = restoreInput.files?.[0]
      if (!f) return
      try {
        const n = await restoreBackup(f)
        status.replaceChildren(notice('info', `Restored ${n.reports} report(s) and ${n.receipts} receipt(s).`))
      } catch (e) {
        status.replaceChildren(notice('error', e instanceof Error ? e.message : String(e)))
      }
      restoreInput.value = ''
    },
  })

  return shell('Settings', '/', [
    h('form', { onsubmit: (e: Event) => { e.preventDefault(); void save() } },
      field('Your name', userName, 'Used as "Name" on the report and in the Excel file name (J_DOE).'),
      h('h2', null, 'Maximum claim per expense type'),
      h('p', { class: 'muted' }, 'When a type has a maximum, the claimed amount is the receipt total or the maximum, whichever is lower. Leave blank for no limit. You can still override the amount on a receipt.'),
      h('div', { class: 'caps' }, ...capInputs.map(({ type, input }) => field(type, input))),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save settings')),
    ),
    status,
    h('h2', null, 'Backup'),
    h('p', { class: 'muted' }, 'Data lives only in this browser. Download a backup now and then, and restore it on a new device or after clearing browser data.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', onclick: async () => download(await createBackup(), `expense-backup-${todayIso()}.zip`) }, 'Download backup'),
      h('button', { class: 'btn', type: 'button', onclick: () => restoreInput.click() }, 'Restore backup'),
      restoreInput,
    ),
  ])
}
