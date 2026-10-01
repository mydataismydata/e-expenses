# Expense Reports

Offline-first web app (PWA) that builds expense reports from receipts.

- Create reports by date range (name, from/to, optional project reference and "Invoiced").
- Add a receipt by camera or PDF/JPG/PNG. Type, payee, place, date, amount and invoice number are guessed (PDF text layer first, on-device OCR for photos and scanned PDFs). You always review the guesses.
- The receipt goes into the report whose dates contain the receipt date. If several reports overlap that date it asks which one; if none match it offers to create one.
- Per-type maximum claim (Settings). Defaults: Internet fees $70, Phone fees $40. The receipt total is kept; the claimed amount is capped, and can be overridden on a receipt.
- **Export** gives one ZIP containing the filled Excel template and one PDF per receipt named `NN - YYYY-MM <invoice number or payee>.pdf`, where `NN` is the row on the report. JPG/PNG photos are wrapped in a PDF.
- Everything runs in the browser. Data is stored in IndexedDB on the device; there is no server. Use **Settings → Download backup** regularly.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # parsing, naming, Excel filling
npm run build      # outputs dist/
npm run preview    # serve dist/ (service worker active)
```

`npm run dev` / `build` first copy the Tesseract engine and English model from `node_modules` into `public/ocr` (git-ignored) so OCR works offline.

The Excel template lives in `src/assets/ExpenseReportForm_Template_US.xlsx`. It is filled by editing the sheet XML directly, so formatting, the `Tableau1` table, the drop-downs and the logo are untouched. More than 20 receipts grow the table and push the totals/signature block down.

`.working/` (sample report and receipt) is git-ignored because it holds personal data.

## Deploy: private GitHub repo + Cloudflare Pages + Access

1. **GitHub** – create a private repository and push this folder (`git remote add origin …`, `git push -u origin main`).
2. **Cloudflare Pages** – Dashboard → Workers & Pages → Create → Pages → Connect to Git. Authorise the Cloudflare GitHub app for the private repo, then:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `22`
3. **Lock it down with Cloudflare Access** – Pages project → Settings → General → *Access policy* → Enable (this creates an Access application for `<project>.pages.dev` and its preview URLs), or do it by hand in Zero Trust → Access → Applications → Self-hosted. Add an *Allow* policy for your email address(es) with the One-time PIN login method.
4. **Install on the phone** – open the URL in Chrome on Android, sign in, wait for the first load to finish (about 17 MB is cached for offline use), then menu → *Install app*. After that it works in airplane mode.

Notes:
- The manifest is requested with credentials (`crossorigin="use-credentials"`) so installation works behind Access.
- Because the app is cached, an expired Access session does not lock you out offline. New versions download when you are online and show a "Reload" bar.
- Clearing site data or uninstalling the app deletes the local database. Restore from a backup ZIP.

## Limits

- USD only; the template's Currency/Rate/local-amount columns are left blank.
- OCR is best-effort: dates and totals are usually right, payee and place less so. Check the pre-filled fields.
