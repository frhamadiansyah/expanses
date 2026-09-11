# Personal Finance Platform — Design

**Date:** 2026-09-11
**Status:** Approved design, pending implementation plan
**Codename:** Expanses (branding decision deferred to Stage 8; the `Mon*` name space — Monveo, Monevo, Monvo, Monlio, Monefy, Moneon — is saturated and should be avoided)

## 1. Product thesis

A multi-currency personal finance platform combining three product shapes that exist separately today:

- **Worthful** — net worth first: assets, liabilities, credit cards, bills, loans, dashboard
- **Money Lover** — logging first: wallets, category tree, budgets, goals, events, recurring
- **Monveo** — capture speed: voice, receipt scanning, money spaces, no bank credentials

Plus the gap none of them fill: **credit card rewards tracking for Indonesian card programs**. Worthful treats cards purely as liabilities. The rewards-tracking category (MaxRewards, The Points Guy, AwardWallet) is US-centric and does not cover BCA, Mandiri, CIMB, UOB, DBS, or HSBC Indonesia programs.

The points engine is the differentiator. Everything else is table stakes executed well.

The primary user is a heavy credit card user who spends for points. This makes one technical property non-negotiable: **card spending must be counted once**, as an expense at purchase time, and statement payments must not be counted as spending. Naive expense trackers double-count this, which makes them unusable for exactly this user.

## 2. Scope

### v1 (all before launch)

Ten surfaces plus the points engine:

Dashboard, Spending, Wallets, Credit cards, Bills, Loans, Assets, Budgets, Goals, Events — plus card rewards tracking with an earn-rule engine and a "which card should I use" recommender.

Capture in v1: manual entry and CSV import, built on the full draft-transaction pipeline so later sources plug in without rework.

### Phase 2 (designed for, not built)

Email-forward ingestion, receipt OCR, voice capture, React Native client, market price feeds for stocks and crypto, payment gateway, curated Indonesian card catalog, bank aggregators.

### Non-goals

- Storing bank credentials. Ever. No screen scraping, no username/password capture.
- Ads.
- Cross-workspace database queries.
- Microservices.

## 3. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Ledger model | Double-entry | Credit cards, loans, transfers, and multi-currency net worth are structurally correct instead of special-cased |
| Tenancy key | `workspace_id` on every financial table from migration one | Retrofitting shared spaces later means migrating every row and rewriting every query and auth check |
| Spaces | User-visible, plural, typed (personal/shared/business/travel) | Monveo validates this as a headline concept, not hidden plumbing |
| Subscriptions | `plan` column + `can()` gate seam, no payment gateway in v1 | Gateway is cheap to add later; scattered entitlement checks are not |
| Base currency | Per workspace | Reporting unit of a space; transaction currency is independent |
| Asset valuation | Manual snapshots in v1, `market` mode prepared | Market data is a paid, rate-limited subsystem; the schema additions for it are free now |
| Auth + hosting | Auth.js + Postgres on Railway/Fly | No vendor lock, auth rows sit beside `workspace_members`, RLS straightforward |
| Capture | Full draft pipeline in v1, manual + CSV surfaces only | One write path into the ledger; every future source is an extractor module |
| Card programs | Hand-entered earn rules in v1, curated catalog later | Rule schema proves out against real cards before taking on catalog maintenance |
| Points ledger | Single-entry log in a non-money unit | Earning is unilateral; no counterparty, no FX, no balancing requirement |

### Defaults

- Free-tier caps on object counts (spaces, budgets, recurring rules, events)
- CSV export in v1
- Raw capture payload retention: 90 days after draft resolution, configurable per workspace
- Languages: English and Bahasa Indonesia at launch
- Realized FX gain/loss posts to an income account
- Soft delete plus audit log on all financial mutations

## 4. Architecture

API-first monolith. Business logic lives in a framework-free core, not in route handlers.

```
apps/web         Next.js App Router — UI only, calls the API
apps/api         route handlers — auth, validation, HTTP concerns
packages/core    domain: posting, balances, budgets, FX, points. Pure TS
packages/db      Prisma schema, migrations, scoped repositories
packages/jobs    workers: recurring, FX, reminders, later email parsing
```

Logic does not live in server actions, because the React Native client in phase 2 needs the same operations over HTTP and cannot call them.

`packages/core` is pure and has no I/O. Money bugs live in posting rules and balance math; keeping them in pure functions makes them testable in milliseconds without a database.

**Runtime:** Postgres (single database, RLS enabled), Redis (BullMQ queue and rate limiting), a worker process, object storage for uploads. Deployed as web + worker + Postgres on Railway or Fly.

