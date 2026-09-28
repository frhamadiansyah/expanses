# Household sharing — v3 checked against the code (build step 0)

Checked: `2026-09-26-household-sharing-design.md` (draft v3) against the code at `725f284` on `feat/household-sharing`.
v3 was written against `445a655`; `main` has moved since (the add page, the pickers' icons, the sample household), but
none of those commits touched a table §4.1 names or the ledger's write path. Where the code and v3 differ, the code
wins and the spec is corrected in the same commit. The constant is
`packages/db/src/sync/shared-entities.ts`; its test is `packages/db/test/sync/shared-entities.test.ts`. The test
checks that every column of every synced table falls into exactly one of these: a key, a field, a link column, or
never synced. So a column added later fails the test until someone sorts it.

## 1. Tables and columns (§4.1)

| # | Where | v3 said | The code | Correction applied |
|---|---|---|---|---|
| 1 | `category` fields | "icon and colour columns" | `accounts` has `icon` and no colour column | Fields are `name`, `parent_id`, `kind`, `subtype`, `currency`, `icon`, `system_key`, `sort_order`, `archived_at` |
| 2 | `category` fields | no `system_key` | 0043 keeps a category's `system_key` per book "so card earning rules still recognise them" | `system_key` travels. Without it a joiner's own card would not recognise the book's categories when earning points |
| 3 | `category` fields | no `sort_order` | `sort_order NOT NULL DEFAULT 0` is the tree editor's order | `sort_order` travels, so both phones show the same tree |
| 4 | `budget_frequency` | "the table's key, as step 1 finds it" (§15 open) | 0053: `budget_frequencies(budget_id PK, workspace_id, frequency, amount_as_set_minor)` | `Op.id = budget_id`; fields `frequency`, `amount_as_set_minor`. Removed from §15 |
| 5 | `purchase.bill` | from `bill_payments` | the ledger writes **both** `transactions.template_id` and the `bill_payments` row from one input (`templateId`, `billMonth`) | `bill` stands for `transactions.template_id` + `bill_payments.(template_id, bill_month)` |
| 6 | `Money.lines` | `{ categoryId, amountMinor, memo }` | entries are balanced **per currency** (`planPosting`); a line's currency is part of it | Lines carry `currency`. See open item O2 for lines that are not in the book's currency |
| 7 | Insert on apply | "insert it with winners, the table's defaults" | Several columns are `NOT NULL` without a default and never travel: `created_at` (books, accounts, budgets, expense_templates, bill_skips), `updated_at` (budgets, book_budget_settings), `books.kind` | Each record's `localOnInsert` names them; apply writes a local value (now; `'shared'` for `books.kind`) |
| 8 | Never syncs | the list in §4.1 | also never sent: `books.sort_order`, `books.created_at`, `accounts.valuation_mode` (defaults to `'derived'`), every `created_at`/`updated_at`, `entries.id` (a local id) | Added to `NEVER_SYNCED_COLUMNS` and to the spec's list |
| 9 | `purchase` scope | "in `book_transactions` … and it has at least one income or expense entry" | `postTransactionTx` writes `book_transactions` only for a posting with an income or expense line, so the second clause is already true of every tagged row | Scope is "the head is in `book_transactions` for the book" |
| 10 | Tag rows on apply | "apply writes the tag row whenever it … posts a `purchase`" | `postTransactionTx` writes `book_transactions` itself, from the categories' `book_categories` rows | Apply writes only `book_categories`; the ledger tags a purchase |
| 11 | `member`, `device` | tables in §4.1 | `book_members` and `book_devices` do not exist yet; migration 0056 (Task 2) creates them | Marked `createdBy0056` in the constant; the test checks they are absent today. Task 2 removes the flag |

Confirmed with no change: `books` (`name`, `base_currency`, `count_events_in_budget`, `archived_at`; `kind` never
sent); `budgets` (scope by category, `category_account_id`, `amount_minor`); `budget_overrides` (`id`, scope by budget);
`book_budget_settings` (`Op.id = book_id`, `expected_income_minor`); `book_income_overrides` (primary key
`(book_id, month)`, so `Op.id = bookId|month`); `expense_templates` (`money_account_id NOT NULL`, carried by `payer`);
`bill_windows` (`Op.id = template_id`); `bill_skips` (primary key `(workspace_id, template_id, month)`, so
`Op.id = templateId|month`); `transaction_flags` (`channel`, `excluded`); every table has `workspace_id NOT NULL`.

## 2. The ledger doors (§6.3, §7)

| # | v3 said | The code | Correction applied |
|---|---|---|---|
| 12 | §7.2 `postTransactionTx(input with id = op.id)` | `postTransactionTx` always mints `id = uuidv7()`; `PostTransactionInput` has no `id` | Task 3 adds an optional `id` to `PostTransactionInput`, used only by apply's first post of a lineage. `replaceTransaction` spreads `...input` into its inner post, so it must drop `id` |
| 13 | §7.2 `replaceTransaction(L.head, input)` inside apply's one db transaction | `replaceTransaction(database, …)` opens its **own** `database.transaction`. That runs under a non-reentrant mutex, so calling it inside another transaction deadlocks | Extract `replaceTransactionTx(tx, ws, id, input)`; `replaceTransaction` wraps it. Apply calls the `Tx` form |
| 14 | §6.3 capture at three doors: post → new lineage; replace → diff; "`voidTransactionTx`, when not part of a replace" → void | `replaceTransaction` never calls `voidTransactionTx`. It calls the private `markVoidTx` and then `postTransactionTx` with `replacesTransactionId`, so a hook on `postTransactionTx` would also see every replacement and start a second lineage. Other code also replaces without `replaceTransaction`: `trades.ts` (recalculated sells) calls `voidTransactionTx` and then `postTransactionTx` with `replacesTransactionId`. A per-door hook would emit `{void:true}` for that pair, and void wins for ever | Capture sits at the two places the ledger writes: `postTransactionTx` (insert) and `markVoidTx` (status → void). It records the lineages each db transaction touches and flushes the **net effect per lineage** before commit (the rule is in §6.3). How the flush runs is open item O1 |
| 15 | §6.3 "`events.ts` and `set-aside-tx.ts` also insert or update `transactions`; step 1 routes each through one of the three doors" | They update in place only columns that never travel: `events.tagTransaction` sets `event_id`, and `set-aside-tx` `parkForGoalTx`/`carryTaggedTx` set `goal_id`. `ledger.setTransactionMcc` also sets `mcc` in place | No rerouting. The §6.4 test triggers fire only on **synced** columns (`AFTER UPDATE OF <synced columns>`), or these writes would fail the harness |
| 16 | §7.3 "Every `replaceTransaction` and `voidTransactionTx` already writes `audit_log`; apply passes the author's member" | `audit_log` is written by `postTransactionTx` (`'post'`, payload = the whole input) and `markVoidTx` (`'void'`, payload `{}`). A replace writes one of each. Neither carries an author | Task 3 adds an optional author (`syncAuthor`: a member id). In `PostTransactionInput` it lands in the `'post'` payload on its own. `voidTransactionTx` gains an optional author argument that goes into the `'void'` payload |
| 17 | §7.4 replace carries set-aside, goal, bill payment, card | Confirmed. `replaceTransaction` carries: the set-aside answer when `input.setAside === undefined`; a tagged goal (`carryTaggedTx`/`parkForGoalTx`); `templateId` and `billMonth` when undefined; `cardId`, `card_postings`, `card_settlements`; point actuals, photos, event items, deposit events; `channel`, `excluded`, `eventId`, `mcc`, `source`, `externalRef`, and the original currency when both fields are undefined | Stated in §7.4. **`ledgerInput` leaves `undefined` (not `null`) every input field that is not a winner**, above all `setAside`, `templateId`, `billMonth`, `cardId`, `eventId` and `mcc`. A `null` would clear the fact on the payer's device |
| 18 | — | A correction that drops every category line (a purchase re-filed as a transfer) posts a head with no book | Capture treats it as leaving the book: `{void:true}` for the lineage |

### Every writer of `transactions` / `entries`

Rows are inserted only in `postTransactionTx`. `status` is updated only in `markVoidTx`. `entries` is never updated or
deleted. Every other writer reaches the ledger through a door:

| Writer | What it writes | Door |
|---|---|---|
| `ledger.ts` `postTransactionTx` | inserts `transactions`, `entries`, `book_transactions`, `bill_payments`, `transaction_flags` (via `writeExtrasTx`) | **capture point** (insert) |
| `ledger.ts` `markVoidTx` (private) | `transactions.status = 'void'` | **capture point** (void) |
| `ledger.ts` `postTransaction` | — | `postTransactionTx` |
| `ledger.ts` `voidTransaction` / `voidTransactionTx` (with deposit-event recursion) | — | `markVoidTx` |
| `ledger.ts` `replaceTransaction` | also moves `card_postings`, `card_settlements`, point actuals, photos (tables that never sync) | `markVoidTx` + `postTransactionTx(replacesTransactionId)` |
| `ledger.ts` `setTransactionMcc` | `transactions.mcc` in place | none; `mcc` never syncs |
| `events.ts` `tagTransaction` | `transactions.event_id` in place | none; `event_id` never syncs |
| `set-aside-tx.ts` `parkForGoalTx`, `carryTaggedTx` | `transactions.goal_id` in place | none; `goal_id` never syncs |
| `transaction-extras.ts` `writeExtrasTx` | `transaction_flags` upsert/delete | called only from `postTransactionTx` |
| `expense-templates.ts` pay bills / `undoBillPayments` | — | `postTransactionTx` / `voidTransactionTx` |
| `trades.ts` (write, recalculate sells, delete) | — | `postTransactionTx` (with `replacesTransactionId` on recalc) / `voidTransactionTx` |
| `convert.ts` (purchase → investment buy) | — | `voidTransactionTx`, then a trade via `postTransactionTx` |
| `goal-transfers.ts` | — | `postTransactionTx` / `voidTransactionTx` |
| `account-delete.ts` | — | `voidTransactionTx` (the opening balance only) |
| `accounts.ts`, `cash-accounts.ts`, `debts.ts`, `loans.ts`, `deposit-automation.ts`, `drafts.ts`, `imports.ts`, `statements.ts` | — | `postTransactionTx` |
| web: `EditSheet`, `ReceiptPage`, `TransactionRow/Card/Page`, `ReviewPage`, `MovePage`, `CardHero`, `EventDetailPage` | — | the exported `postTransaction` / `replaceTransaction` / `voidTransaction` |

Migrations (`0042`, `0044`) and `importBytes` (restore) also write these tables. They sit outside capture by design:
§8.7 covers restore.

## 3. Readers of §4.4's anti-join

Corrected in fix round 1. An earlier version said one anti-join in `listAccounts` covers every named reader. That is
false: `assetValuesAt` reads every `kind = 'asset'` account straight from `accounts` and feeds Net worth, the tax
report and goal funding. The list below comes from a grep of every `from(accounts)` / `JOIN accounts` in
`packages/db/src/repos`. In `apps/web`, no file queries `accounts` directly; every screen goes through these
repository functions.

**Readers that list a set of asset accounts** (a placeholder would show up). The anti-join goes in **each** of them:

| Reader | Where | Feeds |
|---|---|---|
| `listAccounts` | `accounts.ts:107` (the select at :114) | `useAccounts()` in `apps/web/src/lib/queries.ts:10`: the Accounts page, every Paid-with and Transfer picker, Net worth's money list (`networth/attention.ts:51`), and the tax report rows (`coretax/report-rows.ts`) |
| `assetValuesAt` | `asset-values.ts:82–88` | `netWorthAt` (:193) and `sheetInputsAt` (:301), which feed Net worth and the balance sheet behind the health ratios (`networth/HealthRatios.tsx`); `networth/queries.ts:31`; `coretaxInputsFor` (`tax-inputs.ts:27`), which feeds the tax report (`tax-reports.ts:115`, `coretax/queries.ts:36`) and `kmk-rates.ts:28`; goal funding (`goal-funding.ts:99`, `:205`); idle cash (`idle-cash.ts:28`); `monthEndValues` (:254) |
| `coretaxInputsFor`'s own account read | `tax-inputs.ts:37–40` | name and subtype maps for the harta rows. It walks `assetValuesAt`'s rows, so it is covered once that reader is filtered. The predicate still goes here, so the tax report never depends on that ordering |

**Readers that need no change:**

- `nativeBalances` (`ledger.ts:593`) returns a balance for every account, placeholders included. Every consumer
  indexes it by accounts it already listed through a filtered reader: `asset-values.ts:107/201/318`,
  `tax-inputs.ts:30`, `set-aside.ts:108` (promised accounts only), `deposit-automation.ts:299` (one deposit),
  `networth/attention.ts:59` (the `useAccounts` money list), and `useBalances` (`lib/queries.ts:38`). The rule for
  the future: no consumer iterates its keys.
- Liability-only reads (`asset-values.ts:199`, `:315`): a placeholder is an asset.
- Lookups by id or into a map: `goal-funding.ts:299`, `goal-contributions.ts:110` (`PARKED` is savings, investment
  and fund, never cash), `base-costs.ts:22`, `expense-templates.ts:204`, `loans.ts:256`, `debts.ts:140`, and every
  `eq(accounts.id, …)` guard. A placeholder is reached only through a purchase's money side, and these never list
  one.

**One shared predicate.** Step 5 adds `notPlaceholder(accountIdColumn)` to `packages/db/src/sync/`. It is
`<column> NOT IN (SELECT account_id FROM book_member_accounts)`. The step applies it in `listAccounts` (with an
`includePlaceholders` opt-in for the receipt and the sync code), in `assetValuesAt`, and in `coretaxInputsFor`'s
account read. Each gets a test: a book with a placeholder holding a balance leaves Net worth, the tax inputs, goal
funding, idle cash, the health-ratio sheet and the pickers unchanged.

## 4. Open for the controller (all ruled)

These are design-level. The controller's ruling follows each item, and the spec marks each one with "(ruled On)".

- **O1. Where the capture flush runs.** Rule 14 needs a hook at the end of the caller's db transaction, before
  `COMMIT`, to turn the touched lineages into ops. **Proposed:** `createDatabase().transaction` keeps a per-transaction
  capture session (the mutex already serialises transactions, so one "current session" per `Database` is enough) and
  runs its flushers after `fn` resolves and before `COMMIT`. Writes through `database.db` outside a transaction are
  not ledger writes, so they need no session.
  **Ruled: accepted.** A per-transaction capture session in `createDatabase().transaction`, flushed before `COMMIT`; written into spec §6.3.
- **O2. Lines not in the book's currency.** Seeding sends history. A purchase from before sharing may have been paid
  from a USD card, and its category entry is then in USD with `fx_rate_to_base ≠ 1`. v3's "amounts are in the book's
  currency" does not hold for history. A receiver would hit `MISSING_RATE`. A placeholder account must have a
  currency (`accounts` CHECK: an asset has one), so it cannot take any currency. **Proposed:** a line carries its
  `currency` and `amountBaseMinor` (in the book's currency). A receiver whose head is not the payer's own posts a line
  in another currency against a placeholder for (member, currency), with `ratesToBase` taken from the carried pair.
  The payer's device keeps its own accounts as §7.4 says. The simpler alternative: seed such rows converted to the
  book's currency and move the foreign figure to `originalCurrency`/`originalAmountMinor`.
  **Ruled: the first proposal.** `Money.lines` carry `currency` and `amountBaseMinor` (book currency). A receiver that did not pay posts a line in another currency against a placeholder per (member, currency), with `ratesToBase` from the carried pair; the payer keeps their own accounts. `entries.amount_base_minor` moved from `NEVER_SYNCED_COLUMNS` into `money`. Spec §4.1, §4.2 (`book_member_accounts.currency`, `UNIQUE (book_id, member_id, currency)`), §4.3, §4.4 and §7.4 are updated.
- **O3. A book whose currency is not the workspace's.** `books.base_currency` can differ from the owner's workspace
  currency (`book-currency.ts`), and `entries.amount_base_minor` is always in the workspace currency. §8.2 checks only
  the joiner. **Proposed:** **Share this workspace** refuses a book whose `base_currency` differs from the owner's
  workspace base currency, with the same sentence §8.2 uses. Cross-currency books are already dropped.
  **Ruled: accepted.** Share refuses such a book with §8.2's sentence; spec §6.5 step 0 and §11.
- **O4. `category_needs`.** A category's need-or-choice mark (0053) is keyed by `category_account_id` and edited on
  the book's Categories page. v3 does not list it, so the two phones would disagree about it. **Proposed:** add a
  `category_need` entity (`Op.id = category_account_id`, field `need`, same scope as `category`).
  **Ruled: accepted.** `category_need` is in the constant (`Op.id = category_account_id`, field `need`, category scope), in spec §4.1, and in the schema test.
- **O5. Local side effects that void a shared purchase.** `convert.ts` turns a purchase into an investment buy by
  voiding it, and a void wins for ever on every device. So when the payer converts a purchase, it disappears from the
  other member's book. **Proposed:** accept it and say so in §7.3. The purchase really did stop being spending.
  **Ruled: accepted.** Documented in spec §7.3 as a known behaviour.
