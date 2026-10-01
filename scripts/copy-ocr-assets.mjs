// Copies the Tesseract worker, wasm cores and English model into public/ocr so the
// app can run OCR fully offline (and the service worker can precache them).
import { cpSync, mkdirSync, readdirSync } from 'node:fs'

const out = 'public/ocr'
mkdirSync(out, { recursive: true })
cpSync('node_modules/tesseract.js/dist/worker.min.js', `${out}/worker.min.js`)
for (const f of readdirSync('node_modules/tesseract.js-core')) {
  if (f.includes('lstm') && f.endsWith('.wasm.js')) cpSync(`node_modules/tesseract.js-core/${f}`, `${out}/${f}`)
}
cpSync('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${out}/eng.traineddata.gz`)
console.log('OCR assets copied to', out)
