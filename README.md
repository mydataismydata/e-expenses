# Expense Reports

Offline-first web app (PWA) that builds expense reports from receipts.

- Create reports by date range (name, from/to, optional project reference and "Invoiced").
- Add a receipt by camera or PDF/JPG/PNG. Type, payee, place, date, amount, currency and invoice number are guessed (PDF text layer first, on-device OCR for photos and scanned PDFs). You always review the guesses.
- Receipts can be in any currency. The amount is converted to US dollars with the exchange rate of the receipt date (see **Exchange rates**). You can type a different rate on any receipt.
- The receipt goes into the report whose dates contain the receipt date. If several reports overlap that date it asks which one; if none match it offers to create one.
- Per-type maximum claim (Settings), in US dollars. Defaults: Internet fees $70, Phone fees $40. The receipt total is kept; the claimed amount is capped after conversion, and can be overridden on a receipt.
- **Export** gives one ZIP containing the filled Excel template and one PDF per receipt named `NN - YYYY-MM <invoice number or payee>.pdf`, where `NN` is the row on the report. JPG/PNG photos are wrapped in a PDF.
- The Excel template is not part of the app. Add one or more in **Settings → Excel templates** (or from a report's export box) with a file picker, for example the US and the French form. They are kept on the device and in backups. Each report can use a different template; the first one added is the default.
- The look is the Clean grids design template in its indigo palette, with light and dark themes (**Settings → Appearance**). See `src/styles/clean-grids/README.md`.
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

### Excel templates

Templates never go in this repository (`templates/` and `*.xlsx` are git-ignored). The app takes them from the user with a file picker and stores them in IndexedDB.

A template is filled by editing the sheet XML directly, so formatting, the table, the drop-downs and the logo are untouched. More than 20 receipts grow the table and push the totals/signature block down. A file is accepted only if it has the original layout: header cells in rows 3–4, the expense table at `A6:J27` with its total in `G27`. Each row gets the claimed US dollars in **Amount $**; a foreign receipt also fills **Currency**, **Rate** (US dollars per unit) and **Amount (local currency)**.

To run the Excel tests, copy one or more templates into `templates/`. `npm test` fills each of them; without any, those tests are skipped.

### Exchange rates

Rates come from [Frankfurter](https://frankfurter.dev) (free, no key, CORS enabled). For the ~30 currencies the European Central Bank quotes, the app uses the ECB's daily reference rate for the receipt date. Other currencies get Frankfurter's average of central-bank rates for that date. A weekend or holiday gets the last rate published before it.

The rate is looked up when the receipt is entered. Offline, the receipt is saved with its rate pending; the report fetches it next time it is opened online, and export asks for it first. A receipt saved before that day's rate was published is looked up again for a week. Rates typed by hand are never replaced.

`.working/` (sample report and receipt) is git-ignored because it holds personal data.

## Deploy: private GitHub repo + Cloudflare Pages + Access

1. **GitHub** – create a private repository and push this folder (`git remote add origin …`, `git push -u origin main`).
2. **Cloudflare Pages** – Dashboard → Workers & Pages → Create → Pages → Connect to Git. Authorise the Cloudflare GitHub app for the private repo, then:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `22`
3. **Login gate (free, no card)** – `functions/_middleware.ts` is a Cloudflare Pages Function that asks for a username and password before serving anything. Set the credentials in the Pages project → Settings → Variables and Secrets (add them for both Production and Preview): `APP_USER` and `APP_PASSWORD` (type *Secret*). If either is missing the site returns 503 instead of serving. (Cloudflare Access is the alternative, but it needs a card on file.)
4. **Install on the phone** – open the URL in Chrome on Android, sign in with the login, wait for the first load to finish (about 17 MB is cached for offline use), then menu → *Install app*. After that it works in airplane mode.

Notes:
- The manifest is requested with credentials (`crossorigin="use-credentials"`) so installation works behind the login.
- Once installed the app is served from the on-device cache, so it never asks for the login again offline. Changing the password only affects new devices and updates. New versions download when you are online and show a "Reload" bar.
- Clearing site data or uninstalling the app deletes the local database. Restore from a backup ZIP.

## Limits

- Reports are in US dollars. Other currencies are converted, never the other way round.
- OCR is best-effort: dates and totals are usually right, payee and place less so. Check the pre-filled fields. A receipt that names a non-US currency (€, £, EUR, CHF…) is read with day-first dates and decimal commas.
