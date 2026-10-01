import { deleteReport, getReport, saveReport, uid } from '../db'
import { h } from '../dom'
import type { Report } from '../types'
import { field, go, notice, shell } from './shell'

export async function reportFormPage(id?: string): Promise<HTMLElement> {
  const existing = id ? await getReport(id) : undefined
  const name = h('input', { type: 'text', required: true, value: existing?.name ?? '', placeholder: 'e.g. May–Dec 2025 expenses' })
  const from = h('input', { type: 'date', required: true, value: existing?.from ?? '' })
  const to = h('input', { type: 'date', required: true, value: existing?.to ?? '' })
  const projectRef = h('input', { type: 'text', value: existing?.projectRef ?? '' })
  const invoiced = h('input', { type: 'text', value: existing?.invoiced ?? '' })
  const error = h('div')

  const form = h(
    'form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault()
        error.replaceChildren()
        if (to.value < from.value) return void error.append(notice('error', 'The end date is before the start date.'))
        const report: Report = {
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
    field('Report name', name, 'Printed as the Title on the Excel report.'),
    h('div', { class: 'row2' }, field('From', from), field('To', to)),
    h('div', { class: 'row2' }, field('Project reference', projectRef, 'Optional'), field('Invoiced', invoiced, 'Optional')),
    error,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Save' : 'Create report')),
  )

  const del = existing
    ? h(
        'button',
        {
          class: 'btn danger',
          type: 'button',
          onclick: async () => {
            if (confirm(`Delete "${existing.name}" and all its receipts? This cannot be undone.`)) {
              await deleteReport(existing.id)
              go('/')
            }
          },
        },
        'Delete report',
      )
    : null

  return shell(existing ? 'Edit report' : 'New report', existing ? `/report/${existing.id}` : '/', [form, del ?? ''].filter(Boolean) as Node[])
}
