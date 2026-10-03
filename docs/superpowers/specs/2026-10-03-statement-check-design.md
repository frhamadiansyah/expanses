# Statement check from screenshots — design

Status: draft for the owner's review, 2026-10-03. Brainstormed with the owner; mockups (not committed) in the session
scratchpad: `statement-check.html`, `statement-options.html`, `statement-rows-cashflow-style.html`,
`donut-filter-options.html`.

## 1. Purpose

The owner spends mostly on credit cards and wants to know **which categories the money goes to**. They do not track
bank transfers or card-bill payments, and they will not upload statement PDFs. They will take **screenshots** of the
statement.

A statement check reads those screenshots on the phone and compares them with what cicis already holds for that card
and period:

- rows already recorded are **matched**;
- rows missing from cicis are **recorded** with a category, in statement order;
- recorded transactions missing from the statement are **flagged**;
- the statement's closing balance is compared with the card's balance: **✓ Reconciled** or the difference.

It also works as a **catch-up**: checking every statement from January 2026 to now fills the card's history, after
which Cashflow's donut filtered to that card for the year answers "where does my card money go?".

Success, using the owner's HSBC Indonesia statement as the example:

- five screenshots of one statement give every row exactly once;
- known merchants come with their category already filled;
- a month with no unknown merchants records in one tap and ends **✓ Reconciled**;
- nothing leaves the phone, and no screenshot is kept.

## 2. Decisions (from the brainstorm)

| # | Decision |
|---|---|
| S1 | **Match, record missing, flag extras** (option C). |
| S2 | **Two ways in, one check screen.** From the card's page, **Activity → Check statement** with several screenshots picked at once. From Photos, **Share → cicis** with several images; the app asks which card. The period comes from the card's statement cycle and can be changed. |
| S3 | **Near amounts.** Same card, the date nearby and the amount within 5% counts as **Amount differs**. One tap chooses **Use statement amount** or **Keep mine**. Nothing recorded is changed without the owner's tap. |
| S4 | **CR rows (money in).** A CR row is a **refund** when it looks like a shop or equals an earlier purchase. A refund is recorded as money back under that purchase's category. Any other CR row is a **card payment**. |
| S5 | **Totals.** The owner also screenshots the summary. The **closing balance** is compared with the card's balance in cicis on the closing date: **✓ Reconciled**, or "Differs by Rp X" with the likely cause. |
| S6 | **Screenshots are not kept.** They are deleted when the check finishes. Only the result is kept: card, period, closing balance, status, and which row matched which transaction. |
| S7 | **Card payments are not tracked by default.** The per-card setting **Track card payments** is **off** by default. While it is off, the check records one quiet **"Payments not tracked"** adjustment per statement instead of transfers (§3.6). While it is on, a payment matches a recorded transfer into the card. If there is none, it becomes a transfer draft that asks for the From account once and remembers it, with **Not tracked** as an option. |
| S8 | **Matching never uses notes.** Matching uses the amount, the direction, the card and the date: ±3 days for purchases, ±5 days for payments. Several CR rows may add up to one recorded payment. The text only breaks a tie between same-amount candidates; if it is still unclear, the app asks. The owner's note is never changed, and the statement's text is **not stored**. |
| S9 | **Missing rows in statement order** (option C), drawn like the **Cashflow list**: a card per day, the category's icon circle, the category as the title and "merchant · card" underneath. Choosing a category for one row fills every other row of the same merchant in that check. Known merchants come pre-filled. A **Needs a category** tab shows only the gaps. **Record all N** is enabled once every row has a category. |
| S10 | **History before the card's start.** When the statement is older than the card's start in cicis, the check offers to move the card's start to that statement, with the statement's **previous balance** as the opening amount, so nothing is counted twice. The same guard applies to a bank account: a payment dated before the account's start defaults to **Not tracked**. |
| S11 | **The Cashflow donut follows the list's existing filter.** With "Paid with" set, the ring, the total and the categories show that card or account only. The only sign of the filter is the filter icon turning dark with a count (option A). The period sheet (Week, Month, Quarter, Year, All, Custom) already exists and is unchanged. "2026" in the current year means 1 January to today. |
| S12 | **The Review page uses the same Cashflow list style**: a card per day, the category icon circle, the category title, and the 🔔 📱 🧾 source marks. One look for every list of transactions. |
| S13 | **Country-neutral.** No bank is named in code. Date and amount forms are general. A card that reads wrong learns its column layout from the owner's corrections, as capture does. |

