# Workspaces, steps 3–4: switching, and across workspaces — design

Status: approved · 2026-09-18
Builds on: `docs/superpowers/specs/2026-09-17-workspaces-design.md` (sections 4–7), whose steps 1–2 are merged.
Mockups: workspaces (switcher in ⋯, the workspace list, New workspace, card statement badge, an event across workspaces).

## 1. Where this starts

Steps 1 and 2 put books under the owner scope and taught the book-scoped repositories to read them:
`WorkspaceContext.bookId` narrows categories, category sets, budgets, expected income, bills, Cashflow's list and the
month's totals; `ownerScope(ws)` drops the narrowing for everything that belongs to you. One book exists, so nothing
has changed on screen.

This build makes a second workspace reachable and correct: the four preconditions the steps 1–2 review found
(section 2), the switcher and the workspace list (section 3), New workspace (section 4), Settings → Workspaces with a
base currency of its own (sections 5 and 6), and then what has to hold once two workspaces really exist — events, the
events-in-budget flag, and badges on a card's statement (section 7).

In the product the word is **workspace**. In code it stays **book**.

## 2. The four preconditions

These are money-correctness, not polish: each of them is a wrong figure the moment a second workspace exists, so they
land before any switcher does.

### 2.1 Personal is found by kind, and cannot be archived

`personalBook` and `personalBookIdTx` return *the first unarchived book*. Archive Personal and Business inherits
every fallback: expected-income dual writes (`budget-settings.ts` `targetsFor`), recreated default categories
(`ensureCategoryKeys`), default category sets, and the book a category with no context is filed into.

- Both functions look the book up by `kind = 'personal'` — the book migration 0042 created, or `createPersonalBookTx`
  did — ordered by `sort_order, created_at`, and fall back to the first unarchived book only when a workspace somehow
  has none of that kind (a database whose personal book was renamed and re-kinded by hand).
- `archiveBook` refuses a book whose kind is `personal`, with code `PERSONAL_BOOK`: "Personal is where categories and
  expected income fall back to, so it stays." The existing "last book" refusal stays.
- `createBook` refuses `kind: 'personal'` for a second book in the same workspace (code `ONE_PERSONAL`), so the
  lookup can never be ambiguous.

Also in this pass, from the deferred minors: `createBook` validates `baseCurrency` with `isSupportedCurrency` and
`kind` against the four kinds; `renameBook` and `archiveBook` refuse an id that is not a book of this workspace
(`NOT_FOUND`) rather than updating nothing; `setActiveBook` refuses a book that is not this workspace's or is
archived; `BookError` carries a `code` as `LedgerError` and `RecurringError` do; migration 0046 adds the missing
index on `book_category_sets(book_id)`.

### 2.2 An account's history shows every workspace, with a badge

`/transactions?account=…` is the history of one of *your* accounts — a card, a bank account — and an account is not
a workspace's. Today the page passes `ws` (carrying `bookId`), so opening BCA from Accounts hides every purchase
filed in another workspace, and the account's own page disagrees with its statement.

- When the scope account is a money account (`asset` or `liability`), `TransactionsPage` reads the list with
  `ownerScope(ws)`. When the scope is a category, the book narrowing stays (a category belongs to exactly one book,
  so it changes nothing, and it keeps the page honest if the id is stale).
- Every row on that page carries a small workspace badge — the book's name, in the tint of its kind — **only when
  the workspace has more than one unarchived book**. With one book there is nothing to say and no badge is drawn.
- The badge is read from `book_transactions` for the ids on screen, by one repository call,
  `bookNamesOf(database, ws, transactionIds): Record<string, { id: string; name: string; kind: BookKind }>`.
- A transaction filed in no book (a transfer, a card payment, an opening balance) has no badge: it belongs to no
  workspace, which is exactly why it shows in all of them.

### 2.3 `system_key` lookups: which caller wants which

`categoryIdsByKeyTx` returns one id per key across the whole workspace. Once a workspace copies its categories, two
rows share `food_beverage.restaurants` (0043 narrowed the unique index to allow it) and the one that answers is
whichever the query returns first. Every caller must say what it means. Two new functions replace the ambiguity:

```ts
/** One id per key, from the book the context names (else the Personal book). For writing into a book. */
categoryIdsByKeyTx(db, ws): Promise<Record<string, string>>        // unchanged name, now book-aware
/** Every id that carries each key, in every book. For owner-level figures and card rules. */
categoryIdsByKeyAllTx(db, ws): Promise<Record<string, string[]>>   // new
```

