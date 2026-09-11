# Personal Finance Platform — Design

**Date:** 2026-09-11 (revised same day: local-first E2EE architecture, v0 scope)
**Status:** Approved design, pending implementation plan
**Codename:** Expanses (branding decided at launch prep; the `Mon*` name space — Monveo, Monevo, Monvo, Monlio, Monefy, Moneon — is saturated and should be avoided)

## 1. Product thesis

A multi-currency personal finance platform combining three product shapes that exist separately today:

- **Worthful** — net worth first: assets, liabilities, credit cards, bills, loans, dashboard
- **Money Lover** — logging first: wallets, category tree, budgets, goals, events, recurring
- **Monveo** — capture speed: voice, receipt scanning, money spaces, no bank credentials

Plus two things none of them combine:

1. **Credit card rewards tracking for Indonesian card programs.** Worthful treats cards purely as liabilities. The rewards-tracking category (MaxRewards, The Points Guy, AwardWallet) is US-centric and does not cover BCA, Mandiri, CIMB, UOB, DBS, or HSBC Indonesia programs.
2. **Zero-knowledge privacy by default.** Financial data lives on the user's device. Paid sync is end-to-end encrypted; the operator sees only metadata. Features that require the server to read plaintext exist only as labeled opt-ins.

The primary user is a heavy credit card user who spends for points. One technical property is non-negotiable: **card spending is counted once**, as an expense at purchase time, and statement payments are never counted as spending.

## 2. Scope

### v0 — local-only personal build (3–5 working days)

Single user, single device, no server, no login. This is the future free tier, built on the real architecture — not a throwaway prototype.

- Ledger core with invariant tests
- Account tree: wallets, credit cards, income and expense categories with subcategories
- Manual transaction entry, split transactions, card statement payment as a transfer
- Spending by category and period
- Net worth dashboard
- Multi-currency with daily rates
- Points: card terms, statement cycles, earn rules with category multipliers, caps and rounding modes, projected points, per-cycle actual-points recording for accuracy comparison, which-card recommender
- Basic CSV import
- Plaintext backup export and import, with an explicit warning
- PWA install and persistent storage request

The owner uses v0 on real cards immediately. Points accuracy can only be validated against 2–3 real statement cycles, so validation runs in parallel with the remaining build.

### v1 — public launch

Everything in v0, plus: full draft capture pipeline and review queue, complete points engine (expiry, redemption options, fee ROI, cap splits), events, bills, recurring, loans, budgets, goals, asset valuations, end-to-end encrypted multi-device sync, shared household spaces, encrypted backups, onboarding, English and Bahasa Indonesia, plan gating, external security review.

### Phase 2 (designed for, not built)

Email-forward ingestion, receipt OCR, voice capture, React Native client, market price feeds, payment gateway, curated Indonesian card catalog, bank aggregators. Email ingestion, server-side AI capture, and aggregators are opt-in exceptions to zero-knowledge (§9).

### Non-goals

- Storing bank credentials. Ever.
- Ads.
- Server-side reading of financial data outside labeled opt-in features.
- Microservices.

