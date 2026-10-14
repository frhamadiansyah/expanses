# Decimals on whole-unit currencies — implementation plan

> For agentic workers: execute task by task; each task ends with its tests green and a commit.

**Goal:** a decimal rupiah amount can be typed on a single Expense/refund/Income amount; it posts rounded (up for money out, down for money in), the exact figure is stored, and card points use it rounded down.

**Architecture:** ledger stays in whole units; one nullable `transactions.exact_hundredths` column, synced as a purchase field; the points funnel reads it.

**Spec:** docs/superpowers/specs/2026-10-14-rupiah-decimals-design.md

## Global Constraints

- `parseMajor` keeps its behaviour; only new functions accept decimals for exponent-0 currencies.
- Exact figures are positive integers in hundredths of the currency unit; null when the fraction is zero.
- Money out (expense, refund) rounds up; money in (income) rounds down.
- Decimals only on the single amount: splits, transfers and all other money fields stay whole.
- After saving, decimals are never shown (B2): lists, totals, receipt and edit form show the whole figure.
- Migration `0068_exact_hundredths` after 0067, undeclared column behind a cached exists check (see packages/db/src/repos/day-order-column.ts).
- Country-neutral: the rule is by exponent (IDR, JPY, KRW), never by currency code.
- Test-first; fast-check properties for parsing. Copy never says "you"/"your". No subagents, no git stash, no pkill.
- Commits: subject a plain sentence of what now works; trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. "12.500,30+0,80" on the keypad: summed exactly before rounding (→ 12.502, exact 1250110).
2. Editing a decimal purchase's note only keeps the exact figure; changing its amount to whole clears it.
3. A refund of a decimal purchase takes back the same points it earned (floor of the same exact).
4. An older peer receiving `exactHundredths` changes no money.
5. A split or transfer with "12.500,30" is refused with a clear message, not silently rounded.

---

### Task 1: core — fractional parsing, keypad, capture and CSV readers

**Files:** packages/core/src/money/money.ts (new `parseFractionalMajor`), packages/core/src/money/keypad.ts (`evaluateAmount` option `fractional`, exact result), packages/core/src/capture/amount.ts (`toMinor` keeps exact for exponent-0), packages/core/src/import/csv.ts (`parseCsvAmount` accepts decimals for exponent-0), tests beside each.

**Interfaces produced:**
- `parseFractionalMajor(text: string, currency: string, direction: 'up' | 'down'): { minor: number; exactHundredths: number | null }` — throws `MoneyError` like `parseMajor` for malformed input and for more than 2 decimals; for exponent > 0 currencies returns `{ minor: parseMajor(text, currency), exactHundredths: null }`.
- `evaluateAmount(expression, currency, { refund?: boolean; fractional?: 'up' | 'down' })` → unchanged return when `fractional` is absent; with it, returns the rounded minor and exposes the exact via a sibling `evaluateExact(expression, currency, opts): { minor: number; exactHundredths: number | null } | null` (keep `evaluateAmount`'s return type unchanged for its many callers). Operands are summed in hundredths; ÷ and × counts stay whole numbers.
- Capture readings gain `exactHundredths?: number` for exponent-0 currencies when the printed figure had a non-zero fraction; `minor` is rounded up for money out, down for money in (the reading's direction is known where drafts are built — if not in core, return the exact and let Task 2 round).
- `parseCsvAmount(value, currency, direction?)` → keeps `number | null` return; add `parseCsvExact(value, currency, direction): { minor; exactHundredths } | null`.

Steps: failing tests (units + fast-check: `minor === ceil/floor(exact/100)`, whole input → null exact, exponent-2 currencies unchanged, the "12.500,30+0,80" case) → implement → green → commit.

### Task 2: db — column, ledger, sync, points, drafts, CSV import

**Files:** packages/db/migrations/0068_exact_hundredths.sql, packages/db/src/migrations.ts, packages/db/src/repos/exact-column.ts (exists check like day-order-column.ts), packages/db/src/repos/ledger.ts (`PostTransactionInput.exactHundredths?: number | null`; write on post; carry on replace unless provided), packages/db/src/sync/shared-entities.ts + capture.ts + apply.ts (purchase field `exactHundredths`, in-place fast path when it is the only winning field, like `dayOrder`), packages/db/src/repos/points.ts (`cardSpendLines`: when exact is set, line amount = sign × floor(exact/100)), packages/db/src/repos/drafts.ts + capture ingest (draft keeps exact; confirm passes it), CSV import commit path (passes exact), packages/db/test/sync/shared-entities.test.ts column lists.

**Consumes:** Task 1 interfaces.
**Produces:** `PostTransactionInput.exactHundredths`, `TransactionView.exactHundredths: number | null` (read in the list/view query behind the exists check).

Tests: post/replace carry and clear; points 2.499,70 → 0 points at 1/2.500 while card charged 2.500; refund reverses the same; sync round trip; an op with only `exactHundredths` applied in place; older-peer simulation (op without the field changes nothing; field ignored by `ledgerInput`); draft confirm; CSV import.

### Task 3: web — form, keypad key, review form, e2e

**Files:** apps/web/src/features/transactions/tx-form.ts (`amounts()`/`positive()`/refund path use `evaluateExact` with direction by mode for the single amount; splits/transfer refuse a fraction with "Decimals go on a single amount only"; `formFromTransaction` keeps `exactHundredths` on the draft and the form shows the whole figure; changing the amount recomputes or clears it; `formToPost` passes it), apps/web/src/features/transactions/Keypad.tsx / `keypadKeys` (a "," key on exponent-0 currencies when the field allows decimals), AmountRow.tsx (passes the allowance), apps/web/src/features/review/draft-form.ts (keeps the draft's exact), e2e `phone-rupiah-decimals.spec.ts`.

**Consumes:** Tasks 1–2.

Tests: web units (expense up, income down, refund, split/transfer refusal, edit keeps/clears exact); e2e phone: type 12.500,30 with the "," key → row 12.501 → reopen shows 12.501 → save note-only keeps exact (points estimate on the row's receipt uses 12.500 if a card with a rule is set up in the fixture).

### Finish

Full suite (typecheck, npm test incl. db capture config, full e2e), whole-branch review on the most capable model, one fix wave, then merge/push/TestFlight per owner approval.
