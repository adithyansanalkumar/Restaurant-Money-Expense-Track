# Restaurant Money App Implementation Plan

> Note: this plan was written when the app lived in a `resto-app/` folder of another repository. In this repository, `resto-app/web` is `web/` and `resto-app/worker` is `worker/`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the private, installable restaurant money app (PWA) described in the approved design: expenses, collections, supplier credit, reading bills from photos, profit graphs, Excel export, and Google Drive sync between an iPhone and an Android phone.

**Architecture:** A static React + TypeScript web app, installable on the home screen and working offline. All data lives in IndexedDB on each phone. Sync merges per-record changes into one `ledger.json` file in the owner's Google Drive folder, using the "newest change wins" rule. A tiny Cloudflare Worker keeps Google sign-in alive (it holds refresh tokens, encrypted) and never sees restaurant data. Pure domain modules (money, totals, credit, merge, receipt parsing) carry most of the logic and the tests; screens stay thin.

**Tech Stack:**
- App: Vite 5, React 18, TypeScript 5 (strict).
- Offline and storage: `vite-plugin-pwa` (Workbox), Dexie 4 (IndexedDB).
- Tests: Vitest, `fake-indexeddb`, `@testing-library/react`, Playwright (one smoke test).
- Bill reading: `tesseract.js` 5 (languages `fra` + `eng`, loaded on first use).
- Excel: `write-excel-file`.
- Google: Google Identity Services (code flow), Drive REST v3 via `fetch`, Google Picker.
- Sign-in helper: Cloudflare Workers + Workers KV (free tier); deploy with `wrangler`.
- Hosting: Cloudflare Pages (free).

**Spec:** `drafts/restaurant-money-app-design.md` (approved 2026-11-26). The approved screens are the `V2…` artboards at https://claude.ai/artifact/STGngUebSGc9pBfTRL3kkX.