## 3. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Privacy model | Local-first, E2EE sync, labeled opt-in exceptions | Privacy is a market differentiator; moving the ledger client-side later would be a rewrite |
| Ledger model | Double-entry | Credit cards, loans, transfers, and multi-currency net worth are structurally correct instead of special-cased |
| Transaction mutability | Immutable; corrections are void + reversal | Required for correct sync merges — append-only records never produce unbalanced merged state |
| Client storage | SQLite WASM (official `@sqlite.org/sqlite-wasm`, `opfs-sahpool` VFS) in a web worker | Real SQL for ledger aggregation; `opfs-sahpool` avoids cross-origin isolation headers |
| ORM | Drizzle (`sqlite-proxy` driver to the worker) | Runs in browser and React Native; Prisma does not run client-side |
| Web client | Vite + React + TypeScript, TanStack Router, Tailwind, shadcn/ui | Local-first SPA; server rendering adds nothing and complicates workers and WASM |
| Server (Stage 7+) | Small Node service (Hono) + Postgres on Railway/Fly, Auth.js for identity | Identity, plan, device registry, encrypted op-log relay, wrapped key blobs |
| Tenancy key | `workspace_id` on every financial table | Spaces are first-class; in sync, workspace keys are the access control |
| Spaces | User-visible, plural, typed (personal/shared/business/travel) | Validated by Monveo as a headline concept |
| Subscriptions | `plan` + `can()` gate seam, no payment gateway in v1 | Gateway cheap later; scattered entitlement checks are not |
| Plan boundary | Free = local only; paid = E2EE sync + sharing | Free tier costs nearly nothing to host |
| Base currency | Per workspace, as reporting unit | Transaction currency is independent |
| Asset valuation | Manual snapshots; `market` mode prepared | Market data is a paid, rate-limited subsystem |
| Capture | Draft pipeline; manual + CSV surfaces | One write path into the ledger |
| Card programs | Hand-entered earn rules; curated catalog later | Rule schema proves out against real cards first |
| Points ledger | Single-entry log in a non-money unit | Earning is unilateral; no counterparty, no FX |
| Sync engine | Chosen by Stage 1 spike against §8 required properties; custom on libsodium if no candidate meets all | Evolu fits SQL but cross-user sharing is unconfirmed; Jazz does sharing but is not SQL |

### Defaults

- Free-tier caps on object counts (spaces, budgets, recurring rules, events)
- CSV export in v1
- Raw capture payload retention: 90 days after draft resolution, configurable per workspace
- Languages: English and Bahasa Indonesia at launch
- Realized FX gain/loss posts to an income account
- Audit log on all financial mutations

## 4. Architecture

```
apps/web         Vite + React PWA — UI; runs core and the local database
apps/server      Stage 7+: identity, plan, devices, encrypted op-log relay
packages/core    domain: posting, balances, budgets, FX, points. Pure TS
packages/db      Drizzle schema (SQLite), migrations, scoped repositories
packages/sync    Stage 8+: op log, hybrid logical clocks, encryption, apply/validate
```

`packages/core` is pure and has no I/O. Money bugs live in posting rules and balance math; pure functions make them testable in milliseconds.

`packages/db` hides storage behind repositories. If the sync spike selects an engine with its own storage layer (e.g. Evolu), the migration is contained to this package.

The SQLite database runs in a dedicated web worker. `opfs-sahpool` holds exclusive file handles, so only one tab may own the database; a Web Locks API guard shows other tabs a "open in the other tab" screen.

**One posting engine.** Every capture source produces drafts that funnel into a single `postTransaction()` in core. Each carries `source` and `external_ref`.

**Entitlement seam.** `workspaces.plan` defaults to `free`. A single `can(workspace, feature)` helper gates every limit. No payment gateway in v1.

## 5. Data model

### Money representation

64-bit integer minor units (SQLite `INTEGER`) plus ISO 4217 currency code. Exponent from a currency table (IDR 0, JPY 0, USD 2, KWD 3). No floats anywhere.

### Identifiers

Client-generated UUIDv7. Required for offline creation and multi-device sync without server-assigned ids.

### Ledger

```
workspaces        id, name, type(personal|shared|business|travel),
                  base_currency, plan, created_at

workspace_members workspace_id, user_id, role(owner|admin|member|viewer)
                  — present from v0 with a single local owner

accounts          id, workspace_id, parent_id,
                  kind(asset|liability|income|expense|equity),
                  subtype(cash|bank|credit_card|savings|investment|
                          property|vehicle|receivable|payable|loan|
                          category),
                  name, icon, currency,
                  valuation_mode(derived|snapshot|market), archived_at

transactions      id, workspace_id, occurred_at, description,
                  source(manual|csv|voice|receipt|email),
                  external_ref, event_id, status(posted|void),
                  voids_transaction_id, created_at

entries           id, transaction_id, account_id,
                  amount_minor, currency,
                  fx_rate_to_base, amount_base_minor, memo
```