Book-aware ordering is deterministic: the context's book, else the personal book, else the book with the lowest
`sort_order, created_at`; within a book, the lowest `created_at`.

| caller | which | why |
|---|---|---|
| `catalog.ts` `writePlan` (card earn rules, via `planCatalogApply`) | **all copies** | a rule that earns on restaurants must earn on a business dinner too. `planCatalogApply` takes `Record<string, readonly string[]>` and puts every id in the rule's `match.categoryIds`. |
| `CatalogPicker.tsx` (`categoryIdsByKey`) | **all copies** | it shows which published choice maps to which of your categories; it must not claim a key is unmapped because the copy it found is in another book. |
| `point-ledger.ts` `cardYearRoi` (`miscellaneous.membership_fee`) | **all copies** | the fee was charged once, to whichever workspace was open; the card's year is yours. |
| `flows.ts` `periodFlows` (`income.realized_gains`, `government_taxes.estimated_tax`, `miscellaneous.interest`) | **all copies** | these three keys exclude or reclassify amounts. A copy left out would count a realised gain as income. |
| `debts.ts` `debtCategoriesTx` (`income.other`, `miscellaneous.interest`, `gift_giving`) | **the open book** | lending is recorded into a workspace; its interest and forgiveness are that workspace's spending. |
| `loans.ts` (`miscellaneous.interest`, `miscellaneous.fees_charges`) | **the open book** | same: a loan payment's interest is spending in the workspace being recorded into. |
| `trades.ts` `tradeAccountsFor` (fees, taxes, realised gains) | **the open book** | a purchase's fee is spending; the holding itself is yours and unaffected. |
| `categories.ts` `ensureCategoryKeys` | **Personal only** | a default recreated on open joins the tree the rest of the defaults live in. Already so; a test pins it. |
| `ImportPage.tsx` (`miscellaneous`, `income.other` fallbacks) | **the open book** | an import records into the open workspace, so its fallback category must be one of that workspace's. |

`categoryIdsByKey(database, ws)` keeps its signature and delegates to the book-aware form.

### 2.4 Owner-level forms and guesses stay inside one workspace

- **Pickers.** Lend & borrow, Loans and Buy & sell post transactions with a category line. Their category pickers
  offer one workspace's categories at a time — the open one — through the same `useInOpenBook()` the Cashflow and
  bill forms already use. That is what makes the `TWO_BOOKS` refusal unreachable by ordinary use.
- **The refusal's words.** `LedgerError('TWO_BOOKS')` currently says "A transaction cannot spend in two workspaces at
  once". A loan repayment or a lend-back is not spending, so it becomes: "A transaction cannot belong to two
  workspaces at once. Pick categories from one workspace." Neutral, and it names what to do.
- **Guesses.** `guessCategoryFromHistory` reads the whole workspace's history, so typing "Superindo" in Business can
  fill in Personal's Groceries — a category the form will then refuse. It narrows to `ws.bookId` when one is set
  (join `book_categories`), and behaves exactly as today when none is.
- **Budgets and bills refuse a foreign category.** `saveBudget` and `saveExpenseTemplate` refuse a category filed in
  another book than `ws.bookId` (`BudgetError('OTHER_BOOK')`, `RecurringError('OTHER_BOOK')`): a cap that cannot be
  seen on the sheet that owns it is a cap nobody will ever meet.
- **Postings with only a `spend_category_id`.** A card-funded trade and a card-paid loan record the category on the
  entry's `spend_category_id`, not as a category line, so the posting has no category entry and is filed in no book.
  That is deliberate and stays: they are your money moving, they show in every workspace's list like a transfer, and
  their points still count on the card. Documented, with a test that pins it.
- **Replacing keeps the filing.** `replaceTransaction` re-posts, so the new transaction is filed by the same rule as
  the original. A test pins it: edit a Business purchase's amount and it is still Business's.

## 3. Switching

### 3.1 Where the switch lives

- **Phone.** The ⋯ menu on Cashflow gains a first item, above the filters and separated from them by a gap, because
  it changes the whole app rather than narrowing one list: the open workspace's initial-tint dot, its name, and
  "Workspace ›". Tapping it closes the menu and opens the workspace sheet.
- **Desktop.** The sidebar's identity block ("Expanses · Personal · IDR · on this device") becomes the switcher: a
  button with the same dot, the workspace name, the base currency and a chevron, opening the same sheet. It is
  reachable from every screen, which is more than the phone offers, so desktop is not the weaker of the two.
