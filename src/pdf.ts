import { PDFDocument } from 'pdf-lib'

const LETTER = { w: 612, h: 792 }
const MARGIN = 24

/** Wrap a JPEG or PNG in a one-page PDF, scaled to fit a Letter page (landscape images get a landscape page). */
export async function imageToPdf(bytes: Uint8Array, kind: 'jpg' | 'png'): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const img = kind === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
  const landscape = img.width > img.height
  const pw = landscape ? LETTER.h : LETTER.w
  const ph = landscape ? LETTER.w : LETTER.h
  const scale = Math.min((pw - 2 * MARGIN) / img.width, (ph - 2 * MARGIN) / img.height, 1)
  const w = img.width * scale
  const h = img.height * scale
  const page = doc.addPage([pw, ph])
  page.drawImage(img, { x: (pw - w) / 2, y: ph - MARGIN - h, width: w, height: h })
  return doc.save()
}