Enumerations are `TEXT` columns with `CHECK` constraints. Structured fields are JSON `TEXT`.

**Core invariant:** entries of a posted transaction sum to zero per currency. SQLite has no deferred constraints, so enforcement is: (1) `postTransaction()` in core refuses unbalanced input; (2) the repository writes transaction and entries in one SQLite transaction; (3) an integrity check query runs in tests and on every sync apply.

**Transactions are immutable.** Editing a transaction posts a void of the original plus a new transaction. Recategorizing is the same operation. The UI presents this as an ordinary edit.

**Categories are accounts** of `kind=income|expense`, nested via `parent_id` (Food › Groceries).

**Wallets are accounts** — `kind=asset, subtype=cash|bank|savings` or `kind=liability, subtype=credit_card`.

**Lend/borrow debts** are `receivable` or `payable` accounts with a counterparty name.

### Card purchase and statement payment

```
Purchase, Superindo, 500,000 IDR on BCA Visa
  Expense:Food:Groceries    +500,000
  Liability:BCA Visa        −500,000

Statement payment, 8,000,000 IDR
  Liability:BCA Visa      +8,000,000
  Asset:BCA Checking      −8,000,000
```

The purchase is spending. The payment touches no expense account and is not spending.

### Supporting tables

```
currencies        code, exponent, symbol
valuations        account_id, as_of, value_minor, currency
fx_rates          base, quote, as_of, rate, fetched_at
budgets           workspace_id, account_id, period, amount_minor,
                  currency, starts_at, repeats, rollover(none|carry)
goals             workspace_id, account_id, target_minor, target_date
events            workspace_id, name, starts_at, ends_at, primary_currency
recurring_rules   workspace_id, template, rrule, next_run_at,
                  auto_post, kind(recurring|bill)
bill_instances    rule_id, due_date, amount_minor,
                  status(due|paid|overdue|skipped|partial), transaction_id
loan_terms        account_id, principal_minor, annual_rate,
                  term_months, first_payment_on
loan_schedule     account_id, due_date, principal_minor,
                  interest_minor, status
draft_transactions workspace_id, source, raw_payload, extracted,
                  confidence, status, external_ref, raw_purge_after
import_batches    workspace_id, filename, mapping, stats
attachments       workspace_id, transaction_id, storage_key, kind
audit_log         workspace_id, action, entity, before, after, created_at
account_balance_daily  account_id, day, closing_minor
```

**Budget rollover:** `none` discards unspent amount at period end; `carry` adds it to the next period's limit. Overspend never carries forward as debt.

### Prepared for phase 2

```
instruments       symbol, exchange, type(stock|etf|crypto|fund), currency
lots              account_id, instrument_id, quantity,
                  cost_basis_minor, acquired_at
price_history     instrument_id, as_of, price_minor, currency
```

### Derived, never stored

- Account balance at D = sum of entries of posted transactions where `occurred_at <= D`
- Net worth at D = Σ(asset balances at D) − Σ(liability balances at D), converted at FX as of D
- Budget consumption = sum of entries into the expense subtree within the period

`account_balance_daily` is a cache written by the posting engine and rebuildable from entries. Entries are truth.

## 6. Multi-currency

Base currency is the reporting unit of a space. A travel space based in IDR holds THB transactions from Bangkok in January and CNY from Shanghai in May. Each entry stores its currency, the rate to base at transaction date, and the converted amount. Events carry an optional `primary_currency` for native-currency trip reports.

Changing a space's base currency recomputes `amount_base_minor`. Entry currency and amount never change.

**Rate source:** ECB-backed daily rates via Frankfurter, fetched by the client in v0 and cached in `fx_rates`. From Stage 7, fetched through a server cache that is not tied to user identity. A missing rate falls back to the last known rate and is flagged stale in the UI. Rates are never fabricated.

