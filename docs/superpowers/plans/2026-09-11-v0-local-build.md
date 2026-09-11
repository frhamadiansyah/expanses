# v0 Local-Only Personal Build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-only, single-user personal finance PWA — double-entry ledger, wallets, credit cards, categorized spending, multi-currency net worth, credit card points with a which-card recommender, CSV import, and backup — running entirely in the browser.

**Architecture:** npm-workspaces monorepo. `packages/core` holds all domain logic as pure TypeScript with no I/O. `packages/db` holds the SQLite schema (hand-written SQL migrations), a Drizzle `sqlite-proxy` database over a pluggable `SqlExecutor`, and workspace-scoped repositories; tests run it against `better-sqlite3`. `apps/web` is a Vite + React PWA that runs SQLite WASM (`opfs-sahpool` VFS) in a dedicated worker behind the same `SqlExecutor` interface.

**Tech Stack:** Node 24, npm 11 workspaces, TypeScript 7, Vite 8, React 19, Vitest 5, Drizzle ORM 0.45 (`drizzle-orm/sqlite-proxy`), better-sqlite3 13 (tests only), `@sqlite.org/sqlite-wasm` 3.53, Tailwind CSS 4 (`@tailwindcss/vite`), TanStack Router 1, TanStack Query 5, vite-plugin-pwa 1.3, Playwright 1.63, fast-check 4, papaparse 5.

**Spec:** `docs/superpowers/specs/2026-09-11-personal-finance-platform-design.md` — read §2 (v0 scope), §5 (data model), §6 (multi-currency), §10 (points), §13 (v0 threat model and durability).

## Global Constraints

- Money amounts are integer minor units held in JS `number` and asserted with `Number.isSafeInteger`. Never floats for money.
- FX rates are the only floating-point values. Every conversion rounds to integer minor units immediately with `roundHalfAwayFromZero`.
- `fx_rate_to_base` = units of the workspace base currency per 1 major unit of the entry currency.
- Currency exponents: IDR 0, JPY 0, KRW 0, KWD 3, all other supported currencies 2. IDR is 0 by product decision (spec §5), not ISO 4217.
- Sign convention: debit positive, credit negative. Entries of a posted transaction sum to zero per currency.
- Transactions are immutable. Editing = mark original `status='void'` + post a new transaction with `replaces_transaction_id`. Voided transactions are excluded from every balance, report, and points computation.
- Every financial table has non-null `workspace_id`. Every repository function takes a `WorkspaceContext` as its first argument.
- All ids are UUIDv7 strings from `uuidv7()` in `@expanses/core`. No autoincrement ids.
- Dates are `YYYY-MM-DD` strings (`occurred_on`, `on_date`, `cycle_start`); timestamps are ISO-8601 UTC strings (`created_at`).
- Inside `database.transaction(fn)`, use only the `tx` argument. Calling `database.db` inside a transaction deadlocks.
- Schema changes are new numbered SQL files in `packages/db/migrations/`, registered in `packages/db/src/migrations.ts`. Never edit an applied migration.
- No network calls except Frankfurter FX (`https://api.frankfurter.dev/v2/rates`).
- No server, no login, no analytics, no third-party scripts.
- Run all commands from the repository root: `/Users/frhamadiansyah/Documents/Projects/Expanses`.

## Deviations from spec, recorded

- Projected points and cap usage are **derived per cycle on read** from posted transactions (spec §10 lists `point_entries` and `rule_cycle_usage`). Recomputing the cycle makes voids and backdating correct for free. Those tables arrive in Stage 3 as caches only if needed.
- `redemption_options` stores `value_minor` + `per_points` instead of `unit_value_minor`, because a point is often worth a fraction of a rupiah.
- `fx_rates` columns are `from_currency, to_currency, on_date, rate, source, source_date, fetched_at`.
- `accounts.subtype` adds `equity`; `accounts.system_key` identifies system accounts (`opening_balance`, `currency_exchange`).
- `transactions` uses `occurred_on` (date) and `replaces_transaction_id`.
- UI uses hand-written Tailwind components; shadcn/ui CLI is deferred to Stage 2 (its interactive init is unsuitable for agent execution).
- `account_balance_daily` rollup is deferred; v0 data volumes are served by indexed `SUM` queries.
- Backup is the raw SQLite database file (`.sqlite3`), plaintext, with an explicit warning.

## File Structure

