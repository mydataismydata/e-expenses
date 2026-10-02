import { claimedAmount, convertedAmount, matchingReports } from '../claim'
import { deleteReceipt, getReceipt, getSettings, listReports, newReportCurrency, saveReceipt, saveReport, uid } from '../db'
import { currencyDigits, currencyOptions, fmtDate, h, money, monthBounds, roundTo } from '../dom'
import { isPdf, todayIso } from '../export'
import { extractText, normaliseImage, renderPdfPage } from '../extract'
import { guessFields } from '../parse'
import { describeRate, fetchRate, needsRate } from '../rates'
import { EXPENSE_TYPES, type FxRate, type Receipt } from '../types'
import { askFirst, card, field, go, input, notice, select, shell } from './shell'

const NEW_REPORT = '__new__'
const LAST_CURRENCY = 'expenses.currency'

/** The currency of the last receipt saved on this device, so a trip abroad does not mean picking it every time. */
function lastCurrency(): string {
  try {
    return localStorage.getItem(LAST_CURRENCY) || 'USD'
  } catch {
    return 'USD'
  }
}

/** Add (no id) or edit (id) a receipt. */
export async function receiptFormPage(id: string | undefined, presetReportId: string | null): Promise<HTMLElement> {
  const [settings, reports, existing] = await Promise.all([getSettings(), listReports(), id ? getReceipt(id) : Promise.resolve(undefined)])
  if (id && !existing) return shell({ title: 'Not found', back: ['/', 'Reports'] }, [notice('error', 'This receipt no longer exists.')])

  let file: Blob | undefined = existing?.file
  let fileName = existing?.fileName ?? ''
  const touched = new Set<string>(existing ? ['date', 'payee', 'place', 'description', 'type', 'ref', 'amount', 'report', 'currency'] : [])
  let claimTouched = existing?.claimedOverride != null
  let fx: FxRate | null = existing?.fx ?? null
  let rateTouched = fx?.source === 'Manual'

  // ---- inputs
  const tracked = (name: string, props: Record<string, unknown>) => input({ ...props, oninput: () => touched.add(name) })
  const date = tracked('date', { type: 'date', required: true, value: existing?.date ?? '' })
  const payee = tracked('payee', { type: 'text', value: existing?.payee ?? '', placeholder: 'Who was paid' })
  const place = tracked('place', { type: 'text', value: existing?.place ?? '', placeholder: 'City, ST, USA' })
  const description = tracked('description', { type: 'text', value: existing?.description ?? '', placeholder: 'Short description' })
  const ref = tracked('ref', { type: 'text', value: existing?.ref ?? '', placeholder: 'Used in the file name when present' })
  const amount = tracked('amount', { type: 'number', required: true, min: 0, step: '0.01', inputmode: 'decimal', value: existing?.amount?.toString() ?? '', 'aria-label': 'Receipt total' })
  const startCurrency = existing?.currency ?? lastCurrency()
  const currency = select(
    { 'aria-label': 'Currency', onchange: () => { touched.add('currency'); void updateRate() } },
    ...currencyOptions().map(([code, label]) => h('option', { value: code, selected: code === startCurrency }, label)),
  )
  const type = select({ onchange: () => touched.add('type') }, ...EXPENSE_TYPES.map((t) => h('option', { value: t, selected: t === (existing?.type ?? 'Others') }, t)))
  const rate = input({
    type: 'number', min: 0, step: 'any', inputmode: 'decimal',
    oninput: () => {
      rateTouched = true
      const v = Number(rate.value)
      fx = rate.value !== '' && v > 0 ? { rate: v, to: target(), date: date.value, source: 'Manual' } : null
      showRate()
      refreshClaim()
    },
  })
  if (fx) rate.value = String(fx.rate)
  const rateLabel = h('span', { class: 'kicker' })
  const rateSource = h('span')
  const rateConverted = h('span', { class: 'mono' })
  const rateReset = h('span')
  const rateField = h('div', { class: 'field' }, rateLabel, rate, h('span', { class: 'hint' }, rateSource, rateConverted, rateReset))
  const claimed = input({
    type: 'number', min: 0, step: '0.01', inputmode: 'decimal',
    oninput: () => { claimTouched = true; refreshClaim() },
  })
  const claimLabel = h('span', { class: 'kicker' })
  const reportSel = select({ onchange: () => { touched.add('report'); refreshReport(); void updateRate() } })
  const newName = input({ type: 'text', placeholder: 'Name of the new report' })
  const newFrom = input({ type: 'date' })
  const newTo = input({ type: 'date' })
  const defaultReportCurrency = newReportCurrency(reports)
  const newCurrency = select(
    { onchange: () => void updateRate() },
    ...currencyOptions().map(([code, label]) => h('option', { value: code, selected: code === defaultReportCurrency }, label)),
  )
  const reportBox = h('div', { class: 'stack' })
  const claimHint = h('span')
  const status = h('div')
  const preview = h('div', { class: 'preview' })
  const error = h('div')

  const num = () => (amount.value === '' ? NaN : Number(amount.value))
  /** The chosen report's currency: every amount is converted into it and claimed in it. */
  const target = () => (reportSel.value === NEW_REPORT ? newCurrency.value : (reports.find((r) => r.id === reportSel.value)?.currency ?? defaultReportCurrency))
  const foreign = () => currency.value !== target()
  const computedClaim = () => (Number.isFinite(num()) ? (claimedAmount({ amount: num(), type: type.value, claimedOverride: null, currency: currency.value, fx }, settings.caps, target()) ?? NaN) : NaN)

  function refreshClaim() {
    const to = target()
    claimLabel.textContent = `Amount to claim (${to})`
    const auto = computedClaim()
    if (!claimTouched) claimed.value = Number.isFinite(auto) ? auto.toFixed(2) : ''
    const cap = settings.caps[type.value]
    const overridden = claimTouched && claimed.value !== '' && Number(claimed.value) !== auto
    const parts: string[] = []
    if (foreign() && !fx && !overridden) parts.push('Waiting for the exchange rate.')
    if (cap !== undefined) parts.push(`${type.value} is limited to ${money(cap, to)}.`)
    if (overridden) parts.push('Amount overridden by hand.')
    if (!parts.length) parts.push(foreign() ? `Defaults to the receipt total converted to ${to}.` : 'Defaults to the receipt total.')
    claimHint.textContent = parts.join(' ')
    const converted = foreign() && fx && Number.isFinite(num()) ? convertedAmount({ amount: num(), currency: currency.value, fx }, to) : null
    rateConverted.textContent = converted !== null ? ` ${money(num(), currency.value)} = ${money(converted, to)}.` : ''
  }

  // ---- exchange rate: the published rate for the receipt date, unless typed by hand
  function showRate(message?: string) {
    rateLabel.textContent = `Exchange rate (${target()} per 1 ${currency.value})`
    rate.setAttribute('aria-label', rateLabel.textContent)
    if (message) rateSource.textContent = message
    else if (fx) rateSource.textContent = rateTouched ? 'Entered by hand.' : describeRate(fx, date.value, fmtDate)
    else rateSource.textContent = ''
    rateReset.replaceChildren(
      rateTouched ? ' ' : '',
      rateTouched ? h('button', { class: 'linkish', type: 'button', onclick: () => { rateTouched = false; void updateRate() } }, 'Use the published rate') : '',
    )
  }

  let rateRequest = 0
  async function updateRate(initial = false) {
    rateField.hidden = !foreign()
    amount.step = String(10 ** -currencyDigits(currency.value))
    const mine = ++rateRequest
    // A rate typed for another report currency no longer applies.
    if (fx && fx.to !== target()) {
      rateTouched = false
      fx = null
      rate.value = ''
    }
    if (!foreign()) {
      fx = null
    } else if (rateTouched) {
      showRate()
    } else if (!date.value) {
      fx = null
      rate.value = ''
      showRate('The rate is looked up once the date is known.')
    } else if (initial && fx && !needsRate({ currency: currency.value, fx, date: date.value }, target(), todayIso())) {
      showRate()
    } else {
      showRate('Looking up the rate…')
      try {
        const got = await fetchRate(currency.value, target(), date.value)
        if (mine !== rateRequest) return
        fx = got
        rate.value = got ? String(got.rate) : ''
        showRate(got ? undefined : 'No rate is published for this date yet. It is fetched later, or type it here.')
      } catch (e) {
        if (mine !== rateRequest) return
        const keep = existing && existing.currency === currency.value && existing.date === date.value && existing.fx?.to === target() ? existing.fx : null
        fx = keep
        rate.value = keep ? String(keep.rate) : ''
        showRate(navigator.onLine ? `${e instanceof Error ? e.message : e} The rate is fetched later, or type it here.` : 'Offline. The rate is fetched when you are back online, or type it here.')
      }
    }
    refreshClaim()
  }

  // ---- report selection: suggested from the date, asks when ambiguous
  function refreshReportOptions(selected: string) {
    reportSel.replaceChildren(
      h('option', { value: '' }, '— choose a report —'),
      ...reports.map((r) => h('option', { value: r.id, selected: r.id === selected }, `${r.name} (${fmtDate(r.from)} – ${fmtDate(r.to)})`)),
      h('option', { value: NEW_REPORT, selected: selected === NEW_REPORT }, '＋ New report…'),
    )
  }
  function refreshReport() {
    reportBox.replaceChildren()
    const matches = date.value ? matchingReports(reports, date.value) : []
    if (reportSel.value === NEW_REPORT) {
      const b = date.value ? monthBounds(date.value) : { from: '', to: '' }
      if (!newFrom.value) newFrom.value = b.from
      if (!newTo.value) newTo.value = b.to
      if (!newName.value && date.value) newName.value = `${date.value.slice(0, 7)} Expenses`
      reportBox.append(
        field('New report name', newName),
        h('div', { class: 'pair' }, field('From', newFrom), field('To', newTo)),
        field('Report currency', newCurrency, 'Every receipt in the report is converted into this currency.'),
      )
    } else if (!date.value) {
      reportBox.append(h('span', { class: 'hint muted small' }, 'The report is suggested once the date is known.'))
    } else if (matches.length > 1 && !reportSel.value) {
      reportBox.append(notice('warn', `${fmtDate(date.value)} falls in ${matches.length} overlapping reports (${matches.map((m) => m.name).join(', ')}). Choose which one gets this receipt.`))
    } else if (matches.length === 0 && !reportSel.value) {
      reportBox.append(notice('warn', `No report covers ${fmtDate(date.value)}. Pick another report or create a new one.`))
    } else if (reportSel.value && !matches.some((m) => m.id === reportSel.value)) {
      reportBox.append(notice('warn', `${fmtDate(date.value)} is outside this report's dates.`))
    }
  }
  function suggestReport() {
    if (touched.has('report')) return refreshReport()
    const m = date.value ? matchingReports(reports, date.value) : []
    refreshReportOptions(m.length === 1 ? m[0].id : '')
    refreshReport()
  }
  const preset = presetReportId && reports.some((r) => r.id === presetReportId) ? presetReportId : ''
  refreshReportOptions(existing?.reportId ?? preset)
  if (existing || preset) touched.add('report')
  date.addEventListener('input', () => {
    suggestReport()
    if (fx?.source === 'Manual') fx = { ...fx, date: date.value }
    void updateRate()
  })
  amount.addEventListener('input', refreshClaim)
  type.addEventListener('change', refreshClaim)
  refreshClaim()
  if (existing?.claimedOverride != null) claimed.value = String(existing.claimedOverride)
  void updateRate(true)
  refreshReport()

  // ---- file handling and pre-fill
  async function showPreview(f: Blob) {
    preview.replaceChildren()
    if (isPdf(f)) {
      try {
        const c = await renderPdfPage(f, 700)
        preview.append(c)
      } catch {
        preview.append(h('p', { class: 'muted' }, 'PDF attached.'))
      }
    } else {
      preview.append(h('img', { src: URL.createObjectURL(f), alt: 'Receipt preview' }))
    }
  }

  function applyGuess(text: string) {
    const g = guessFields(text)
    const set = (name: string, el: HTMLInputElement | HTMLSelectElement, v: string | undefined) => {
      if (v !== undefined && !touched.has(name)) el.value = v
    }
    set('date', date, g.date)
    set('payee', payee, g.payee)
    set('place', place, g.place)
    set('type', type, g.type)
    set('ref', ref, g.ref)
    if (g.currency && [...currency.options].some((o) => o.value === g.currency)) set('currency', currency, g.currency)
    set('amount', amount, g.amount?.toFixed(currencyDigits(currency.value)))
    if (!touched.has('description') && g.payee) description.value = g.payee
    suggestReport()
    void updateRate()
    const found = [g.date, g.amount, g.payee, g.place, g.ref].filter((x) => x !== undefined).length
    status.replaceChildren(notice(found ? 'info' : 'warn', found ? 'Fields pre-filled from the receipt. Please check them.' : 'Could not read much from this receipt. Please fill in the fields.'))
  }

  async function onFile(raw: File | undefined) {
    if (!raw) return
    error.replaceChildren()
    const pdf = raw.type === 'application/pdf' || raw.name.toLowerCase().endsWith('.pdf')
    try {
      file = pdf ? new Blob([await raw.arrayBuffer()], { type: 'application/pdf' }) : await normaliseImage(raw)
    } catch {
      status.replaceChildren(notice('error', 'Could not open that file. Use a PDF, JPG or PNG.'))
      return
    }
    fileName = raw.name
    void showPreview(file)
    status.replaceChildren(notice('info', 'Reading receipt…'))
    try {
      applyGuess(await extractText(file, pdf, (msg, p) => status.replaceChildren(notice('info', p !== undefined ? `${msg} ${Math.round(p * 100)}%` : `${msg}…`))))
    } catch (e) {
      status.replaceChildren(notice('warn', `Automatic reading failed (${e instanceof Error ? e.message : e}). Please fill in the fields.`))
    }
  }

  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: () => onFile(camera.files?.[0]) })
  const picker = h('input', { type: 'file', accept: 'image/*,application/pdf,.pdf', onchange: () => onFile(picker.files?.[0]) })
  const chooser = h(
    'div',
    { class: 'row' },
    h('button', { class: 'btn quiet', type: 'button', onclick: () => camera.click() }, 'Take photo'),
    h('button', { class: 'btn quiet', type: 'button', onclick: () => picker.click() }, 'Choose PDF or image'),
    camera,
    picker,
  )
  if (file) void showPreview(file)

  // ---- save
  async function save(another: boolean) {
    error.replaceChildren()
    const fail = (m: string) => void error.append(notice('error', m))
    if (!file) return fail('Attach a receipt first.')
    if (!date.value) return fail('Enter the receipt date.')
    if (!Number.isFinite(num()) || num() <= 0) return fail('Enter the receipt amount.')
    let reportId = reportSel.value
    if (!reportId) return fail('Choose a report for this receipt.')
    if (reportId === NEW_REPORT) {
      if (!newName.value.trim() || !newFrom.value || !newTo.value || newTo.value < newFrom.value) return fail('Give the new report a name and a valid date range.')
      reportId = uid()
      await saveReport({ id: reportId, name: newName.value.trim(), from: newFrom.value, to: newTo.value, projectRef: '', invoiced: '', createdAt: Date.now(), currency: newCurrency.value })
    }
    const auto = computedClaim()
    const claim = Number(claimed.value)
    const receipt: Receipt = {
      id: existing?.id ?? uid(),
      reportId,
      date: date.value,
      payee: payee.value.trim(),
      place: place.value.trim(),
      description: description.value.trim(),
      type: type.value,
      ref: ref.value.trim(),
      amount: roundTo(num(), currencyDigits(currency.value)),
      currency: currency.value,
      fx: foreign() ? fx : null,
      claimedOverride: claimTouched && claimed.value !== '' && claim !== auto ? claim : null,
      file,
      fileName,
      addedAt: existing?.addedAt ?? Date.now(),
    }
    await saveReceipt(receipt)
    try {
      localStorage.setItem(LAST_CURRENCY, receipt.currency)
    } catch {
      /* Storage refused: the picker starts at USD next time. */
    }
    go(another ? `/receipt/new?report=${reportId}&n=${Date.now()}` : `/report/${reportId}`)
  }

  // Save and delete; asking "Delete this receipt?" takes over the whole bar.
  const savebar = h(
    'div',
    { class: 'savebar' },
    h('button', { class: 'btn', type: 'submit' }, 'Save'),
    existing ? null : h('button', { class: 'btn quiet', type: 'button', onclick: () => void save(true) }, 'Save & add another'),
    existing
      ? h(
          'button',
          {
            class: 'btn danger',
            type: 'button',
            onclick: () =>
              askFirst(savebar, 'Delete this receipt? This cannot be undone.', 'Delete receipt', async () => {
                await deleteReceipt(existing.id)
                go(`/report/${existing.reportId}`)
              }),
          },
          'Delete',
        )
      : null,
  )

  const form = h(
    'form',
    { class: 'stack', onsubmit: (e: Event) => { e.preventDefault(); void save(false) } },
    card('Receipt', [chooser, preview, status]),
    card('Details', [
      h('div', { class: 'pair' }, field('Date', date), field('Type', type)),
      h('div', { class: 'pair' }, field('Payee', payee), field('Place', place)),
      field('Description', description, 'Printed in the Description column.'),
      field('Invoice / receipt number', ref),
    ]),
    card('Amount', [
      h('div', { class: 'field' }, h('span', { class: 'kicker' }, 'Receipt total'), h('div', { class: 'amount-pair' }, amount, currency), h('span', { class: 'hint' }, 'As printed on the receipt, in its own currency.')),
      rateField,
      h('label', { class: 'field' }, claimLabel, claimed, h('span', { class: 'hint' }, claimHint)),
    ]),
    card('Report', [field('Report', reportSel), reportBox]),
    error,
    savebar,
  )
  const back = existing ? existing.reportId : preset
  const backName = reports.find((r) => r.id === back)?.name
  return shell({ title: existing ? 'Edit receipt' : 'Add receipt', back: back && backName ? [`/report/${back}`, backName] : ['/', 'Reports'] }, [form])
}