## 3. The pieces

### 3.1 Reading a statement screenshot (pure, `packages/core/src/statement/`)

Input: the Vision lines of each image (`CaptureLine[]`: text, box, height — the capture contract) plus the period.

1. **Rows.** Lines are grouped by vertical centre (tolerance about half a line height), then sorted left to right in
   each group. A row is a **statement row** when it holds:
   - one or two dates at the left. Forms: `06MAY`, `06 MAY`, `6 Mei`, `06/05`, `06-05-2026`, in Indonesian and
     English month names, from the existing date word lists;
   - an amount at the right end: `3,368,590`, `3.368.590`, `3.368.590,00`, `1,563,849CR`, `-55.000`, `55.000 DB`.
     A trailing **CR** or **K/Kredit**, a leading minus, or "+" means money in; **DB** or no marker means money out.
   - The text between the dates and the amount is the **description**.
   - With two dates, the first is the posting date and the second the transaction date when printed in that order;
     the transaction date is the one used for matching.
2. **Year.** It is taken from the period. Day and month are placed in the period, so a December–January statement
   gets the right year for each row.
3. **Summary.** In any image, a line with a balance label and an amount is the **closing balance**. Labels come from
   word lists, e.g. `new balance, closing balance, saldo akhir, tagihan baru, total tagihan, outstanding`. The
   **previous balance** is read the same way (`previous balance, saldo sebelumnya, tagihan sebelumnya`).
4. **Overlaps.** Images overlap when the owner scrolls. When the end of one image and the start of the next repeat
   the same run of rows (date, description, amount), the repeat is dropped. Two identical rows **inside one image**
   are kept, because they are real repeat purchases.
5. **Fees.** A row whose description matches fee words (`fee, biaya, materai, stamp duty, interest, bunga, annual,
   iuran`) is a fee, categorised **Fees & charges**.
6. **Learned layout.** If the owner corrects a row's amount or date, the card remembers which column held it. This
   is the capture template idea, keyed by the card (§3.4 of the transaction-capture spec).

Output: `StatementReading { rows: StatementRow[]; closingMinor: number | null; previousMinor: number | null; emptyImages: number[] }`.
(Corrected in the build: the screenshots that gave nothing are listed by index as `emptyImages`, which is what
"Nothing read from screenshot N" needs; the draft's `skipped: string[]` was never built.)
Each `StatementRow` has `{ on, postedOn, description, amountMinor (positive), direction: 'out'|'in', isFee }`.
Amounts are in the card's currency and IDR has exponent 0.

### 3.2 Matching (`packages/db`)

For each row, in date order, against the card's transactions in the period plus the matching window:

- **Purchase (out).**
  - **Matched:** same amount, same card, date within ±3 days.
  - **Amount differs:** within 5% and ±3 days.
  - Captured drafts still pending count as candidates too. A match there merges into the draft, which is then
    recorded with the statement row.
- **CR (in), refund.** A refund matches a recorded refund or income on the card. If none exists, it is **missing**,
  and will be recorded as money back under the category of the purchase it reverses (the same merchant, or the same
  amount earlier); otherwise under "Refunds".
- **CR (in), card payment.**
  - With tracking off: payments are summed into §3.6's adjustment, not matched.
  - With tracking on: a payment matches a transfer into the card within ±5 days. Several rows may sum to one
    transfer. Unmatched payments become transfer drafts.
- **Ties.** The date and then the text break ties between same-amount candidates. If still unclear: **Ask**.
  (Corrected in the build: the nearer date decides first, as Review Focus 3 expects; the text only breaks a tie
  between equally near dates.)
- **Each transaction matches at most one row,** except a payment matched by a sum.
- **Flagged:** every transaction on the card inside the period that no row matched is **Recorded, not on this
  statement**. Choices: **Move to another card**, **Delete**, **Keep**. Transactions after the closing date are not
  flagged; they belong to the next statement.

### 3.3 Categories for missing rows

- **Known merchant.** The category comes from the most recent recorded transaction whose normalised description
  matches the row. Normalising means lower case, digits and city or country suffixes removed (`JAKARTA SLT ID`,
  `TANGERANG ID`), and whitespace collapsed. It is marked "known".
- **Same merchant in this check.** Choosing a category for one row fills every unanswered row of the same normalised
  merchant, marked "same merchant". The owner can change any row on its own afterwards.
- **Fees** go to **Fees & charges**. If the workspace has no such category, it is created on first use.
- **Refunds** with no purchase to go back under (no merchant history, no earlier purchase of the same amount, none
  on the statement) go to **Refunds** (`miscellaneous.refunds`, under Miscellaneous), created on first use.
- The answers are remembered through the transactions they create, so next month's rows and captures read them as
  "known".

### 3.4 The check screen (`apps/web/src/features/statement-check/`)

1. **Start.**
   - Card and statement period: from the card page they are fixed; from Share there is a card picker.
   - The screenshot thumbnails, plus **+ Add**.
   - The note "Add every page of transactions, and the summary with the new balance."
   - The **Check N screenshots** button.
2. **Reading.** A progress line while each image is read on the phone. Vision is reached through the capture
   plugin's text recognition, extended to accept image data from the web layer.
3. **History guard (S10).** If needed, the question "Start this card on 1 Jan 2026 with Rp X owed?" is asked here.
   Moving the start replaces the card's opening (dated the day before the statement, owing its previous balance;
   removed when that is zero) and keeps one bridging balance correction on the old start date, so today's balance
   never changes. The bridge is recomputed on every later check of the card and goes when it reaches zero.
