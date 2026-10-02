import { deleteReport, getReport, saveReport, uid } from '../db'
import { h } from '../dom'
import type { Report } from '../types'
import { askFirst, card, field, go, input, notice, shell } from './shell'

export async function reportFormPage(id?: string): Promise<HTMLElement> {
  const existing = id ? await getReport(id) : undefined
  const name = input({ type: 'text', required: true, value: existing?.name ?? '', placeholder: 'e.g. May–Dec 2025 expenses' })
  const from = input({ type: 'date', required: true, value: existing?.from ?? '' })
  const to = input({ type: 'date', required: true, value: existing?.to ?? '' })
  const projectRef = input({ type: 'text', value: existing?.projectRef ?? '' })
  const invoiced = input({ type: 'text', value: existing?.invoiced ?? '' })
  const error = h('div')

  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (e: Event) => {
        e.preventDefault()
        error.replaceChildren()
        if (to.value < from.value) return void error.append(notice('error', 'The end date is before the start date.'))
        const report: Report = {
          ...existing,
          id: existing?.id ?? uid(),
          name: name.value.trim(),
          from: from.value,
          to: to.value,
          projectRef: projectRef.value.trim(),
          invoiced: invoiced.value.trim(),
          createdAt: existing?.createdAt ?? Date.now(),
        }
        await saveReport(report)
        go(`/report/${report.id}`)
      },
    },
    card('Report', [
      field('Report name', name, 'Printed as the Title on the Excel report.'),
      h('div', { class: 'pair' }, field('From', from), field('To', to)),
      h('div', { class: 'pair' }, field('Project reference', projectRef, 'Optional'), field('Invoiced', invoiced, 'Optional')),
    ]),
    error,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, existing ? 'Save' : 'Create report')),
  )

  const del = existing ? h('div', { class: 'row' }) : null
  if (existing && del) {
    const ask = () =>
      askFirst(del, `Delete "${existing.name}" and all its receipts? This cannot be undone.`, 'Delete report', async () => {
        await deleteReport(existing.id)
        go('/')
      })
    del.append(h('button', { class: 'btn danger', type: 'button', onclick: ask }, 'Delete report'))
  }

  return shell(
    { title: existing ? 'Edit report' : 'New report', back: existing ? [`/report/${existing.id}`, existing.name] : ['/', 'Reports'] },
    [form, del].filter(Boolean) as Node[],
  )
}
