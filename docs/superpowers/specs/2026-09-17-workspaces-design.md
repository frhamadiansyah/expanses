# Workspaces that share your accounts — design

Status: approved · 2026-09-17
Mockups: workspaces (switcher in ⋯, recording, card statement, event across workspaces, new workspace) and Add Transaction Option B (workspace row, event under "Add more details").

## 1. What we are building

A person keeps more than one set of books — Personal, Business, Family — but pays for all of them from the same
bank accounts and cards. Money Lover solves this with wallets that each own their money, which splits a credit card's
statement across wallets and stops it matching the bank.

Here the split runs the other way:

- **Your money is yours.** Bank accounts, cash, e-wallets, credit cards (statement, bill, points, instalments), loans,
  investments, net worth, goals, events and the tax report belong to you, once.
- **A workspace is a set of books.** It has its own categories, budgets, recurring bills, and its own Cashflow.
- **A purchase is recorded once**, with three tags: workspace (whose money it is), account (how it was paid), and
  optionally event (what it was for). A business dinner on a family holiday, paid on a personal card, is one entry:
  workspace Business, card BCA KrisFlyer, event Singapore holiday.

Nothing is recorded twice, and a card's statement always counts every purchase made on it.

## 2. What belongs where

From the schema as it stands (migrations up to 0041):

| Belongs to you (unchanged scope) | Belongs to a workspace (new scope) |
|---|---|
| `accounts` of kind asset, liability, equity | `accounts` of kind income, expense (categories) |
| `cards`, `card_identity`, `card_postings`, `card_settlements`, `card_installments`, `card_terms` | `category_sets`, `category_set_members` |
| `reward_programs`, `earn_rules`, `redemption_options`, `cycle_actuals`, `cycle_bonuses`, `transfer_partners`, `point_entries`, `point_snapshots`, `transaction_point_actuals` | `budgets`, `budget_overrides`, `budget_settings`, `budget_income_overrides` |
| `asset_profiles`, `investment_trades`, `prices`, `valuations`, `trade_templates` | `expense_templates`, `bill_skips` |
| `debt_profiles`, `loan_terms`, `loan_rate_periods` | `transactions` that spend or earn (see 4.1) |
| `goals`, `goal_stages`, `goal_earmarks`, `goal_contributions`, `goal_calculators` | |
| `events`, `event_budgets` | |
| `tax_year_reports`, `tax_year_rows`, `income_sources` | |
| `draft_transactions` (a workspace is chosen when one is recorded) | |
| `fx_rates`, `merchant_mccs` | |
| `category_mccs`, `catalog_category_choices` — keyed by category, so they follow the category's workspace | |

## 3. Approach

Three ways to get there were considered.

**A · Move money objects up to a new owner scope.** Add an `owner_id` to every table in the left column and make
`workspace_id` optional on them. Clean in the abstract, but it touches about 40 repositories and every points, card
and net-worth query — the most tested and most money-sensitive code in the app — for no gain in behaviour.

**B · Let accounts live in one workspace and be borrowed by others.** Cross-workspace references everywhere, and every
statement and balance query has to union workspaces. Fragile, and it breaks the one rule the data layer relies on.

**C · Keep today's workspace as the owner, and add books under it.** *Recommended.* The existing `workspaces` row
already scopes everything a person owns, which is exactly the left column. So it stays as it is, and a new `books`
table adds the right column's scope beneath it. Cards, points, loans, goals, events, net worth and tax keep their
queries unchanged. Only categories, budgets, bills and Cashflow learn a `book_id`.

In the product the word stays **workspace**; `book` is only the name in code, so the two scopes cannot be confused.

## 4. Data model

### 4.1 Tables and columns

New table `books`:

| column | notes |
|---|---|
| `id` | uuid v7 |
| `workspace_id` | the owner scope it belongs to |
| `name` | "Personal", "Business" |
| `kind` | `personal`, `business`, `family`, `shared` |
| `base_currency` | the currency this workspace's Cashflow, budgets and bills are read in; chosen in Settings |
| `count_events_in_budget` | 0 or 1. Personal defaults to 0 (a holiday stays out of the monthly budget), Business to 1 |
| `sort_order`, `created_at`, `archived_at` | |

Books are attached through membership tables rather than new columns. The ORM names every column it knows on every
insert, so a `book_id` column on `accounts` or `transactions` would break any database still stopped at an older
version — the reason `category_set_members` is a table of its own (see migration 0028). So:

| table | key | meaning |
|---|---|---|
| `book_categories` | `category_account_id` | which book an income or expense category belongs to |
| `book_transactions` | `transaction_id` | which book a transaction spends or earns in |
| `book_category_sets` | `set_id` | which book a category set belongs to |
| `book_budget_settings` | `book_id` | the book's expected monthly income (today's `budget_settings`, per book) |
| `book_income_overrides` | `book_id`, `month` | one month's expected income (today's `budget_income_overrides`, per book) |

Budgets, budget overrides and recurring bills need no table of their own: each names a category, and the category
names its book.

A transaction:

- **has a `book_transactions` row** when it touches a category (expense, income, a purchase split across categories)
  — the book of those categories;
- **has none** when it only moves money between your own accounts: transfers, card payments, loan repayments, opening
  balances, buying or selling a holding. None of these is spending, so none belongs to a book.

A transaction may not touch categories from two books. The ledger enforces it when posting.

Which book is open is remembered in `settings` (`active_book:<workspace_id>`), so the app reopens where you left it.

### 4.2 Migration 0042

Additive only; no figure changes.