4. **Result.**
   - The headline balance card: **✓ Reconciled**, or "Differs by Rp X" with the likely cause, e.g. a missing fee
     row or an unmatched flagged transaction.
   - Count rows: **Matched N**, **Amount differs N**, **Missing N**, **Recorded, not on this statement N**. Each
     opens its list.
5. **Lists.**
   - **Missing:** drawn like the Cashflow list (S9), with tabs **All** and **Needs a category**. Tapping a row opens
     the category picker the Add form uses; a long-press opens the full Add-style review screen. **Record all N**
     sits at the foot.
   - **Amount differs:** each row offers **Use statement amount** and **Keep mine**.
   - **Not on this statement:** each row offers **Move to another card**, **Delete** and **Keep**.
   - **Matched:** read-only, saying what each row was linked to.
6. **Finishing.**
   - The statement record is saved (§3.5).
   - The screenshots and readings are deleted.
   - Matched transactions get the quiet mark "on statement May 2026" in their receipt view; it is not shown in the
     list.

### 3.5 Data (`packages/db`, migration 0066)

- `statement_checks(id, workspace_id, card_account_id, period_start, period_end, closing_minor, previous_minor,
  status 'reconciled'|'differs'|'open', difference_minor, checked_at)`.
- `statement_links(check_id, transaction_id, kind 'matched'|'recorded'|'differs-kept'|'differs-updated'|
  'payments-untracked')`, which links each transaction to the check it belongs to.
- The per-card setting **Track card payments** is stored beside the card's terms, in `card_statement_settings`; it
  defaults to off.
- **Device-local, never synced** (corrected in the build): the card's terms, postings and settlements are not synced
  today, so the checks, their links and the setting stay on the device too (none is in `SHARED_ENTITIES`). The
  transactions a check posts are ordinary transactions and sync as usual. **No statement text and no image is
  stored**; rows exist only in memory during the check.

### 3.6 "Payments not tracked" (S7)

- **One transaction per statement.** It moves money into the card from the system **balance correction** equity
  account, by the sum of the statement's payment rows that match no payment the owner recorded (a recorded transfer
  into the card is matched and linked, with tracking on or off). Its description is "Payments not tracked (N
  payments)" ("(1 payment)" for one). (Corrected in the build: the opening-balance account would make the line read
  as the card's opening; a tracked "Card payment" recorded by a check uses the same correction account until its From
  account is chosen.)
- **Excluded from reports**, from spending and from the main transaction list, using the existing exclude flag plus
  a list filter for this system kind.
- **Where it shows:** only in the card's statement list, under the Payment group.
- **Splitting it later:** "Split out a payment" turns part of it into a real transfer from a chosen account.
- **Effect:** the card's balance tracks the statement, so ✓ Reconciled works, and no bank account is touched.

### 3.7 Cashflow donut follows the filter (S11)