## 7. Capture pipeline

```
capture source (manual | csv | voice | receipt | email)
  → extractor
  → DraftTransaction {confidence, raw_payload, suggested_category}
  → review queue  OR  auto-post above threshold
  → postTransaction()
```

v0 posts manual entries directly through `postTransaction()` and imports CSV through a preview-then-commit step. The full draft table and review queue land in Stage 2; manual entry is then routed through it without changing the posting engine.

Dedupe uses `external_ref` plus fuzzy matching on amount, date, and account. CSV import commits all-or-nothing per batch.

## 8. Sync and encryption (Stage 8+)

### Required properties

Any sync engine, bought or built, must satisfy all of these:

1. Server stores only ciphertext and the metadata listed below
2. Offline writes on multiple devices converge
3. Append-only records (transactions, entries, point entries) merge without loss
4. Mutable records (account names, rules, settings) merge last-writer-wins per field by hybrid logical clock
5. Every client validates ledger invariants when applying remote operations; invalid operations are quarantined and surfaced, never silently applied
6. Per-workspace keys with multi-member sharing and key rotation on member removal
7. Web and React Native clients

### Key hierarchy

```
Vault passphrase ──Argon2id──▶ KEK ──wraps──▶ Account Master Key (AMK)
Recovery key (shown once)  ──────────wraps──▶ AMK
AMK ──wraps──▶ user X25519 private key
AMK ──wraps──▶ Workspace Key (owner)
member X25519 public key ──wraps──▶ Workspace Key (each shared member)
Workspace Key ──encrypts──▶ that workspace's operations
```

- Server identity login (Auth.js: email magic link or Google) is separate from the vault passphrase. The passphrase and all derived secrets never leave the device.
- Server stores wrapped AMK blobs, KDF salt and parameters, public keys, and wrapped workspace keys.
- Primitives: libsodium — Argon2id, XChaCha20-Poly1305, X25519 — unless the selected engine provides equivalent audited primitives.
- Losing both passphrase and recovery key means data cannot be recovered on a new device. Devices that already hold the local database keep working. This is stated plainly during setup.
- Removing a household member rotates the workspace key; new operations use the new key. Data the removed member already synced remains on their device. Sharing cannot be revoked retroactively, and the UI says so.

### What the server can see

User id, email, plan, device ids, workspace membership graph (required for key distribution), operation count, ciphertext sizes, sync timestamps, IP addresses. The admin dashboard shows exactly this and nothing else.

### Deterministic operation ids

Client-side jobs that materialize scheduled records derive ids from content (`hash(rule_id, period)`), so two offline devices materializing the same recurring transaction produce one record after merge.

## 9. Opt-in exceptions to zero-knowledge (phase 2)

Email forwarding, server-side receipt and voice extraction, and bank aggregators require the server to process plaintext. Each is:

- Off by default, enabled per workspace behind a consent screen stating exactly what the server sees and for how long
- Processed transiently; extracted results are encrypted to the workspace immediately, raw payloads discarded or encrypted
- Labeled in the product and in marketing as an exception. The product claim is "zero-knowledge by default", never unconditional.

Receipt OCR text, email bodies, and voice transcripts are attacker-controllable and may reach a model. Extraction is schema-constrained output only; content is passed as data with no instruction authority; extracted values populate drafts and never trigger actions on their own.

## 10. Points engine

```
card_terms        account_id, credit_limit_minor, statement_day, due_day,
                  annual_fee_minor, fee_waiver_rule

reward_programs   id, card_account_id, name,
                  unit(points|miles|cashback),
                  cycle_anchor(statement|calendar),
                  expiry_policy(none|months_from_earn|fixed_annual)

earn_rules        program_id, priority, stackable, match,
                  rate_num, rate_den,
                  rounding(per_transaction_floor|per_cycle_sum),
                  cap_spend_minor, cap_points, cap_window,
                  min_transaction_minor, valid_from, valid_to

rule_cycle_usage  rule_id, cycle_start, spend_used_minor, points_earned

point_entries     program_id, transaction_id,
                  kind(earn|redeem|expire|adjust|transfer),
                  quantity, occurred_at,
                  status(projected|posted), batch_id, expires_on

cycle_actuals     program_id, cycle_start, actual_points, recorded_at

redemption_options program_id, name,
                  type(cashback|voucher|miles_transfer|statement_credit),
                  unit_value_minor, currency
```

