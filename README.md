# Resto: the restaurant money app

A private app for keeping the restaurant's accounts on your phone: money in, money out, what you owe
suppliers, bill photos and Excel reports. It works offline and keeps a copy in your own Google Drive.

**Cost: 0 euros.** Everything below uses free plans (Google Cloud, Cloudflare, GitHub). No card is needed.

Words used in this guide:
- **Pages URL**: the web address of the app once it is published (looks like `https://something.pages.dev`).
- **Worker**: a tiny free program on Cloudflare that keeps people signed in. It never sees the accounts, only the sign-in.
- **Environment variable**: a setting you type into a website's settings page (name and value).

---

## Part 1. One-time setup (about 30 to 45 minutes)

You do this once, on a computer. Keep a notepad open: you will collect four values and use them later.
Each one is marked **[COPY]** where you get it and **[PASTE]** where it goes.

### Step 1. Google Cloud project

1. Go to https://console.cloud.google.com and sign in with the Google account that will own the restaurant.
2. Top bar, project picker, **New project**. Name it `Resto`. Create it and make sure it is selected.
3. **[COPY] Project number.** On the project's Dashboard ("Project info" card) copy the **Project number**
   (digits only, not the project name). This is `VITE_GOOGLE_APP_ID`.
4. Menu, **APIs & Services**, **Library**. Search for and **Enable** both:
   - **Google Drive API**
   - **Google Picker API**
5. **OAuth consent screen** (menu, APIs & Services; sometimes called "Google Auth platform", "Branding"):
   1. User type: **External**.
   2. App name `Resto`, your email as support and developer contact.
   3. Scopes: add `openid`, `email` and `.../auth/drive.file`. (`drive.file` means the app can only see
      files it created or you picked for it, never the rest of your Drive.)
   4. **Branding links** (Google now requires them before you can publish). They need your Pages URL, so
      do Step 4 first, then come back:
      - Application home page: your Pages URL, for example `https://resto-xxx.pages.dev`
      - Privacy policy link: your Pages URL followed by `/privacy.html` (this page is part of the app)
      - Terms of service: leave empty.
      - Authorised domains: add your Pages address without `https://`, for example `resto-xxx.pages.dev`.
      - Do **not** upload a logo (a logo makes Google ask for a review).
   5. Publishing status (on the **Audience** page): click **Publish app** so it says **In production**.
      If you leave it on "Testing", sign-in stops working after 7 days. You may see an "unverified app"
      warning when signing in: that is normal for a private app; the scopes above do not need Google's review.
6. **Credentials**, **Create credentials**, **OAuth client ID**:
   1. Application type: **Web application**. Name `Resto web`.
   2. **Authorised JavaScript origins**: add your Pages URL (you get it in Step 4; you can come back and add it
      then) and `http://localhost:5173` (only needed if a developer runs the app on a laptop).
   3. Leave "redirect URIs" empty. Create.
   4. **[COPY] Client ID** (ends in `.apps.googleusercontent.com`). This is `VITE_GOOGLE_CLIENT_ID`.
   5. **[COPY] Client secret.** It goes into the worker in Step 3 only. Never put it in the Pages settings.
7. **Credentials**, **Create credentials**, **API key**:
   1. Open the new key, **API restrictions**: restrict to **Google Picker API** only.
   2. **Website restrictions**: add your Pages URL followed by `/*` (for example `https://something.pages.dev/*`).
   3. **[COPY] the key.** This is `VITE_PICKER_API_KEY`.

### Step 2. Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up and create a free account. Verify your email.

### Step 3. Publish the sign-in worker