- Nothing appears in the tab bar, and Cashflow's header is unchanged: with one workspace nothing on screen moves.

### 3.2 The workspace list

One sheet, `WorkspaceSheet`, used by both. It lists every unarchived book in `sort_order, created_at`:

- the kind's dot, the name, and under it "Spent {amount} this month" in **that workspace's own base currency**
  (section 6), computed for the calendar month containing today;
- a tick against the open one;
- "+ New workspace" at the foot;
- "Manage workspaces" links to Settings → Workspaces.

Choosing a workspace calls `setActiveBook`, moves the app's open book, and closes the sheet. Choosing the one
already open just closes it.

### 3.3 Switching and the cache

`AppDb.ws.bookId` is fixed at bootstrap today. It becomes state:

- `App.tsx` holds `const [bookId, setBookId] = useState(app.ws.bookId)` and provides
  `{ ...app, ws: { ...app.ws, bookId }, switchBook }`.
- `switchBook(id)` — `setActiveBook(database, ws, id)`, then `setBookId(id)`, then `queryClient.removeQueries()`.
  **Removed, not invalidated**: an invalidated query keeps its old data while it refetches, and the old data is
  another workspace's money. Every screen shows its loading state for a moment instead, which is the truth.
- Book-scoped query keys keep carrying `ws.bookId` (`['transactions', workspaceId, bookId, …]` and the rest) so that
  two books cannot share a cache entry within a session either.
- The active book is remembered in `settings` under `active_book:<workspaceId>`, so the app reopens where it was;
  `activeBookId` already falls back to Personal when the remembered book has been archived.
- Nothing else reloads: the database handle, the router and the URL stay as they are. A page opened for an account
  (`?account=…`) keeps showing that account, since it is owner-level (2.2).

## 4. New workspace

A sheet opened from the workspace list, with the rows of the mockup:

| row | behaviour |
|---|---|
| Name | required, trimmed |
| Kind | Personal / Business / Family / Shared, as four tiles. `personal` is offered only when the workspace has no personal book — which, after 2.1, is never in practice; the tile is disabled with "There is already a Personal workspace". |
| Base currency | from `CURRENCIES`, defaulting to the owner's base currency |
| Categories | "Start empty" or "Copy from …" — one entry per existing unarchived workspace |
| Count event spending in this workspace's monthly budget | a switch. Default: off for Family and Shared, **on** for Business (a client dinner on a trip is still the month's cost of doing business), off for Personal |

Creating calls `createBook`, then `switchBook` to the new one, so the next thing seen is the new workspace's
(possibly empty) Cashflow. An empty workspace shows the usual empty states; categories are added from the category
picker's "New category" or the Categories screen, which already file into the open book. **No category list is
hard-coded per kind** — the copy is the only starting point the app offers.

What a copy copies (`createBook` with `copyCategoriesFrom`):

- every unarchived category of the source book that is not a category-set member, as new rows with new ids, parents
  remapped, `system_key` kept, `icon` and `sort_order` kept;
- its `book_categories` row;
- **`category_mccs`** for each copied category — the typed MCC is a property of "this category means groceries",
  which is exactly what was copied. Without it a copied workspace earns at the card's base rate for a month until
  the owner notices.

