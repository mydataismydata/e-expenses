import { claimedAmount, matchingReports } from '../claim'
import { deleteReceipt, getReceipt, getSettings, listReports, saveReceipt, saveReport, uid } from '../db'
import { fmtDate, h, money, monthBounds } from '../dom'
import { isPdf } from '../export'
import { extractText, normaliseImage, renderPdfPage } from '../extract'
import { guessFields } from '../parse'
import { EXPENSE_TYPES, type Receipt } from '../types'
import { field, go, notice, shell } from './shell'

const NEW_REPORT = '__new__'

/** Add (no id) or edit (id) a receipt. */
export async function receiptFormPage(id: string | undefined, presetReportId: string | null): Promise<HTMLElement> {
  const [settings, reports, existing] = await Promise.all([getSettings(), listReports(), id ? getReceipt(id) : Promise.resolve(undefined)])
  if (id && !existing) return shell('Not found', '/', [notice('error', 'This receipt no longer exists.')])

  let file: Blob | undefined = existing?.file
  let fileName = existing?.fileName ?? ''
  const touched = new Set<string>(existing ? ['date', 'payee', 'place', 'description', 'type', 'ref', 'amount', 'report'] : [])
  let claimTouched = existing?.claimedOverride != null

  // ---- inputs
  const input = (name: string, props: Record<string, unknown>) =>
    h('input', { ...props, oninput: () => touched.add(name) })
  const date = input('date', { type: 'date', required: true, value: existing?.date ?? '' })
  const payee = input('payee', { type: 'text', value: existing?.payee ?? '', placeholder: 'Who was paid' })
  const place = input('place', { type: 'text', value: existing?.place ?? '', placeholder: 'City, ST, USA' })
  const description = input('description', { type: 'text', value: existing?.description ?? '', placeholder: 'Short description' })
  const ref = input('ref', { type: 'text', value: existing?.ref ?? '', placeholder: 'Used in the file name when present' })
  const amount = input('amount', { type: 'number', required: true, min: 0, step: '0.01', inputmode: 'decimal', value: existing?.amount?.toString() ?? '' })
  const type = h('select', { onchange: () => touched.add('type') }, ...EXPENSE_TYPES.map((t) => h('option', { value: t, selected: t === (existing?.type ?? 'Others') }, t)))
  const claimed = h('input', {
    type: 'number', min: 0, step: '0.01', inputmode: 'decimal',
    oninput: () => { claimTouched = true; refreshClaim() },
  })
  const reportSel = h('select', { onchange: () => { touched.add('report'); refreshReport() } })
  const newName = h('input', { type: 'text', placeholder: 'Name of the new report' })
  const newFrom = h('input', { type: 'date' })
  const newTo = h('input', { type: 'date' })
  const reportBox = h('div')
  const claimHint = h('span')
  const status = h('div')
  const preview = h('div', { class: 'preview' })
  const error = h('div')

  const num = () => (amount.value === '' ? NaN : Number(amount.value))
  const computedClaim = () => (Number.isFinite(num()) ? claimedAmount({ amount: num(), type: type.value, claimedOverride: null }, settings.caps) : NaN)

  function refreshClaim() {
    const auto = computedClaim()
    if (!claimTouched && Number.isFinite(auto)) claimed.value = String(auto)
    const cap = settings.caps[type.value]
    claimHint.textContent =
      cap !== undefined
        ? `${type.value} is limited to ${money(cap)}.${claimTouched && Number(claimed.value) !== auto ? ' Amount overridden by hand.' : ''}`
        : claimTouched && Number(claimed.value) !== auto ? 'Amount overridden by hand.' : 'Defaults to the receipt total.'
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
      reportBox.append(field('New report name', newName), h('div', { class: 'row2' }, field('From', newFrom), field('To', newTo)))
    } else if (!date.value) {
      reportBox.append(h('small', { class: 'hint' }, 'The report is suggested once the date is known.'))
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
  date.addEventListener('input', suggestReport)
  amount.addEventListener('input', refreshClaim)
  type.addEventListener('change', refreshClaim)
  refreshClaim()
  if (existing?.claimedOverride != null) claimed.value = String(existing.claimedOverride)
  refreshClaim()
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
    set('amount', amount, g.amount?.toFixed(2))
    if (!touched.has('description') && g.payee) description.value = g.payee
    suggestReport()
    refreshClaim()
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

  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: () => onFile(camera.files?.[0]) })
  const picker = h('input', { type: 'file', accept: 'image/*,application/pdf,.pdf', hidden: true, onchange: () => onFile(picker.files?.[0]) })
  const chooser = h(
    'div',
    { class: 'actions' },
    h('button', { class: 'btn primary', type: 'button', onclick: () => camera.click() }, '📷 Take photo'),
    h('button', { class: 'btn', type: 'button', onclick: () => picker.click() }, '📄 Choose PDF / image'),
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
      await saveReport({ id: reportId, name: newName.value.trim(), from: newFrom.value, to: newTo.value, projectRef: '', invoiced: '', createdAt: Date.now() })
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
      amount: Math.round(num() * 100) / 100,
      claimedOverride: claimTouched && claimed.value !== '' && claim !== auto ? claim : null,
      file,
      fileName,
      addedAt: existing?.addedAt ?? Date.now(),
    }
    await saveReceipt(receipt)
    go(another ? `/receipt/new?report=${reportId}&n=${Date.now()}` : `/report/${reportId}`)
  }

  const form = h(
    'form',
    { onsubmit: (e: Event) => { e.preventDefault(); void save(false) } },
    chooser,
    preview,
    status,
    field('Date', date),
    field('Type', type),
    field('Payee', payee),
    field('Place', place),
    field('Description', description, 'Printed in the Description column.'),
    field('Invoice / receipt number', ref),
    field('Receipt total ($)', amount),
    field('Amount to claim ($)', claimed, claimHint),
    field('Report', reportSel),
    reportBox,
    error,
    h(
      'div',
      { class: 'actions sticky' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      existing ? null : h('button', { class: 'btn', type: 'button', onclick: () => void save(true) }, 'Save & add another'),
      existing
        ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (confirm('Delete this receipt?')) { await deleteReceipt(existing.id); go(`/report/${existing.reportId}`) } } }, 'Delete')
        : null,
    ),
  )
  return shell(existing ? 'Edit receipt' : 'Add receipt', existing ? `/report/${existing.reportId}` : preset ? `/report/${preset}` : '/', [form])
}