- `SpendingReport` accepts the list's **Paid with** filter. The ring, the total, the categories and the drill-down
  all read only transactions with an entry on that account, counting that account's share of each one.
- The filter icon shows dark with a count when any filter is on; it already does this for the list.
- No other change.

### 3.8 Review list in the Cashflow style (S12)

- `ReviewPage` draws drafts in the same style as Cashflow: a card per day, the icon circle (category, or a yellow "?"
  when no category is chosen yet), the category title, and the source mark plus merchant and account.
- Swipe, tap-to-open on the Add-style screen and Record or Discard are unchanged.

## 4. Data flow

1. **Picking the screenshots.** Card page → Check statement → pick images; or Share → cicis → pick card. Images go
   from the web layer through the capture plugin, or from the share extension through the holding area, marked as a
   statement batch.
2. **Reading.** Each image is read by Vision on the phone, giving `CaptureLine[]` per image. §3.1 turns them into
   one `StatementReading`.
3. **Guard.** S10's history guard runs if the statement is older than the card's start.
4. **Matching and categories.** §3.2 matches the rows; §3.3 fills categories.
5. **The owner's answers.** The owner answers the gaps, the near amounts and the flags, then taps **Record all**.
6. **Recording, in one database transaction:**
   - post the missing rows as transactions;
   - apply the "Use statement amount" changes;
   - post the payments adjustment;
   - save the `statement_checks` row and its links.
7. **Cleanup.** The images are deleted.

## 5. Privacy

- Nothing leaves the phone. There is no network call in the statement code.
- The header (name, address, full card number) is never stored. Only rows and the two balances are read into
  memory, and only the transactions the owner records persist.
- Screenshots are deleted after the check (S6). Statement text is not stored (S8).

## 6. What goes wrong

- **A screenshot with no rows** (cropped or blurry): it is listed as "Nothing read from screenshot 3", with
  **Remove** or **Retake**.
- **No summary screenshot:** the check runs without a balance comparison, and the headline says "Add the summary to
  reconcile".
- **A row read wrong:** tap it to correct the amount or date. The correction teaches the card's layout.
- **A statement already checked for this period:** the app offers **Check again**, which reuses the existing links,
  so nothing is posted twice.
- **The bank shows a foreign-currency purchase in IDR:** it matches by IDR amount within 5% (S3). If it is outside
  5%, it shows as missing plus flagged, and the owner resolves it by Keep or Delete.
- **Payments that add up to the wrong total:** with tracking off this cannot happen, because the adjustment is what
  the statement says.

## 7. Testing

- **Reader.** A corpus of synthetic statement line sets: the HSBC-like layout from the owner's screenshot with
  invented merchants, an Indonesian-language layout, a December–January statement, overlaps between images, CR and
  DB markers, and fee rows. Fast-check properties cover amount forms and the year placement.
- **Matching.** Tests cover:
  - an exact match, ±3 and ±5 days;
  - 5% near amounts;
  - a sum-match for split payments;
  - a tie that needs the owner to choose;
  - a captured draft merging into the statement row;
  - a refund using the original category;
  - a flagged transaction after the closing date that is not flagged.
- **Reconcile.** Closing-balance equality including the payments adjustment, and the history guard moving the card's
  start without double counting.
- **The donut filter.** Totals restricted to one account, and split transactions counted by that account's share.
- **E2E (Playwright).** Statement lines are injected through the e2e test hook into the reading step. Then: record
  all, use a statement amount, keep a flagged row, see ✓ Reconciled, and filter Cashflow to the card for the year.

## 8. Build order

1. Core reader (§3.1) with its corpus.
2. Matching, categories, the payments adjustment and migration 0066 (§3.2, 3.3, 3.5, 3.6).
3. The check screen, the card page entry and the history guard (§3.4, S10).
4. The share-sheet entry for several images (S2) and the plugin's image-data recognition.
5. The Cashflow donut filter (§3.7) and the Review list style (§3.8). These are independent and can run in parallel
   with 1–4.

## 9. Out of scope

- PDF statements (the owner will not upload them) and OCR of photographed paper statements. Paper may work through
  the same reader but is not a goal.
- **Pay the bill**, and the bill and due date on the Cards list. These were proposed separately; the owner does not
  track payments.
- A separate card spending tab (option 2C was rejected).
- Minimum payment and due-date reminders.