What it does not copy: budgets, overrides, bills, expected income, transactions (the new workspace starts with no
money in it), category sets (they are an event's business, and `NOT_IN_A_SET` already excludes them), and
`catalog_category_choices` — despite the steps 1–2 spec's table, that row is keyed by `(program_id, option_key)`,
not by category, so it belongs to the card and there is nothing about it to copy.

## 5. Settings → Workspaces

There is no Settings screen today. One arrives: route `/settings`, `SettingsPage`, listed in `MORE_GROUPS` under
"Keep it safe" and in the desktop sidebar's second group, so both shells reach it. It holds, for now, one section:

- **Your money** — your own base currency (the `workspaces.base_currency` net worth, statements and balances are
  read in), shown and, as today, not editable here; the note says which figures it governs.
- **Workspaces** — one row per unarchived book: name, kind, base currency, "Count event spending in the monthly
  budget". Tapping a row opens it: rename (`renameBook`), change base currency (section 6), the events switch
  (`setBookEventsInBudget`), and Archive (`archiveBook`, refused on Personal and on the last book, with the
  refusal's words shown in place).
- Archiving hides the workspace from the switcher and from Settings; its categories and transactions stay exactly
  where they are, its cards' statements are untouched, and the app falls back to Personal if the archived one was
  open.

## 6. A base currency per workspace

### 6.1 The rule

Every entry is stored with its own `amount_minor` and `currency`, plus `amount_base_minor` in **your** base
currency. A workspace whose base currency differs from yours reads its own figures by converting each amount from
the amount's currency into the workspace's currency **at the rate on the transaction's date**, from `fx_rates` —
the same table and the same "exact date, else the latest earlier rate" rule `findRate` uses.

The conversion is **display only**. Nothing is written back, `entries.amount_base_minor` never changes, and a
workspace whose base currency equals yours takes the existing code path unchanged, so every figure a one-currency
owner sees is bit-identical to today.

### 6.2 What converts, and what does not

Converts (only when the open workspace's base differs from yours):

- Cashflow's chart: each category's total and the period total (`categoryTotalsBetween`).
- Cashflow's list: each day's total, the "N transactions · X spent · Y in" line, and the category-group totals —
  all of which read `entries.amount_base_minor` through `listTransactions`.
- The budget sheet: the spending actuals, the caps and expected income (stored in the workspace's own currency, 6.4
  — so they are *not* converted, they are simply already in it), income actual and debt payments
  (`periodFlows`), goal savings plan and actual, and the month's event line (`eventSpendingBetween`).
- The recurring bills screen and the budget's committed line (`committedByCategory`): each bill's amount, from the
  currency of the account that pays it, at the rate on the bill's out day.
- "Spent … this month" on each row of the workspace list — each in its own workspace's currency.

Does not convert, ever:

- a transaction row's own amount, which keeps showing what was actually paid, in the currency it was paid in;
- account balances, card statements, bills of a card, instalments, points and their values;
- net worth, holdings, valuations, loans, debts, goals' own screens;
- the tax report, which is the Kurs Menteri Keuangan's business and yours;
- anything read with `ownerScope(ws)`.

So a purchase of SGD 60 on a rupiah card appears on Cashflow as "S$60.00", is counted in a Business workspace based
in SGD as 60.00, and in your own IDR net worth exactly as it is today.

### 6.3 A missing rate

A rate is missing when `fx_rates` holds nothing for that pair on or before the transaction's date. Then:

- the amount is **left out** of the converted figure — never counted unconverted, which would add rupiah to dollars;
- the read reports it: every converting repository function also returns (or, for `listTransactions`, records on
  the page through the same helper) the set of `{ currency, earliest date }` it could not convert;
- the screen says so above the figure: "3 amounts in SGD are not counted: no SGD→USD rate for 15 Aug 2026 or
  earlier. Use Add transaction to enter one." — the wording the quick editor already uses for a missing rate.

A **stale** rate (the latest earlier date rather than the exact one) is used silently, as `resolveRates` already
does for posting.

### 6.4 Changing a workspace's base currency

A workspace's caps (`budgets.amount_minor`), month overrides and expected income
(`book_budget_settings`, `book_income_overrides`) carry no currency: they are figures in whatever currency the
workspace reads in. Changing that currency without touching them would turn Rp 5.000.000 of groceries into
$5,000,000.

So `setBookBaseCurrency(database, ws, bookId, currency)`:

1. finds the rate old→new on today's date (`findRate`; stale is accepted, and the chosen rate and date are returned
   so the screen can say which was used);
2. refuses the change when no rate exists at all: "No IDR→SGD rate yet. Record one first."  (`BookError('NO_RATE')`);
3. in one transaction, converts with `convertMinor` every budget cap, every budget override and the expected income
   and income overrides **of that book**, then writes the new currency on the book;
4. writes an `audit_log` row naming the old and new currency, the rate and its date, so the change is traceable.

Recurring bills are not touched: their amounts are in the currency of the account that pays them, which has not
changed.

## 7. Step 4 — across workspaces

### 7.1 An event's tabs

An event is yours and holds spending from every workspace. Its screen gains a segmented control above the ring:
**All**, then one tab per workspace that has spending tagged to this event, in `sort_order` order.

- The tabs come from `booksInEvent(database, ws, eventId): { id, name, kind }[]` — the distinct books of the event's
  transactions, by `book_transactions`. With fewer than two, no control is drawn.
- **All** reads exactly as today, with `ownerScope(ws)`.
- A workspace tab reads `inBook(ws, bookId)`: `eventSheetFor` narrows both its actuals and its planned rows to
  categories filed in that book, so the ring, the plan and the per-category lines are that workspace's share; the
  history below narrows the same way.
- A transaction tagged to an event but filed in no book (a transfer tagged to a trip) shows under **All** and under
  every workspace tab, exactly as it does in every workspace's Cashflow list, and counts in neither ring, because
  no ring counts transfers.
- Event plans (`event_budgets`) may still name categories from any workspace; a plan line whose category is in
  another book simply does not appear under this tab.

### 7.2 `count_events_in_budget`

A workspace's monthly caps leave event-tagged spending out **only when its flag is 0**. Personal defaults to 0 (a
holiday is not this month's failure to keep to the grocery cap); Business defaults to 1 (a client dinner during a
trip is still the month's cost of doing business).

- `budgetSheetFor` reads the open book's flag (`books.count_events_in_budget`, defaulting to 0 when no book is open)
  and passes `excludeEvents: !countEvents` to `categoryTotalsBetween`.
- `budgetSheet` (core) gains `eventsInCaps: boolean`. When true the caps already contain the event spending, so
  `leftOverActualMinor` does not subtract `eventSpendingMinor` a second time; the event figure is still carried
  through for display, and the sheet labels it "included in the caps above".
- Cashflow's chart follows the same flag, through the same `excludeEvents: !countEvents`: the chart and the budget
  must not disagree about what the month cost.
- The event screens themselves are unaffected: an event always shows everything tagged to it.

### 7.3 Workspace badges on a card

A card's statement, bill, points and instalments count every purchase on the card, whichever workspace it was filed
in — that is the whole point of the design and nothing about it changes. What is added is the label:

- `StatementPanel`'s purchase rows and `PurchaseList`'s rows carry the same badge as 2.2, from the same
  `bookNamesOf` call, **only when more than one unarchived book exists**;
- card payments, instalment rows and anything filed in no book carry none;
- no figure on the card screens moves.

### 7.4 Transfers

Money moved between your own accounts belongs to no workspace, so it shows in every workspace's day list and in
none of the charts or caps. `listTransactions` already does this (`NOT IN (… book_id <> ws.bookId)`); this build
pins it with a test in each workspace and a phone flow that switches workspaces and finds the same transfer.

## 8. Testing

- **Pure (`packages/core`):** the rate-picking rule (exact date, latest earlier, none), `budgetSheet` with
  `eventsInCaps` both ways, and `planCatalogApply` mapping one key to several ids.
- **`packages/db`:** the preconditions each get a test naming the wrong figure they prevent — archiving Personal is
  refused; a two-book workspace's `categoryIdsByKeyTx` answers per book while `…AllTx` answers with both; a card
  rule earns on both copies; `cardYearRoi` finds the fee whichever workspace paid it; a guess stays in its book; a
  budget and a bill refuse a foreign category; a replaced transaction keeps its book. Then: `createBook` copies
  `category_mccs`; `setBookBaseCurrency` converts caps and refuses without a rate; a converting workspace's
  Cashflow, budget and bills read in its own currency and report what they could not convert; `booksInEvent` and
  the narrowed `eventSheetFor`; `count_events_in_budget` both ways.
- **The guard stays:** `books-sample.test.ts` must keep passing untouched — every figure of the sample household
  read through its Personal book equals the same figure read through the workspace. Every task in this build runs
  it.
- **Playwright `chromium`:** switch from the sidebar; create a workspace copying categories and see the same tree;
  rename, change base currency, archive in Settings; an account's history showing both workspaces with badges; the
  event tabs.
- **Playwright `phone`:** the ⋯ menu's workspace row, the sheet, switching and finding an empty chart, New
  workspace, and a transfer visible in both workspaces.

## 9. What stays out

- **Sharing and sync.** Unchanged from the steps 1–2 spec, section 5.4: the workspace remains the unit that will be
  shared, and nothing here ties it to one device or one owner. No `workspace_members` role moves yet.
- **The workspace row in Add Transaction.** Recording still files into the open workspace; choosing a workspace
  while recording arrives with the Option B form rebuild (step 5), where the row belongs.
- **A workspace that owns accounts.** Accounts, cards, loans, goals, events, net worth and tax stay yours, once.
- **Hard-coded category sets per kind**, a workspace-level colour or icon chosen by hand (the kind's tint is
  enough for now), reordering workspaces, and deleting one (archiving is the only removal).
