# Restaurant money app: build notes

Date: 2026-11-26
Code: `web/` (the app) and `worker/` (the sign-in helper). Setup and install guide: `README.md`.

## Status

- All 18 plan steps are built except step 15, which is the manual setup Adithyan does with his own Google and Cloudflare accounts.
- Every step was reviewed, and so was the whole branch at the end. The fixes from the final review were checked again and all 17 items came back addressed.
- Tests: 410 unit tests in the web app, 27 in the worker, and an end-to-end run-through in a phone-sized browser.

## Decisions made during the build (to check)

1. Screens that weren't built yet showed a "Coming soon" placeholder. All of them are gone now.
2. "N bills due this week" on Home counts overdue bills plus those due this week.
3. Joining reads the shared `ledger.json` file directly (the `JOIN_MODE` setting is 'file'). The other mode, 'folder', may not work with the app's limited Drive access.
4. Google AI bill reading stays in Settings, off by default (Adithyan's call).
5. Editing an expense's payment status:
   - The automatic "paid now" payment is replaced.
   - Real payments to a supplier are kept while the bill stays on credit.
   - A collection ends up with no payments.
6. Dates like 11/25/2026 on English bills: if the first number is above 12 it's day/month, if the second is above 12 it's month/day, and if neither, it's read day-first. You always confirm the date before saving.
7. A joining phone never writes the restaurant settings. It syncs first and takes the owner's settings.
8. Each phone keeps its own Excel exports and photo backups in its own Drive. Only `ledger.json` is shared, so the two phones don't see each other's bill photos.
9. Until a newly signed-in phone has been matched to its restaurant, sync is paused. This stops it overwriting the owner's data.
10. Signing in with a different Google account asks you to **Reset this phone**. It never mixes two restaurants' books together.
11. The sign-in helper stores one Google sign-in per account, not per phone. Signing out of one phone doesn't sign out the other. "Disconnect Google completely" cuts off every phone on that account.
12. A joined phone keeps its link to the shared restaurant when it signs out. It's restored when the same account signs back in. A phone that belongs to someone else's restaurant is never made its owner.
13. Backed-up photos come back on a new phone signed in to the same account.
14. Joining when the phone already has entries asks whether to add them to the shared restaurant or erase them first.
15. Reports shows spending by supplier.
16. Amounts excluding tax (HT) are optional, under "More" when adding an entry. The app never estimates VAT. In HT view, a banner shows when most amounts still include tax.
17. Both users can change the restaurant settings (as the design says). Only the owner can invite people.
18. Bill photos, the Google AI key, the PIN and the app language stay on each phone and never sync.

## Left for later (no risk to data)

- History has text search only. Filters by type, category, supplier and date aren't built yet.
- The Reports chart always groups by month.
- Settings offers 5 currencies and has no date-format option.
- A setting changed while signed out can be lost when that phone signs back in.
- Duplicate suppliers can appear if both phones create the same one while offline.
- A collection can't yet be split across channels; log several collections instead.
- `ledger.json` keeps deleted records forever. This is fine for years.
- One unit test is flaky: `Settings.test.tsx:318-328` needs a `waitFor`.
- Small items from the final check:
  - Three amounts that don't add up are accepted as typed.
  - Bill HT values can be dropped when the total is edited.
  - No test covers older automatic payments being retired.
  - "Erase then join" while offline leaves the phone empty.
  - Viewing a missing photo on a joined phone can create a Drive folder.

## Still to do by hand (step 15 and the release check)

1. Follow `README.md` Part 1 to create the Google Cloud project, deploy the Cloudflare worker, and set up Pages.
2. Do the sharing check in Part 2 with two Google accounts.
3. Install the app on both phones and check:
   - an expense syncs between the two phones;
   - a joined phone that signs out and back in stays on the shared restaurant;
   - bill reading works offline after the first use.
