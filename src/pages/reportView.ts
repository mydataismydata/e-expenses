import { claimedAmount, sortReceipts } from '../claim'
import { getReport, getSettings, listReceipts } from '../db'
import { fmtDate, h, money } from '../dom'
import { buildExport, download } from '../export'
import { receiptFileName } from '../naming'
import { go, notice, shell } from './shell'

export async function reportViewPage(id: string): Promise<HTMLElement> {
  const report = await getReport(id)
  if (!report) return shell('Not found', '/', [notice('error', 'This report no longer exists.')])
  const settings = await getSettings()
  const receipts = sortReceipts(await listReceipts(id))
  const total = receipts.reduce((a, r) => a + claimedAmount(r, settings.caps), 0)

  const status = h('div')
  const exportBtn = h(
    'button',
    {
      class: 'btn primary',
      disabled: receipts.length === 0,
      onclick: async () => {
        exportBtn.disabled = true
        status.replaceChildren(notice('info', 'Building ZIP…'))
        try {
          const { blob, name } = await buildExport(report, receipts, settings)
          download(blob, name)
          status.replaceChildren(notice('info', `Downloaded ${name}`))
        } catch (e) {
          status.replaceChildren(notice('error', `Export failed: ${e instanceof Error ? e.message : e}`))
        } finally {
          exportBtn.disabled = false
        }
      },
    },
    'Export ZIP (Excel + PDFs)',
  )

  const rows = receipts.map((r, i) => {
    const claimed = claimedAmount(r, settings.caps)
    return h(
      'tr',
      { class: 'click', onclick: () => go(`/receipt/${r.id}`) },
      h('td', null, String(i + 1)),
      h('td', null, fmtDate(r.date)),
      h('td', null, h('div', null, r.payee || '—'), h('div', { class: 'file muted' }, receiptFileName(i + 1, r))),
      h('td', { class: 'hide-sm' }, r.type),
      h('td', { class: 'num' }, money(claimed), claimed !== r.amount ? h('div', { class: 'muted small' }, `of ${money(r.amount)}`) : null),
    )
  })

  return shell(
    report.name,
    '/',
    [
      h('p', { class: 'muted' }, `${fmtDate(report.from)} – ${fmtDate(report.to)}`, report.projectRef ? ` · Project ${report.projectRef}` : '', report.invoiced ? ` · Invoiced ${report.invoiced}` : ''),
      !settings.userName ? notice('warn', 'Set your name in Settings before exporting.') : null,
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: `#/receipt/new?report=${id}` }, '＋ Add receipt'), exportBtn, h('a', { class: 'btn ghost', href: `#/report/${id}/edit` }, 'Edit report')),
      status,
      receipts.length
        ? h(
            'table',
            { class: 'rows' },
            h('thead', null, h('tr', null, ...['#', 'Date', 'Payee / file', 'Type', 'Claimed'].map((t, i) => h('th', { class: i === 3 ? 'hide-sm' : i === 4 ? 'num' : '' }, t)))),
            h('tbody', null, ...rows),
            h('tfoot', null, h('tr', null, h('td', { colSpan: 4, class: 'num' }, 'Total'), h('td', { class: 'num' }, money(total)))),
          )
        : h('p', { class: 'muted empty' }, 'No receipts in this report yet.'),
    ].filter(Boolean) as Node[],
  )
}