`match` holds category ids, merchant patterns, channel (online/offline), currency, and exclusions.

### Rules that determine accuracy

1. **Cycle is not calendar month.** Caps reset on `statement_day`.
2. **Rounding differs by bank.** Per-transaction floor and per-cycle sum produce different totals; rounding is a property of the rule.
3. **Projected versus actual.** Earn entries are `projected` at transaction time. The user records the statement's actual points per cycle in `cycle_actuals`; the difference exposes rule errors and issuer under-crediting.
4. **Caps consume in order.** A transaction straddling a cap splits into bonus-rate and base-rate earn entries. Cap state is recomputed when a transaction is voided or backdated.

### Expiry

FIFO by batch. Redemptions consume oldest first. Client-side job expires unconsumed remainders. Points expiring within 60 days surface as a dashboard warning.

### Recommender

Given amount, category, merchant, and channel: match rules per active card, apply remaining cap headroom, compute earn, value at the program's best redemption rate, rank. Output names the card, rate, estimated rupiah value, and remaining cap headroom.

### Annual fee ROI

Per card-year: points earned valued at the chosen redemption rate, minus annual fee.

### Known limitation

Issuers earn on MCC; the app earns on the user's category. They will disagree (a hotel restaurant bills as lodging). Mitigated by merchant-pattern overrides and by `cycle_actuals` exposing every mismatch. Accuracy converges over a few statement cycles.

## 11. Surfaces

| Surface | Reads | New logic | Lands |
|---|---|---|---|
| Dashboard | balances, rollups, FX | net worth as-of-date, deltas, trend | v0 |
| Spending | expense subtree entries | period grouping, drilldown | v0 |
| Wallets | asset/liability accounts | CRUD, archive, opening balance | v0 |
| Credit cards | liability accounts, card_terms | statement cycle, utilization | v0 |
| Points | reward tables | earn engine, caps, recommender | v0 basic, Stage 3 complete |
| Events | tagged transactions | event reports, dual-currency totals | Stage 2 |
| Bills | recurring_rules, bill_instances | settlement state machine | Stage 4 |
| Loans | loan_terms, loan_schedule | amortization, early payoff | Stage 4 |
| Budgets | expense subtree sums | period math, rollover | Stage 5 |
| Goals | asset account, target | projected completion | Stage 5 |
| Assets | snapshot accounts, valuations | valuation history, gain/loss | Stage 6 |

**Bills versus recurring.** Same scheduler. A recurring transaction has a known amount and date and posts through. A bill is an obligation with a due date, settlement state, and often an amount unknown until the statement arrives.

**Credit card periods.** "This month" on a card means the statement period.

## 12. Client-side jobs

With no server reading data, scheduled work runs on the client when the app opens and periodically while it is open:

```
fetch FX rates for currencies in use
materialize due recurring_rules (deterministic ids)
mark overdue bill_instances
expire unconsumed point batches
purge expired draft raw_payloads
verify rollups against entries for recently touched accounts
```

Every job is idempotent. Missed runs catch up on next open.

Reminders (Stage 4+): the client computes fire times. React Native uses local notifications. Web uses Web Push, where the server holds only a fire time and a generic payload ("You have a bill due"), never amounts or payees.

## 13. Security

### v0 threat model

v0 has no server, so nothing leaves the device except FX rate requests to Frankfurter. The local database is protected by browser origin isolation and the operating system only. It does not protect against someone with access to the unlocked device or browser profile, or against malicious browser extensions. Backups are plaintext files; the export screen says so.