**Where the code lives (Claude's call):** a new folder `resto-app/` in this repository (the repo already holds code in `veille/`). Its layout:
- `resto-app/web/`: the app.
- `resto-app/worker/`: the sign-in helper.
- `resto-app/README.md`: setup and install steps.

## Global Constraints

- Running cost €0: no paid service, no database we run. Only the sign-in helper runs on our side, and it stores only encrypted Google refresh tokens.
- Works offline. Every write goes to IndexedDB first, and sync is best-effort afterwards.
- Money is stored as integer minor units (cents). Never use floats for stored amounts.
- Google scopes are exactly `openid email https://www.googleapis.com/auth/drive.file`.
- Drive layout:
  - Folder `Restaurant Accounts` holds `ledger.json`, a subfolder `Exports`, and a subfolder `Bills` (used only when photo backup is on).
- Bill photos stay on the phone unless the setting "Also back up bill photos to Google Drive" is on (off by default).
- Profit counts expenses by **bill date**. "Cash paid out" counts payments by **payment date**.
- Tax view setting:
  - `incl` shows amounts including tax (TTC / grand total). This is the default.
  - `excl` shows amounts excluding tax (HT / subtotal), and falls back to the including-tax amount (marked) when no excluding-tax amount is known.
- Partial supplier payments are applied to the oldest unpaid bill first.
- Languages at launch are English and French. Every user-visible string goes through `t()`.
- Visual design follows the approved v2 screens:
  - Palette: navy `#1B365D`, blue `#005A9C`, sky `#60C1E5`, pale `#A0E0EF`.
  - Background scene: `#14305A` → `#0A1B33`.
  - Money in `#6FE3A0`, money out `#FF8E8E`, always with a + / − sign or an In / Out label.
  - Fonts: Inter and Inter Tight.
  - Tab bar: Home · Bills · (+) · Reports · Settings. History opens from "See all" on Home.
- Touch targets are at least 44px. Logging an expense from the + button takes at most 4 taps after typing the amount (supplier, category pre-filled, save).
- The app lock auto-locks after 3 minutes in the background.

## Review Focus

1. **French decimal input:** `184,50`, `1 280,00` and `1.280,50` must all parse to the right cents. A wrong parse silently corrupts profit. Pinned in Task 2.
2. **Two phones changing the same record offline:** an edit on one phone and a delete on the other. The newest change wins, and no other record is lost or duplicated. Pinned in Task 14.
3. **Bill reading finds several totals, or none:** a receipt with `Total HT`, `TVA` and `TOTAL TTC` must pre-fill TTC = the TTC line. A receipt with no recognisable total leaves the amount empty and can't be saved without one. Pinned in Task 11.
4. **Overpaying a supplier:** a payment larger than what's owed is refused with a message. Zero or negative payments are refused. Pinned in Task 5.
5. **Sign-in expired or offline during sync:** entries stay saved locally, the status shows "Not synced", and the next sync retries with no duplicates. Pinned in Task 14.

---

### Task 1: App skeleton, glass theme and tab bar

**Files:**
- Create: `resto-app/web/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/ui/theme.css`, `src/ui/Glass.tsx`, `src/ui/TabBar.tsx`, `src/ui/router.ts`, `public/icons/` (192/512 px PNG + maskable)
- Test: `resto-app/web/src/ui/TabBar.test.tsx`

**Interfaces:**
- Produces:
  - `type Route = 'home'|'bills'|'add'|'reports'|'settings'|'history'|'owe'|'setup'|'lock'`
  - `useRoute(): [Route, (r: Route) => void]` (hash-based)
  - `<Glass as? className? strong?>`
  - `<TabBar current={Route} onGo={(r) => void}/>`
  - CSS variables in `theme.css`: `--navy --blue --sky --pale --in --out --text --label --scene`, plus classes `.scene .glass .glass-bar .key`

- [ ] **Step 1:** Scaffold Vite React TS and add the dependencies listed in Tech Stack. Configure `vite-plugin-pwa` with:
  - name "Restaurant Money", `display: 'standalone'`, `theme_color: '#14305A'`, `background_color: '#0A1B33'`
  - offline precache of the app shell.
- [ ] **Step 2: Write the failing test**
```tsx
test('tab bar shows 4 labelled tabs and a central add button', () => {
  const go = vi.fn();
  render(<TabBar current="home" onGo={go} />);
  expect(screen.getAllByRole('link').map(a => a.textContent)).toEqual(['Home','Bills','','Reports','Settings']);
  fireEvent.click(screen.getByLabelText('Add'));
  expect(go).toHaveBeenCalledWith('add');
});
```
- [ ] **Step 3:** Run `npm test -- TabBar` and confirm it fails with "Cannot find module".
- [ ] **Step 4:** Implement `theme.css` with the values from the V2 artboards' `.scene`, `.glass` and `.bar` styles (copy them exactly), plus `Glass`, `TabBar` and `router`. Add an `@supports not (backdrop-filter: blur(1px))` fallback that uses `rgba(255,255,255,.14)`.
- [ ] **Step 5:** Run `npm test` and `npm run build`. Expected: PASS, and `dist/manifest.webmanifest` exists.
- [ ] **Step 6:** Commit: `feat(resto): app skeleton with glass theme and tab bar`

### Task 2: Money, types and defaults

**Files:**
- Create: `resto-app/web/src/domain/types.ts`, `money.ts`, `defaults.ts`
- Test: `resto-app/web/src/domain/money.test.ts`

**Interfaces:**
- Produces (`types.ts`):
```ts
type Id = string; type Cents = number; type ISODate = string /* YYYY-MM-DD */;
interface Base { id: Id; updatedAt: number; deviceId: string; deleted: boolean }
interface Entry extends Base { kind: 'expense'|'income'; date: ISODate; amountIncl: Cents; amountExcl?: Cents; tax?: Cents;
  categoryId: Id; supplierId?: Id; channel?: string; method: 'cash'|'card'|'transfer'|'other';
  status?: 'paid'|'credit'; dueDate?: ISODate; note?: string; photoId?: Id; createdBy: string }
interface Payment extends Base { entryId: Id; date: ISODate; amount: Cents; method: Entry['method']; createdBy: string }
interface Supplier extends Base { name: string; defaultCategoryId?: Id }
interface Category extends Base { name: string; kind: 'expense'|'income'; archived: boolean }
interface SharedSettings extends Base { restaurantName: string; country: string; currency: string; billLanguage: 'fra'|'eng';
  taxView: 'incl'|'excl'; photoBackup: boolean; ocrMode: 'device'|'gemini' }
```
- Produces (`money.ts`):
  - `parseAmount(input: string): Cents | null`
  - `formatMoney(c: Cents, currency: string, locale: string, opts?: { sign?: boolean }): string`
- Produces (`defaults.ts`):
  - `DEFAULT_EXPENSE_CATEGORIES: string[]` (the 14 names in spec 8.2, in order)
  - `DEFAULT_INCOME_CHANNELS: string[]` (the 5 in spec 8.2)

- [ ] **Step 1: Write the failing tests**
```ts
test.each([['184,50',18450],['184.50',18450],['1 280,00',128000],['1.280,50',128050],['1,280.50',128050],['0,5',50],['12',1200]])
  ('parseAmount(%s)', (s, c) => expect(parseAmount(s)).toBe(c));
test.each(['', 'abc', '-5', '1,2,3', '12.345.6'])('parseAmount rejects %s', s => expect(parseAmount(s)).toBeNull());
test('formatMoney', () => {
  expect(formatMoney(234000,'EUR','fr-FR',{sign:true}).replace(/\s/g,' ')).toBe('+2 340,00 €');
  expect(formatMoney(-18650,'EUR','en-GB',{sign:true})).toBe('−€186.50');
});
```
- [ ] **Step 2:** Run `npm test -- money` and confirm it fails.
- [ ] **Step 3:** Implement `parseAmount`. The last `,` or `.` followed by 1–2 digits is the decimal separator. Other `.`, `,` and spaces (including NBSP and NNBSP) are thousands separators. Signs aren't allowed. Implement `formatMoney` with `Intl.NumberFormat` and a real minus sign `−`.
- [ ] **Step 4:** Run the tests and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): money parsing, types and defaults`

### Task 3: Local database and repository

**Files:**
- Create: `resto-app/web/src/db/db.ts`, `src/db/repo.ts`, `src/db/device.ts`
- Test: `resto-app/web/src/db/repo.test.ts` (uses `fake-indexeddb/auto`)

**Interfaces:**
- Consumes: Task 2 types
- Produces:
  - `db`: a Dexie database with tables `entries, payments, suppliers, categories, settings, photos, meta`, indexed by `id, updatedAt, date, kind, supplierId, entryId`
  - `getDeviceId(): Promise<string>` (a UUID created once and stored in `meta`)
  - `put<T extends Base>(table, obj: Omit<T,'updatedAt'|'deviceId'|'deleted'> & Partial<Base>): Promise<T>`, which stamps `updatedAt = Date.now()` and `deviceId`
  - `softDelete(table, id): Promise<void>`
  - `listLive<T>(table, filter?): Promise<T[]>`, which excludes `deleted`
  - `seedDefaults(): Promise<void>`, which adds the default categories once

- [ ] **Step 1: Write the failing tests**
  - `put stamps updatedAt and deviceId and is idempotent by id`
  - `softDelete hides from listLive but row still exists with deleted=true and a newer updatedAt`
  - `seedDefaults twice creates 14 expense categories and 5 income channels once`
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3:** Implement. Ask for persistent storage with `navigator.storage?.persist()` on first open.
- [ ] **Step 4:** Run them and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): local IndexedDB repository`