**One posting engine.** Manual UI, CSV import, and later voice, receipt, and email all produce drafts that funnel into a single `postTransaction()` in core. Each carries `source` and `external_ref`. No source gets bespoke write logic.

**Entitlement seam.** `workspaces.plan` defaults to `free`. A single `can(workspace, feature)` helper in core gates every limit. No Stripe, checkout, webhooks, or pricing page in v1; adding the gateway later means writing payment code and flipping plan values, not threading checks through features.

## 5. Data model

### Money representation

`bigint` minor units plus ISO 4217 currency code. Exponent from a currency table (IDR 0, JPY 0, USD 2, KWD 3). No floats. No arithmetic on Prisma `Decimal` inside core — convert at the edge.

### Ledger

```
workspaces        id, name, type(personal|shared|business|travel),
                  base_currency, plan, created_at

workspace_members workspace_id, user_id, role(owner|admin|member|viewer)

accounts          id, workspace_id, parent_id,
                  kind(asset|liability|income|expense|equity),
                  subtype(cash|bank|credit_card|savings|investment|
                          property|vehicle|receivable|payable|loan),
                  name, icon, currency,
                  valuation_mode(derived|snapshot|market), archived_at

transactions      id, workspace_id, occurred_at, description,
                  source(manual|csv|voice|receipt|email),
                  external_ref, event_id, status(pending|posted|void),
                  created_by, created_at

entries           id, transaction_id, account_id,
                  amount_minor(bigint), currency,
                  fx_rate_to_base, amount_base_minor, memo
```

**Core invariant:** the entries of a transaction sum to zero, per currency. Enforced in `packages/core` and again by a database constraint trigger. This single rule makes transfers, credit card payments, and refunds correct without special cases.

**Categories are accounts** of `kind=income|expense`, nested via `parent_id` (Food › Groceries). One balance engine serves both category reports and account balances; there is no parallel category table to keep in sync.

**Wallets are accounts** — `kind=asset, subtype=cash|bank|savings` or `kind=liability, subtype=credit_card`. "Wallet" is a UI label for accounts the user transacts against directly.

**Lend/borrow debts** are `receivable` asset or `payable` liability accounts with a counterparty name. Repayment is an ordinary transaction. No separate subsystem.

### Supporting tables

```
valuations        account_id, as_of, value_minor, currency
fx_rates          base, quote, as_of, rate
budgets           workspace_id, account_id, period, amount_minor,
                  currency, starts_at, repeats, rollover
goals             workspace_id, account_id, target_minor, target_date
events            workspace_id, name, starts_at, ends_at, primary_currency
recurring_rules   workspace_id, template(jsonb), rrule, next_run_at,
                  auto_post, kind(recurring|bill)
bill_instances    rule_id, due_date, amount_minor,
                  status(due|paid|overdue|skipped|partial), transaction_id
loan_terms        account_id, principal_minor, annual_rate,
                  term_months, first_payment_on
loan_schedule     account_id, due_date, principal_minor,
                  interest_minor, status
draft_transactions workspace_id, source, raw_payload(jsonb),
                  extracted(jsonb), confidence, status,
                  external_ref, raw_purge_after
import_batches    workspace_id, filename, mapping(jsonb), stats
attachments       workspace_id, transaction_id, storage_key, kind
audit_log         workspace_id, actor_id, action, entity, before, after
account_balance_daily  account_id, day, closing_minor
```

