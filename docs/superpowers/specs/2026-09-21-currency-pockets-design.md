# Currency pockets — one bank account, several currencies — design

Status: approved · 2026-09-21
Decisions: `decisions-pockets.md` (user, 2026-09-19)
Mockup: `pockets.html` (https://claude.ai/artifact/PDJfAf3Ps5a66QfV4qVQHA) — the interactive phone (Accounts →
BCA Pocket Valas → US dollar, → Move between pockets, → New account), the three list options, and the rule that
does not bend.
Chosen: list shape **P1** (a parent row, tap to open). The opening balance of each pocket takes an **optional rate**,
resolved for the opening date when left blank.

**Build order (ruling, 2026-09-21): this feature builds before securities**, which is not built. Pockets therefore
writes the parts the decisions say must serve both subjects — the multi-currency sum, the R1 figure and the grouped
row — as shared parts, and securities reuses them (§13). Assumed landed: data safety, event RAB and the Add
Transaction rebuild (the `tx-form.ts` kit, `ratesForSave`, `settledAmount`, `evaluateAmount`). Branches from `main`;
`feat/set-aside` (not merged) touches several of the same files (plan, Global Constraints).

## 1. What we are building

Some banks give one account that keeps several currencies inside it — a US-dollar balance, a Singapore-dollar
balance and a rupiah balance, all under one account number. Others give one account per currency. The app has to
fit both without asking which kind of bank the user is with.

- **A multi-currency account is a parent with one pocket per currency.** The parent is one row in Accounts showing
  the converted total, `≈ Rp 58.982.000`. Tapping it opens the account: the total and the rates it used, one row per
  pocket, then **Move between pockets** and **Add a pocket**.
- **A pocket is an ordinary account.** Tapping one opens the same page any money account has: the balance, its kode
  harta, the rate it was opened at, and its transactions. It can be spent from, paid into and transferred from like
  any other.
- **A single-currency account stays exactly as it is today** — a plain top-level row, no parent, no nesting. What
  decides the shape is how the user set the account up. There is no "is this bank multi-currency?" switch to get
  wrong.
- **Moving money between pockets is a transfer with both currency legs**, because converting USD to SGD inside one
  account is an exchange at a rate the bank chose. Recording both legs is what makes the bank's spread visible
  ("The bank's rate cost you Rp 35.160") instead of losing it in a rounding difference.

## 2. The rule that does not bend

**One account, one currency — at the ledger.** A pocket *is* an account, with a currency of its own. The parent is a
display device: it holds no money, it only adds its pockets up. This keeps every balance, every conversion and every
statement unambiguous, and it is enforced in the repository, not only by the screens (§4).

## 3. Data model

### 3.1 No migration

`accounts.parent_id` has existed since migration 0001 and already carries the category tree; pockets reuse it for
money accounts. **No migration, no new table, no new column.** Migration number 0052 was reserved for this feature
and is not used.

| Row | `kind` | `subtype` | `currency` | `parent_id` | asset profile | entries |
|---|---|---|---|---|---|---|
| The parent, "BCA Pocket Valas" | `asset` | the kind the user chose (Saving account → `savings`) | the workspace's base currency | null | **none** | **never any** |
| A pocket, "BCA Pocket Valas · USD" | `asset` | the parent's subtype | its own (`USD`) | the parent's id | kas, the item's code (0102 for a saving account), bank as `inst` | ordinary |

The parent carries the base currency only because the `accounts` table's CHECK requires an asset to have one
(`0047_cash_equivalents.sql:37`). Nothing reads it as money: the parent has no entries, ever.

### 3.2 What makes an account a parent

An asset account is a **pocket parent** when any asset account, archived or not, names it in `parent_id`. That is
the whole test, computed from the account list by one function (`pocketParentIds`). Today no money account has a
`parent_id` (only categories do, and they are `income`/`expense`), so existing data is untouched.

### 3.3 Names