Needs Node.js on the computer (https://nodejs.org, the "LTS" download). Open a terminal in the
`worker` folder and follow the commands in [`worker/README.md`](worker/README.md). In short:

1. `npm install`, then `npx wrangler login` (a browser window opens; allow it).
2. `npx wrangler kv namespace create TOKENS`, then paste the printed `id` into `wrangler.toml`.
3. In `wrangler.toml` set `ALLOWED_ORIGINS` to **your Pages URL only** and **delete** `http://localhost:5173`
   from it. (Do this step after Step 4 if you do not know the Pages URL yet.)
4. `npx wrangler secret put GOOGLE_CLIENT_ID` (paste the Client ID),
   `npx wrangler secret put GOOGLE_CLIENT_SECRET` (paste the Client secret),
   run `openssl rand -base64 32` and paste its result for `npx wrangler secret put ENC_KEY`.
   Keep a safe copy of `ENC_KEY`; if it is lost everyone just has to sign in again.
5. `npx wrangler deploy`. **[COPY] the worker URL** it prints (`https://resto-auth.<you>.workers.dev`).
   This is `VITE_AUTH_URL`.

### Step 4. Publish the app on Cloudflare Pages

1. Cloudflare dashboard, **Workers & Pages**, **Create**, **Pages**, **Connect to Git**, choose this
   GitHub repository (allow Cloudflare to read it).
2. Build settings:
   - Root directory: `web`
   - Build command: `npm run build`
   - Build output directory: `dist`
3. **Environment variables** (Settings, Variables), **[PASTE]** the four values you collected:

| Name | Value | Where it came from |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | the Client ID | Step 1, point 6 |
| `VITE_AUTH_URL` | the worker URL | Step 3, point 5 |
| `VITE_PICKER_API_KEY` | the API key | Step 1, point 7 |
| `VITE_GOOGLE_APP_ID` | the project number | Step 1, point 3 |

4. Save and deploy. When it finishes, **[COPY] the Pages URL**. Go back and paste it into: the OAuth client's
   JavaScript origins (Step 1.6), the API key's website restriction (Step 1.7), the worker's
   `ALLOWED_ORIGINS` (Step 3.3, then run `npx wrangler deploy` again), and the consent screen's Branding
   links (Step 1.5, point 4). Then publish the consent screen (Step 1.5, point 5).
5. Every time the code on GitHub changes, Pages rebuilds and updates the app by itself. If you change a
   variable, use "Retry deployment" so the change is picked up.

---

## Part 2. The sharing check (10 minutes, two Google accounts)

Do this after Part 3 (it needs the app installed and signed in).

Why: to let Adithyan's phone see Dad's restaurant, the app can use one of two methods. The app is built
to use the safer "pick the file" method, which works either way, so this check is only to confirm
everything behaves on real accounts.

1. On Dad's phone (account A), finish Part 3 and add one expense.
2. In Settings, **Sharing**, share with account B's Gmail address.
3. On a second phone or browser, open the app and sign in with account B. When it shows "Set up your
   restaurant", tap **Joining a shared restaurant? Open it here** at the bottom (as in Part 4), then pick the
   `ledger.json` file. Check the expense appears.
4. Write the result here: **Result: ______ (date ______)**.

`JOIN_MODE` in `web/src/sync/share.ts` defaults to `'file'` (pick `ledger.json`). This works whether or not Google
lets a shared *folder* be opened with `drive.file`, so nothing has to change if the check shows folders do not work.

---

## Part 3. Install on Dad's phone

Open the Pages URL in the phone's browser.

**iPhone (must be Safari):**
1. Tap the **Share** button (square with an arrow).
2. Scroll and tap **Add to Home Screen**, then **Add**.
3. Open Resto from the new icon on the home screen.

**Android (Chrome):**
1. Tap the **three dots (⋮)**.
2. Tap **Install app** (or **Add to Home screen**), then confirm.
3. Open Resto from the icon.

**First run:**
1. Tap **Sign in with Google** and choose the restaurant's Google account. Allow access.
2. **Set up your restaurant**: name, country, currency, and whether totals show with tax (TTC) or without (HT). Tap **Continue**.
3. You land on **Home**. Everything can be changed later in Settings.

("Not now" on the first screen lets you use the app on this phone only, without Google. You can sign in later from Settings.)

---

## Part 4. Connect Adithyan's phone

1. On Dad's phone: **Settings, Sharing, Share with someone**, type Adithyan's Gmail address. Do this first.
2. On Adithyan's phone: install the app as in Part 3.
3. On the first screen sign in with Adithyan's Google account. If it goes to "Set up your restaurant", tap
   **Joining a shared restaurant? Open it here** at the bottom. (Already set up? Use **Settings, Account,
   Open a shared restaurant** instead. If the phone already has entries, for example a test restaurant, the app
   asks whether to **add them** to Dad's books or **erase them first**; choose erase for test data.)
4. Google shows a file picker: choose **`ledger.json`** (shared with you). Done: both phones now show the same accounts.
5. Entries sync by themselves when online; **Sync now** on Home or Settings forces it.

---

## Everyday use (cheat-sheet for Dad)

- **Add an expense**: tap the big **+**, type the amount on the keypad, choose the supplier (or **+ New**),
  the category, then **Save expense**. Choose **On credit** if you have not paid yet.
- **Scan a bill**: **+**, then the camera icon (or the **Bills** tab, **Take a photo of a bill**). Check the shop,
  date and total that the app read, fix anything wrong, tap **Looks right**.
- **Record a collection** (money in): **+**, switch to **Collection**, pick the channel (dine-in, takeaway...), amount, **Save**.
- **Pay a supplier**: Home, **Owed to suppliers**, choose the supplier, **Record a payment**. Partial payments go to the oldest bill first.
- **Export to Excel**: **Reports** tab, choose the range, **Export to Excel**. On a phone it opens the share
  sheet (send it by email or WhatsApp); on a computer it downloads an `.xlsx` file.
- **Fix a mistake**: Home, **See all**, tap the entry, edit or delete.

---

## Good to know

- **Photos stay on the phone** unless you turn on **Settings, Back up bill photos to Google Drive**. With it
  off, the amounts are safe in Drive but the pictures exist only on that phone. With it on, the phone keeps a
  copy of each photo in **your own** Google Drive (the Bills folder), and a new phone signed in with the same
  account brings the photos back when you open them. The other person's phone does not see your photos (and you
  don't see theirs): it shows "Photo not on this phone" instead.
- **PIN and Face ID**: Settings, **App lock**, set a PIN; you can add Face ID or fingerprint on top.
- **Forgot PIN?** The button appears only when the phone is signed in. Sign in again with the same Google
  account and the PIN is cleared so you can set a new one. Be aware: if the phone's browser is still signed in to
  Google, that is a single tap with no password. So the PIN keeps out someone who picks up the phone but cannot
  unlock it (or its Google session); it is not protection against someone who can.
- **Google AI bill reading is optional and off by default.** Bills are normally read on the phone and nothing
  leaves it. To turn on the more accurate reading: Settings, **Bill reading**, **Google AI**, and paste a free key
  from Google AI Studio. Privacy note: the bill photo is then sent to Google, and on the free plan Google may use
  it to improve its products. The key stays on that phone only.
- **Offline**: everything works without internet (adding, scanning, reports). Changes wait on the phone and
  sync when the connection is back. The header shows "Offline — will retry".
- **Changing phones**: install the app, sign in with the **same Google account**, and the accounts come back.
  Bill photos come back (when you open the Bills tab or a photo) only if photo backup was on on the old phone.
- **Sign out one phone**: Settings, Account. **Disconnect Google completely** signs out every phone using the account;
  your data stays in Drive. A phone that joined someone else's restaurant (Adithyan's) goes back to that shared
  restaurant when it signs in again with the same account. If it ever says "This phone belongs to ...'s
  restaurant — open it again", choose the shared `ledger.json` again.
- **With tax / without tax (TTC / HT)**: amounts you type are the total with tax. To see a true HT profit, open
  **More** when adding an entry and fill in **Amount excl. tax** or **Tax** (the other is worked out). Scanned bills
  fill these in when the bill shows them. In HT view the app warns when most amounts have no HT value.
- **Both people have the same rights** over the restaurant settings (name, country, currency, tax view). Only the
  owner (Dad) can share it with someone new.

---

## For developers

```sh
cd web
npm install
npm test                 # unit tests (vitest)
npm run build            # type-check + production build into dist/
npm run dev              # local app on http://localhost:5173
npm run e2e              # smoke test: builds, serves on :4173, drives Chromium at iPhone 13 size

cd ../worker
npm install && npm test  # worker tests; see worker/README.md to deploy
```

- `web/` the React + Vite PWA: `src/screens` (UI), `src/domain` (money, periods, totals), `src/db` (local
  database), `src/sync` (Google sign-in, Drive, sharing), `src/export` (Excel), `src/ocr` (bill reading),
  `src/photos`, `src/lock`, `src/i18n` (English and French).
- `web/e2e/` Playwright smoke test (screenshots go to `e2e/screenshots/`, git-ignored). The first run needs a
  Chromium installed for Playwright (`npx playwright install chromium`).
- `worker/` the Cloudflare sign-in helper.
- Design: [`docs/design.md`](docs/design.md).
  Plan: [`docs/plan.md`](docs/plan.md).
- Environment variables for local runs: copy `web/.env.example` to `web/.env` and fill the four `VITE_` values.
