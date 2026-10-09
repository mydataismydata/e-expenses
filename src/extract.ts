import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { createWorker, type Worker } from 'tesseract.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Progress = (message: string, fraction?: number) => void

let ocrWorker: Promise<Worker> | undefined
let onProgress: Progress | undefined

function getOcr(): Promise<Worker> {
  ocrWorker ??= createWorker('eng', 1, {
    workerPath: `${import.meta.env.BASE_URL}ocr/worker.min.js`,
    corePath: `${import.meta.env.BASE_URL}ocr`,
    langPath: `${import.meta.env.BASE_URL}ocr`,
    gzip: true,
    workerBlobURL: false,
    logger: (m) => onProgress?.('Reading text', m.status === 'recognizing text' ? m.progress : undefined),
  })
  return ocrWorker
}

/** Shrink and re-encode a photo as JPEG (applies EXIF rotation) so stored receipts stay small. */
export async function normaliseImage(file: Blob, maxSide = 2200): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), 'image/jpeg', 0.85))
}

async function ocr(image: Blob | HTMLCanvasElement): Promise<string> {
  const w = await getOcr()
  const { data } = await w.recognize(image as never)
  return data.text
}

/** The open document, and its loading task, which frees the document when destroyed. */
async function openPdf(file: Blob) {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  return { task, doc: await task.promise }
}

async function drawPage(doc: pdfjs.PDFDocumentProxy, n: number, width: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
  return canvas
}

/** Render page 1 of a PDF to a canvas (for scanned PDFs that need OCR). */
export async function renderPdfPage(file: Blob, width = 900): Promise<HTMLCanvasElement> {
  const { task, doc } = await openPdf(file)
  try {
    return await drawPage(doc, 1, width)
  } finally {
    void task.destroy()
  }
}

/** A PDF kept open to draw pages on demand, numbered from 1. Call close() when done. */
export async function pdfPages(file: Blob): Promise<{ count: number; draw: (n: number, width: number) => Promise<HTMLCanvasElement>; close: () => void }> {
  const { task, doc } = await openPdf(file)
  return { count: doc.numPages, draw: (n, width) => drawPage(doc, n, width), close: () => void task.destroy() }
}

/** Draws the pages of a PDF in order, up to `max`, handing each canvas to `onPage` as soon as it is ready. Returns the page count. */
export async function renderPdfPages(file: Blob, width: number, max: number, onPage: (canvas: HTMLCanvasElement, n: number, total: number) => void): Promise<number> {
  const { task, doc } = await openPdf(file)
  try {
    for (let n = 1; n <= Math.min(doc.numPages, max); n++) onPage(await drawPage(doc, n, width), n, doc.numPages)
    return doc.numPages
  } finally {
    void task.destroy()
  }
}

async function pdfText(file: Blob): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const out: string[] = []
  for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    // Group text fragments into visual lines by their vertical position.
    const rows = new Map<number, { x: number; s: string }[]>()
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue
      const y = Math.round(it.transform[5] / 3)
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 1) ?? y
      rows.set(key, [...(rows.get(key) ?? []), { x: it.transform[4], s: it.str }])
    }
    for (const [, items] of [...rows].sort((a, b) => b[0] - a[0])) out.push(items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' '))
  }
  return out.join('\n')
}

/** Text of a receipt: the PDF text layer when present, otherwise OCR. */
export async function extractText(file: Blob, isPdf: boolean, progress: Progress): Promise<string> {
  onProgress = progress
  progress('Reading text')
  if (isPdf) {
    const text = await pdfText(file)
    if (text.replace(/\s/g, '').length > 30) return text
    progress('Scanned PDF, running OCR')
    return ocr(await renderPdfPage(file, 1600))
  }
  return ocr(file)
}