A pocket is stored as `"<parent name> · <currency code>"`, e.g. `BCA Pocket Valas · USD`. Every place that prints an
account name — the Paid with list, a transaction row, a statement, the kas row of the tax report — therefore names
the bank and the currency without being taught about pockets. The pocket list on the parent's page shows the
currency's own name ("US Dollar") instead, since the bank is already the page title.

Renaming the parent renames each pocket whose name is still exactly `"<old name> · <code>"`. A pocket renamed by
hand keeps its own name.

### 3.4 The rules the repository enforces

| Rule | Where | Words |
|---|---|---|
| A pocket is an asset | `createAccountTx` | "Only a money account holds pockets" |
| One level only | `createAccountTx` | "A pocket cannot hold pockets of its own" |
| A pocket is the same kind of account as its parent | `createAccountTx` | "A pocket is the same kind of account as BCA Pocket Valas" |
| A parent has never held money | `createAccountTx` (any entry on the parent, posted or void) | "BCA Pocket Valas already holds money of its own, so it cannot hold pockets" |
| One active pocket per currency | `createAccountTx` | "BCA Pocket Valas already has a USD pocket" |
| An account with pockets starts with at least two | `openPocketedAccount` | "An account with pockets holds at least two currencies…" |
| A time deposit holds one currency | `openPocketedAccount` | "A time deposit holds one currency. Open one deposit per currency." |
| Nothing posts to a parent | `postTransactionTx` — the one place any entry is written | "BCA Pocket Valas holds no money of its own. Choose one of its pockets." |
| A parent is archived after its pockets | `archiveAccount` | "BCA Pocket Valas still has pockets: USD, SGD. Archive each pocket first." |

## 4. The parent holds nothing — every reader

The refusal in `postTransactionTx` is the guarantee: every screen, the CSV import, the review queue, trades,
bills, goals and card payments post through it (`ledger.ts` is the only `insert(entries)` in the repository). The
readers below are what keeps a parent from being *offered* or *shown* as money.

| Reader | What it does with a parent |
|---|---|
| `assetValuesAt` | Leaves it out. This one change covers net worth, the net-worth Assets list, the balance sheet, idle cash, goal funding, health ratios and the tax report's inputs (`coretaxInputsFor`), all of which read it |
| `nativeBalances` | Nothing to change: a parent has no entries, so it has no balance |
| Every picker of money (Paid with, From, To, the review queue, events, import, goals, card payers, the quick row editor, the table) | Built from `moneyHolders(accounts)`, which is `isMoneyAccount` minus parents. `isMoneyAccount` itself is **unchanged**, because `TransactionsPage` uses it to decide that an account's history is owner-wide — which a parent's is |
| `/transactions?account=<parent>` | Already includes an account's children (`TransactionsPage` scope), so it lists every pocket's movements. The list's totals read `baseMinor`, so mixed currencies add up correctly |
| The Accounts page | Draws the parent as one row (§7) and its pockets not at all |
| `periodFlows` | Unchanged. A move between two pockets never reaches income or spending (no category). Between two *savings* pockets, "put away" moves by the spread only: a cost is money taken back out of savings (put away falls by Rp 35.160), a gain is not counted, because the money did not come from spending money. That is today's rule for any transfer between two savings accounts, pinned by a test and not changed here (§17.4) |

## 5. Opening an account with pockets

`/accounts/new` → a kind of account → the form (`CashAccountForm`). For the kinds of account held at an institution
(Current account, Saving account, Fund account) and not a time deposit, the form gains one switch:

**Holds more than one currency** — *Off for an account that holds one currency. On for one that keeps several
currencies inside it.* (Country-neutral copy; the mockup's bank names are not shown.)

- **Off** — the form is exactly today's.
- **On** — Currency, Balance now and the single Rate row give way to a **Pockets** group. Each pocket is three rows:
  **Currency**, **Opening balance** (in that pocket's own currency) and **Rate** (only for a currency other than the
  workspace's). Under them: **Add another currency** and, when there are more than two, **Remove the last pocket**.
  It opens with two pockets: the workspace's currency and the first currency not yet used.
- **The rate is optional.** Filled, it is checked (`checkManualRate`) and stored as a manual rate for the opening
  date, exactly as today's form does. Blank, the rate for the opening date is resolved (`resolveRates`), and only if
  none can be found does saving stop, naming the currency: "No SGD→IDR rate available. Enter it manually." The two
  copies of this logic that exist today (`AccountsPage`'s form and `CashAccountForm`) become one function,
  `openingRateFor`, which the pocket form calls per pocket.
- **Saving is atomic.** Every rate is settled first; then the parent and every pocket, with their opening balances
  and kas rows, are written in one database transaction (`openPocketedAccount`). A pocket that cannot be opened
  leaves no parent and no other pocket behind.
- Each opening balance is read by `parseMajor` in **that pocket's currency**, the reader the account forms already
  use. Changing a pocket's currency after typing its balance re-reads the same text in the new currency, and a text
  the new currency cannot hold (`2400.50` for IDR) is refused in `parseMajor`'s words rather than rounded.

## 6. Add a pocket

`/accounts/$accountId/pocket`, from the parent's page. Rows: **Currency** (only currencies the account has no active
pocket in), **Opening balance**, **Balance as of**, **Rate** (optional, as §5). Saved by `addPocket`, which files the
pocket under the item code of the parent's kind and copies the bank from the account's first pocket. It refuses an
account that has no pockets — a plain account does not turn into a parent (§17).

## 7. The Accounts list (P1)

The Money section is the same `RecordTable` it is today, with the same five columns on a desktop and the same
sideways scroller on a phone. A pocket never appears as a row of its own. A parent is one row:

| Column | A parent shows |
|---|---|
| Account | its name, linking to `/accounts/$accountId`; under it "Saving account · 3 pockets" |
| Filed as | "Each pocket files its own row" — the parent is never on daftar harta |
| Balance | `≈ Rp 58.982.000`, the pockets converted at the rates this device holds for today and added up; or "No SGD rate yet" when a pocket's currency has none |
| (points) | nothing |
| Rename · Archive | as for any account; Rename renames the pockets (§3.3); Archive is refused while pockets are open (§3.4) |

**A total needs every rate.** If any pocket's currency has no rate at all, the row does not add up the rest and
does not add raw minor units — it says which rate is missing. (`/net-worth/loans` still adds mixed-currency loans as
if they were rupiah; that is the defect this rule exists to avoid, and it is not copied.)

**The Money tile** (user decision 7, 2026-09-21) sits over the list: "Money ≈ Rp 103.882.000 · across 4 accounts ·
3 currencies" — every money account (the cash kinds of the catalogue, not holdings, not debts) and every pocket at
today's held rates, an account with pockets counting as one account. With a missing rate it gives no figure and
names the rate.

Rates for display come from `useStoredRates` — what this device already holds, the last known rate when today's is
not stored — so opening a screen never reaches the network.

## 8. The account page — `/accounts/$accountId`

- **Title** the parent's name, back to **Accounts**.
- **Hero**: the ≈ total in the workspace's currency. Caption: "≈ at 16.250 IDR per 1 USD · 12.680 IDR per 1 SGD"
  ("last known" beside a rate that is not today's), and "3 pockets · can be spent from" (or "cannot be spent from
  directly" for a kind that cannot). With a missing rate, no hero: one line saying which rate is missing, and that
  each balance below is exact.
- **Pockets** — one row per open pocket, in the order they were added: the currency's name, "Opened 2025-02-04"
  under it, and the figure **R1**: the pocket's own balance leading, `≈ Rp 39.000.000` beneath it (nothing beneath a
  pocket in the workspace's own currency). Each row opens the pocket's page. Footer: *Each pocket keeps its own
  balance in its own currency. The account only adds them up.*
- **Move between pockets** (only with two or more pockets) · **Add a pocket** · **See their transactions**
  (`/transactions?account=<parent>`).

## 9. The pocket page

A pocket's page is the page every money account already has, `/net-worth/assets/$accountId`
(`AssetDetailPage`), with two additions that apply to **any money account held in a foreign currency** — a
single-currency USD account gets them too, as the mockup shows for the plain USD account:

- Under the hero figure: `≈ Rp 39.000.000 · at 16.250 IDR per 1 USD`.
- **Opened at 15.940 IDR per 1 USD** — the rate the opening balance was posted at (`openingsOf`), when there is one.

And one for a pocket: **back** goes to its parent's page, named, rather than to All assets. The kode harta
(`AssetSettings`), the link to its transactions, the chart and Archive are unchanged.

## 10. Moving between pockets — `/accounts/$accountId/move`

This is a new kind of transfer, and currency is where this project's worst defects came from (a transfer once drew a
currency control its save ignored and moved Rp 100 where the screen said Rp 1.600.000). Its currency handling is
therefore designed, not inherited by accident:

### 10.1 Rows

**From** (a pocket, "US Dollar · 2.400,00 available") · **To** (another pocket) · **Leaves USD** · **Arrives SGD** ·
**Bank's rate** (read-only, "1 USD = 1,2760 SGD") · **Date**. Then the spread, then **Move it**.

### 10.2 Where each figure's currency comes from

- The screen holds an ordinary transfer `FormDraft` (`mode: 'transfer'`, `moneyId` = From, `toId` = To).
- **Leaves** is `amountFields(draft, …).amount` — the kit's one decision about the typed figure. A transfer offers
  no currency flag (`currencyChoosable`), so it is always the From pocket's currency.
- **Arrives** is `receivedField(draft, …)`: a new function beside `amountFields` in `tx-form.ts`, returning the
  Received field's label, value and currency — the To account's — or null when the two currencies match. The
  Transfer tab's **Received amount** row and **the save** (`transferPostingLines`, and the goal branch) are changed
  to read the same record, so the screen that draws the figure and the posting that moves it cannot disagree about
  its currency. The labels on this screen are built from those records' currencies ("Leaves " + the amount field's
  currency), never from the pocket rows separately.
- Every figure is read by `evaluateAmount`, the kit's one reader; blur settles it with `settledAmount`.
- **There is no third currency and no flag.** Between pockets there is no merchant to have charged a third one.
- **Changing From or To clears both figures.** They were typed in the old pockets' currencies; carrying `500` from
  a USD pocket into a JPY one would re-read it at a different scale. Choosing the pocket already chosen on the other
  side swaps the two.
- **Arrives is never pre-filled.** It is what the bank actually gave, which is the one figure only the user has; an
  estimate there is the shape of the `¥120 → Rp 2.270` defect. (The Transfer tab's Received amount is not pre-filled
  either.)

### 10.3 The bank's rate and the spread

- **Bank's rate** = what arrived ÷ what left, each in major units (`impliedRate`). Display only; nothing stores it.
- **The spread** (`exchangeCost`): what left, converted to the workspace's currency at the rates this device holds
  for the move's date, minus what arrived, converted the same way. Positive: "The bank's rate cost you Rp 35.160";
  negative: "The bank's rate gained you Rp …"; zero: "matched". Footer: "US$500,00 was worth Rp 8.125.000 on
  2026-09-21; S$638,00 is worth Rp 8.089.840. The gap is the bank's spread, and it is recorded." With a missing rate
  the spread row is not drawn.
- **It is recorded.** The posting is `exchangeLines` through the Currency exchange account, as every cross-currency
  transfer already is. Each leg is converted at its own rate, so the Currency exchange account's base-currency
  total for the move is exactly the spread shown (the arithmetic is the same `convertMinor` on the same figures).

### 10.4 Saving

`formToPost` → `ratesForSave` (which asks for a rate row on this screen when one is missing) → `postTransaction`.
The same three functions the Transfer tab calls; nothing on this screen builds a posting line. Description:
"BCA Pocket Valas: USD → SGD". After saving, back to the account page.

A move is afterwards an ordinary transfer: its receipt, its edit (the full form's Transfer tab), its delete — every
refusal those already carry applies unchanged.

## 11. The Transfer tab and every other picker

Pockets are ordinary accounts, so they appear wherever money accounts are chosen, under their full names. The
parent appears in none of them (§4). A USD→SGD transfer made on the Transfer tab between two pockets posts exactly
what the Move screen posts; the two differ only in layout.

## 12. Tax report and net worth

- **Daftar harta**: each pocket is its own kas row — its code (0102 for a saving account), its own name
  ("BCA Pocket Valas · USD"), its balance in its currency, converted as every foreign kas row already is. **The
  parent never appears**: `assetValuesAt` leaves it out, so `coretaxInputsFor` never sees it. No double counting.
- **Net worth** counts each pocket once at its value; the parent contributes nothing.
- The net-worth **Assets** list shows an account with pockets as **one grouped row** — its name, "3 pockets", the ≈
  total — opening to the account's page (user decision 8, 2026-09-21). Because a ≈ row beside a raw group total would
  contradict itself, that page's group totals and its hero are converted by `sumToBase` too, refusing a missing rate;
  today they add minor units of every currency as if they were the first row's.

## 13. The parts securities will reuse

The decisions say the grouped row — "a parent that sums its children, opens to reveal them, and holds nothing
itself" — is designed for both subjects and must not be built twice. Securities was meant to land first; the order
is now reversed (ruling, 2026-09-21), so this feature builds the shared parts, free of pocket words:

1. **The summing model** — `sumToBase` in `packages/core/src/money/exchange.ts`: amounts in several currencies as one
   base figure, or none with the missing rates named. (Core's `netWorth` returns a partial total beside
   `missingRates`, and `asset-values.ts`'s `toBase` answers 0; neither is a substitute.)
2. **The R1 figure** — in the kit, `approxLine` / `rateLine` (`ui/native/approx.ts`) and `ApproxFigure`
   (`ui/native/Grouped.tsx`): the native figure leading, `≈` the converted figure beneath.
3. **The grouped row** — in the kit, `groupedFigure` and `GroupedRow`: one row, the ≈ total or the missing rate named,
   opening to where the children are listed. The Accounts page stays a `RecordTable` (its rows carry Rename and
   Archive) and takes the same `groupedFigure` text; the net-worth Assets list uses `GroupedRow`.

Nothing in the database depends on 0051.

## 14. Testing

**Pure (`packages/core`)** — `sumToBase`: the mockup's three pockets add to Rp 58.982.000; a missing rate gives no
total and names the currency (and is neither the raw-minor sum nor the sum without it); a negative pocket is
subtracted, not added; rounding is half away from zero (a figure at `.58` tells round from floor). `exchangeCost`:
the mockup's $500 → S$638 costs Rp 35.160; a better-than-market rate gives a negative cost; USD→IDR and KWD→IDR
catch an exponent mistake. `impliedRate` across exponents 0, 2 and 3.

**Repository (`packages/db`)** — opening an account with pockets writes one parent with no profile and no entries,
and one pocket per currency with its opening balance at its own rate; every refusal of §3.4; a refused pocket leaves
nothing behind; posting to a parent is refused before anything is written; renaming carries to pockets named after
the parent only; `assetValuesAt`, net worth and `coretaxInputsFor` see each pocket once and the parent never; a
USD→SGD move leaves the Currency exchange account holding exactly `exchangeCost(...).costMinor` in base; a move
between two savings pockets lowers put-away by exactly the spread and reaches neither income nor spending;
`openingsOf` returns the opening rate.

**Web unit** — `moneyHolders`; `receivedField` and the posting agreeing on the second figure's currency; the move
screen's figures and `formToPost`'s lines agreeing **at every keystroke** of `500` and `638`, of `100.50` and
`1.630.000`; changing a pocket clearing both figures; the pocket form reading each balance in its own currency.

**End to end** — a combination walk (§ plan Task 10), driving every figure keystroke by keystroke
(`pressSequentially`, never `fill`) on both `chromium` and `phone`.

## 15. Out of scope

- Turning an existing single-currency account into one with pockets (§17).
- Grouping pockets on the Overview (the Assets list groups them, §12).
- A recent-transactions list on the pocket page; its transactions stay one tap away, as for every account.
- Pockets for credit cards or loans, and for time deposits.
- Fixing `/net-worth/loans`'s mixed-currency sum, or `netWorthAt` counting a missing rate as 0.

## 16. Decisions taken here that the decisions file did not cover

1. **The parent's currency** is the workspace's base currency, because the table requires one; nothing reads it.
2. **Pocket names** are `"<parent> · <code>"`, stored, so no reader of names needs to learn about pockets; renaming
   the parent carries over to pockets still named that way.
3. **Which kinds get the switch**: Current, Saving and Fund accounts — the kinds held at an institution — and not a
   time deposit, whose terms are per deposit.
4. **At least two pockets** to open; more are added from the account page.
5. **No pre-fill of Arrives**, and changing a pocket clears both figures (§10.2).
6. **Display rates are the stored ones** (`useStoredRates`), so opening a screen never fetches.
7. **`isMoneyAccount` is not changed**; `moneyHolders` is added beside it for pickers (§4).
8. **One `openingRateFor`** replaces the two copies of the opening-rate block, and Add asset's third reader.
9. **Pockets keep the order they were given** in `accounts.sort_order` (an existing column), because ids made in one
   millisecond are not ordered. In pickers sorted by (sort order, name) a pocket after the first lists after the
   other money accounts.

## 17. Open questions

1. **Converting an existing account — out of scope (user, 2026-09-21).** A user who already recorded "BCA Valas USD" as a plain account and now wants
   an SGD pocket beside it cannot attach one: `addPocket` refuses an account with no pockets, and a plain account
   that has held money cannot become a parent. Today's answer is to open a new account with pockets and transfer the
   balance across. "Move this account under a new parent" is not built.
2. **The Accounts summary tile — decided: built** (user decision 7, §7).
3. **Net-worth Assets list — decided: pockets group under their account** (user decision 8, §12).
4. **The spread in "put away".** `periodFlows` counts a cross-currency transfer between two savings accounts
   asymmetrically: a spread that costs lowers put-away, a spread that gains is ignored. Pockets make such transfers
   common. Whether the gain should count too (or neither) is not decided; the build keeps today's rule and pins it.

## 18. What the code says about the decision record

- "No migration is needed" — **confirmed**: `parent_id` exists and `createAccountTx` already accepts it for any
  kind. The reserved 0052 is unused. One caveat the record did not mention: the table's CHECK requires an asset to
  have a currency, so the parent carries one (§16.1).
- "Every cash subtype already accepts any currency" — **confirmed** (`openCashAccount` passes `input.currency`
  straight through).
- "The opening rate is already optional … leave it blank and it resolves" — **confirmed for money accounts only**,
  and implemented twice (`AccountsPage.tsx` and `CashAccountForm.tsx`, identical blocks). **Add asset does not**:
  `add-asset.ts:156-158` reads a typed rate with its own parser (`Number(typed.replace(/\./g, '').replace(',', '.'))`,
  so `16.500` is 16500 there and 16,5 under `parseRate`) and, when the rate is blank, posts with no rate, which
  `planPosting` refuses for a foreign currency. **Fixed here** (plan Task 4 Step 5b): Add asset calls the same
  `openingRateFor` the money forms use, so a typed rate is read by `parseRate` (and previewed) and a blank one is
  resolved for the opening date — one rate for all the opening's purchases, dated at the earliest, as the form
  already applied one rate to them all.