1. Create `books`; insert one book named "Personal" (kind `personal`) for each existing workspace, with that
   workspace's base currency.
2. Create the membership tables above.
3. Backfill: every income and expense category and every category set → that workspace's Personal book; every
   transaction with at least one income or expense entry → Personal; today's budget settings and income overrides
   copied into the per-book tables for Personal. The old tables stay, untouched, for anything still reading them.
4. A test runs the sample household through the migration and compares, before and after: account balances, every
   card statement, points balances, net worth, the budget sheet for three months, and category totals. All must be
   identical.

Rollback: the new tables are ignored by old code, so a backup restored from before 0042 still opens.

## 5. Behaviour

### 5.1 Per workspace

- **Categories**: each workspace has its own tree, managed in the app rather than hard-coded: "New category" in the
  category picker and the Categories screen both add to the open workspace. A new workspace starts either empty or with
  a copy of another workspace's categories; there is no built-in Business list. Copied categories keep their system
  keys, so card earning rules keyed by category (`food_beverage.restaurants` and so on) keep working. A category made
  from scratch has no key and earns at the card's base rate until one is chosen for it.
- **Base currency**: each workspace has its own, set in Settings. A purchase is converted into the workspace's currency
  for its Cashflow, budgets and bills, using the rate on the purchase's date (the same rates `fx_rates` already holds).
  The purchase itself, the card and the account keep their own currencies, so statements and net worth are unaffected.
  Net worth stays in your own base currency, also chosen in Settings.
- **Cashflow**: chart, rows and budget page read only the open workspace's categories and transactions. The day list
  shows the open workspace's transactions, plus transfers, which belong to no workspace and show in every one.
- **Budgets and recurring bills**: per workspace, as today.
- **Add Transaction** (Option B): the first row is the workspace, set to the open one; changing it changes the
  categories offered. Transfer and Buy / sell have no workspace row.

### 5.2 Yours, across workspaces

- **Cards**: statement, bill, points and instalments count every purchase on the card, whatever its workspace. A small
  badge on each purchase names its workspace.
- **Events**: an event holds spending from any workspace. Its screen gains a switch — All, then one tab per workspace
  that has spending in it — which narrows the ring, the plan and the history. Event plans (`event_budgets`) can name
  categories from any workspace.
- **Event spending in monthly budgets** follows the spending's workspace: its `count_events_in_budget` decides whether
  a tagged purchase counts against that workspace's monthly caps.
- **Net worth, goals, loans, investments, tax**: unchanged.
- **Imports and drafts**: yours. Recording a draft asks for its workspace along with its category.

### 5.3 Switching and managing

- ⋯ on Cashflow lists the open workspace first, above the filters. Tapping it opens the list of workspaces (each with
  what it spent this month) and "+ New workspace".
- New workspace: name, kind, base currency, starting categories (empty, or copied from another workspace), and the
  events switch.
- Renaming and archiving a workspace live in Settings. Archiving hides it from the switcher; its transactions and
  categories stay, and the cards that paid for them are unaffected.

### 5.4 Leaving room for sharing

Sharing a workspace with another person — a spouse on a Family workspace, an accountant on Business — is planned, but
not part of this build: it needs sync between devices, which a local-first app does not have yet and which deserves
its own design. What this design does now is avoid closing that door:

- **The workspace (book) is the unit of sharing**, never the owner scope. A person invited to Family sees Family's
  categories, budgets, bills and transactions — not the Personal workspace, and not your net worth.
- **A shared workspace must read without your accounts.** Its transactions name how they were paid (account name and
  a card's last four digits) as a label, so a member sees "BCA KrisFlyer ···· 1467" on a purchase without being able to
  open the card's statement, balance or points. When sharing is built, that label is what syncs; the card does not.
- **A member records with their own accounts.** Each person pays from what they own, and the shared workspace simply
  holds purchases from both — the same "recorded once, three tags" rule, with two owners instead of one.
- **Member roles move to the workspace.** The existing `workspace_members` roles (owner, admin, member, viewer) belong on
  books when sharing arrives; nothing in this build uses them.
- **Nothing here depends on one device.** Every id is already a uuid v7 and every change is already written to
  `audit_log`, which is what a later sync can build on.

## 6. Build order

Each step lands green on its own.

1. **Books underneath** — migration 0042, `books` repository (list, create, rename, archive), the migration test from
   4.2, the active book in the app context. No visible change.
2. **Scoped by book** — categories, category sets, budgets, bills and the posting rule read and write `book_id`;
   Cashflow and the budget page filter by the open book. Still one book, so still no visible change; the whole
   suite must pass untouched.
3. **Switching** — ⋯ workspace item, the workspace list, New workspace (empty or copied categories, its own base currency), and per-workspace base currency in Settings.
4. **Across workspaces** — event tabs by workspace, `count_events_in_budget`, workspace badges on card statements.
5. **Recording** — the workspace row in Add Transaction arrives with the Option B form rebuild.

## 7. Decisions and open questions

Decided on 2026-09-17:

- **Categories are not hard-coded per kind.** A workspace starts empty or copied; categories are added from the menu.
- **Every workspace has its own base currency**, chosen in Settings, alongside your own base currency for net worth.
- **Sharing a workspace is planned, as a later project.** It needs sync between devices and gets its own design; this
  build keeps the workspace as the unit that will be shared and does nothing that ties it to one owner (5.4).
- **Add Transaction uses Option B, with B3** for "Add more details": one row per extra, each opening its own screen.

- **Transfers show in every workspace's day list.** Moving money between your own accounts belongs to no workspace, so
  it is listed wherever you are looking, and stays out of every chart and budget, as today.
