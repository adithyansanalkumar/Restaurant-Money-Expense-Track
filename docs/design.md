# Restaurant money app: design

Date: 2026-11-25
Status: approved by Adithyan on 2026-11-26 (with the liquid glass v2 screens)

## 1. Why this exists

Adithyan's father owns a restaurant. Today he writes every expense and every day's collection in a paper notebook and keeps the paper bills. He cannot easily see whether the restaurant is making or losing money, or how spending and income change over time.

He wants a phone app that replaces the notebook and the pile of bills, shows profit or loss clearly with graphs, and exports to Excel. Adithyan also uses it, on his own phone, with the same data.

Success: the father stops using the notebook because the app is faster, and can answer "did we make money this month, and where did it go?" in a few seconds.

## 2. Users and devices

- **Two users:** the father on an **iPhone** and Adithyan on an **Android** phone. Both add entries, but rarely at the same moment.
- **Private:** not published on the App Store or Play Store. No paid accounts or services; the running cost must be €0.
- **Restaurant-focused:** wording, default categories and reports are written for a restaurant, not a general business.

## 3. Goals

1. **Log money out (expenses):** amount, supplier or shop, category, bill date, payment method, note, and an optional bill photo. A quick entry takes under 10 seconds. An expense can be **paid now** or **on credit** (paid later, in one go or in parts).
2. **Log money in (daily collection):** the day's takings, optionally split by channel (dine-in, takeaway, delivery apps and so on) and by payment method (cash, card, other).
3. **Bills section:** take a photo of a printed bill; the app reads the **date, total amount and shop/supplier name** and pre-fills an expense. The user checks and corrects it, then saves.
4. **Dashboard:** profit or loss for today, this week, this month, this year or a custom range. A **graph of money in vs. money out over time** with the profit line. A breakdown of spending by category and by supplier.
5. **Excel export** (.xlsx) for any date range.
6. **Google sign-in, backup and sync through Google Drive:** the data lives on the phone and works offline. It syncs to the owner's Google Drive automatically and with a **"Sync now"** button. On a new phone, even when switching between iPhone and Android, signing in with Google brings all the data back.
7. **Sharing:** the owner shares the data with a second Google account (Adithyan). Both phones see and edit the same data.
8. **Settings:** currency, language, date format, categories, suppliers, app lock, photo backup, bill reading mode, sync, export, sign out.
9. **App lock:** PIN, plus Face ID or fingerprint where the phone supports it.
10. **Supplier credit:** see what is owed to each supplier, record payments against unpaid bills, and see which bills are due soon.
11. **First-run setup:** the first time the app opens, it asks for the country, currency, app language, bill language and tax view. All can be changed later in Settings.
12. **Fresh start:** no import of the old notebook; the app starts from the day it's installed.

## 4. Non-goals

- No App Store or Play Store release, and no public sign-up.
- No point-of-sale, table orders, inventory, payroll or tax filing.
- No database run by us: all restaurant data stays on the phones and in the owner's Google Drive. The only thing we run is a small free sign-in helper (8.10) that never sees restaurant data.
- No import of past notebook data.
- No push notifications (due-soon bills are shown inside the app).
- No paid services of any kind.

## 5. Anti-goals (the app fails if any of these happen)

- Entering a bill is slower or more annoying than writing it in the notebook.
- Data is lost: through a sync conflict, a phone change, or a bad merge between the two phones.
- The automatic bill reading saves a wrong amount without the user seeing and confirming it.
- The father needs a computer, or has to reinstall something every week, to keep using the app.

## 6. Constraints

- **iPhone without a paid Apple account:** a native app would expire every 7 days. So the app is an **installable web app (PWA)**: opened from a link, then "Add to Home Screen". It runs full-screen with its own icon and works offline.
- **Cost €0:** free hosting, free Cloudflare Workers tier for the sign-in helper, free Google Cloud project, free on-device text recognition.
- **Bill photos are not stored in Google Drive by default**, to save his Drive space (see 8.4).
- **Bills are mostly printed**, so reading them from photos is realistic. Handwritten bills are best-effort only.

## 7. Approaches considered