### Task 4: Totals (dashboard and reports maths)

**Files:**
- Create: `resto-app/web/src/domain/totals.ts`
- Test: `resto-app/web/src/domain/totals.test.ts`

**Interfaces:**
- Consumes: `Entry`, `Payment`
- Produces:
  - `shownAmount(e: Entry, view: 'incl'|'excl'): { cents: Cents; fallback: boolean }`
  - `summarize(entries: Entry[], from: ISODate, to: ISODate, view): { in: Cents; out: Cents; profit: Cents; fallbackCount: number }`
  - `series(entries, from, to, bucket: 'day'|'week'|'month', view): { label: string; in: Cents; out: Cents; profit: Cents }[]`
  - `byCategory(entries, from, to, view): { categoryId: Id; cents: Cents; share: number }[]` (sorted descending)
  - `bySupplier(...)`: same shape keyed by `supplierId`
  - `cashOut(payments: Payment[], from, to): Cents`
  - `compare(curr: Cents, prev: Cents): number | null` (fraction, or `null` when `prev` is 0)

- [ ] **Step 1: Write the failing tests** using a fixture of 6 entries spanning 31 Oct–2 Dec, including one credit expense paid in December:
  - `summarize` for November gives `in 980000, out 746000, profit 234000`.
  - The credit expense dated 28 Nov counts in November's `out`. `cashOut` for November excludes its December payment.
  - With `view: 'excl'`, an entry without `amountExcl` uses `amountIncl`, and `fallbackCount` is 1.
  - `compare(234000, 209000)` is about `0.1196`.
  - Deleted entries are ignored.