**Budget rollover** has two modes per budget: `none` (unspent amount is discarded at period end) and `carry` (unspent amount increases the next period's effective limit). Overspend never carries forward as debt in either mode.

### Prepared for phase 2 (additive, no ledger migration)

```
instruments       symbol, exchange, type(stock|etf|crypto|fund), currency
lots              account_id, instrument_id, quantity,
                  cost_basis_minor, acquired_at
price_history     instrument_id, as_of, price_minor, currency
```

Investment accounts run `valuation_mode=snapshot` in v1. Adding a price provider means flipping affected accounts to `market` and backfilling `price_history`. Entries, transactions, and balances are untouched.

### Derived, never stored

- Account balance at date D = sum of entries where `occurred_at <= D`
- Net worth at D = Σ(asset balances at D) − Σ(liability balances at D), each converted at the FX rate **as of D**
- Budget consumption = sum of entries into that expense subtree within the period

`account_balance_daily` is an incrementally maintained rollup written by the posting engine and rebuildable from entries at any time. The rollup is a cache; entries are truth. Never the reverse.

## 6. Multi-currency

Base currency is the **reporting unit of a space**, not the currency spent in it. A travel space based in IDR holds THB transactions from a January Bangkok trip and CNY transactions from a May Shanghai trip. Each entry stores its own currency, the FX rate to base at the transaction date, and the base-converted amount.

Events carry an optional `primary_currency` so a trip reports natively in THB while the space total still means something.

Changing a space's base currency is a pure recomputation of `amount_base_minor`. Entry currency and amount are truth and never change.

**Rate source:** free ECB-backed daily rates (Frankfurter or exchangerate.host). Stored daily, history never overwritten. A missing date falls back to the last known rate and is flagged stale in the response so the UI can say so. Rates are never fabricated silently. Crypto rates via CoinGecko when market mode arrives.

Realized FX gain or loss posts to an income account rather than being absorbed.

## 7. Capture pipeline

```
capture source (manual | voice | receipt | csv | email)
  → extractor (form | STT+LLM | OCR+LLM | column map | template/LLM)
  → DraftTransaction {confidence, raw_payload, suggested_category}
  → review queue  OR  auto-post above threshold
  → postTransaction()
```

v1 implements the pipeline with manual and CSV extractors. Adding a source later is one extractor module plus a client surface; the draft table, review queue, dedupe, categorization, and posting engine are all reused.

Dedupe uses `external_ref` plus fuzzy matching on amount, date, and account.

CSV import is previewed and committed all-or-nothing per batch.

## 8. Points engine

A second ledger denominated in a non-money unit, posted alongside the money entries of the same transaction.

```
card_terms        account_id, credit_limit_minor, statement_day, due_day,
                  annual_fee_minor, fee_waiver_rule(jsonb)

reward_programs   id, card_account_id, name,
                  unit(points|miles|cashback),
                  cycle_anchor(statement|calendar),
                  expiry_policy(none|months_from_earn|fixed_annual)

earn_rules        program_id, priority, stackable,
                  match(jsonb),
                  rate_num, rate_den,
                  rounding(per_transaction_floor|per_cycle_sum),
                  cap_spend_minor, cap_points, cap_window,
                  min_transaction_minor,
                  valid_from, valid_to

rule_cycle_usage  rule_id, cycle_start, spend_used_minor, points_earned

point_entries     program_id, transaction_id,
                  kind(earn|redeem|expire|adjust|transfer),
                  quantity, occurred_at,
                  status(projected|posted), batch_id, expires_on

redemption_options program_id, name,
                  type(cashback|voucher|miles_transfer|statement_credit),
                  unit_value_minor, currency
```

`match` holds category ids, merchant patterns, channel (online/offline), currency for foreign-spend rules, and exclusions.

### Rules that determine accuracy

1. **Cycle is not calendar month.** Caps reset on `statement_day`. Every cap window derives from `cycle_anchor` plus the card's statement day.
2. **Rounding differs by bank and is material.** Per-transaction floor and per-cycle sum produce different totals for the same spending. Rounding is a property of the rule, not a global constant.
3. **Projected versus posted.** Earn entries post as `projected` at transaction time and flip to `posted` on statement confirmation. The gap between the two detects under-crediting by the issuer.
4. **Caps consume in order.** A transaction straddling a cap splits into two earn entries — bonus rate up to the remaining headroom, base rate beyond it. Cap state is recomputed if a transaction is backdated or recategorized.

### Expiry

FIFO by batch. Each earn creates a batch with `expires_on`. Redemptions consume oldest first. A daily job expires unconsumed remainders. Points expiring within 60 days surface as a dashboard warning.

### Recommender

Given amount, category, merchant, and channel: match rules per active card, apply remaining cap headroom, compute earn, value it at that program's best redemption rate, rank the cards. Output names the card, the rate, the estimated value, and the remaining cap headroom.

### Annual fee ROI

Per card, per card-year: points earned valued at the chosen redemption rate, minus annual fee.

### Known limitation

Issuers earn on MCC; this app earns on the user-selected category. They will disagree — a restaurant inside a hotel bills as lodging. Mitigated by merchant-pattern overrides in `match`, and by the projected-versus-posted gap surfacing every mismatch so rules are corrected from observed data. Accuracy is approximate initially and converges after a few statement cycles.

## 9. Surfaces

| Surface | Reads | New logic |
|---|---|---|
| Dashboard | balances, rollups, FX | net worth as-of-date, period deltas, trend |
| Spending | expense subtree entries | period grouping, drilldown, merchant rollup |
| Wallets | asset/liability accounts | CRUD, archive, reorder, opening balance |
| Credit cards | liability accounts, card_terms | statement cycle, utilization, available credit |
| Bills | recurring_rules, bill_instances | settlement state machine, unknown amounts |
| Loans | loan_terms, loan_schedule | amortization, principal/interest split, early payoff |
| Assets | snapshot accounts, valuations | valuation history, gain/loss vs cost basis |
| Budgets | expense subtree sums | period math, rollover, prediction from history |
| Goals | asset account, target | contribution tracking, projected completion |
| Events | tagged transactions | event reports, dual-currency totals |
| Points | reward tables | earn engine, caps, expiry, recommender, fee ROI |

**Bills versus recurring.** Same scheduler, different semantics. A recurring transaction has a known amount and date and posts straight through. A bill is an obligation with a due date, a settlement state, and often an amount unknown until the statement arrives. Bills always materialize a `bill_instance` awaiting settlement; recurring rules with `auto_post` do not.

**Credit card statement handling.** "This month" on a card means the statement period, not the calendar month. Statement amount is unknown until close. Paying a statement is a transfer from a cash account to the card liability and is never counted as spending.

## 10. Background jobs

BullMQ on Redis. Every job idempotent and keyed so a retry cannot double-post.

```
daily 00:15  fetch FX rates
daily 00:30  materialize due recurring_rules
daily 01:00  mark overdue bill_instances
daily 01:15  expire unconsumed point batches
daily 01:30  purge expired draft raw_payloads
hourly       balance rollup repair (idempotent)
on-demand    CSV import, loan schedule generation, cap recomputation
phase 2      reminder delivery, inbound email parsing, market prices
```

Materialization is guarded by a unique `(rule_id, period)` constraint.

## 11. Security and tenancy

- Non-null `workspace_id` on every financial table, first column in every composite index
- No route handler touches Prisma directly. Access goes through repositories requiring a `WorkspaceContext`; an unscoped query is not expressible
- Postgres RLS as second line: session variable set per request transaction, policies on every table
- Cross-workspace reporting sums per-workspace results in core
- Auth.js with database sessions, argon2id, Google OAuth, TOTP MFA in v1
- Rate limiting on auth and capture endpoints
- No bank credentials stored under any circumstances
- `raw_payload` encrypted app-side with envelope encryption, purged on schedule
- Audit log on every financial mutation: actor, before, after
- User-initiated data export and hard delete

**Untrusted input.** Receipt OCR text, email bodies, and voice transcripts are attacker-controllable and reach a model. Extraction produces schema-constrained output only; content is passed as data with no instruction authority; extracted values never trigger actions on their own. They populate a draft for human confirmation, or auto-post only under numeric-field confidence thresholds.

## 12. Error handling and invariants

- Posting is a single database transaction: transaction, entries, and rollup update commit atomically or not at all
- Idempotency keys required on every write endpoint, client-generated
- Corrections are void plus reversal entries, never destructive edits
- Backdated or recategorized transactions invalidate rollups forward from that date; a repair job recomputes
- Missing FX rate falls back to last known and is flagged stale
- Optimistic locking on account and valuation edits; advisory lock per account for rollup maintenance

## 13. Testing

- `packages/core` is pure — unit tests run without a database
- Property tests for the invariants: entries sum to zero, balance equals sum of entries, rollup equals derived balance
- Golden tests for amortization schedules and for points earn across cap boundaries, both rounding modes, and cycle edges
- Integration tests on real Postgres, including explicit RLS isolation assertions that workspace A cannot read workspace B
- End-to-end on the critical path: purchase on card appears in spending under the correct subcategory, statement payment does not double-count
- TDD throughout

## 14. Build sequence

```
Stage 0  Foundation      repo, CI, Postgres, Auth.js, workspaces,
                         members, RLS, plan seam
Stage 1  Ledger core     account tree, entries, posting engine,
                         invariants, balances, FX, rollups
Stage 2  Capture         manual entry, draft pipeline, review queue,
                         CSV import
Stage 3  Core surfaces   wallets, spending, categories, dashboard,
                         net worth, events
Stage 4  Cards + points  card terms, statement cycles, programs,
                         earn rules, cap engine, recommender, fee ROI
Stage 5  Obligations     worker, recurring, bills, loans, reminders
Stage 6  Planning        budgets, goals
Stage 7  Assets          valuations, instrument stubs
Stage 8  Launch prep     export, onboarding, EN/ID, plan gating,
                         observability, branding
```

Stages 1 and 4 carry the complexity. Stage 4 precedes bills and budgets despite being harder because it is the differentiator; if points tracking is the reason a user switches, it cannot be the last thing built.

This is a multi-month solo build. Per-stage estimates belong in the implementation plan, attached to concrete tasks.