| Approach | Summary | Trade-off | Decision |
|---|---|---|---|
| **A. Installable web app (PWA)** | One web app, hosted free, added to the home screen on both phones | Free and works on iPhone. A web app cannot silently save photos into a "Bills" album in the phone gallery, so photos live inside the app with a one-tap "Save to phone" button. | **Chosen** |
| B. Native app | Real iOS and Android app | Best camera and gallery access, but on iPhone it needs $99/year or reinstalling every 7 days from a computer | Rejected: breaks the €0 rule or the "no weekly reinstall" anti-goal |
| C. Native on Android + web app on iPhone | Two builds | Only Adithyan gets the gallery folder; twice the work to build and maintain for two users | Rejected: not worth it |

Adithyan chose **A**.

## 8. Design

### 8.0 Visual design (approved: liquid glass v2)

The approved screens are the **"Liquid glass v2"** set on the design canvas: https://claude.ai/artifact/STGngUebSGc9pBfTRL3kkX (artboards named `V2…`).

- Palette: navy `#1B365D`, blue `#005A9C`, sky `#60C1E5`, pale `#A0E0EF`; background is a deep navy scene (`#14305A` → `#0A1B33`) lit by soft pools of those colours.
- Frosted glass panels: translucent white gradient, 30px backdrop blur, thin bright edge, top highlight, soft shadow. Text is white; labels are soft blue-grey (`#C6D8E6`).
- **Money in = green (`#6FE3A0`), money out = red (`#FF8E8E`)**, always with a + / − sign or an In / Out label.
- Fonts: Inter (body), Inter Tight (numbers and headings).
- Floating glass tab bar: **Home · Bills · (+) · Reports · Settings**. The round + in the middle opens Add entry from anywhere.
- **History is not a tab**: Home shows recent entries with **"See all"**, which opens the full History screen.
- Where the blur isn't supported, panels fall back to plain translucent fills.

### 8.1 Screens

```
┌───────────────────────────┐
│  November 2026        ▼   │   ← period picker
│                           │
│   Profit   +€2,340        │   (green / red)
│   In  €9,800  Out €7,460  │
│                           │
│   [ graph: in vs out ]    │
│                           │
│  Top spending: Meat €1,900│
│                           │
│ [+ Expense] [+ Collection]│   ← big buttons, always visible
├───────────────────────────┤
│ Home  Bills  History  ⚙   │
└───────────────────────────┘
```