- [ ] **Step 2:** Run the tests and confirm they FAIL.
- [ ] **Step 3:** Implement. Weeks start on the settings' first day of the week, Monday by default. Pass `weekStart` as an optional final parameter defaulting to 1.
- [ ] **Step 4:** Run the tests and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): totals and report series`

### Task 5: Supplier credit

**Files:**
- Create: `resto-app/web/src/domain/credit.ts`
- Test: `resto-app/web/src/domain/credit.test.ts`

**Interfaces:**
- Produces:
  - `openBills(entries, payments): { entry: Entry; paid: Cents; remaining: Cents }[]`, oldest bill date first
  - `supplierBalances(entries, payments): { supplierId: Id; owed: Cents; bills: number; paidSoFar: Cents; total: Cents }[]`
  - `dueBucket(bill: Entry, today: ISODate): 'overdue'|'thisWeek'|'later'|'none'`
  - `allocatePayment(supplierId, amount: Cents, date: ISODate, method, entries, payments): Payment[] | { error: 'tooMuch'|'notPositive'; owed: Cents }`
  - `paymentsForPaidNow(entry: Entry): Payment[]` (one payment on the bill date for `status: 'paid'`)

- [ ] **Step 1: Write the failing tests**
  - Three unpaid bills of €320, €290 and €170 (12, 19 and 23 Nov).
  - `allocatePayment(..., 40000)` returns payments of 32000 (to the 12 Nov bill) and 8000 (to the 19 Nov bill).
  - Paying 78001 gives `{error:'tooMuch', owed:78000}`. Paying 0 or −5 gives `notPositive`.
  - `dueBucket` with today = 25 Nov: due 20 Nov → `overdue`, due 28 Nov → `thisWeek`, due 7 Dec → `later`, no due date → `none`.
- [ ] **Step 2:** Run the tests and confirm they FAIL.
- [ ] **Step 3:** Implement. "This week" means up to and including the coming Sunday.
- [ ] **Step 4:** Run the tests and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): supplier credit and payment allocation`

### Task 6: Translations, first-run setup and settings store

**Files:**
- Create: `resto-app/web/src/i18n/index.ts`, `en.ts`, `fr.ts`, `src/settings/store.ts`, `src/screens/Setup.tsx`
- Test: `resto-app/web/src/i18n/i18n.test.ts`, `src/screens/Setup.test.tsx`

**Interfaces:**
- Produces:
  - `t(key: keyof typeof en, vars?: Record<string,string|number>): string`
  - `setLanguage('en'|'fr')`, with French falling back to English per key
  - `useSettings(): { shared: SharedSettings|null; device: { appLanguage:'en'|'fr'; weekStart: 0|1 }; saveShared(p: Partial<SharedSettings>): Promise<void>; saveDevice(...) }`
  - `COUNTRY_DEFAULTS: Record<string,{currency:string; locale:string; billLanguage:'fra'|'eng'}>` (at least FR, BE, CH, GB, IN, US)

- [ ] **Step 1: Write the failing tests**
  - An `fr.ts` with a missing key falls back to English.
  - A test asserts that every key in `en` exists in `fr`, listing the missing keys.
  - Setup: choosing country "France" pre-selects EUR and French for the bill language. Continue saves `SharedSettings` with `taxView:'incl'` by default and routes to `home`.
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3:** Implement following the `V2Setup` artboard: restaurant name, country, currency, app language, bill language, tax view, and the link "Joining a shared restaurant? Open it here" (which routes to `setup?join` and is wired in Task 16).
- [ ] **Step 4:** Run them and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): i18n, settings and first-run setup`

### Task 7: Add entry (expense or collection)

**Files:**
- Create: `resto-app/web/src/screens/AddEntry.tsx`, `src/ui/Keypad.tsx`, `src/ui/Segmented.tsx`, `src/domain/keypad.ts`
- Test: `resto-app/web/src/domain/keypad.test.ts`, `src/screens/AddEntry.test.tsx`

**Interfaces:**
- Consumes: `put`, `paymentsForPaidNow`, `parseAmount`, `t`
- Produces:
  - `pressKey(display: string, key: '0'-'9'|'.'|'⌫', decimalSep: ','|'.'): string`: at most 2 decimals, a single separator, no leading zeros, at most 9 integer digits
  - `<AddEntry initial?: Partial<Entry> & { photoId?: Id }/>`: Task 11 reuses it, pre-filled from a bill

- [ ] **Step 1: Write the failing tests**
  - Keypad: `pressKey('184', ',', ',') === '184,'`; a third decimal is ignored; `⌫` on `'0'` stays `'0'`.
  - AddEntry: typing 1-8-4-,-5 then Save with supplier "Metro" creates an expense of 18450. The category comes from Metro's `defaultCategoryId`, `status` is `'paid'`, and one Payment is created.
  - Switching to "On credit" shows a due-date field and creates no Payment.
  - Collection mode hides supplier and category and shows channel and method. Save creates `kind:'income'`.
  - Save is disabled while the amount is empty or 0.
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3:** Implement following the `V2AddExpense` artboard:
  - Suppliers are sorted by most recently used. "+ New" creates a supplier inline.
  - Saving a new supplier with a category sets its `defaultCategoryId`.
- [ ] **Step 4:** Run them and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): add expense and collection screen`