### Free tier durability

Browser storage can be lost: Safari deletes script-writable storage after 7 days without interaction unless the app is installed to the home screen, and users clear site data. Mitigations:

- Request `navigator.storage.persist()` on every launch
- Prompt PWA installation, prominently on iOS
- Backup reminder every 7 days; persistent warning banner after 14 days without a backup
- One-click restore from backup file

### From Stage 7

- End-to-end encryption per §8 (Stage 8)
- Auth.js identity with rate limiting; TOTP MFA for account login
- Scoped repositories requiring `WorkspaceContext` on client and server
- Server-side Postgres row-level security on relay tables
- User-initiated account deletion removes all server-held ciphertext and key blobs
- External security review of the key hierarchy and sync protocol before public launch

## 14. Error handling

- Posting writes transaction, entries, and rollup update in one SQLite transaction
- Transactions are immutable; corrections are void plus new transaction
- Voided or backdated transactions invalidate rollups and cap usage forward from that date; recomputation is idempotent
- Missing FX rate falls back to last known and is flagged stale
- CSV import previews and commits all-or-nothing
- Remote operations failing invariant validation are quarantined and shown to the user (Stage 8+)
- Idempotency keys on every server write endpoint (Stage 7+)

## 15. Testing

- `packages/core` unit tests without a database
- Property tests: entries sum to zero; balance equals sum of entries; rollup equals derived balance; void plus repost preserves balances
- Golden tests: points earn across cap boundaries, both rounding modes, cycle edges; amortization schedules (Stage 4)
- Repository integration tests against SQLite (Node build of the same schema)
- End-to-end browser test of the critical path: card purchase appears under the correct subcategory; statement payment does not count as spending; net worth moves once
- Stage 8+: sync convergence tests with multiple simulated offline devices; quarantine of invalid operations; key rotation on member removal; server-side assertion that stored payloads are ciphertext
- TDD throughout

## 16. Build sequence and estimates

Estimates assume Claude implements and the owner reviews and tests daily (2–4 hours/day), full-time engagement.

```
v0        Local-only personal build                         3–5 days
Stage 1   Sync engine spike (throwaway): Evolu, Jazz,        1 week
          custom — scored against §8 required properties
Stage 2   Core hardening: property tests, events,            1–2 weeks
          draft pipeline + review queue, CSV mapping + dedupe
Stage 3   Points complete: expiry, redemptions, fee ROI,     1.5–2.5 weeks
          cap splits, projected vs actual reconciliation
Stage 4   Obligations: recurring, bills, loans, reminders    1.5–3 weeks
Stage 5   Budgets and goals                                  1 week
Stage 6   Assets: valuations, instrument stubs               0.5–1 week
Stage 7   Server: identity, plan, devices, relay             1–1.5 weeks
Stage 8   E2EE sync: key hierarchy, recovery, multi-device   2–4 weeks
Stage 9   Household sharing and key rotation                 1–2 weeks
Stage 10  Launch prep: onboarding, EN/ID, gating, encrypted  1.5–2.5 weeks
          backups, observability, branding
```

**Total: roughly 13–22 weeks to launch-ready**, plus calendar-bound work running in parallel:

- Points accuracy validation across 2–3 real statement cycles, starting at v0
- External security review of Stages 8–9, 2–4 weeks lead time
- Real-device testing of PWA storage durability on iOS

Stages 8 and 9 compress least and carry the most risk.

### v0 day plan

```
Day 1  Monorepo, Vite + React, SQLite WASM worker, Drizzle,
       currency table, ledger core + invariant tests
Day 2  Account tree, wallets, credit cards, manual entry with
       category/subcategory, splits, statement payment as transfer
Day 3  Spending by category, net worth dashboard, multi-currency rates
Day 4  Points: card terms, cycles, earn rules, caps, rounding,
       projected points, cycle actuals, recommender
Day 5  CSV import, backup export/import, PWA, persistent storage
```