- **Home (dashboard):** period picker, profit/loss, totals in and out, graph, top categories and suppliers, two big "+ Expense" and "+ Collection" buttons.
- **Add expense:** amount keypad first, then supplier (recently used suppliers shown first), category (pre-filled from the supplier's last category), date (today by default), payment method, note, optional photo. Save.
- **Add collection:** date (today by default) and total, with an optional split by channel and payment method.
- **Bills:** a camera button and a grid of all bill photos. Taking a photo runs bill reading; the result opens the Add expense screen pre-filled, with the read fields highlighted so the user checks them. Each photo links to its expense, and each expense shows its photo.
- **History** (from "See all" on Home): a list of all entries, searchable and filterable by type, category, supplier and date. Tap to edit; deleting asks for confirmation.
- **Reports:** graphs over a chosen range: in vs out over time (by day, week or month), profit trend, spending by category and by supplier, plus an "Export to Excel" button.
- **Settings:** see 8.8.

### 8.2 Data stored

- **Entry:** id, type (expense or income), date, amount including tax, amount excluding tax and tax amount (when known), category, supplier (expenses), channel and payment method, note, photo id (optional), created by (Google account), created at, updated at, deleted flag.
- For expenses also: payment status (paid, partly paid, unpaid) and due date (optional).
- **Payment:** id, expense id, date, amount, payment method, created by, updated at, deleted flag. A "paid now" expense gets one payment on the bill date automatically.
- **Supplier:** id, name, default category.
- **Category:** id, name, type (expense or income), archived flag.
- **Settings** (shared ones are synced, device ones are not).

Default expense categories: Vegetables & fruit, Meat & fish, Dairy, Dry goods & groceries, Beverages, Gas & fuel, Electricity, Water, Rent, Staff wages, Repairs & maintenance, Packaging, Cleaning supplies, Other.

Default income channels: Dine-in, Takeaway, Delivery apps, Catering, Other.

All categories and channels can be renamed, added or archived in Settings. Archiving keeps old entries intact.

Money is stored as whole minor units (cents) to avoid rounding errors.

### 8.3 Storage, sync and sharing

- **On the phone:** all data is stored in the browser's local database (IndexedDB). The app asks the browser to keep it permanently (persistent storage). The app works fully offline.
- **In Google Drive:** sign-in uses Google with the narrowest Drive permission (only files the app created or the user picked). The app creates a folder in the owner's Drive, for example "Restaurant Accounts", containing the data file(s) and an "Exports" subfolder for Excel files.
- **Sync:** runs automatically when the app opens, after each change (shortly delayed and grouped), and when the "Sync now" button is tapped. Each record carries an "updated at" time and a "deleted" flag rather than being erased, so the two phones can merge: for each record, the most recent change wins. Two people editing *the same entry* at the same moment is rare and accepted; the latest edit wins. A last-sync time and status are shown in Settings.
- **Sharing:** in Settings, the owner taps "Share with someone" and enters a Gmail address; the app shares the Drive folder with that account. On the second phone, the user signs in with Google and picks the shared folder once (Google's file picker).
- **New phone:** install from the link, sign in, pick the folder, and everything is restored (except photos that were never backed up, see 8.4).
- **Google login project:** a free Google Cloud project, set to "In production" with only non-sensitive permissions, so sign-in doesn't expire every 7 days and needs no Google review.

### 8.3b Supplier credit

- When adding an expense, a **Paid now / On credit** switch (Paid now by default). On credit asks for an optional due date.
- **"What I owe" screen** (reached from the Home screen card): total owed, then each supplier with their balance; tap a supplier to see unpaid bills and **record a payment** (full or partial, possibly covering several bills, oldest first).
- Home shows a card: "Owed to suppliers: €X · N bills due this week". Overdue bills are marked in red.
- **How it counts:** profit uses the **bill date** (what was bought in that period, paid or not). Reports also show **cash actually paid out** in the period (by payment date), so he can see both "what this month cost" and "what money left this month".
- Excel export adds a **Payments** sheet and a **Supplier balances** sheet.

### 8.4 Bill photos

- Photos are compressed (about 100–200 KB each) and stored **inside the app on the phone that took them**. They are visible from the Bills grid and from each expense.
- **"Save to phone"** on any photo, and **"Save all bills"** in Settings, use the phone's share sheet so the user can save them to the gallery, Files, or an album they name "Bills".
- **Setting "Also back up bill photos to Google Drive":** off by default. When on, photos are uploaded to a "Bills" subfolder of the shared Drive folder, and they then appear on the other phone and survive a phone change.
- Known limits, accepted by Adithyan: without that setting, a photo is only on the phone that took it, and it is lost if that phone is lost.

### 8.5 Reading bills from photos

- **Default: on the phone, free and offline:** text recognition runs inside the app, in the bill language chosen at setup. Simple rules then find the totals, the date (common date formats, including the country's usual format) and the shop name (the top lines of the bill). The supplier is matched against the saved supplier list.
- **Totals:** the rules look for the total including tax ("Total TTC", "Net à payer", "Grand total", "Total") and, when printed, the total excluding tax ("Total HT", "Subtotal") and the tax amount. Whatever is found is stored; the missing one is left empty, or worked out when two of the three are known.
- **Optional, in Settings: "Better bill reading (Google AI)":** the user pastes a free Google AI (Gemini) key, and photos are sent to Google's AI for more accurate reading. Off by default because the photo leaves the phone.
- **The user always confirms** before saving. Fields the app read are highlighted; anything it couldn't read is left empty.

### 8.6 Dashboard and reports

- Period: today, this week, this month, this year, custom range.
- Profit = money in − money out for the period, green when positive and red when negative.
- **Tax view setting:** amounts are shown either **including tax** ("Total TTC" / grand total) or **excluding tax** ("Total HT" / subtotal). When an entry has no excluding-tax amount, the including-tax amount is used and marked.
- Cash paid out in the period (by payment date) and the amount owed to suppliers.
- Graph of money in vs. money out over time, grouped by day, week or month depending on the range, with the profit as a line.
- Spending by category and by supplier, with the share of the total.
- Comparison with the previous period (for example "this month vs. last month: spending +8%").

### 8.7 Excel export

- Choose a date range, then export one .xlsx file with these sheets:
  - **Entries:** every entry, one row each, all fields.
  - **Monthly summary:** money in, money out and profit per month.
  - **By category:** totals per category per month.
  - **By supplier:** totals per supplier.
- The file can be shared via the phone's share sheet (WhatsApp, email, Files) and is also saved to the "Exports" folder in Drive.

### 8.8 Settings

- Restaurant name.
- Country (sets defaults for currency, date format and the bill words to look for).
- Currency (any; shared by both phones).
- App language (English and French to start; more can be added).
- Bill language (the language bills are printed in, used for reading photos).
- Tax view: including tax (TTC / grand total) or excluding tax (HT / subtotal).
- Date format and first day of the week.
- Categories, income channels and suppliers: add, rename, archive.
- App lock: PIN, plus Face ID or fingerprint where available. Locks after a few minutes in the background.
- Photo backup to Drive (on/off).
- Bill reading mode (on-device / Google AI with key).
- Sync: status, last sync time, "Sync now".
- Sharing: who has access, "Share with someone".
- Export to Excel.
- Account: signed-in Google account, sign out.

### 8.9 Installing and hosting

- The app is a static site hosted free (for example Cloudflare Pages or Netlify, which allow a private code repository). It can be reached through a link.
- On each phone: open the link in Safari (iPhone) or Chrome (Android), then "Add to Home Screen".
- Updates are published by pushing code; both phones pick up the new version the next time the app opens.

### 8.10 Sign-in helper

- A tiny function on Cloudflare Workers' free tier. Its only job is to keep Google sign-in alive, so that sync stays automatic on the iPhone home-screen app without a Google pop-up every hour.
- At sign-in, it exchanges Google's one-time code for a long-lived refresh token, stores that token encrypted, and gives the app a fresh short-lived access token when asked. It never touches Drive files or restaurant data.
- If the helper is unreachable, the app keeps working offline and falls back to a normal Google sign-in tap to sync.

### 8.11 First-run setup

On first open: sign in with Google, then either **create a new restaurant** (owner) or **open a shared one** (second user picks the shared folder). For a new restaurant, a short setup asks: restaurant name, country, currency, app language, bill language, tax view. Every answer can be changed in Settings. A second user inherits the shared settings and only chooses their own app language.

## 9. Decided by Adithyan

- Two users, iPhone (father) and Android (Adithyan), both entering data, rarely at the same time.
- Data on the phone, backup and sync through Google Drive with Google sign-in, plus a "Sync now" button.
- Bill photos stay on the phone by default; optional Drive backup setting.
- A Bills section that reads date, amount and shop from photos. Bills are mostly printed.
- Settings for currency, language and similar options.
- Private, €0, no store release.
- Restaurant-focused.
- Approach A: installable web app.
- Graphs of money in vs. money out over time.
- Use the free Cloudflare sign-in helper so sync stays automatic.
- Country, currency, languages and tax view asked at first launch, changeable in Settings; a setting to show totals including tax (TTC / grand total) or excluding tax.
- Track supplier credit (goods taken now, paid later).
- Start fresh, with no notebook import.

## 10. Calls made by Claude (to check)

- The father is the owner: his Google account and Drive hold the data, and he does the first setup (Adithyan can sit with him for it). Both users have equal rights to add, edit and delete entries and change shared settings; only the owner can share with more people.
- Narrowest Drive permission, and data in a visible "Restaurant Accounts" folder so it can be shared.
- "Most recent change wins" per record for sync conflicts, with deleted records kept as markers.
- On-device bill reading by default, with optional Google AI as a setting.
- Default restaurant categories and income channels (8.2).
- Optional split of the daily collection by channel and payment method.
- PIN lock with Face ID or fingerprint.
- Excel sheet layout (8.7).
- English and French as starting languages.
- The tax setting changes how totals are *shown*; the app stores both totals when the bill has them.
- Profit counts expenses by bill date; reports also show cash paid out by payment date.
- Credit payments can be partial and applied oldest bill first; due-soon bills shown in the app, not as push notifications.
- The second user shares the owner's settings and only picks their own app language.
- Free hosting on Cloudflare Pages or Netlify.

## 11. Left to the builder

- Front-end framework and libraries (charts, Excel writer, text recognition, local database).
- Exact sync file layout in Drive (one file vs. one per month, and so on), as long as the merge rule in 8.3 holds.
- The rules for finding the total, date and shop on a bill, and how they're tested.
- Visual design, as long as entering an expense stays under 10 seconds and the main buttons are large.