### Task 8: Home, charts and History

**Files:**
- Create: `resto-app/web/src/screens/Home.tsx`, `src/screens/History.tsx`, `src/ui/charts/InOutLine.tsx`, `src/ui/charts/ProfitBars.tsx`, `src/ui/charts/Donut.tsx`
- Test: `resto-app/web/src/screens/Home.test.tsx`, `src/screens/History.test.tsx`, `src/ui/charts/charts.test.tsx`

**Interfaces:**
- Consumes: `summarize`, `series`, `compare`, `supplierBalances`, `dueBucket`, `listLive`, `softDelete`
- Produces:
  - `<InOutLine data={series()} />`
  - `<ProfitBars data={series()} />` (positive bars green and up, negative bars red and down from a zero line)
  - `<Donut slices={{label:string; cents:Cents; color:string}[]} centerLabel centerValue />`

- [ ] **Step 1: Write the failing tests**
  - Home with the Task 4 fixture shows `+2 340,00 €`, the in/out totals, the "vs last period" badge, today in and out, and "Owed to suppliers · 1 280,00 €" with "3 bills due this week" (using Task 5 data).
  - Clicking "See all" routes to `history`.
  - ProfitBars renders one bar with `data-sign="neg"` for September.
  - Donut slice arcs add up to the circumference within ±1.
  - History: the search box filters by supplier name or note. Delete asks "Delete this entry?" and calls `softDelete` only after confirming.
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3:** Implement following the `V2Main` artboard (period control: Day / Week / Month / Year; the sync button is wired in Task 14). Charts are hand-made SVG, with `role="img"` and an `aria-label` summarising the figures.
- [ ] **Step 4:** Run them and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): home dashboard, charts and history`

### Task 9: Reports and Excel export

**Files:**
- Create: `resto-app/web/src/screens/Reports.tsx`, `src/export/workbook.ts`, `src/export/share.ts`
- Test: `resto-app/web/src/export/workbook.test.ts`

**Interfaces:**
- Consumes: totals, credit, repo
- Produces:
  - `buildWorkbook(data, from, to, view, t): { sheet: string; rows: (string|number|Date|null)[][] }[]`, with sheets in this order: `Entries, Monthly summary, By category, By supplier, Payments, Supplier balances` (names translated)
  - `exportExcel(from, to): Promise<Blob>`
  - `shareOrDownload(blob: Blob, filename: string): Promise<'shared'|'downloaded'>`: uses `navigator.share({files})` when available, otherwise a download link
  - Task 16 adds the upload of the exported file to the Drive `Exports` folder

- [ ] **Step 1: Write the failing tests**
  - Using the Task 4 fixture, Monthly summary has the rows `Nov 2026: in 9800, out 7460, profit 2340`, with amounts as numbers in currency units, not cents strings.
  - The Entries sheet has 1 header row plus 1 row per live entry. Deleted entries are excluded.
  - The filename is `restaurant-2026-11-01_2026-11-30.xlsx`.
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3:** Implement following the `V2Reports` artboard (range 3M / 6M / 1Y and custom, profit bars, donut of the top 4 categories plus "Other"). Convert the rows to a file with `write-excel-file`.
- [ ] **Step 4:** Run them and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): reports and Excel export`

### Task 10: What I owe and recording payments

**Files:**
- Create: `resto-app/web/src/screens/Owe.tsx`, `src/screens/RecordPayment.tsx`
- Test: `resto-app/web/src/screens/Owe.test.tsx`

**Interfaces:**
- Consumes: `supplierBalances`, `openBills`, `dueBucket`, `allocatePayment`, `put`

