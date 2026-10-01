import { claimedAmount } from '../claim'
import { getSettings, listReceipts, listReports } from '../db'
import { fmtDate, h, money } from '../dom'
import { notice, shell } from './shell'


export async function homePage(): Promise<HTMLElement> {
  const [reports, settings] = await Promise.all([listReports(), getSettings()])
  const rows = await Promise.all(
    reports.map(async (r) => {
      const receipts = await listReceipts(r.id)
      const total = receipts.reduce((a, x) => a + claimedAmount(x, settings.caps), 0)
      return h(
        'a',
        { class: 'card', href: `#/report/${r.id}` },
        h('div', { class: 'card-title' }, r.name),
        h('div', { class: 'muted' }, `${fmtDate(r.from)} – ${fmtDate(r.to)}`),
        h('div', { class: 'card-meta' }, h('span', null, `${receipts.length} receipt${receipts.length === 1 ? '' : 's'}`), h('strong', null, money(total))),
      )
    }),
  )
  return shell(
    'Expense reports',
    null,
    [
      !settings.userName ? notice('warn', 'Set your name in Settings. It goes on the report and in the Excel file name.') : null,
      h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/receipt/new' }, '＋ Add receipt'), h('a', { class: 'btn', href: '#/report/new' }, 'New report')),
      reports.length ? h('div', { class: 'cards' }, ...rows) : h('p', { class: 'muted empty' }, 'No reports yet. Create a report for a date range, then add receipts to it.'),
    ].filter(Boolean) as Node[],
    [h('a', { class: 'btn ghost', href: '#/settings' }, 'Settings')],
  )
}
