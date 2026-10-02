import { totalClaimed } from '../claim'
import { getSettings, listReceipts, listReports } from '../db'
import { fmtDate, h, money } from '../dom'
import { notice, shell } from './shell'

export async function homePage(): Promise<HTMLElement> {
  const [reports, settings] = await Promise.all([listReports(), getSettings()])
  const rows = await Promise.all(
    reports.map(async (r) => {
      const receipts = await listReceipts(r.id)
      const { total, pending } = totalClaimed(receipts, settings.caps, r.currency)
      return h(
        'a',
        { class: 'card pad stack tight', href: `#/report/${r.id}` },
        h('h2', null, r.name),
        h('span', { class: 'meta' }, `${fmtDate(r.from)} – ${fmtDate(r.to)}`),
        h(
          'span',
          { class: 'spread' },
          h('span', { class: 'row' }, h('span', { class: 'muted' }, `${receipts.length} receipt${receipts.length === 1 ? '' : 's'}`), pending ? h('span', { class: 'tag warn' }, `${pending} rate${pending === 1 ? '' : 's'} pending`) : null),
          h('span', { class: 'figure' }, money(total, r.currency)),
        ),
      )
    }),
  )
  return shell(
    {
      title: 'Reports',
      actions: [h('a', { class: 'btn', href: '#/receipt/new' }, '＋ Add receipt'), h('a', { class: 'btn quiet', href: '#/report/new' }, 'New report')],
    },
    [
      !settings.userName ? notice('warn', 'Set your name in Settings. It goes on the report and in the Excel file name.') : null,
      reports.length ? h('div', { class: 'cards' }, ...rows) : h('p', { class: 'card empty' }, 'No reports yet. Create a report for a date range, then add receipts to it.'),
    ].filter(Boolean) as Node[],
  )
}
