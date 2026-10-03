import { claimedAmount, convertedAmount, sortReceipts, totalClaimed } from '../claim'
import { getReport, getSettings, listReceipts, listTemplates, saveReceipt, saveReport } from '../db'
import { currencySymbol, fmtDate, h, money } from '../dom'
import { buildExport, download, todayIso } from '../export'
import { receiptFileName } from '../naming'
import { needsRate, refreshRates } from '../rates'
import { addTemplate, templateFor } from '../templates'
import type { Receipt, Template } from '../types'
import { templateAmountSymbol } from '../xlsx'
import { field, go, notice, refresh, select, shell } from './shell'

const ADD_TEMPLATE = '__add__'

export async function reportViewPage(id: string): Promise<HTMLElement> {
  const report = await getReport(id)
  if (!report) return shell({ title: 'Not found', back: ['/', 'Reports'] }, [notice('error', 'This report no longer exists.')])
  const [settings, templates] = await Promise.all([getSettings(), listTemplates()])
  const receipts = sortReceipts(await listReceipts(id))
  const cur = report.currency
  const { total, pending } = totalClaimed(receipts, settings.caps, cur)
  const today = todayIso()

  // ---- exchange rates: fetched in the background, the page redraws when they arrive
  const rateBox = h('div')
  async function getRates(quiet: boolean) {
    if (!quiet) rateBox.replaceChildren(notice('info', 'Getting exchange rates…'))
    const res = await refreshRates(receipts, cur, today, saveReceipt)
    if (res.updated) return refresh()
    if (!quiet) rateBox.replaceChildren(notice(res.missing ? 'warn' : 'ok', res.error ?? (res.missing ? 'No rate is published for those dates yet. Try again later, or type the rate on the receipt.' : 'Rates are up to date.')))
  }
  if (pending) {
    rateBox.replaceChildren(
      h(
        'div',
        { class: 'notice' },
        `${pending} receipt${pending === 1 ? ' needs' : 's need'} an exchange rate. It is fetched when you are online. `,
        h('button', { class: 'linkish', type: 'button', onclick: () => void getRates(false) }, 'Get rates now'),
      ),
    )
  }
  if (navigator.onLine && receipts.some((r) => needsRate(r, cur, today))) void getRates(true).catch(() => {})

  // ---- template and export
  const status = h('div')
  const chosen = templateFor(report, settings, templates)
  // A template whose amount column shows another currency's symbol would print EUR amounts with "$".
  const mismatch = h('div')
  async function checkSymbol(t: Template | undefined) {
    mismatch.replaceChildren()
    const symbol = t && (await templateAmountSymbol(await t.file.arrayBuffer()).catch(() => undefined))
    if (symbol && symbol !== currencySymbol(cur) && symbol !== cur)
      mismatch.replaceChildren(notice('warn', `${t.name} shows its amounts with "${symbol}", but this report is in ${cur}. Pick a template for ${cur}, or change the report's currency.`))
  }
  void checkSymbol(chosen)
  const picker = h('input', {
    type: 'file',
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    onchange: async () => {
      const f = picker.files?.[0]
      picker.value = ''
      if (!f) return
      try {
        const { template } = await addTemplate(f)
        await saveReport({ ...report, templateId: template.id })
        refresh()
      } catch (e) {
        status.replaceChildren(notice('error', e instanceof Error ? e.message : String(e)))
      }
    },
  })
  const templateSel = select(
    {
      onchange: async () => {
        if (templateSel.value === ADD_TEMPLATE) {
          templateSel.value = chosen?.id ?? ''
          return picker.click()
        }
        await saveReport({ ...report, templateId: templateSel.value })
        report.templateId = templateSel.value
        void checkSymbol(templates.find((t) => t.id === templateSel.value))
      },
    },
    ...templates.map((t) => h('option', { value: t.id, selected: t.id === chosen?.id }, `${t.name}${t.id === settings.defaultTemplateId ? ' (default)' : ''}`)),
    h('option', { value: ADD_TEMPLATE }, '＋ Add template…'),
  )

  const exportBtn = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      disabled: receipts.length === 0 || templates.length === 0,
      onclick: async () => {
        exportBtn.disabled = true
        try {
          const template = templates.find((t) => t.id === templateSel.value) ?? chosen
          if (!template) throw new Error('Add an Excel template first.')
          if (receipts.some((r) => needsRate(r, cur, today))) {
            status.replaceChildren(notice('info', 'Getting exchange rates…'))
            await refreshRates(receipts, cur, today, saveReceipt)
          }
          status.replaceChildren(notice('info', 'Building ZIP…'))
          const { blob, name } = await buildExport(report, receipts, settings, template.file)
          download(blob, name)
          status.replaceChildren(notice('ok', `Downloaded ${name}`))
        } catch (e) {
          status.replaceChildren(notice('error', `Export failed. ${e instanceof Error ? e.message : e}`))
        } finally {
          exportBtn.disabled = false
        }
      },
    },
    'Export ZIP (Excel + PDFs)',
  )

  const exportCard = h(
    'section',
    { class: 'card pad stack' },
    templates.length
      ? h('div', { class: 'stack tight' }, field('Excel template', templateSel, 'Kept on this device. Add or remove templates in Settings.'), mismatch)
      : h(
          'div',
          { class: 'stack tight' },
          h('span', { class: 'kicker' }, 'Excel template'),
          h('p', null, 'Choose the Excel template to fill, for example the US or the French form. It stays on this device and is not part of the app.'),
          h('div', { class: 'row' }, h('button', { class: 'btn quiet', type: 'button', onclick: () => picker.click() }, 'Choose Excel template…')),
        ),
    h('div', { class: 'row' }, exportBtn),
    status,
    picker,
  )

  // ---- receipts
  const amountCell = (r: Receipt) => {
    const claimed = claimedAmount(r, settings.caps, cur)
    const converted = convertedAmount(r, cur)
    const foreign = r.currency !== cur
    return h(
      'td',
      { class: 'num' },
      claimed === null ? h('span', { class: 'tag warn' }, 'Rate pending') : h('span', { class: 'figure' }, money(claimed, cur)),
      foreign ? h('div', { class: 'small muted mono' }, money(r.amount, r.currency), r.fx?.to === cur ? ` × ${r.fx.rate}` : '') : null,
      claimed !== null && converted !== null && claimed !== converted ? h('div', { class: 'small muted mono' }, `of ${money(converted, cur)}`) : null,
    )
  }
  const rows = receipts.map((r, i) =>
    h(
      'tr',
      { class: 'click', onclick: () => go(`/receipt/${r.id}`) },
      h('td', { class: 'mono' }, String(i + 1)),
      h('td', { class: 'nowrap' }, fmtDate(r.date)),
      h('td', null, h('a', { href: `#/receipt/${r.id}` }, r.payee || r.description || '—'), h('div', { class: 'file' }, receiptFileName(i + 1, r))),
      h('td', { class: 'hide-sm' }, r.type),
      amountCell(r),
    ),
  )
  const table = receipts.length
    ? h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'table' },
            h('thead', null, h('tr', null, ...['#', 'Date', 'Payee / file', 'Type', 'Claimed'].map((t, i) => h('th', { class: i === 3 ? 'hide-sm' : i === 4 ? 'num' : '' }, t)))),
            h('tbody', null, ...rows),
            h(
              'tfoot',
              null,
              h('tr', null, h('td', { colSpan: 3 }, 'Total'), h('td', { class: 'hide-sm' }), h('td', { class: 'num figure' }, money(total, cur), pending ? h('div', { class: 'small muted' }, `+ ${pending} pending`) : null)),
            ),
          ),
        ),
      )
    : h('p', { class: 'card empty' }, 'No receipts in this report yet.')

  const sub = [`${fmtDate(report.from)} – ${fmtDate(report.to)}`, cur, report.projectRef && `Project ${report.projectRef}`, report.invoiced && `Invoiced ${report.invoiced}`].filter(Boolean).join(' · ')
  return shell(
    {
      title: report.name,
      sub,
      back: ['/', 'Reports'],
      actions: [h('a', { class: 'btn quiet', href: `#/receipt/new?report=${id}` }, '＋ Add receipt'), h('a', { class: 'btn quiet', href: `#/report/${id}/edit` }, 'Edit')],
    },
    [!settings.userName ? notice('warn', 'Set your name in Settings before exporting.') : null, rateBox, exportCard, table].filter(Boolean) as Node[],
  )
}
