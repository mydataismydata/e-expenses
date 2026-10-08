# Expense Reports

Offline-first web app (PWA) that builds expense reports from receipts.

- Create reports by date range (name, from/to, currency, optional project reference and "Invoiced"). A new report starts in the currency of the last report you made, or USD.
- Add a receipt by camera or PDF/JPG/PNG. Type, payee, place, date, amount, currency and invoice number are guessed (PDF text layer first, on-device OCR for photos and scanned PDFs). You always review the guesses.
- A photo from the camera opens in a crop box first: drag the corners and edges to the receipt, turn it with **Rotate**, or retake it. Any attached image can be cropped again from its preview. The app reads the receipt after cropping, so the background doesn't confuse it.
- For **Taxi** and **Mileage allowances**, From and To fields open under the type. The description fills itself in as the payee and the route ("Uber CDG to Paris office") until you type your own.
- **Mileage allowances** are claimed at the IRS rate per mile for the trip date. Paste a directions link from Google Maps, OpenStreetMap or Apple Maps, or type two addresses in From and To, and press **Find route**. The app gets the driving distance, sets the amount (miles × rate, in USD) and draws a map of the route as the receipt. You can also type the miles and attach your own screenshot. See **Mileage**.
- Receipts can be in any currency. A receipt in the report's currency is used as printed. Any other is converted into the report's currency with the exchange rate of the receipt date (see **Exchange rates**). You can type a different rate on any receipt.
- The receipt goes into the report whose dates contain the receipt date. If several reports overlap that date it asks which one; if none match it offers to create one.
- Per-type maximum claim (Settings). Defaults: Internet fees 70, Phone fees 40. A maximum is an amount in each report's own currency: 70 is $70 on a USD report and €70 on a EUR report. The receipt total is kept; the claimed amount is capped after conversion, and can be overridden on a receipt.
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

A template is filled by editing the sheet XML directly, so formatting, the table, the drop-downs and the logo are untouched. More than 20 receipts grow the table and push the totals/signature block down. A file is accepted only if it has the original layout: header cells in rows 3–4, the expense table at `A6:J27` with its total in `G27`. Each row gets the claimed amount, in the report's currency, in the amount column, and the receipt's currency in **Currency**. A converted receipt also fills **Rate** (report currency per unit of the receipt's currency) and **Amount (local currency)**.

Pick a template whose amount column matches the report's currency: the US form formats amounts with "$". The report page warns when the template's symbol and the report's currency differ.

To run the Excel tests, copy one or more templates into `templates/`. `npm test` fills each of them; without any, those tests are skipped.

### Exchange rates

Rates come from [Frankfurter](https://frankfurter.dev) (free, no key, CORS enabled). When the European Central Bank quotes both the receipt's and the report's currency (~30 currencies), the app uses the ECB's daily reference rate for the receipt date. Other pairs get Frankfurter's average of central-bank rates for that date. A weekend or holiday gets the last rate published before it.

The rate is looked up when the receipt is entered. Offline, the receipt is saved with its rate pending; the report fetches it next time it is opened online, and export asks for it first. A receipt saved before that day's rate was published is looked up again for a week. Rates typed by hand are kept until the report's currency changes. Changing a report's currency, or moving a receipt to a report in another currency, converts the receipts again; amounts to claim typed by hand stay as typed.

### Mileage

The IRS business rates are in `IRS_RATES` in `src/mileage.ts`, by the date each took effect (2026 changed on July 1). Add each new rate when the IRS announces it. A trip in a year the table does not cover uses the newest rate, and the form says so.

Find route uses three free OpenStreetMap services, all called from the browser without a key:
- **Directions links** give the exact points. A Google link copied from the address bar works. A short share link (maps.app.goo.gl) does not: a web page cannot see where it leads.
- **Place search** ([Nominatim](https://nominatim.org)) finds typed addresses and links that only name the places. It allows one search a second.
- **Road distance** comes from the [OSRM](https://project-osrm.org) demo server, the same engine as openstreetmap.org's car directions. It can differ a little from Google's distance.
- **The map** is drawn from openstreetmap.org tiles, with the attribution printed under it.

These services see the addresses or points of the trip. Nothing else leaves the device.

`.working/` (sample report and receipt) is git-ignored because it holds personal data.

## Deploy: GitHub + Cloudflare

Cloudflare (Workers Builds, project `e-expenses`) is connected to this repository. Every push to `main` builds the app and deploys it; the result shows as a check on the commit in GitHub. The build command is `npm run build` and the output folder is `dist`.

There is no login. The site serves only the app code, which is public here anyway. Reports, receipts and Excel templates never leave the device. Exchange-rate lookups send currencies and dates; Find route sends the trip's places (see **Mileage**).

**Install on the phone** – open the URL in Chrome on Android, wait for the first load to finish (about 17 MB is cached for offline use), then menu → *Install app*. After that it works in airplane mode.

Notes:
- Once installed the app is served from the on-device cache. New versions download when you are online and show a "Reload" bar.
- Clearing site data or uninstalling the app deletes the local database. Restore from a backup ZIP.

## Limits

- OCR is best-effort: dates and totals are usually right, payee and place less so. Check the pre-filled fields. A receipt that names a non-US currency (€, £, EUR, CHF…) is read with day-first dates and decimal commas.