- [ ] **Step 1: Write the failing tests**
  - Shows a total of `−1 280,00 €` with overdue, this week and later buckets of 320 / 610 / 350.
  - Recording €400 for Boucherie Martin writes 2 Payments, and the balance becomes €380.
  - Entering €900 shows the "That's more than you owe (780,00 €)" message and writes nothing.
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3:** Implement following the `V2Owe` artboard. Overdue bills are shown in red.
- [ ] **Step 4:** Run them and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): what I owe and supplier payments`

### Task 11: Bill photos and reading bills

**Files:**
- Create: `resto-app/web/src/photos/photos.ts`, `src/ocr/parseReceipt.ts`, `src/ocr/ocr.ts`, `src/screens/Bills.tsx`, `src/screens/BillCheck.tsx`
- Test: `resto-app/web/src/ocr/parseReceipt.test.ts`, `src/ocr/fixtures/*.txt` (at least 6 receipt texts: 3 French and 3 English, including one with no total), `src/photos/photos.test.ts`

**Interfaces:**
- Produces:
  - `compressPhoto(file: Blob, maxEdge = 1600, quality = 0.7): Promise<Blob>`
  - `savePhoto(blob): Promise<Id>`, `getPhoto(id): Promise<Blob|undefined>`
  - `savePhotoToPhone(id)` and `saveAllPhotos()`, both via `shareOrDownload`
  - `parseReceipt(text: string, lang: 'fra'|'eng', suppliers: Supplier[]): { shop?: string; supplierId?: Id; date?: ISODate; incl?: Cents; excl?: Cents; tax?: Cents }`
  - `readBill(blob, lang): Promise<string>` (tesseract, lazy-loaded worker)

- [ ] **Step 1: Write the failing tests** for `parseReceipt`:
  - On the Metro fixture (French) it returns `incl 18450, excl 15380, tax 3070, date '2026-11-25'`, and shop "METRO CASH & CARRY" matched to the saved supplier "Metro Cash & Carry" (case and punctuation ignored).
  - When only two of incl / excl / tax are found, the third is computed.
  - An English "GRAND TOTAL 52.40" gives `incl 5240`.
  - The no-total fixture returns `incl` as undefined.
  - Dates: `25/11/2026`, `25.11.26` and `2026-11-25` parse. For `eng`, `11/25/2026` parses as US when the first number is greater than 12.
  - Keywords: incl = `TOTAL TTC|NET A PAYER|NET À PAYER|GRAND TOTAL|TOTAL`; excl = `TOTAL HT|SOUS-TOTAL|SUBTOTAL`; tax = `TVA|VAT|TAX`. The most specific match wins, and the bottom-most line wins ties.
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3:** Implement `parseReceipt`, the photo helpers, the Bills grid and `BillCheck` (following the `V2Bills` artboard).
  - Fields read from the photo are highlighted. "Looks right" opens `AddEntry` pre-filled with `photoId`. Saving still needs an amount.
  - The camera opens via `<input type="file" accept="image/*" capture="environment">`.
- [ ] **Step 4:** Run them and confirm they PASS. Run `npm run build` and check that the tesseract worker and language data are separate chunks, not in the main bundle.
- [ ] **Step 5:** Commit: `feat(resto): bill photos and on-device bill reading`

### Task 12: App lock

**Files:**
- Create: `resto-app/web/src/lock/lock.ts`, `src/screens/Lock.tsx`
- Test: `resto-app/web/src/lock/lock.test.ts`

**Interfaces:**
- Produces:
  - `setPin(pin: string)`: 4–6 digits, PBKDF2-SHA256, 200k iterations, salt stored in `meta`
  - `checkPin(pin): Promise<boolean>`
  - `enableBiometric(): Promise<boolean>` (WebAuthn platform authenticator, `userVerification:'required'`)
  - `unlockBiometric(): Promise<boolean>`
  - `shouldLock(hiddenAt: number, now: number): boolean` (true after 180000 ms)

- [ ] **Step 1: Write the failing tests**
  - A wrong PIN returns false, and the right one returns true.
  - The PIN isn't stored in clear text.
  - `shouldLock(0, 179999)` is false and `shouldLock(0, 180000)` is true.
  - After 5 wrong PINs, `checkPin` refuses for 30 s.
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3:** Implement. A forgotten PIN can be reset by signing in again with Google, which re-downloads data from Drive.
- [ ] **Step 4:** Run them and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): PIN and Face ID / fingerprint app lock`

### Task 13: Sign-in helper (Cloudflare Worker) and Drive client

**Files:**
- Create: `resto-app/worker/package.json`, `wrangler.toml`, `src/index.ts`, `src/crypto.ts`
- Create: `resto-app/web/src/sync/auth.ts`, `src/sync/drive.ts`
- Test: `resto-app/worker/src/index.test.ts`, `resto-app/web/src/sync/drive.test.ts`

**Interfaces:**
- Worker endpoints (JSON):
  - `POST /exchange {code}` → `{session, accessToken, expiresIn, email}`
  - `POST /refresh {session}` → `{accessToken, expiresIn}`
  - `POST /revoke {session}` → `204`
  - Only requests whose `Origin` is in `ALLOWED_ORIGINS` are served; others get `403`.
- Worker setup:
  - Secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENC_KEY` (base64, 32 bytes).
  - KV binding: `TOKENS`. The value is the refresh token, AES-GCM encrypted. The session key is 32 random bytes in base64url.
- Web `auth.ts`:
  - `signIn(): Promise<{email:string}>` (GIS `initCodeClient`, `ux_mode:'popup'`, scopes from Global Constraints, `access_type` offline via the worker)
  - `getAccessToken(): Promise<string>` (cached; refreshed 60 s before expiry; throws `AuthNeeded`)
  - `signOut()`
- Web `drive.ts`:
  - `ensureFolder(name, parentId?): Promise<Id>`
  - `findFile(name, parentId): Promise<{id:string; version:string}|null>`
  - `readJson(id): Promise<{data:unknown; version:string}>`
  - `writeJson(id|null, name, parentId, data): Promise<{id:string; version:string}>`
  - `uploadBlob(name, parentId, blob, mime)`
  - `shareFolder(id, email): Promise<void>` (role `writer`)

- [ ] **Step 1: Write the failing tests**
  - Worker, with `fetch` and KV mocked:
    - `/exchange` stores an encrypted value that doesn't contain the raw refresh token.
    - `/refresh` with an unknown session returns `401`.
    - A wrong Origin returns `403`.
    - Google's `invalid_grant` on refresh deletes the KV key and returns `401`.
  - Drive, with `fetch` mocked:
    - `writeJson(null, …)` sends a multipart upload to `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version`.
    - A `401` response triggers one token refresh and one retry.
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3:** Implement both sides.
- [ ] **Step 4:** Run them and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): sign-in helper worker and Drive client`

### Task 14: Merge and sync

**Files:**
- Create: `resto-app/web/src/sync/merge.ts`, `src/sync/sync.ts`, `src/ui/SyncStatus.tsx`
- Test: `resto-app/web/src/sync/merge.test.ts`, `src/sync/sync.test.ts`

**Interfaces:**
- Consumes: repo (Task 3), drive (Task 13)
- Produces:
  - `type Ledger = { schema: 1; entries: Entry[]; payments: Payment[]; suppliers: Supplier[]; categories: Category[]; settings: SharedSettings[] }`
  - `merge(a: Ledger, b: Ledger): Ledger`: per table and per id, the higher `updatedAt` wins; on a tie, the higher `deviceId` wins; deletions are kept as tombstones
  - `syncNow(): Promise<{status:'ok'|'offline'|'authNeeded'|'error'; at:number}>`
  - `scheduleSync()` (debounced 5 s after each write; also on app open and when coming back online)
  - `useSyncStatus()`

- [ ] **Step 1: Write the failing tests**
  - `merge` is commutative and idempotent on a random set of 50 records: `merge(a,b)` deep-equals `merge(b,a)`, and `merge(a,a)` deep-equals `a`.
  - Phone A edits entry X at t=10 and phone B deletes X at t=12: the result is deleted. With the opposite timestamps, the edit wins.
  - Records only on one side are kept.
  - `syncNow`:
    - Reads `ledger.json`, merges, writes back and applies the merged result to IndexedDB.
    - If the file `version` changed between read and write, it re-reads and re-merges, at most 3 times.
    - When `fetch` rejects (offline), local data is untouched and the status is `offline`.
    - When `getAccessToken` throws `AuthNeeded`, the status is `authNeeded` and the UI shows a "Sign in to sync" button.
    - Running `syncNow` twice in a row produces no duplicate records.
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3:** Implement. Wire the Sync button (Home) and "Sync now" (Settings).
- [ ] **Step 4:** Run them and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): Drive sync with per-record merge`

### Task 15: Manual setup and sharing check (Adithyan, with Claude guiding)

This task needs Adithyan's own accounts; Claude can't do it from the cloud session. No code.

- [ ] **Step 1: Google Cloud project**
  - Create a project and enable the Drive API and the Picker API.
  - OAuth consent screen: External, publishing status **In production**, scopes `openid`, `email`, `drive.file`.
  - Create a Web OAuth client with authorised JavaScript origins = the Pages URL and `http://localhost:5173`.
  - Create an API key restricted to the Picker API and the Pages URL.
- [ ] **Step 2: Cloudflare**
  - Create a free account.
  - Run `npx wrangler kv namespace create TOKENS`.
  - Run `npx wrangler secret put GOOGLE_CLIENT_ID`, then `GOOGLE_CLIENT_SECRET`, then `ENC_KEY`.
  - Deploy the worker.
  - Create a Pages project pointing at `resto-app/web` (build `npm run build`, output `dist`), with environment variables `VITE_GOOGLE_CLIENT_ID`, `VITE_PICKER_API_KEY` and `VITE_AUTH_URL`.
- [ ] **Step 3: Sharing check (decides Task 16's join method)**
  - With two Google accounts, owner A creates the folder and `ledger.json` and shares the folder with B.
  - B opens the Picker on the folder.
  - Record whether B's app can then read `ledger.json` with `drive.file`.
  - If yes, Task 16 uses **folder pick**. If no, it uses **file pick** (B picks `ledger.json` and, when photo backup is on, the `Bills` folder files are read through the same picker).
  - Write the result in `resto-app/README.md`.

### Task 16: Sharing, joining and photo backup

**Files:**
- Create: `resto-app/web/src/sync/share.ts`, `src/screens/Join.tsx`, `src/photos/backup.ts`
- Create: `resto-app/web/src/screens/Settings.tsx` (following the `V2Settings` artboard)
- Test: `resto-app/web/src/sync/share.test.ts`, `src/photos/backup.test.ts`

**Interfaces:**
- Consumes: `shareFolder`, `uploadBlob`, `syncNow`, the Task 15 result
- Produces:
  - `inviteByEmail(email): Promise<void>`
  - `openShared(): Promise<void>` (Picker; stores the chosen folder or file id in `meta.ledgerRef`)
  - `backupPendingPhotos(): Promise<number>` (only when `photoBackup` is on; marks each photo `backedUp`)
  - `saveExportToDrive(blob: Blob, filename: string): Promise<void>` (`ensureFolder('Exports', rootId)` + `uploadBlob`; called by Reports after `exportExcel` when signed in)

- [ ] **Step 1: Write the failing tests**
  - Inviting an invalid email is refused before any request.
  - After `openShared`, `syncNow` reads the picked ledger instead of creating a new one.
  - With `photoBackup` off, `backupPendingPhotos` uploads nothing. With it on, it uploads each photo once.
  - Only the owner sees "Share with someone" (`ownerEmail` is stored in shared settings at creation).
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3:** Implement Settings in full: country and currency, languages, tax view, categories and suppliers editor, sharing, photo backup, app lock, bill reading mode, export, sign out.
- [ ] **Step 4:** Run them and confirm they PASS.
- [ ] **Step 5:** Commit: `feat(resto): sharing, joining and optional photo backup`

### Task 17: Optional better bill reading with Google AI

**Files:**
- Create: `resto-app/web/src/ocr/gemini.ts`
- Test: `resto-app/web/src/ocr/gemini.test.ts`

**Interfaces:**
- Produces:
  - `readBillWithGemini(blob, apiKey): Promise<ReturnType<typeof parseReceipt>>`, which calls `generateContent` on a current Gemini Flash model (the model name is a single constant in `gemini.ts`) with a JSON schema `{shop,date,incl,excl,tax}` and converts amounts with `parseAmount`.
  - The key is stored on the device only, never synced.

- [ ] **Step 1: Write the failing test** (`fetch` mocked): a JSON reply of `{"incl":"184,50"}` gives `incl 18450`. Any error falls back to on-device reading with a notice.
- [ ] **Step 2:** Run it and confirm it FAILS.
- [ ] **Step 3:** Implement and wire it to the Settings "Bill reading" option.
- [ ] **Step 4:** Run it and confirm it PASSES.
- [ ] **Step 5:** Commit: `feat(resto): optional Google AI bill reading`

### Task 18: Release: smoke test, install guide, deploy

**Files:**
- Create: `resto-app/web/e2e/smoke.spec.ts`, `resto-app/README.md` (setup and an install guide for Dad in plain words, with screenshots), `resto-app/web/playwright.config.ts`

- [ ] **Step 1: Write the smoke test**
  - It runs offline with Drive mocked: first-run setup → add an expense of `184,50` → Home shows `−184,50 €` today → export gives an `.xlsx` download.
  - Run it at an iPhone viewport (`devices['iPhone 13']`) with `--trace off`.
- [ ] **Step 2:** Run `npx playwright test --trace off` and confirm it PASSES.
- [ ] **Step 3:** Push and let Cloudflare Pages deploy. Then, on both phones:
  - Open the URL and choose Add to Home Screen.
  - Go through setup and the join flow, and check that an expense entered on one phone appears on the other after "Sync now".
- [ ] **Step 4:** Commit: `docs(resto): install guide and smoke test`