```
package.json                       workspaces root, scripts
tsconfig.base.json                 shared compiler options
.gitignore

packages/core/
  package.json  tsconfig.json  vitest.config.ts
  src/index.ts                     public exports
  src/ids.ts                       uuidv7()
  src/money/currencies.ts          currency table, currencyInfo()
  src/money/money.ts               parseMajor, formatMinor, convertMinor, rounding
  src/ledger/types.ts              AccountKind, PostingLine, PlannedEntry, PostingError
  src/ledger/posting.ts            planPosting()
  src/ledger/lines.ts              expense/income/transfer/exchange/opening line builders
  src/ledger/balances.ts           displayAmount, netWorth
  src/reports/periods.ts           monthRange, lastNMonths, today helpers
  src/reports/spending.ts          spendingTree()
  src/points/cycles.ts             cycleFor()
  src/points/earn.ts               computeCycleEarn()
  src/points/recommend.ts          recommendCards()
  src/import/csv.ts                mapCsvRows(), dedupeKey()
  test/**/*.test.ts

packages/db/
  package.json  tsconfig.json  vitest.config.ts
  migrations/0001_ledger.sql
  migrations/0002_fx.sql
  migrations/0003_points.sql
  migrations/0004_import.sql
  src/index.ts                     browser-safe exports
  src/node.ts                      Node-only exports (better-sqlite3 executor)
  src/executor.ts                  SqlExecutor interface
  src/database.ts                  createDatabase(), Mutex, transaction
  src/node-executor.ts             createNodeExecutor()
  src/migrations.ts                migration list + migrate()
  src/schema.ts                    Drizzle table definitions
  src/context.ts                   WorkspaceContext
  src/seed.ts                      default category tree + system accounts
  src/repos/workspaces.ts
  src/repos/accounts.ts
  src/repos/ledger.ts
  src/repos/fx.ts
  src/repos/reports.ts
  src/repos/points.ts
  src/repos/imports.ts
  src/repos/settings.ts
  test/helpers.ts
  test/**/*.test.ts

apps/web/
  package.json  tsconfig.json  vite.config.ts  vitest.config.ts
  playwright.config.ts  index.html
  public/icon-192.png  public/icon-512.png
  src/main.tsx                     single-tab guard, bootstrap, render
  src/styles.css
  src/db/worker.ts                 SQLite WASM worker
  src/db/worker-executor.ts        SqlExecutor over postMessage
  src/db/bootstrap.ts              open, migrate, ensure workspace
  src/app/providers.tsx            AppContext + QueryClient
  src/app/router.tsx               routes
  src/app/layout.tsx               nav shell
  src/ui/                          Button, Input, Select, Card, Field, Money
  src/lib/fx-client.ts             Frankfurter client
  src/lib/rates.ts                 resolveRatesToBase()
  src/lib/download.ts              saveBytes()
  src/features/accounts/AccountsPage.tsx
  src/features/categories/CategoriesPage.tsx
  src/features/transactions/TransactionForm.tsx
  src/features/transactions/TransactionsPage.tsx
  src/features/spending/SpendingPage.tsx
  src/features/dashboard/DashboardPage.tsx
  src/features/cards/CardSetupPage.tsx
  src/features/cards/CardPointsPage.tsx
  src/features/cards/RecommendPage.tsx
  src/features/import/ImportPage.tsx
  src/features/backup/BackupPage.tsx
  src/features/backup/BackupBanner.tsx
  src/features/pwa/InstallHint.tsx
  src/lib/*.test.ts                unit tests for web-only libs
  e2e/*.spec.ts
```

## Tasks

| # | Task | Day |
|---|---|---|
| 1 | Monorepo scaffold | 1 |
| 2 | Core: ids, currencies, money | 1 |
| 3 | Core: posting and line builders | 1 |
| 4 | Core: balances and net worth | 1 |
| 5 | DB: executor, database, migrations, ledger schema | 1 |
| 6 | DB: workspace and account repositories with seed | 2 |
| 7 | DB: ledger repository | 2 |
| 8 | DB + web lib: FX rates | 2 |
| 9 | Web: SQLite worker, bootstrap, single-tab guard | 2 |
| 10 | Web: shell, routing, providers, UI primitives | 2 |
| 11 | Web: accounts page | 2 |
| 12 | Web: categories page | 2 |
| 13 | Web: transaction form and list + critical-path e2e | 3 |
| 14 | Core + DB: spending and net-worth reports | 3 |
| 15 | Web: spending and dashboard pages | 3 |
| 16 | Core: statement cycles and earn engine | 4 |
| 17 | DB + web: card terms, programs, rules, redemption, actuals | 4 |
| 18 | Core + web: card points page and recommender | 4 |
| 19 | CSV import | 5 |
| 20 | Backup export/import and reminders | 5 |
| 21 | PWA, persistent storage, install hint | 5 |

---

## Execution status (2026-09-11)

Executed on the fast track at the owner's request instead of task-by-task with a per-task review gate. Implementation went directly from the file map above, with tests required for money, ledger, FX, points, CSV, and backup logic.

Delivered: all 21 task deliverables across two drops.

Verification at completion: core 39, db 21, web 4 unit tests passing; typecheck clean in all packages; two Playwright tests passing against a production build (card purchase vs statement payment critical path; points cap cascade and recommender).

Outstanding before Stage 2: an independent code review of the v0 codebase, which the fast track skipped.
