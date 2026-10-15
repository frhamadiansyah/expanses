# Shared Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A trip that several people record into: one shared event with its own relay book, people with or without the app, splits, one event currency, balances and fewest-payment settle-ups, while each phone's own books carry only that person's share and nothing about anyone's accounts leaves the phone.

**Architecture:** Pure split/conversion/balance/settle-up/posting logic lives in `packages/core/src/shared-events/`. Each shared event is a relay book of its own (a `shared_books` row with no `books` row, as the net-worth group log is), holding seven new row entities; apply on every phone derives that phone's own local transactions from the records (`event_postings`, the way `member_transfer_postings` follows `member_transfers`). The derived transactions belong to no workspace book, and every reader that narrows by book leaves them out (§5.1).

**Tech Stack:** TypeScript, SQLite via drizzle-orm `sql`, vitest + fast-check, React 19 + TanStack Router/Query, Playwright with the local relay Worker.

**Spec:** `docs/superpowers/specs/2026-10-15-shared-events-design.md` (binding; read it in full before any task). Household sharing background: `docs/superpowers/specs/2026-09-26-household-sharing-design.md` (§6.4 capture harness).

## Global Constraints

- "Copy never says "you"/"your" (the owner's rule); people are named." Every string a screen shows, every error message a repository throws.
- "Events that are not shared behave exactly as today." (D10) No existing event test may change behaviour; a task that touches an existing event path proves it with the existing tests green.
- "One event currency (chosen at creation, fixed after the first expense). Each expense keeps its own currency and a rate to the event currency, fixed when recorded and synced." (D5)
- "`rateToEvent` is a decimal string (the existing rate format). An expense in the event currency has rate `1`."
- "`splitJson` is `[{personId, minor}]` in the expense's own currency for `amounts`, or `[personId…]` for `equal`."
- "`toEvent(minor, currency, rateToEvent, eventCurrency)`: one rounding rule (half away from zero), used everywhere. Each share is converted on its own; the payer's "paid" figure is the sum of the converted shares, so every expense nets to exactly zero in the event currency."
- "`fewestPayments(balances)`: greedy largest-debtor-to-largest-creditor; deterministic order (by amount, then person id) so every phone suggests the same list."
- "**Never synced:** which account paid, card, MCC, photos, channel, anyone's workspace, anyone's own-currency figures."
- "Anyone may edit anything, **except** an expense paid from a member's account: only that member changes its amount, currency, rate, date, or deletes it." (D8)
- "Leaving needs a zero balance; a person is removed only at zero balance and in no expense." (D9)
- The new migration is `0069_shared_events.sql` (the latest today is `0068_exact_hundredths.sql`).
- No bank names and no country names in code, tests or fixtures; every fixture figure, rate, date and name is invented. Currency codes (TRY, EUR, IDR) are codes, not names, and are allowed.
- Features stay country-neutral; only the tax report (`tax-inputs.ts`) speaks Coretax codes.
- Long why-comments in the repo's voice on every non-obvious rule; names follow the surrounding file.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Rulings on spec gaps (binding for every task)

These close gaps the spec leaves open. Each is cited by number in the tasks that implement it.

- **R1 Person id = member id.** A person who has the app is the event relay book's member whose member id equals the person's id. Claiming a name is joining the relay book as that member (`introductionRefusal` already refuses a second introduction of an existing member, in log order, on every phone), then writing `event_people.member_id = id`. `memberId` is null or equal to the row's own id, and only an op whose author member equals that id may set it. "A name is claimed once" therefore needs no new race handling.
- **R2 Writer rules are pure.** Every event writer rule reads only the op's fields, the stored row's fields and the author member (the authority view's), never another row, so every phone decides alike (the same discipline `decideRowWriter` keeps). To make D8 decidable that way, `event_expense` carries one more field, `payerMemberId` (null = paid outside the app or recorded on someone's behalf; else equal to `payerPersonId`), and `event_settlement` carries `fromMemberId` and `toMemberId`. Writer = those members when set, anyone otherwise. Each may go from null to X once, only by member X, only when X is the person the record names (the *takeover*, R6); once set it never moves, and neither does the person it is tied to.
- **R3 Void wins.** A record's `voidedAt`, once set, is never cleared: an op that would clear it is refused (`AUTHORITY: a void stays void`). Records (`event_expense`, `event_expense_detail`, `event_settlement`, `event_person`) are never deleted by an op; categories and plan items may be.
- **R4 Local tables.** `event_books` (the event relay books this phone holds: its workspace, its local `events` row, its trip-balance account), `event_postings` (`book_id, record_id, kind, transaction_id, account_id, account_amount_minor, unposted, changed_by`), `event_category_accounts` (`book_id, category_id, account_id, earn_category_id`), `event_log_currency` (`book_id, currency, locked`). The spec's `event_postings (recordId, transactionId)` gains the paying account and its own-currency figure because both are local facts that never sync.
- **R5 The paying side.** The account a person paid from, and the figure it was charged in its own currency, are kept only in `event_postings`. When the account's currency is the expense's (or, for a settlement, the event's), the account side is always the record's amount; otherwise it is the figure typed on this phone, kept until this phone's own edit gives a new one. A purchase in another currency than its account sets the local transaction's `originalCurrency`/`originalAmountMinor` to the record's currency and amount.
- **R6 Needs an account.** A phone posts "I paid" lines only when it holds the paying account (`event_postings.account_id`) and the record's payer member is this member. Otherwise the record is `unposted = 'choose-account'`, listed on the event page as "Not in Budi's books yet", and resolved by *Take over* (`takeOverRecords`), which sets the member field (R2) and the account. This one path covers a name claimed later, a record made on a stale view, and a lost phone.
- **R7 Equal splits are explicit.** `split_json` for `equal` lists the ticked people at recording; "everyone" is written out. A person added later is never silently in an older expense. `sharesOf` therefore needs no people list.
- **R8 Currency lock in log order.** A currency change is refused locally once any expense is here (capture time), and on every phone by a log-order mark (`event_log_currency`), kept by `decideOpsTx` for every entry including this phone's own: the first accepted `event_expense` locks the book; a later `shared_event.currency` is stripped from its op, and this phone's own stripped change is put back to the log's currency.
- **R9 Done, remove and leave are local checks.** "Done" (`finishedAt`), "remove a name" and "leave" are refused by the repositories and screens; peers apply what arrives by the usual per-field merge.
- **R10 Older builds.** An event invite's sealed preview carries `baseCurrency: 'XXX'` (the code for "no currency"), so a build that does not know events refuses it with its currency message before claiming; the event's own currency travels in `preview.event.currency`. The web app's version goes to `0.4.0`, and `SHARED_EVENTS_MIN_APP_VERSION = '0.4.0'` is checked before a join.
- **R11 Who paid is fixed.** `payerPersonId` is frozen once the payer member is set (R2); on an anyone-expense it may be changed. A settlement's `fromPersonId`/`toPersonId` never change: a wrong settlement is voided and recorded again.
- **R12 Points.** A card's share line would earn on the share alone. So a derived card purchase carries `spendCategoryId` on the card line (the workspace category it was moved from, else the event's local category), and `cardSpendLines` reads it there and skips the local share categories' own lines: points stay on the full charge.
- **R13 Paid by.** The Add screen's Paid by offers this person (with one of their own accounts) and the people without the app. A person with the app records their own payments; an expense recorded for them on a stale view becomes an anyone-expense they take over (R6).
- **R14 The Add screen in a shared event is its own card.** `/transactions/new?event=<shared event>` opens `SharedExpenseCard` (Paid by, Split, the event's categories, the rate) instead of the workspace card, whose Paid with / book categories / With rows do not apply; picking a shared event on the workspace card's Event row while adding opens that card, and on an edit it moves the purchase (Task 13). The amount is a typed field, not the keypad, in this first version.

## Review Focus

1. A transaction derived from a shared event shows up in a workspace's Cashflow list, category totals, budget sheet or event-spending line: it must appear in none of them, yet stay in its account's history, its card's statement and points, net worth and the event page. Tests: Task 3 (`event-only-readers.test.ts`), one per reader.
2. Shares converted one by one round so that the payer's converted total differs from the sum the others owe, leaving a balance one unit off: every expense must net to exactly zero in the event currency, and every phone's trip-balance account must equal its Balances line. Tests: Task 1 (`shared-events.property.test.ts`: balances sum to zero; lines balance per currency and match the person's balance), Task 9 (`shared-events-sync.test.ts`: account equals Balances on every phone).
3. A card purchase moved into a shared event loses its card, MCC, channel, photos, statement match or points: all of them must survive the move, and points must still be earned on the full charge. Test: Task 10 (`shared-event-moves.test.ts`).
4. Two phones suggesting different settle-up lists for the same balances: the list must be a function of the balances alone (amount, then person id). Tests: Task 1 (key order shuffled → same list), Task 9 (two phones read identical suggestions).
5. A friend's edit changing the owner's account balance — the split or category changed through `event_expense_detail`, or an amount changed by someone who is not the payer: the payer's money account line must never move, only the trip-balance and share lines. Tests: Task 4 (`event-authority.test.ts`: amount edit by a non-payer refused), Task 9 (`shared-events-sync.test.ts`: detail edit by a friend leaves the payer's bank untouched).

## Waves

Tasks in one wave touch disjoint files and can run in parallel; each wave starts when the previous one is merged.

| Wave | Tasks | Needs |
|---|---|---|
| 1 | Task 1 (core logic), Task 2 (migration 0069, `event_balance`) | — |
| 2 | Task 3 (§5.1 readers), Task 4 (sync entities and writer rules) | Task 2 |
| 3 | Task 5 (derivation of each phone's lines) | Tasks 1, 3 |
| 4 | Task 6 (writes) | Tasks 4, 5 |
| 5 | Task 7 (reads and shared plan), Task 8 (the event's relay book) | Task 6 |
| 6 | Task 9 (apply wiring, three-phone convergence), Task 10 (moves), Task 11 (web: event page, events list, Debts) | Tasks 7, 8 |
| 7 | Task 12 (web: people, share, join), Task 13 (web: Add screen, tagging, receipt) | Tasks 9–11 |
| 8 | Task 14 (end to end) | all |

Files each wave's tasks touch are disjoint (checked task by task): Task 1 owns `packages/core/src/index.ts`, Task 2 `packages/core/src/assets/balance-sheet.ts`; Task 3 owns `ledger.ts`/`reports.ts`/`flows.ts`, Task 4 the `sync/` files; Task 7 owns `packages/db/src/index.ts` in wave 5 and Task 8 does not touch it; in wave 6 only Task 10 touches the index, only Task 9 `apply.ts`/`engine.ts`, only Task 11 `apps/web`; in wave 7 Task 12 keeps to `events/`, `sharing/`, the router and the sync service, Task 13 to `transactions/` and `shared-event-reads.ts`.

Commands used throughout: `npm run test -w @expanses/core`, `npx vitest run <file>` from the package directory, `npm run typecheck`, `npm run test:capture`.

---

### Task 1: Core — splits, conversion, balances, fewest payments, each phone's lines

Spec §4 and §5's table, R5–R7. Pure functions only; no database.

**Files:**
- Create: `packages/core/src/shared-events/split.ts`
- Create: `packages/core/src/shared-events/balances.ts`
- Create: `packages/core/src/shared-events/lines.ts`
- Modify: `packages/core/src/index.ts` (append one export block at the end of the file)
- Test: `packages/core/test/shared-events.test.ts`
- Test: `packages/core/test/shared-events.property.test.ts`

**Interfaces:**
- Consumes: `convertMinor(amountMinor, from, to, rate)` from `packages/core/src/money/money.ts`; `PostingLine` from `packages/core/src/ledger/types.ts`.
- Produces (all exported from `@expanses/core`):
  - `class SharedEventError extends Error { readonly code: SharedEventErrorCode }`, `type SharedEventErrorCode = 'SPLIT_MISMATCH' | 'EMPTY_SPLIT' | 'DUPLICATE_PERSON' | 'BAD_RATE' | 'BAD_AMOUNT' | 'UNBALANCED' | 'BAD_SETTLEMENT'`
  - `interface PersonMinor { personId: string; minor: number }`
  - `type SplitInput = { mode: 'equal'; people: readonly string[] } | { mode: 'amounts'; shares: readonly PersonMinor[] }`
  - `interface ExpenseRecord { id: string; amountMinor: number; currency: string; rateToEvent: string; payerPersonId: string; split: SplitInput; voided: boolean }`
  - `interface SettlementRecord { id: string; fromPersonId: string; toPersonId: string; amountMinor: number; voided: boolean }`
  - `sharesOf(expense: Pick<ExpenseRecord, 'amountMinor' | 'payerPersonId' | 'split'>): PersonMinor[]`
  - `isRateString(text: string): boolean`, `rateString(rate: number): string`
  - `toEvent(minor: number, currency: string, rateToEvent: string, eventCurrency: string): number`
  - `expenseInEvent(expense: ExpenseRecord, eventCurrency: string): { paidMinor: number; shares: PersonMinor[] }`
  - `balances(expenses: readonly ExpenseRecord[], settlements: readonly SettlementRecord[], eventCurrency: string, people?: readonly string[]): Record<string, number>`
  - `interface SuggestedPayment { fromPersonId: string; toPersonId: string; amountMinor: number }`, `fewestPayments(balances: Readonly<Record<string, number>>): SuggestedPayment[]`
  - `parseSplitJson(mode: string, json: string): SplitInput`, `splitJsonOf(split: SplitInput): string`
  - `interface MyLineAccounts { shareAccountId: string; eventBalanceAccountId: string; exchangeAccountId: string }`
  - `interface PaidFromAccount { accountId: string; currency: string; chargedMinor: number; spendCategoryId?: string | null }`
  - `type MyLines = { kind: 'none' } | { kind: 'needs-account' } | { kind: 'lines'; lines: PostingLine[] }`
  - `myExpenseLines(input: { expense: ExpenseRecord; eventCurrency: string; me: string; accounts: MyLineAccounts; paidFrom: PaidFromAccount | null }): MyLines`
  - `mySettlementLines(input: { settlement: SettlementRecord; eventCurrency: string; me: string; eventBalanceAccountId: string; exchangeAccountId: string; account: { accountId: string; currency: string; amountMinor: number } | null }): MyLines`

- [ ] **Step 1: Write the failing example tests**

`packages/core/test/shared-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  balances,
  expenseInEvent,
  type ExpenseRecord,
  fewestPayments,
  isRateString,
  myExpenseLines,
  mySettlementLines,
  parseSplitJson,
  rateString,
  SharedEventError,
  sharesOf,
  splitJsonOf,
  toEvent,
} from '../src/index';

/*
 * Shared events (spec §4, §5). A week by the coast in lira (TRY): Rina, Andi and Budi (Budi without the app). Every
 * figure here is invented: 1 EUR = 31.5 TRY on the day, amounts in minor units (cents, kuruş).
 */

const expense = (over: Partial<ExpenseRecord> = {}): ExpenseRecord => ({
  id: 'exp-1',
  amountMinor: 9_000,
  currency: 'EUR',
  rateToEvent: '31.5',
  payerPersonId: 'rina',
  split: { mode: 'equal', people: ['rina', 'andi', 'budi'] },
  voided: false,
  ...over,
});

describe('sharesOf', () => {
  it('splits equally, the leftover going to the payer when the payer is in the split', () => {
    expect(sharesOf({ amountMinor: 100, payerPersonId: 'andi', split: { mode: 'equal', people: ['rina', 'andi', 'budi'] } })).toEqual([
      { personId: 'rina', minor: 33 },
      { personId: 'andi', minor: 34 },
      { personId: 'budi', minor: 33 },
    ]);
  });

  it('gives the leftover to the first person in the split when the payer is not in it', () => {
    expect(sharesOf({ amountMinor: 101, payerPersonId: 'rina', split: { mode: 'equal', people: ['andi', 'budi'] } })).toEqual([
      { personId: 'andi', minor: 51 },
      { personId: 'budi', minor: 50 },
    ]);
  });

  it('takes amounts as given when they add up to the total, and refuses them when they do not', () => {
    const split = { mode: 'amounts' as const, shares: [{ personId: 'rina', minor: 40 }, { personId: 'andi', minor: 60 }] };
    expect(sharesOf({ amountMinor: 100, payerPersonId: 'rina', split })).toEqual(split.shares);
    expect(() => sharesOf({ amountMinor: 101, payerPersonId: 'rina', split })).toThrow(expect.objectContaining({ code: 'SPLIT_MISMATCH' }));
  });

  it('refuses an empty split, a person named twice and an amount that is not above zero', () => {
    expect(() => sharesOf({ amountMinor: 100, payerPersonId: 'rina', split: { mode: 'equal', people: [] } })).toThrow(SharedEventError);
    expect(() => sharesOf({ amountMinor: 100, payerPersonId: 'rina', split: { mode: 'equal', people: ['rina', 'rina'] } })).toThrow(expect.objectContaining({ code: 'DUPLICATE_PERSON' }));
    expect(() => sharesOf({ amountMinor: 0, payerPersonId: 'rina', split: { mode: 'equal', people: ['rina'] } })).toThrow(expect.objectContaining({ code: 'BAD_AMOUNT' }));
  });
});

describe('rates and conversion', () => {
  it('reads the decimal-string rate format and writes it back without exponents', () => {
    expect(isRateString('31.5')).toBe(true);
    expect(isRateString('1')).toBe(true);
    expect(isRateString('0')).toBe(false);
    expect(isRateString('1e-7')).toBe(false);
    expect(isRateString('31,5')).toBe(false);
    expect(rateString(0.0000625)).toBe('0.0000625');
    expect(rateString(31.5)).toBe('31.5');
    expect(() => rateString(0)).toThrow(expect.objectContaining({ code: 'BAD_RATE' }));
  });

  it('converts half away from zero, and keeps the event currency at rate 1 only', () => {
    expect(toEvent(3_000, 'EUR', '31.5', 'TRY')).toBe(94_500);
    expect(toEvent(1, 'EUR', '0.5', 'TRY')).toBe(1); // 0.5 rounds away from zero
    expect(toEvent(12_345, 'TRY', '1', 'TRY')).toBe(12_345);
    expect(() => toEvent(100, 'TRY', '2', 'TRY')).toThrow(expect.objectContaining({ code: 'BAD_RATE' }));
  });

  it('makes the payer’s paid figure the sum of the converted shares', () => {
    const { paidMinor, shares } = expenseInEvent(expense({ amountMinor: 100, rateToEvent: '0.333' }), 'TRY');
    expect(shares.map((s) => s.minor)).toEqual([11, 11, 11]); // 34 for Rina × 0.333 = 11.32 → 11; 33 × 0.333 = 10.99 → 11
    expect(paidMinor).toBe(33);
  });
});

describe('balances and fewest payments', () => {
  it('reads paid minus own shares plus settlements paid minus received, summing to zero', () => {
    const out = balances(
      [expense(), expense({ id: 'exp-2', amountMinor: 60_000, currency: 'TRY', rateToEvent: '1', payerPersonId: 'andi', split: { mode: 'equal', people: ['rina', 'andi'] } })],
      [{ id: 'set-1', fromPersonId: 'budi', toPersonId: 'rina', amountMinor: 50_000, voided: false }],
      'TRY',
      ['rina', 'andi', 'budi', 'dewi'],
    );
    // Rina paid €90 (283,500 TRY in shares of 94,500), owes 94,500 of it and 30,000 of Andi's dinner, and was paid 50,000.
    expect(out).toEqual({ rina: 283_500 - 94_500 - 30_000 - 50_000, andi: 60_000 - 94_500 - 30_000, budi: -94_500 + 50_000, dewi: 0 });
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('ignores voided records', () => {
    expect(balances([expense({ voided: true })], [], 'TRY')).toEqual({});
  });

  it('suggests the fewest payments, largest debtor to largest creditor, ties by person id', () => {
    expect(fewestPayments({ rina: 480_000, andi: -290_000, budi: -190_000, dewi: 0 })).toEqual([
      { fromPersonId: 'andi', toPersonId: 'rina', amountMinor: 290_000 },
      { fromPersonId: 'budi', toPersonId: 'rina', amountMinor: 190_000 },
    ]);
    expect(fewestPayments({ b: -100, a: -100, c: 200 })).toEqual([
      { fromPersonId: 'a', toPersonId: 'c', amountMinor: 100 },
      { fromPersonId: 'b', toPersonId: 'c', amountMinor: 100 },
    ]);
  });

  it('refuses balances that do not sum to zero', () => {
    expect(() => fewestPayments({ rina: 10, andi: -9 })).toThrow(expect.objectContaining({ code: 'UNBALANCED' }));
  });
});

describe('split json', () => {
  it('round-trips both modes in the shape the spec gives', () => {
    expect(splitJsonOf({ mode: 'equal', people: ['rina', 'andi'] })).toBe('["rina","andi"]');
    expect(splitJsonOf({ mode: 'amounts', shares: [{ personId: 'rina', minor: 5 }] })).toBe('[{"personId":"rina","minor":5}]');
    expect(parseSplitJson('equal', '["rina","andi"]')).toEqual({ mode: 'equal', people: ['rina', 'andi'] });
    expect(parseSplitJson('amounts', '[{"personId":"rina","minor":5}]')).toEqual({ mode: 'amounts', shares: [{ personId: 'rina', minor: 5 }] });
    expect(() => parseSplitJson('equal', '{"x":1}')).toThrow(SharedEventError);
  });
});

const accounts = { shareAccountId: 'share', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx' };

describe('myExpenseLines (spec §5)', () => {
  it('I paid from a euro wallet: wallet −90, my share +30, the others’ converted shares on the trip balance, exchange between', () => {
    const out = myExpenseLines({ expense: expense(), eventCurrency: 'TRY', me: 'rina', accounts, paidFrom: { accountId: 'wallet', currency: 'EUR', chargedMinor: 9_000 } });
    expect(out).toEqual({
      kind: 'lines',
      lines: [
        { accountId: 'wallet', amountMinor: -9_000, currency: 'EUR' },
        { accountId: 'share', amountMinor: 3_000, currency: 'EUR' },
        { accountId: 'trip', amountMinor: 189_000, currency: 'TRY' },
        { accountId: 'fx', amountMinor: 6_000, currency: 'EUR' },
        { accountId: 'fx', amountMinor: -189_000, currency: 'TRY' },
      ],
    });
  });

  it('someone else paid and I am in the split: my share, the trip balance down by its converted figure', () => {
    const out = myExpenseLines({ expense: expense(), eventCurrency: 'TRY', me: 'andi', accounts, paidFrom: null });
    expect(out).toEqual({
      kind: 'lines',
      lines: [
        { accountId: 'share', amountMinor: 3_000, currency: 'EUR' },
        { accountId: 'trip', amountMinor: -94_500, currency: 'TRY' },
        { accountId: 'fx', amountMinor: -3_000, currency: 'EUR' },
        { accountId: 'fx', amountMinor: 94_500, currency: 'TRY' },
      ],
    });
  });

  it('not the payer and not in the split: nothing; the payer without the paying account here: needs an account', () => {
    expect(myExpenseLines({ expense: expense(), eventCurrency: 'TRY', me: 'dewi', accounts, paidFrom: null })).toEqual({ kind: 'none' });
    expect(myExpenseLines({ expense: expense(), eventCurrency: 'TRY', me: 'rina', accounts, paidFrom: null })).toEqual({ kind: 'needs-account' });
  });

  it('a card charged in another currency keeps the card line’s earning category', () => {
    const out = myExpenseLines({
      expense: expense({ currency: 'TRY', amountMinor: 30_000, rateToEvent: '1', split: { mode: 'equal', people: ['rina'] } }),
      eventCurrency: 'TRY',
      me: 'rina',
      accounts,
      paidFrom: { accountId: 'card', currency: 'IDR', chargedMinor: 150_000, spendCategoryId: 'restaurants' },
    });
    expect(out).toEqual({
      kind: 'lines',
      lines: [
        { accountId: 'card', amountMinor: -150_000, currency: 'IDR', spendCategoryId: 'restaurants' },
        { accountId: 'share', amountMinor: 30_000, currency: 'TRY' },
        { accountId: 'fx', amountMinor: 150_000, currency: 'IDR' },
        { accountId: 'fx', amountMinor: -30_000, currency: 'TRY' },
      ],
    });
  });

  it('a voided expense posts nothing', () => {
    expect(myExpenseLines({ expense: expense({ voided: true }), eventCurrency: 'TRY', me: 'andi', accounts, paidFrom: null })).toEqual({ kind: 'none' });
  });
});

describe('mySettlementLines (spec §5)', () => {
  const settlement = { id: 'set-1', fromPersonId: 'andi', toPersonId: 'rina', amountMinor: 290_000, voided: false };

  it('paying from a rupiah bank: bank down by what it paid, trip balance up by the lira figure', () => {
    expect(mySettlementLines({ settlement, eventCurrency: 'TRY', me: 'andi', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: { accountId: 'bank', currency: 'IDR', amountMinor: 1_450_000 } })).toEqual({
      kind: 'lines',
      lines: [
        { accountId: 'bank', amountMinor: -1_450_000, currency: 'IDR' },
        { accountId: 'trip', amountMinor: 290_000, currency: 'TRY' },
        { accountId: 'fx', amountMinor: 1_450_000, currency: 'IDR' },
        { accountId: 'fx', amountMinor: -290_000, currency: 'TRY' },
      ],
    });
  });

  it('receiving into a lira wallet needs no exchange; a third person posts nothing; a party with no account needs one', () => {
    expect(mySettlementLines({ settlement, eventCurrency: 'TRY', me: 'rina', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: { accountId: 'wallet', currency: 'TRY', amountMinor: 290_000 } })).toEqual({
      kind: 'lines',
      lines: [
        { accountId: 'wallet', amountMinor: 290_000, currency: 'TRY' },
        { accountId: 'trip', amountMinor: -290_000, currency: 'TRY' },
      ],
    });
    expect(mySettlementLines({ settlement, eventCurrency: 'TRY', me: 'budi', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: null })).toEqual({ kind: 'none' });
    expect(mySettlementLines({ settlement, eventCurrency: 'TRY', me: 'rina', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: null })).toEqual({ kind: 'needs-account' });
  });

  it('refuses a settlement from a person to the same person', () => {
    expect(() =>
      mySettlementLines({ settlement: { ...settlement, toPersonId: 'andi' }, eventCurrency: 'TRY', me: 'andi', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: null }),
    ).toThrow(expect.objectContaining({ code: 'BAD_SETTLEMENT' }));
  });
});
```

- [ ] **Step 2: Write the failing property tests**

`packages/core/test/shared-events.property.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balances, type ExpenseRecord, expenseInEvent, fewestPayments, myExpenseLines, mySettlementLines, type PostingLine, type SettlementRecord, sharesOf } from '../src/index';

/*
 * Spec §4's three properties, and Review Focus 2 and 4: the split always sums to the total; balances sum to zero; the
 * suggestions settle every balance and do not depend on the order the balances were read in; and each phone's lines
 * balance per currency while moving its trip balance by exactly its Balances figure.
 */
const RUNS = 300;
const SEED = 20261015;
const PEOPLE = ['p-andi', 'p-budi', 'p-dewi', 'p-rina'] as const;
const personArb = fc.constantFrom(...PEOPLE);
const currencyArb = fc.constantFrom('TRY', 'EUR', 'IDR');
const rateArb = fc.constantFrom('0.0211', '1', '31.5', '1.0007', '640', '0.5');

const splitArb = (amountMinor: number) =>
  fc.oneof(
    fc.uniqueArray(personArb, { minLength: 1, maxLength: 4 }).map((people) => ({ mode: 'equal' as const, people })),
    fc.uniqueArray(personArb, { minLength: 1, maxLength: 4 }).chain((people) =>
      fc.array(fc.nat({ max: 1000 }), { minLength: people.length, maxLength: people.length }).map((weights) => {
        const sum = weights.reduce((a, b) => a + b, 0) || 1;
        const shares = people.map((personId, i) => ({ personId, minor: Math.floor((amountMinor * weights[i]!) / sum) }));
        shares[0]!.minor += amountMinor - shares.reduce((a, s) => a + s.minor, 0);
        return { mode: 'amounts' as const, shares };
      }),
    ),
  );

const expenseArb = (eventCurrency: string): fc.Arbitrary<ExpenseRecord> =>
  fc.record({ amountMinor: fc.integer({ min: 1, max: 50_000_000 }), currency: currencyArb, payerPersonId: personArb, rate: rateArb, voided: fc.boolean() }).chain(({ amountMinor, currency, payerPersonId, rate, voided }) =>
    splitArb(amountMinor).map((split) => ({ id: `e-${amountMinor}`, amountMinor, currency, rateToEvent: currency === eventCurrency ? '1' : rate, payerPersonId, split, voided })),
  );

const settlementArb: fc.Arbitrary<SettlementRecord> = fc
  .tuple(personArb, personArb, fc.integer({ min: 1, max: 9_000_000 }), fc.boolean())
  .filter(([from, to]) => from !== to)
  .map(([fromPersonId, toPersonId, amountMinor, voided]) => ({ id: `s-${amountMinor}`, fromPersonId, toPersonId, amountMinor, voided }));

describe('shared events, properties', () => {
  it('the split always sums to the total', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50_000_000 }).chain((amountMinor) => fc.tuple(fc.constant(amountMinor), splitArb(amountMinor), personArb)), ([amountMinor, split, payer]) => {
        const shares = sharesOf({ amountMinor, payerPersonId: payer, split });
        expect(shares.reduce((sum, s) => sum + s.minor, 0)).toBe(amountMinor);
        if (split.mode === 'equal') expect(Math.max(...shares.map((s) => s.minor)) - Math.min(...shares.map((s) => s.minor))).toBeLessThan(split.people.length);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('each expense nets to exactly zero in the event currency, and balances sum to zero', () => {
    fc.assert(
      fc.property(fc.array(expenseArb('TRY'), { maxLength: 8 }), fc.array(settlementArb, { maxLength: 4 }), (expenses, settlements) => {
        for (const e of expenses) {
          const { paidMinor, shares } = expenseInEvent(e, 'TRY');
          expect(paidMinor).toBe(shares.reduce((sum, s) => sum + s.minor, 0));
        }
        expect(Object.values(balances(expenses, settlements, 'TRY')).reduce((a, b) => a + b, 0)).toBe(0);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('the suggestions settle every balance, in at most n−1 payments, whatever order the balances were read in', () => {
    fc.assert(
      fc.property(fc.array(expenseArb('TRY'), { minLength: 1, maxLength: 8 }), fc.array(settlementArb, { maxLength: 4 }), (expenses, settlements) => {
        const owed = balances(expenses, settlements, 'TRY', PEOPLE);
        const plan = fewestPayments(owed);
        const after = { ...owed };
        for (const p of plan) {
          expect(p.amountMinor).toBeGreaterThan(0);
          after[p.fromPersonId]! += p.amountMinor;
          after[p.toPersonId]! -= p.amountMinor;
        }
        expect(Object.values(after).every((v) => v === 0)).toBe(true);
        const nonZero = Object.values(owed).filter((v) => v !== 0).length;
        expect(plan.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
        const reversed = Object.fromEntries(Object.entries(owed).reverse());
        expect(fewestPayments(reversed)).toEqual(plan);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('each phone’s lines balance per currency and move its trip balance by exactly its Balances figure', () => {
    const accounts = { shareAccountId: 'share', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx' };
    const perCurrency = (lines: PostingLine[]) => {
      const sums = new Map<string, number>();
      for (const l of lines) sums.set(l.currency, (sums.get(l.currency) ?? 0) + l.amountMinor);
      return [...sums.values()];
    };
    fc.assert(
      fc.property(fc.array(expenseArb('TRY'), { minLength: 1, maxLength: 6 }), fc.array(settlementArb, { maxLength: 3 }), personArb, (expenses, settlements, me) => {
        let trip = 0;
        for (const e of expenses) {
          const paidFrom = e.payerPersonId === me ? { accountId: 'bank', currency: e.currency, chargedMinor: e.amountMinor } : null;
          const out = myExpenseLines({ expense: e, eventCurrency: 'TRY', me, accounts, paidFrom });
          if (out.kind !== 'lines') continue;
          expect(perCurrency(out.lines).every((sum) => sum === 0)).toBe(true);
          expect(out.lines.every((l) => l.amountMinor !== 0)).toBe(true);
          trip += out.lines.filter((l) => l.accountId === 'trip').reduce((sum, l) => sum + l.amountMinor, 0);
        }
        for (const s of settlements) {
          const out = mySettlementLines({ settlement: s, eventCurrency: 'TRY', me, eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: { accountId: 'bank', currency: 'TRY', amountMinor: s.amountMinor } });
          if (out.kind !== 'lines') continue;
          expect(perCurrency(out.lines).every((sum) => sum === 0)).toBe(true);
          trip += out.lines.filter((l) => l.accountId === 'trip').reduce((sum, l) => sum + l.amountMinor, 0);
        }
        expect(trip).toBe(balances(expenses, settlements, 'TRY', PEOPLE)[me]);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `cd packages/core && npx vitest run test/shared-events.test.ts test/shared-events.property.test.ts`
Expected: FAIL — `sharesOf` (and the rest) is not exported from `../src/index`.

- [ ] **Step 4: Write `split.ts`**

`packages/core/src/shared-events/split.ts`:

```ts
import { convertMinor } from '../money/money';

/*
 * A shared event's arithmetic (shared events spec §4). An expense keeps its own currency and the rate to the event's
 * currency it was recorded with, as a decimal string, so every phone converts it with the same figure. Each person's
 * share is converted on its own, half away from zero — the one rounding rule `convertMinor` already uses — and the
 * payer's "paid" figure is the sum of those converted shares, never the total converted once: that is what makes every
 * expense net to exactly zero in the event currency, however the units fall.
 */

export type SharedEventErrorCode = 'SPLIT_MISMATCH' | 'EMPTY_SPLIT' | 'DUPLICATE_PERSON' | 'BAD_RATE' | 'BAD_AMOUNT' | 'UNBALANCED' | 'BAD_SETTLEMENT';

export class SharedEventError extends Error {
  readonly code: SharedEventErrorCode;

  constructor(code: SharedEventErrorCode, message: string) {
    super(message);
    this.name = 'SharedEventError';
    this.code = code;
  }
}

export interface PersonMinor {
  personId: string;
  minor: number;
}

/**
 * Who shares an expense. `equal` lists the people ticked when it was recorded — "everyone" is written out (ruling R7),
 * so a person added to the event later is never silently in an older expense. `amounts` gives each person's share in
 * the expense's own currency.
 */
export type SplitInput = { mode: 'equal'; people: readonly string[] } | { mode: 'amounts'; shares: readonly PersonMinor[] };

export interface ExpenseRecord {
  id: string;
  /** In `currency`'s minor units, above zero. */
  amountMinor: number;
  currency: string;
  /** Units of the event currency per one unit of `currency`, as a decimal string; '1' in the event currency. */
  rateToEvent: string;
  payerPersonId: string;
  split: SplitInput;
  voided: boolean;
}

export interface SettlementRecord {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  /** In the event currency's minor units, above zero. */
  amountMinor: number;
  voided: boolean;
}

function refuseDuplicates(people: readonly string[]): void {
  if (new Set(people).size !== people.length) throw new SharedEventError('DUPLICATE_PERSON', 'A person is in a split once');
}

/**
 * Each person's share of an expense, in the expense's own currency. An equal split gives every person the same whole
 * number of minor units, and the units left over all go to one person: the payer when the payer is in the split, else
 * the first person listed. An amounts split must add up to the total exactly.
 */
export function sharesOf(expense: Pick<ExpenseRecord, 'amountMinor' | 'payerPersonId' | 'split'>): PersonMinor[] {
  const total = expense.amountMinor;
  if (!Number.isSafeInteger(total) || total <= 0) throw new SharedEventError('BAD_AMOUNT', 'An expense is a whole number of minor units above zero');
  const split = expense.split;
  if (split.mode === 'amounts') {
    if (split.shares.length === 0) throw new SharedEventError('EMPTY_SPLIT', 'An expense is shared by at least one person');
    refuseDuplicates(split.shares.map((s) => s.personId));
    for (const share of split.shares) {
      if (!Number.isSafeInteger(share.minor) || share.minor < 0) throw new SharedEventError('BAD_AMOUNT', 'A share is a whole number of minor units, zero or more');
    }
    const sum = split.shares.reduce((acc, s) => acc + s.minor, 0);
    if (sum !== total) throw new SharedEventError('SPLIT_MISMATCH', `The shares add up to ${sum}, the expense is ${total}`);
    return split.shares.map((s) => ({ personId: s.personId, minor: s.minor }));
  }
  if (split.people.length === 0) throw new SharedEventError('EMPTY_SPLIT', 'An expense is shared by at least one person');
  refuseDuplicates(split.people);
  const each = Math.floor(total / split.people.length);
  const leftover = total - each * split.people.length;
  const takes = split.people.includes(expense.payerPersonId) ? expense.payerPersonId : split.people[0]!;
  return split.people.map((personId) => ({ personId, minor: each + (personId === takes ? leftover : 0) }));
}

/** The rate format a record carries: digits, an optional point and more digits, above zero. Never an exponent. */
const RATE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function isRateString(text: string): boolean {
  return RATE.test(text) && Number(text) > 0;
}

/**
 * A typed or derived rate as the decimal string a record carries: twelve places at most, trailing zeros dropped. A rate
 * too small to show in twelve places is refused rather than written as 0.
 */
export function rateString(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) throw new SharedEventError('BAD_RATE', `A rate is a number above zero, got ${rate}`);
  const text = rate.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
  if (!isRateString(text)) throw new SharedEventError('BAD_RATE', `The rate ${rate} is too small to keep`);
  return text;
}

/**
 * One amount in the event currency: the one conversion every screen and every phone uses (spec §4). In the event's own
 * currency the rate must be '1' and the amount is returned as it is.
 */
export function toEvent(minor: number, currency: string, rateToEvent: string, eventCurrency: string): number {
  if (!isRateString(rateToEvent)) throw new SharedEventError('BAD_RATE', `"${rateToEvent}" is not a rate`);
  if (currency === eventCurrency) {
    if (Number(rateToEvent) !== 1) throw new SharedEventError('BAD_RATE', 'An expense in the event currency has rate 1');
    return minor;
  }
  return convertMinor(minor, currency, eventCurrency, Number(rateToEvent));
}

/** An expense in the event currency: each share converted on its own, and what the payer paid as their sum. */
export function expenseInEvent(expense: ExpenseRecord, eventCurrency: string): { paidMinor: number; shares: PersonMinor[] } {
  const shares = sharesOf(expense).map((s) => ({ personId: s.personId, minor: toEvent(s.minor, expense.currency, expense.rateToEvent, eventCurrency) }));
  return { paidMinor: shares.reduce((sum, s) => sum + s.minor, 0), shares };
}

/** `split_json` as the spec gives it: `[personId…]` for equal, `[{personId, minor}]` for amounts. */
export function splitJsonOf(split: SplitInput): string {
  return JSON.stringify(split.mode === 'equal' ? [...split.people] : split.shares.map((s) => ({ personId: s.personId, minor: s.minor })));
}

/** Reads `split_mode` and `split_json` back; malformed peer data is a `SharedEventError`, never a crash. */
export function parseSplitJson(mode: string, json: string): SplitInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SharedEventError('EMPTY_SPLIT', 'The split is not readable');
  }
  if (!Array.isArray(parsed)) throw new SharedEventError('EMPTY_SPLIT', 'The split is not readable');
  if (mode === 'equal' && parsed.every((p) => typeof p === 'string')) return { mode: 'equal', people: parsed as string[] };
  if (mode === 'amounts' && parsed.every((p) => p && typeof p === 'object' && typeof (p as PersonMinor).personId === 'string' && Number.isSafeInteger((p as PersonMinor).minor))) {
    return { mode: 'amounts', shares: (parsed as PersonMinor[]).map((p) => ({ personId: p.personId, minor: p.minor })) };
  }
  throw new SharedEventError('EMPTY_SPLIT', 'The split is not readable');
}
```

- [ ] **Step 5: Write `balances.ts`**

`packages/core/src/shared-events/balances.ts`:

```ts
import { expenseInEvent, type ExpenseRecord, type SettlementRecord, SharedEventError } from './split';

/*
 * Who owes whom in a shared event (spec §4). A balance is paid − own shares + settlements paid − settlements received,
 * in the event currency: positive, the group owes this person; negative, this person owes the group. The sum over
 * everyone is always zero, because every expense nets to zero (`expenseInEvent`) and every settlement moves the same
 * figure from one person to another.
 */

export function balances(expenses: readonly ExpenseRecord[], settlements: readonly SettlementRecord[], eventCurrency: string, people: readonly string[] = []): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (personId: string, minor: number) => (out[personId] = (out[personId] ?? 0) + minor);
  for (const personId of people) out[personId] = 0;
  for (const expense of expenses) {
    if (expense.voided) continue;
    const { paidMinor, shares } = expenseInEvent(expense, eventCurrency);
    add(expense.payerPersonId, paidMinor);
    for (const share of shares) add(share.personId, -share.minor);
  }
  for (const s of settlements) {
    if (s.voided) continue;
    add(s.fromPersonId, s.amountMinor);
    add(s.toPersonId, -s.amountMinor);
  }
  return out;
}

export interface SuggestedPayment {
  fromPersonId: string;
  toPersonId: string;
  amountMinor: number;
}

interface Side {
  personId: string;
  minor: number;
}

/** Larger amounts first, then person id: the one order every phone sorts by, so every phone suggests the same list. */
const byAmountThenId = (a: Side, b: Side) => b.minor - a.minor || (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0);

/**
 * The fewest payments that settle every balance, greedily: the largest debtor pays the largest creditor as much as
 * either side allows, again and again. A function of the balances alone — never of the order they were read in
 * (Review Focus 4).
 */
export function fewestPayments(owed: Readonly<Record<string, number>>): SuggestedPayment[] {
  const entries = Object.entries(owed);
  if (entries.reduce((sum, [, minor]) => sum + minor, 0) !== 0) throw new SharedEventError('UNBALANCED', 'Balances that do not add up to zero cannot be settled');
  const debtors: Side[] = entries.filter(([, m]) => m < 0).map(([personId, m]) => ({ personId, minor: -m }));
  const creditors: Side[] = entries.filter(([, m]) => m > 0).map(([personId, m]) => ({ personId, minor: m }));
  const out: SuggestedPayment[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(byAmountThenId);
    creditors.sort(byAmountThenId);
    const debtor = debtors[0]!;
    const creditor = creditors[0]!;
    const amountMinor = Math.min(debtor.minor, creditor.minor);
    out.push({ fromPersonId: debtor.personId, toPersonId: creditor.personId, amountMinor });
    debtor.minor -= amountMinor;
    creditor.minor -= amountMinor;
    if (debtor.minor === 0) debtors.shift();
    if (creditor.minor === 0) creditors.shift();
  }
  return out;
}
```

- [ ] **Step 6: Write `lines.ts`**

`packages/core/src/shared-events/lines.ts`:

```ts
import type { PostingLine } from '../ledger/types';
import { type ExpenseRecord, type SettlementRecord, SharedEventError, sharesOf, toEvent } from './split';

/*
 * What a shared event's record puts in one phone's own books (spec §5's table). Every line is in its own currency; the
 * currency exchange account balances each currency to zero, as `exchangeLines` does for a conversion, so a euro dinner
 * in a lira trip paid from a rupiah card is one posting. The trip balance moves by exactly this person's figure in
 * `balances` — the converted shares of the others when this person paid, minus their own converted share when someone
 * else did — so the account and the Balances tab never disagree (Review Focus 2).
 */

export interface MyLineAccounts {
  /** This phone's local copy of the event category, an expense account in no workspace book. */
  shareAccountId: string;
  /** The trip balance: an `event_balance` asset in the event currency. */
  eventBalanceAccountId: string;
  /** The currency exchange equity account. */
  exchangeAccountId: string;
}

/** The account this person paid from, and what it was charged in its own currency (ruling R5). */
export interface PaidFromAccount {
  accountId: string;
  currency: string;
  chargedMinor: number;
  /** On a card: the category the card earns by (ruling R12). */
  spendCategoryId?: string | null;
}

export type MyLines = { kind: 'none' } | { kind: 'needs-account' } | { kind: 'lines'; lines: PostingLine[] };

/** Drops zero lines and balances every currency through the exchange account, currencies in code order. */
function throughExchange(lines: PostingLine[], exchangeAccountId: string): PostingLine[] {
  const kept = lines.filter((line) => line.amountMinor !== 0);
  const sums = new Map<string, number>();
  for (const line of kept) sums.set(line.currency, (sums.get(line.currency) ?? 0) + line.amountMinor);
  const out = [...kept];
  for (const [currency, sum] of [...sums].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (sum !== 0) out.push({ accountId: exchangeAccountId, amountMinor: -sum, currency });
  }
  return out;
}

export function myExpenseLines(input: { expense: ExpenseRecord; eventCurrency: string; me: string; accounts: MyLineAccounts; paidFrom: PaidFromAccount | null }): MyLines {
  const { expense, eventCurrency, me, accounts, paidFrom } = input;
  if (expense.voided) return { kind: 'none' };
  const shares = sharesOf(expense);
  const mine = shares.find((share) => share.personId === me)?.minor ?? 0;
  const lines: PostingLine[] = [];
  if (expense.payerPersonId === me) {
    // Ruling R6: "I paid" lands on a money account only when this phone holds it.
    if (!paidFrom) return { kind: 'needs-account' };
    if (!Number.isSafeInteger(paidFrom.chargedMinor) || paidFrom.chargedMinor <= 0) throw new SharedEventError('BAD_AMOUNT', 'What the account was charged is above zero');
    lines.push({ accountId: paidFrom.accountId, amountMinor: -paidFrom.chargedMinor, currency: paidFrom.currency, ...(paidFrom.spendCategoryId ? { spendCategoryId: paidFrom.spendCategoryId } : {}) });
    lines.push({ accountId: accounts.shareAccountId, amountMinor: mine, currency: expense.currency });
    const others = shares.filter((share) => share.personId !== me).reduce((sum, share) => sum + toEvent(share.minor, expense.currency, expense.rateToEvent, eventCurrency), 0);
    lines.push({ accountId: accounts.eventBalanceAccountId, amountMinor: others, currency: eventCurrency });
  } else {
    if (mine === 0) return { kind: 'none' };
    lines.push({ accountId: accounts.shareAccountId, amountMinor: mine, currency: expense.currency });
    lines.push({ accountId: accounts.eventBalanceAccountId, amountMinor: -toEvent(mine, expense.currency, expense.rateToEvent, eventCurrency), currency: eventCurrency });
  }
  return { kind: 'lines', lines: throughExchange(lines, accounts.exchangeAccountId) };
}

export function mySettlementLines(input: {
  settlement: SettlementRecord;
  eventCurrency: string;
  me: string;
  eventBalanceAccountId: string;
  exchangeAccountId: string;
  account: { accountId: string; currency: string; amountMinor: number } | null;
}): MyLines {
  const { settlement, eventCurrency, me, account } = input;
  if (settlement.fromPersonId === settlement.toPersonId) throw new SharedEventError('BAD_SETTLEMENT', 'A settlement is between two people');
  if (settlement.voided) return { kind: 'none' };
  const paying = settlement.fromPersonId === me;
  if (!paying && settlement.toPersonId !== me) return { kind: 'none' };
  if (!account) return { kind: 'needs-account' };
  if (!Number.isSafeInteger(account.amountMinor) || account.amountMinor <= 0) throw new SharedEventError('BAD_AMOUNT', 'What the account paid or received is above zero');
  const sign = paying ? 1 : -1;
  return {
    kind: 'lines',
    lines: throughExchange(
      [
        { accountId: account.accountId, amountMinor: -sign * account.amountMinor, currency: account.currency },
        { accountId: input.eventBalanceAccountId, amountMinor: sign * settlement.amountMinor, currency: eventCurrency },
      ],
      input.exchangeAccountId,
    ),
  };
}
```

- [ ] **Step 7: Export from the core index**

Append to the end of `packages/core/src/index.ts`:

```ts
export {
  expenseInEvent,
  type ExpenseRecord,
  isRateString,
  parseSplitJson,
  type PersonMinor,
  rateString,
  type SettlementRecord,
  SharedEventError,
  type SharedEventErrorCode,
  sharesOf,
  splitJsonOf,
  type SplitInput,
  toEvent,
} from './shared-events/split';
export { balances, fewestPayments, type SuggestedPayment } from './shared-events/balances';
export { type MyLineAccounts, type MyLines, myExpenseLines, mySettlementLines, type PaidFromAccount } from './shared-events/lines';
```

- [ ] **Step 8: Run the tests and the typecheck**

Run: `cd packages/core && npx vitest run test/shared-events.test.ts test/shared-events.property.test.ts && npx tsc -p tsconfig.json`
Expected: PASS, no type errors. If the `expenseInEvent` example's figures disagree, recompute by hand (34 × 0.333 = 11.322 → 11; 33 × 0.333 = 10.989 → 11) — never change the rounding rule.

- [ ] **Step 9: Run the whole core suite**

Run: `npm run test -w @expanses/core`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/shared-events packages/core/src/index.ts packages/core/test/shared-events.test.ts packages/core/test/shared-events.property.test.ts
git commit -m "$(cat <<'EOF'
Shared events core: splits, one conversion rule, balances that sum to zero, the fewest payments, and each phone's own lines

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration 0069 — the event log's tables, the local bookkeeping, and the `event_balance` subtype

Spec §3 (tables), §5 (the trip-balance account; net worth; the tax report), rulings R2 and R4.

**Files:**
- Create: `packages/db/migrations/0069_shared_events.sql`
- Modify: `packages/db/src/migrations.ts` (import after `exactHundredths`; entry after `{ version: 68, … }`)
- Modify: `packages/db/src/schema.ts:31` (accounts `subtype` enum)
- Modify: `packages/db/src/repos/accounts.ts:23-26` (`BALANCE_SUBTYPES.asset`)
- Modify: `packages/core/src/assets/balance-sheet.ts` (`SECTION_BY_SUBTYPE`)
- Modify: `packages/db/src/repos/asset-values.ts` (`GROUP_BY_SUBTYPE`, `netWorthAt`, `sheetInputsAt`)
- Modify: `packages/db/src/repos/tax-inputs.ts` (the `owed` branch)
- Modify: `packages/db/test/account-types-migration.test.ts:123`, `packages/db/test/cash-equivalents-migration.test.ts:105` (the expected subtype lists grow by `event_balance`)
- Test: `packages/db/test/shared-events-migration.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - Synced tables (columns exactly as in the SQL below): `shared_events`, `event_people`, `event_categories`, `event_expenses`, `event_expense_details`, `event_settlements`, `event_items_shared`.
  - Local tables: `event_books (book_id PK, workspace_id, event_id UNIQUE, balance_account_id)`, `event_postings (book_id, record_id, kind, transaction_id, account_id, account_amount_minor, unposted, changed_by)`, `event_category_accounts (book_id, category_id, account_id UNIQUE, earn_category_id)`, `event_log_currency (book_id PK, currency, locked)`.
  - Account subtype `'event_balance'` (kind `asset`): in `BALANCE_SUBTYPES.asset`, plan group `owed`, balance-sheet section `receivable`; a negative one counts as a `payable` liability in `netWorthAt` and `sheetInputsAt`, and as utang `109` in `coretaxInputsFor`; a positive one as piutang `0209`.

- [ ] **Step 1: Write the failing migration test**

`packages/db/test/shared-events-migration.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { coretaxInputsFor, createAccount, migrate, MIGRATIONS, nativeBalances, netWorthAt, postTransaction, sheetInputsAt, systemAccountId } from '../src/index';
import { setupDb } from './helpers';
import type { NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const columns = async (database: Awaited<ReturnType<typeof setupDb>>['database'], table: string) =>
  (await database.db.values<[number, string]>(sql.raw(`SELECT cid, name FROM pragma_table_info('${table}')`))).map((r) => r[1]);

describe('migration 0069 (shared events)', () => {
  it('is version 69 and named shared_events', () => {
    expect(MIGRATIONS.find((m) => m.version === 69)).toMatchObject({ name: 'shared_events' });
  });

  it('makes the seven synced tables and the four local ones with the spec’s columns', async () => {
    const t = await setupDb();
    executor = t.executor;
    expect(await columns(t.database, 'event_expenses')).toEqual(['book_id', 'id', 'occurred_on', 'amount_minor', 'currency', 'rate_to_event', 'payer_person_id', 'payer_member_id', 'voided_at']);
    expect(await columns(t.database, 'event_expense_details')).toEqual(['book_id', 'id', 'note', 'category_id', 'split_mode', 'split_json', 'recorded_by', 'updated_by']);
    expect(await columns(t.database, 'event_settlements')).toEqual(['book_id', 'id', 'occurred_on', 'from_person_id', 'to_person_id', 'from_member_id', 'to_member_id', 'amount_minor', 'voided_at']);
    for (const table of ['shared_events', 'event_people', 'event_categories', 'event_items_shared', 'event_books', 'event_postings', 'event_category_accounts', 'event_log_currency']) {
      expect((await columns(t.database, table)).length, table).toBeGreaterThan(0);
    }
  });

  it('takes an event_balance account and still refuses a subtype it has never heard of', async () => {
    const t = await setupDb();
    executor = t.executor;
    const trip = await createAccount(t.database, t.ws, { name: 'Coast week', kind: 'asset', subtype: 'event_balance', currency: 'TRY' });
    expect(trip.subtype).toBe('event_balance');
    await expect(
      t.database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-x', '${t.ws.workspaceId}', 'asset', 'treasure', 'Chest', 'IDR', 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
    expect(await t.database.db.values(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });

  it('counts a trip balance owed to this person as a receivable, and one this person owes as a payable', async () => {
    const t = await setupDb();
    executor = t.executor;
    const owedTo = await createAccount(t.database, t.ws, { name: 'Coast week', kind: 'asset', subtype: 'event_balance', currency: 'IDR' });
    const owing = await createAccount(t.database, t.ws, { name: 'Hill weekend', kind: 'asset', subtype: 'event_balance', currency: 'IDR' });
    const equity = await systemAccountId(t.database.db, t.ws, 'opening_balance');
    await postTransaction(t.database, t.ws, { occurredOn: '2026-10-01', description: 'x', lines: [{ accountId: owedTo.id, amountMinor: 300_000, currency: 'IDR' }, { accountId: equity, amountMinor: -300_000, currency: 'IDR' }] });
    await postTransaction(t.database, t.ws, { occurredOn: '2026-10-01', description: 'y', lines: [{ accountId: owing.id, amountMinor: -120_000, currency: 'IDR' }, { accountId: equity, amountMinor: 120_000, currency: 'IDR' }] });

    const worth = await netWorthAt(t.database, t.ws, '2026-10-31', {});
    expect(worth.assetsMinor).toBe(300_000);
    expect(worth.liabilitiesMinor).toBe(120_000);
    expect(worth.netWorthMinor).toBe(180_000);
    expect(worth.stack!.assets.receivable).toBe(300_000);
    expect(worth.stack!.liabilities.payable).toBe(120_000);

    const sheet = await sheetInputsAt(t.database, t.ws, '2026-10-31');
    expect(sheet.assets.map((a) => a.accountId)).toEqual([owedTo.id]);
    expect(sheet.liabilities).toEqual([expect.objectContaining({ accountId: owing.id, subtype: 'payable', balanceMinor: 120_000 })]);

    const tax = await coretaxInputsFor(t.database, t.ws, 2026);
    expect(tax.receivables).toEqual([expect.objectContaining({ accountId: owedTo.id, code: '0209', balanceMinor: 300_000 })]);
    expect(tax.debts).toEqual([expect.objectContaining({ accountId: owing.id, code: '109', balanceMinor: 120_000 })]);
    expect(await nativeBalances(t.database, t.ws)).toMatchObject({ [owedTo.id]: 300_000, [owing.id]: -120_000 });
  });

  it('keeps every account and balance when a version-68 database is migrated', async () => {
    const t = await setupDb();
    executor = t.executor;
    // setupDb already ran 0069; the version-68 path is the account-types and cash-equivalents tests' (their lists grow
    // by event_balance). Here: the rebuild left the foreign keys whole.
    expect(await t.database.db.values(sql`PRAGMA foreign_key_check`)).toEqual([]);
    expect(await migrate(t.database)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/db && npx vitest run test/shared-events-migration.test.ts`
Expected: FAIL — no migration 69; `Subtype event_balance is not valid for asset`.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/0069_shared_events.sql`:

```sql
/* Shared events (shared events spec §3, §5). A trip several people record into is a relay book of its own: a
   shared_books row with no books row, as the net-worth group log is. Its seven synced tables are keyed by that book's
   local id (book_id), which apply writes on insert and which never travels; each record's own id is `id`, so a
   deleted category or plan item is gone for good on every phone (sync rule 3).

   The four local tables never sync: which event books this phone holds and its trip-balance account (event_books), the
   transaction each record put in this phone's own books and the account it was paid from (event_postings), this
   phone's own copy of each event category (event_category_accounts), and the currency lock in log order
   (event_log_currency, ruling R8).

   The trip balance is an asset with a subtype of its own, event_balance: 0001 wrote the subtypes as a CHECK, and SQLite
   cannot alter a CHECK, so the accounts table is rebuilt exactly as 0047 rebuilt it — same columns, same defaults,
   same indexes, foreign keys deferred and the table recreated under its own name — with one more subtype. */

CREATE TABLE shared_events (
  book_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  /* Chosen at creation, fixed after the first expense (D5, ruling R8). */
  currency TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE event_people (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  /* NULL: a person without the app. Otherwise equal to id: the member who claimed this name (ruling R1). */
  member_id TEXT,
  removed_at TEXT,
  PRIMARY KEY (book_id, id)
);

CREATE TABLE event_categories (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  PRIMARY KEY (book_id, id)
);

/* The money of an expense: only its payer's member writes it, when the payer has one (D8, ruling R2). */
CREATE TABLE event_expenses (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  /* Units of the event currency per one unit of `currency`, a decimal string; '1' in the event currency. */
  rate_to_event TEXT NOT NULL,
  payer_person_id TEXT NOT NULL,
  /* NULL: paid outside the app or recorded on someone's behalf; else equal to payer_person_id (ruling R2). */
  payer_member_id TEXT,
  voided_at TEXT,
  PRIMARY KEY (book_id, id)
);

/* The rest of an expense, under the same id: anyone writes it. */
CREATE TABLE event_expense_details (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  note TEXT,
  category_id TEXT,
  split_mode TEXT NOT NULL CHECK (split_mode IN ('equal', 'amounts')),
  split_json TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (book_id, id)
);

CREATE TABLE event_settlements (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  from_person_id TEXT NOT NULL,
  to_person_id TEXT NOT NULL,
  from_member_id TEXT,
  to_member_id TEXT,
  /* In the event currency. */
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  voided_at TEXT,
  PRIMARY KEY (book_id, id)
);

/* The shared plan (D7): one thing to buy, its estimate in the event currency, and the expense that answered it. */
CREATE TABLE event_items_shared (
  book_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_minor INTEGER NOT NULL,
  category_id TEXT,
  link TEXT,
  note TEXT,
  expense_id TEXT,
  share_minor INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, id)
);

/* Local only, never synced. */
CREATE TABLE event_books (
  book_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  balance_account_id TEXT NOT NULL
);

CREATE TABLE event_postings (
  book_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'settlement')),
  /* The derived transaction, posted or void; NULL while nothing has been posted. */
  transaction_id TEXT,
  /* The account this person paid from or received into, and its own-currency figure (ruling R5). */
  account_id TEXT,
  account_amount_minor INTEGER,
  /* Why nothing is posted now: 'choose-account', 'no-rate' or 'malformed'. NULL when posted (or nothing to post). */
  unposted TEXT,
  /* The member whose change last replaced the derived transaction, when not this phone's own: "Changed by Andi". */
  changed_by TEXT,
  PRIMARY KEY (book_id, record_id)
);
CREATE INDEX event_postings_transaction ON event_postings (transaction_id);

CREATE TABLE event_category_accounts (
  book_id TEXT NOT NULL,
  /* '' stands for an expense with no category. */
  category_id TEXT NOT NULL,
  account_id TEXT NOT NULL UNIQUE,
  /* The workspace category a card earns by on these purchases (ruling R12), when there is one. */
  earn_category_id TEXT,
  PRIMARY KEY (book_id, category_id)
);

CREATE TABLE event_log_currency (
  book_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0
);

PRAGMA defer_foreign_keys = ON;

CREATE TABLE accounts_rebuild_0069 AS SELECT * FROM accounts;

DROP TABLE accounts;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  parent_id TEXT REFERENCES accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'income', 'expense', 'equity')),
  subtype TEXT NOT NULL CHECK (subtype IN ('cash', 'bank', 'credit_card', 'savings', 'fund', 'ewallet', 'time_deposit',
    'other_cash', 'investment', 'property', 'vehicle', 'receivable', 'payable', 'loan', 'category', 'equity', 'event_balance')),
  name TEXT NOT NULL,
  icon TEXT,
  currency TEXT,
  valuation_mode TEXT NOT NULL DEFAULT 'derived' CHECK (valuation_mode IN ('derived', 'snapshot', 'market')),
  system_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (kind IN ('income', 'expense', 'equity') OR currency IS NOT NULL)
);

INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode,
  system_key, sort_order, archived_at, created_at)
SELECT id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode,
  system_key, sort_order, archived_at, created_at FROM accounts_rebuild_0069;

DROP TABLE accounts_rebuild_0069;

CREATE INDEX accounts_workspace_kind ON accounts (workspace_id, kind);
CREATE UNIQUE INDEX accounts_system_key ON accounts (workspace_id, system_key)
  WHERE system_key IS NOT NULL AND kind NOT IN ('income', 'expense');
```

- [ ] **Step 4: Register it**

In `packages/db/src/migrations.ts`, after `import exactHundredths from '../migrations/0068_exact_hundredths.sql?raw';` add:

```ts
import sharedEvents from '../migrations/0069_shared_events.sql?raw';
```

and after `{ version: 68, name: 'exact_hundredths', sql: exactHundredths },` add:

```ts
  { version: 69, name: 'shared_events', sql: sharedEvents },
```

- [ ] **Step 5: Add the subtype to the schema, the balance list and the sheet sections**

In `packages/db/src/schema.ts`, the accounts `subtype` enum becomes:

```ts
    enum: ['cash', 'bank', 'credit_card', 'savings', 'fund', 'ewallet', 'time_deposit', 'other_cash', 'investment', 'property', 'vehicle', 'receivable', 'payable', 'loan', 'category', 'equity', 'event_balance'],
```

In `packages/db/src/repos/accounts.ts`, `BALANCE_SUBTYPES.asset` becomes:

```ts
  // 'event_balance' is a shared event's trip balance (shared events §5): made by the event, never offered by a picker.
  asset: ['cash', 'bank', 'savings', 'fund', 'ewallet', 'time_deposit', 'other_cash', 'investment', 'property', 'vehicle', 'receivable', 'event_balance'],
```

In `packages/core/src/assets/balance-sheet.ts`, `SECTION_BY_SUBTYPE` gains:

```ts
  // A trip balance the group owes this person is money owed to them (shared events §5); one they owe is a payable.
  event_balance: 'receivable',
```

- [ ] **Step 6: Net worth and the balance sheet read a negative trip balance as a payable**

In `packages/db/src/repos/asset-values.ts`, `GROUP_BY_SUBTYPE` gains `event_balance: 'owed',` after `receivable: 'owed',`.

Replace the start of `netWorthAt` up to and including the `liabilities` line with:

```ts
export async function netWorthAt(database: Database, ws: WorkspaceContext, date: string, ratesToBase: Record<string, number>): Promise<NetWorth> {
  const values = await assetValuesAt(database, ws, date);
  // A trip balance below zero is money this person owes the group (shared events §5): counted as a payable, never as
  // an asset worth less than nothing. Net worth is the same figure either way; what it is made of is not.
  const owing = values.filter((row) => row.subtype === 'event_balance' && row.valueMinor < 0);
  const held = values.filter((row) => !owing.includes(row));
  const assets = sumToBase({ amounts: held.map((row) => ({ minor: row.valueMinor, currency: row.currency })), baseCurrency: ws.baseCurrency, ratesToBase });

  const liabilitySubtypes = BALANCE_SUBTYPES.liability as readonly string[];
  const rows = await database.db
    .select({ id: accounts.id, currency: accounts.currency, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'liability'), isNull(accounts.archivedAt)));
  const balances = await nativeBalances(database, ws, date);
  const owed = [
    ...rows.filter((row) => liabilitySubtypes.includes(row.subtype)).map((row) => ({ minor: -(balances[row.id] ?? 0), currency: row.currency ?? ws.baseCurrency })),
    ...owing.map((row) => ({ minor: -row.valueMinor, currency: row.currency })),
  ];
  const liabilities = sumToBase({ amounts: owed, baseCurrency: ws.baseCurrency, ratesToBase });
```

In the same function, change `for (const row of values) {` (the `bySection` loop) to `for (const row of held) {`, and after the `byKind` loop add:

```ts
  for (const row of owing) byKind.payable += toBase(-row.valueMinor, row.currency, ws, ratesToBase, stacked);
```

In `sheetInputsAt`, change the `assets` map to read from the rows that are not owed trip balances, and add those as liabilities. Replace `const assets: SheetAsset[] = values.map((row) => ({` with:

```ts
  // A trip balance below zero is a payable (shared events §5), as in `netWorthAt`.
  const owing = values.filter((row) => row.subtype === 'event_balance' && row.valueMinor < 0);
  const assets: SheetAsset[] = values.filter((row) => !owing.includes(row)).map((row) => ({
```

and just before `return { assets, liabilities, missing: [...missing].sort() };` add:

```ts
  for (const row of owing) {
    const balanceMinor = toBase(-row.valueMinor, row.currency, ws, ratesToBase, missing);
    // Owed to friends from a trip: due at once, like any personal debt.
    liabilities.push({ accountId: row.accountId, name: row.name, subtype: 'payable', balanceMinor, dueWithinYearMinor: balanceMinor, note: null, item: null, icon: debtIcon('payable', undefined, assetSubtype) });
  }
```

- [ ] **Step 7: The tax report files a trip balance by its sign**

In `packages/db/src/repos/tax-inputs.ts`, replace the `if (value.planGroup === 'owed') { … }` block with:

```ts
    if (value.planGroup === 'owed') {
      // A trip balance (shared events §5) is piutang lainnya while the group owes this person, utang lainnya while this
      // person owes the group — read by its sign on 31 December.
      if (value.subtype === 'event_balance') {
        if (balanceMinor > 0) inputs.receivables.push({ accountId: value.accountId, name: value.name, code: '0209', balanceMinor, currency: value.currency, fields: { name: value.name, ...fields } });
        if (balanceMinor < 0) inputs.debts.push({ accountId: value.accountId, name: value.name, code: '109', balanceMinor: -balanceMinor, currency: value.currency, note: null });
        continue;
      }
      // A receivable's name is what the piutang table asks for.
      const person = debtProfileOf.get(value.accountId);
      if (balanceMinor <= 0) continue;
      inputs.receivables.push({
        accountId: value.accountId,
        name: value.name,
        code: person?.coretaxCode ?? '0201',
        balanceMinor,
        currency: value.currency,
        fields: { name: person?.personName ?? value.name, ...fields },
      });
      continue;
    }
```

- [ ] **Step 8: Grow the two older migration tests' expected subtype lists**

In `packages/db/test/account-types-migration.test.ts:123`:

```ts
    expect(allowedSubtypes(after.ddl)).toEqual([...allowedSubtypes(before.ddl), 'event_balance', 'ewallet', 'fund', 'other_cash', 'time_deposit'].sort());
```

In `packages/db/test/cash-equivalents-migration.test.ts:105`:

```ts
    expect(allowedSubtypes(after.ddl)).toEqual([...allowedSubtypes(before.ddl), 'event_balance', 'other_cash', 'time_deposit'].sort());
```

- [ ] **Step 9: Run the new and the touched tests, then the whole db suite and the typecheck**

Run: `cd packages/db && npx vitest run test/shared-events-migration.test.ts test/account-types-migration.test.ts test/cash-equivalents-migration.test.ts test/net-worth-series.test.ts test/tax-inputs.test.ts`
Expected: PASS.
Run: `npm run test -w @expanses/db && npm run typecheck`
Expected: PASS (the capture run included: no shared row is touched).

- [ ] **Step 10: Commit**

```bash
git add packages/db/migrations/0069_shared_events.sql packages/db/src/migrations.ts packages/db/src/schema.ts packages/db/src/repos/accounts.ts packages/db/src/repos/asset-values.ts packages/db/src/repos/tax-inputs.ts packages/core/src/assets/balance-sheet.ts packages/db/test/shared-events-migration.test.ts packages/db/test/account-types-migration.test.ts packages/db/test/cash-equivalents-migration.test.ts
git commit -m "$(cat <<'EOF'
Migration 0069: a shared event's tables, the local bookkeeping beside them, and a trip balance that is a receivable or a payable by its sign

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: §5.1 — every reader that narrows by book leaves event-only transactions out

Spec §5.1 and Review Focus 1. Today a transaction with no `book_transactions` row shows in every workspace (`ledger.ts` `listWith`). A transaction a shared event put in this phone's books (it has an `event_postings` row) must show in no workspace list, Cashflow, budget or spending report, and still in its account's history (read owner-wide), its card's statement and points, net worth and the event page.

**Files:**
- Create: `packages/db/src/repos/event-only.ts`
- Modify: `packages/db/src/repos/ledger.ts` (`listWith`, the book narrowing at ~line 665)
- Modify: `packages/db/src/repos/reports.ts` (`categoryRows` where clause; `eventSpendingBetween` where clause)
- Modify: `packages/db/src/repos/flows.ts` (`periodFlows` rows query)
- Test: `packages/db/test/event-only-readers.test.ts`

**Interfaces:**
- Consumes: the `event_postings` table (Task 2).
- Produces (module `packages/db/src/repos/event-only.ts`, not exported from the package index):
  - `eventOnlyExists(db: Db): Promise<boolean>`
  - `notEventOnly(transactionId: SQLWrapper): SQL`
  - `eventPostingOfTx(db: Db, transactionId: string): Promise<{ bookId: string; recordId: string; kind: 'expense' | 'settlement' } | null>`

- [ ] **Step 1: Write the failing tests, one per reader**

`packages/db/test/event-only-readers.test.ts`:

```ts
import { expenseLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  categoryTotalsBetween,
  createAccount,
  eventSpendingBetween,
  inBook,
  listAccounts,
  listTransactions,
  nativeBalances,
  ownerScope,
  periodFlows,
  personalBook,
  postTransaction,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/*
 * Shared events §5.1 (Review Focus 1). A fish dinner a shared event put in this phone's books — on a local share
 * category that belongs to no workspace, with an `event_postings` row — must not reach any workspace's list, category
 * totals, Cashflow figures, budget sheet or event line, and must stay in the wallet's own history and balance.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function trip() {
  const t = await setupDb();
  executor = t.executor;
  const book = await personalBook(t.database, t.ws);
  const ws = inBook(t.ws, book.id);
  const wallet = await createAccount(t.database, ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-09-30' });
  const groceries = (await listAccounts(t.database, ws)).find((a) => a.name === 'Groceries')!;
  // The local copy of an event category, as the derivation (Task 5) makes it: an expense account in no book.
  await t.database.execScript(
    `INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at)
     VALUES ('share-dinners', '${t.ws.workspaceId}', NULL, 'expense', 'category', 'Dinners', NULL, NULL, 'derived', NULL, 0, NULL, '2026-10-01T00:00:00Z')`,
  );
  await t.database.execScript(`INSERT INTO event_category_accounts (book_id, category_id, account_id, earn_category_id) VALUES ('ev-book', 'cat-dinners', 'share-dinners', NULL)`);
  await postTransaction(t.database, ws, { occurredOn: '2026-10-05', description: 'Market', lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: wallet.id, amountMinor: 50_000, currency: 'IDR' }) });
  const dinner = await postTransaction(t.database, ws, {
    occurredOn: '2026-10-06',
    description: 'Fish dinner',
    lines: expenseLines({ categoryAccountId: 'share-dinners', paymentAccountId: wallet.id, amountMinor: 80_000, currency: 'IDR' }),
    eventId: 'ev-local',
  });
  await t.database.execScript(`INSERT INTO event_postings (book_id, record_id, kind, transaction_id) VALUES ('ev-book', 'exp-1', 'expense', '${dinner}')`);
  return { ...t, ws, wallet, groceries, dinner };
}

const october = { from: '2026-10-01', to: '2026-10-31' };

describe('§5.1: an event-only transaction is in no workspace', () => {
  it('the workspace list leaves it out; the wallet’s history (read owner-wide) and a receipt keep it', async () => {
    const t = await trip();
    const listed = (await listTransactions(t.database, t.ws)).map((v) => v.description);
    expect(listed).toContain('Market');
    expect(listed).not.toContain('Fish dinner');
    expect((await listTransactions(t.database, ownerScope(t.ws), { accountId: t.wallet.id })).map((v) => v.description)).toContain('Fish dinner');
    expect((await listTransactions(t.database, ownerScope(t.ws), { id: t.dinner }))).toHaveLength(1);
    expect((await listTransactions(t.database, ownerScope(t.ws), { eventId: 'ev-local' })).map((v) => v.id)).toEqual([t.dinner]);
  });

  it('category totals leave it out, in the workspace and owner-wide alike', async () => {
    const t = await trip();
    for (const ws of [t.ws, ownerScope(t.ws)]) {
      const totals = await categoryTotalsBetween(t.database, ws, 'expense', october.from, october.to);
      expect(totals.map((row) => row.accountId)).toEqual([t.groceries.id]);
    }
  });

  it('Cashflow’s spending leaves it out', async () => {
    const t = await trip();
    expect((await periodFlows(t.database, t.ws, october)).spendingMinor).toBe(50_000);
    expect((await periodFlows(t.database, ownerScope(t.ws), october)).spendingMinor).toBe(50_000);
  });

  it('the budget sheet and its event line leave it out', async () => {
    const t = await trip();
    const sheet = await budgetSheetFor(t.database, t.ws, '2026-10');
    expect(sheet.spendingActualMinor).toBe(50_000);
    expect(sheet.eventSpendingMinor).toBe(0);
    expect((await eventSpendingBetween(t.database, ownerScope(t.ws), october.from, october.to)).amountMinor).toBe(0);
  });

  it('the wallet’s balance still counts it', async () => {
    const t = await trip();
    expect((await nativeBalances(t.database, t.ws))[t.wallet.id]).toBe(1_000_000 - 50_000 - 80_000);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/db && npx vitest run test/event-only-readers.test.ts`
Expected: FAIL — `Fish dinner` is in the workspace list and in the category totals; Cashflow spending reads 130,000 owner-wide.

- [ ] **Step 3: Write `event-only.ts`**

`packages/db/src/repos/event-only.ts`:

```ts
import { type SQL, sql, type SQLWrapper } from 'drizzle-orm';
import type { Db } from '../database';

/*
 * Shared events §5.1. A transaction a shared event put in this phone's own books — the share, the payment, the
 * settle-up — belongs to no workspace: its expense line is on a local copy of the event's category, filed in no book,
 * so it has no `book_transactions` row. A row with none used to mean "moving your own money" and showed in every
 * workspace; this one must show in none. `event_postings` is what tells the two apart: every reader that narrows by
 * book, and every spending report, adds `notEventOnly`. The account's own history (read owner-wide), the card's
 * statement and points, net worth and the event page never narrow by book, so they keep it.
 */

const present = new WeakMap<object, true>();

/** Whether this copy has the shared-event tables (migration 0069). A copy stopped before it has nothing to leave out. */
export async function eventOnlyExists(db: Db): Promise<boolean> {
  if (present.get(db)) return true;
  const rows = await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_postings'`);
  if (rows.length > 0) present.set(db, true);
  return rows.length > 0;
}

/** Over a transaction id: true when it is not one of a shared event's derived transactions. */
export function notEventOnly(transactionId: SQLWrapper): SQL {
  return sql`${transactionId} NOT IN (SELECT transaction_id FROM event_postings WHERE transaction_id IS NOT NULL)`;
}

/** The shared-event record a derived transaction follows, or null for any other transaction. */
export async function eventPostingOfTx(db: Db, transactionId: string): Promise<{ bookId: string; recordId: string; kind: 'expense' | 'settlement' } | null> {
  if (!(await eventOnlyExists(db))) return null;
  const [row] = await db.values<[string, string, string]>(sql`SELECT book_id, record_id, kind FROM event_postings WHERE transaction_id = ${transactionId}`);
  return row ? { bookId: row[0], recordId: row[1], kind: row[2] as 'expense' | 'settlement' } : null;
}
```

- [ ] **Step 4: The workspace list**

In `packages/db/src/repos/ledger.ts`, add the import:

```ts
import { eventOnlyExists, notEventOnly } from './event-only';
```

and replace the book-narrowing block in `listWith`:

```ts
  // A book's list: what was filed in it, and what was filed nowhere — moving your own money shows in every book. What
  // a shared event put in this phone's books is filed nowhere too, and shows in no book (shared events §5.1): read
  // owner-wide (an account's history, a receipt, the event page) it is still there.
  const bookId = opts.bookId ?? ws.bookId;
  if (bookId) {
    conds.push(sql`${transactions.id} NOT IN (SELECT transaction_id FROM book_transactions WHERE book_id <> ${bookId})`);
    if (await eventOnlyExists(database.db)) conds.push(notEventOnly(transactions.id));
  }
```

- [ ] **Step 5: Category totals and the event line**

In `packages/db/src/repos/reports.ts`, add the import:

```ts
import { eventOnlyExists, notEventOnly } from './event-only';
```

In `categoryRows`, add to the `and(…)` list right after the `notExcluded(ws)` entry:

```ts
      // What a shared event put in this phone's books is no workspace's spending (shared events §5.1), owner-wide too.
      ...((await eventOnlyExists(database.db)) ? [notEventOnly(transactions.id)] : []),
```

In `eventSpendingBetween`, add the same entry after its `notExcluded(ws)` entry:

```ts
    // A shared event's own share is counted on the event page, never on a workspace's event line (§5.1).
    ...((await eventOnlyExists(database.db)) ? [notEventOnly(transactions.id)] : []),
```

- [ ] **Step 6: Cashflow**

In `packages/db/src/repos/flows.ts`, add the import:

```ts
import { eventOnlyExists, notEventOnly } from './event-only';
```

and before `const rows = await database.db` in `periodFlows` add:

```ts
  // What a shared event put in this phone's books is in no workspace's Cashflow (shared events §5.1).
  const eventOnly = await eventOnlyExists(database.db);
```

then add to that query's `and(…)`:

```ts
        ...(eventOnly ? [notEventOnly(transactions.id)] : []),
```

- [ ] **Step 7: Run the tests, then the reader suites they touch, then everything**

Run: `cd packages/db && npx vitest run test/event-only-readers.test.ts test/reports.test.ts test/flows.test.ts test/budget-sheet.test.ts test/ledger.test.ts test/book-events.test.ts`
Expected: PASS.
Run: `npm run test -w @expanses/db && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/repos/event-only.ts packages/db/src/repos/ledger.ts packages/db/src/repos/reports.ts packages/db/src/repos/flows.ts packages/db/test/event-only-readers.test.ts
git commit -m "$(cat <<'EOF'
What a shared event puts in a phone's books is in no workspace: lists, category totals, Cashflow and the budget leave it out

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Sync — the seven entities, who may write them, and an event book's context

Spec §3 (entities and writers), §7 (payer-only, refused writes in `sync_skipped`, currency refused after the first expense), rulings R1–R3, R8, R11. No relay yet: everything here is decided and captured against a stand-in event book.

**Files:**
- Create: `packages/db/src/sync/events/authority.ts`
- Modify: `packages/db/src/sync/shared-entities.ts` (seven `RowEntity` entries before the `purchase` entry; `NEVER_SYNCED_COLUMNS`)
- Modify: `packages/db/src/sync/authority.ts` (`eventBookWorkspaceOf`, `DecideContext.everyMemberOwns`, `decideOp` event branch, `decideEventRow`, `noteEventLogTx`, `decideMember`'s owner introduction)
- Modify: `packages/db/src/sync/capture.ts` (`withCapture` event branch, `refuseWrongLog`)
- Modify: `packages/db/src/sync/apply.ts` (`bookContextTx` fallback; `pullAndApply` passes `everyMemberOwns` and puts this phone's own stripped currency back)
- Test: `packages/db/test/sync/event-authority.test.ts`
- Test: `packages/db/test/sync/event-capture.test.ts`
- (Covered without edits: `packages/db/test/sync/shared-entities.test.ts` holds every new entity's columns to the schema.)

**Interfaces:**
- Consumes: Task 2's tables.
- Produces:
  - `EVENT_ENTITIES: ReadonlySet<string>` and `eventWriteRefusal(entity: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, key: Record<string, string>, member: string | null): string | null` from `packages/db/src/sync/events/authority.ts`.
  - Entity names and synced fields (what later tasks write and read):
    - `shared_event` (key `book_id`): `name, startsOn, endsOn, currency, finishedAt`
    - `event_person` (key `id`): `name, memberId, removedAt`
    - `event_category` (key `id`): `name, icon, sortOrder, archivedAt`
    - `event_expense` (key `id`): `occurredOn, amountMinor, currency, rateToEvent, payerPersonId, payerMemberId, voidedAt`
    - `event_expense_detail` (key `id`, the expense's): `note, categoryId, splitMode, splitJson, recordedBy, updatedBy`
    - `event_settlement` (key `id`): `occurredOn, fromPersonId, toPersonId, fromMemberId, toMemberId, amountMinor, voidedAt`
    - `event_item` (key `id`): `name, quantity, unitPriceMinor, categoryId, link, note, expenseId, shareMinor, sortOrder`
  - `eventBookWorkspaceOf(tx: Db, bookId: string): Promise<string | null>` (authority.ts) — the workspace this phone holds an event book in, from `event_books`.
  - `bookContextTx(tx, eventBookId)` resolves an event book (workspace and currency from `event_books`, member from `shared_books`).
  - `DecideContext.everyMemberOwns?: boolean` — every member of the book is an owner (event books, like group logs).

- [ ] **Step 1: Write the failing pure tests for the writer rules**

`packages/db/test/sync/event-authority.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccount } from '../../src/index';
import type { NodeExecutor } from '../../src/node';
import { AuthorityError, decideOpsTx } from '../../src/sync/authority';
import { bookContextTx } from '../../src/sync/apply';
import { eventWriteRefusal } from '../../src/sync/events/authority';
import { encodeHlc } from '../../src/sync/hlc';
import { setupDb } from '../helpers';
import { shareBookForTest } from './sync-helpers';

/*
 * Who may write a shared event's rows (shared events §3, D8; rulings R1–R3, R11). One pure predicate judges this
 * phone's own write and a peer's op alike. Review Focus 5: an expense's money is its payer's member's alone, and the
 * detail entity — the split, the category, the note — carries none of it.
 */

const expense = (over: Record<string, unknown> = {}) => ({
  occurredOn: '2026-10-06',
  amountMinor: 9_000,
  currency: 'EUR',
  rateToEvent: '31.5',
  payerPersonId: 'p-rina',
  payerMemberId: 'p-rina',
  voidedAt: null,
  ...over,
});
const key = { id: 'exp-1' };

describe('eventWriteRefusal: an expense paid from a member’s account', () => {
  it('is recorded by that member only', () => {
    expect(eventWriteRefusal('event_expense', null, expense(), key, 'p-rina')).toBeNull();
    expect(eventWriteRefusal('event_expense', null, expense(), key, 'p-andi')).toMatch(/only the person whose money it is/);
  });

  it('keeps its amount, currency, rate, date and void to its payer’s member', () => {
    for (const change of [{ amountMinor: 1 }, { currency: 'TRY' }, { rateToEvent: '30' }, { occurredOn: '2026-10-07' }, { voidedAt: '2026-10-08T00:00:00Z' }]) {
      expect(eventWriteRefusal('event_expense', expense(), expense(change), key, 'p-andi')).not.toBeNull();
      expect(eventWriteRefusal('event_expense', expense(), expense(change), key, 'p-rina')).toBeNull();
    }
  });

  it('never changes who paid, nor the member', () => {
    expect(eventWriteRefusal('event_expense', expense(), expense({ payerPersonId: 'p-andi' }), key, 'p-rina')).toMatch(/who paid is fixed/);
    expect(eventWriteRefusal('event_expense', expense(), expense({ payerMemberId: null }), key, 'p-rina')).toMatch(/set once/);
  });

  it('lets anyone write its details: split, category, note (Review Focus 5 — no money travels there)', () => {
    const detail = { note: 'Fish dinner', categoryId: 'cat-1', splitMode: 'equal', splitJson: '["p-rina","p-andi"]', recordedBy: 'p-rina', updatedBy: null };
    expect(eventWriteRefusal('event_expense_detail', detail, { ...detail, splitJson: '["p-andi"]', updatedBy: 'p-andi' }, key, 'p-andi')).toBeNull();
  });
});

describe('eventWriteRefusal: an expense paid outside the app', () => {
  const outside = expense({ payerPersonId: 'p-budi', payerMemberId: null });

  it('is anyone’s to record and change, its payer included', () => {
    expect(eventWriteRefusal('event_expense', null, outside, key, 'p-andi')).toBeNull();
    expect(eventWriteRefusal('event_expense', outside, { ...outside, amountMinor: 8_000, payerPersonId: 'p-dewi' }, key, 'p-andi')).toBeNull();
  });

  it('is taken over by the person who paid it, once they have the app, and by nobody else', () => {
    expect(eventWriteRefusal('event_expense', outside, { ...outside, payerMemberId: 'p-budi' }, key, 'p-budi')).toBeNull();
    expect(eventWriteRefusal('event_expense', outside, { ...outside, payerMemberId: 'p-andi' }, key, 'p-andi')).toMatch(/set only by the person it names/);
    expect(eventWriteRefusal('event_expense', outside, { ...outside, payerMemberId: 'p-budi' }, key, 'p-andi')).toMatch(/set only by the person it names/);
  });
});

describe('eventWriteRefusal: people, settlements, voids and deletes', () => {
  it('a name is claimed once, by the member whose id it is (R1)', () => {
    const budi = { name: 'Budi', memberId: null, removedAt: null };
    expect(eventWriteRefusal('event_person', budi, { ...budi, memberId: 'p-budi' }, { id: 'p-budi' }, 'p-budi')).toBeNull();
    expect(eventWriteRefusal('event_person', budi, { ...budi, memberId: 'p-andi' }, { id: 'p-budi' }, 'p-andi')).not.toBeNull();
    expect(eventWriteRefusal('event_person', { ...budi, memberId: 'p-budi' }, { ...budi, memberId: 'p-dewi' }, { id: 'p-budi' }, 'p-dewi')).toMatch(/set once/);
    expect(eventWriteRefusal('event_person', budi, { ...budi, name: 'Budi S.' }, { id: 'p-budi' }, 'p-andi')).toBeNull();
  });

  it('a settlement is written by either side’s member, anyone’s when neither has the app, and never re-pointed', () => {
    const s = { occurredOn: '2026-10-12', fromPersonId: 'p-andi', toPersonId: 'p-rina', fromMemberId: 'p-andi', toMemberId: 'p-rina', amountMinor: 290_000, voidedAt: null };
    expect(eventWriteRefusal('event_settlement', null, s, { id: 's-1' }, 'p-rina')).toBeNull();
    expect(eventWriteRefusal('event_settlement', null, s, { id: 's-1' }, 'p-dewi')).not.toBeNull();
    expect(eventWriteRefusal('event_settlement', s, { ...s, toPersonId: 'p-dewi' }, { id: 's-1' }, 'p-andi')).toMatch(/who paid whom is fixed/);
    const outside = { ...s, fromPersonId: 'p-budi', fromMemberId: null, toPersonId: 'p-dewi', toMemberId: null };
    expect(eventWriteRefusal('event_settlement', null, outside, { id: 's-2' }, 'p-andi')).toBeNull();
  });

  it('the side that gets the app later takes over its half, even when the other half is already a member’s', () => {
    const s = { occurredOn: '2026-10-12', fromPersonId: 'p-andi', toPersonId: 'p-budi', fromMemberId: 'p-andi', toMemberId: null, amountMinor: 90_000, voidedAt: null };
    expect(eventWriteRefusal('event_settlement', s, { ...s, toMemberId: 'p-budi' }, { id: 's-3' }, 'p-budi')).toBeNull();
    expect(eventWriteRefusal('event_settlement', s, { ...s, toMemberId: 'p-budi', amountMinor: 1 }, { id: 's-3' }, 'p-budi')).not.toBeNull();
  });

  it('a void stays a void; a record is never deleted, a category or an item may be', () => {
    expect(eventWriteRefusal('event_expense', expense({ voidedAt: '2026-10-08T00:00:00Z' }), expense({ voidedAt: null }), key, 'p-rina')).toMatch(/a void stays a void/);
    expect(eventWriteRefusal('event_expense', expense(), null, key, 'p-rina')).toMatch(/never deleted/);
    expect(eventWriteRefusal('event_category', { name: 'Dinners', icon: null, sortOrder: 0, archivedAt: null }, null, { id: 'cat-1' }, 'p-andi')).toBeNull();
  });

  it('says nothing about entities that are not a shared event’s', () => {
    expect(eventWriteRefusal('category', null, { name: 'x' }, { id: 'c' }, null)).toBeNull();
  });
});

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

/** A stand-in event book on this phone: shared as Rina, held in the Personal workspace, with Andi in its view. */
async function eventBook() {
  const t = await setupDb();
  executor = t.executor;
  const trip = await createAccount(t.database, t.ws, { name: 'Coast week', kind: 'asset', subtype: 'event_balance', currency: 'TRY' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO event_books (book_id, workspace_id, event_id, balance_account_id) VALUES ('ev-book', '${t.ws.workspaceId}', 'ev-local', '${trip.id}');
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
    INSERT INTO sync_authority (book_id, member_id, role, role_hlc, deleted, row_hlc) VALUES ('ev-book', 'p-andi', 'owner', '0', 0, '0');
    INSERT INTO sync_authority_devices (book_id, device_id, member_id, removed_seq, added_seq) VALUES ('ev-book', 'dev-andi', 'p-andi', NULL, 2);
    INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
      VALUES ('ev-book', 'exp-1', '2026-10-06', 9000, 'EUR', '31.5', 'p-rina', 'p-rina', NULL);
  `);
  return t;
}

describe('a peer’s op, decided against the stored row and the authority view', () => {
  it('refuses Andi’s change to the amount of Rina’s expense, and takes Andi’s change to its split', async () => {
    const t = await eventBook();
    const hlc = encodeHlc(Date.parse('2026-10-09T00:00:00Z'), 0, 'dev-andi');
    const decided = await t.database.transaction((tx) =>
      decideOpsTx(tx, { bookId: 'ev-book', author: 'dev-andi', hlc, creator: false }, [
        { entity: 'event_expense', id: 'exp-1', op: 'upsert', fields: { amountMinor: 1 } },
        { entity: 'event_expense_detail', id: 'exp-1', op: 'upsert', fields: { splitJson: '["p-andi"]', updatedBy: 'p-andi' } },
      ]),
    );
    expect(decided[0]).toBeInstanceOf(AuthorityError);
    expect((decided[0] as AuthorityError).message).toMatch(/^AUTHORITY: only the person whose money it is/);
    expect(decided[1]).not.toBeInstanceOf(AuthorityError);
  });

  it('strips a currency change that comes after the first expense in the log (R8)', async () => {
    const t = await eventBook();
    const hlc = encodeHlc(Date.parse('2026-10-09T00:00:00Z'), 0, 'dev-andi');
    const decided = await t.database.transaction(async (tx) => {
      await decideOpsTx(tx, { bookId: 'ev-book', author: 'dev-andi', hlc, creator: false }, [
        { entity: 'shared_event', id: 'ev-book', op: 'upsert', fields: { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', finishedAt: null } },
        { entity: 'event_expense', id: 'exp-2', op: 'upsert', fields: { occurredOn: '2026-10-07', amountMinor: 500, currency: 'TRY', rateToEvent: '1', payerPersonId: 'p-budi', payerMemberId: null, voidedAt: null } },
      ]);
      return decideOpsTx(tx, { bookId: 'ev-book', author: 'dev-andi', hlc, creator: false }, [
        { entity: 'shared_event', id: 'ev-book', op: 'upsert', fields: { name: 'Coast weekend', currency: 'EUR' }, changed: ['name', 'currency'] },
      ]);
    });
    const op = decided[0]!;
    expect(op).not.toBeInstanceOf(AuthorityError);
    expect(op.op === 'upsert' && op.fields).toEqual({ name: 'Coast weekend' });
  });
});

describe('an event book’s context', () => {
  it('is the workspace that holds it, in that workspace’s currency, as this phone’s member', async () => {
    const t = await eventBook();
    const ctx = await t.database.transaction((tx) => bookContextTx(tx, 'ev-book'));
    expect(ctx).toEqual({ bookId: 'ev-book', ws: { workspaceId: t.ws.workspaceId, baseCurrency: 'IDR' }, memberId: 'p-rina', currency: 'IDR' });
    expect((await t.database.db.values(sql`SELECT 1 FROM sync_skipped`)).length).toBe(0);
  });
});
```

- [ ] **Step 2: Write the failing capture tests**

`packages/db/test/sync/event-capture.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccount, personalBook } from '../../src/index';
import type { NodeExecutor } from '../../src/node';
import { AuthorityError } from '../../src/sync/authority';
import { withCapture } from '../../src/sync/capture';
import { setupDb } from '../helpers';
import { installCaptureTriggers, uncapturedWrites } from './capture-harness';
import { outboxOps, shareBookForTest } from './sync-helpers';

/*
 * This phone's own writes to a shared event's book (shared events §3, §7): captured whole (§6.4: nothing escapes),
 * judged before they commit by the same rules a peer's op meets, and kept out of any book that is not an event's.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function eventBook() {
  const t = await setupDb();
  executor = t.executor;
  const trip = await createAccount(t.database, t.ws, { name: 'Coast week', kind: 'asset', subtype: 'event_balance', currency: 'TRY' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO event_books (book_id, workspace_id, event_id, balance_account_id) VALUES ('ev-book', '${t.ws.workspaceId}', 'ev-local', '${trip.id}');
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
  `);
  await installCaptureTriggers(t.database, 'ev-book');
  return t;
}

const insertExpense = (payerMember: string | null) => sql`
  INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
  VALUES ('ev-book', 'exp-1', '2026-10-06', 9000, 'EUR', '31.5', ${payerMember ?? 'p-budi'}, ${payerMember}, NULL)`;

describe('capturing a shared event’s rows', () => {
  it('captures a new expense whole, and nothing escapes', async () => {
    const t = await eventBook();
    await t.database.transaction((tx) => withCapture(tx, { entity: 'event_expense', id: 'exp-1', bookId: 'ev-book' }, () => tx.run(insertExpense('p-rina'))));
    const ops = await outboxOps(t.database);
    expect(ops).toEqual([expect.objectContaining({ entity: 'event_expense', id: 'exp-1', op: 'upsert', fields: expect.objectContaining({ amountMinor: 9000, payerMemberId: 'p-rina' }) })]);
    expect(await uncapturedWrites(t.database, 'ev-book')).toEqual([]);
  });

  it('refuses, before it commits, an amount change to an expense another member paid', async () => {
    const t = await eventBook();
    await t.database.execScript(`INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
      VALUES ('ev-book', 'exp-9', '2026-10-06', 9000, 'EUR', '31.5', 'p-andi', 'p-andi', NULL)`);
    await expect(
      t.database.transaction((tx) => withCapture(tx, { entity: 'event_expense', id: 'exp-9', bookId: 'ev-book' }, () => tx.run(sql`UPDATE event_expenses SET amount_minor = 1 WHERE id = 'exp-9'`))),
    ).rejects.toBeInstanceOf(AuthorityError);
    expect(await t.database.db.values(sql`SELECT amount_minor FROM event_expenses WHERE id = 'exp-9'`)).toEqual([[9000]]);
  });

  it('refuses a currency change once an expense exists here (R8)', async () => {
    const t = await eventBook();
    await t.database.transaction((tx) => withCapture(tx, { entity: 'event_expense', id: 'exp-1', bookId: 'ev-book' }, () => tx.run(insertExpense(null))));
    await expect(
      t.database.transaction((tx) => withCapture(tx, { entity: 'shared_event', id: 'ev-book', bookId: 'ev-book' }, () => tx.run(sql`UPDATE shared_events SET currency = 'EUR' WHERE book_id = 'ev-book'`))),
    ).rejects.toThrow(/currency is fixed/);
  });

  it('refuses a shared event’s row written into a workspace’s book', async () => {
    const t = await eventBook();
    const book = await personalBook(t.database, t.ws);
    // The capture run shares every first Personal book from birth: share it here only when it is not already.
    await t.database.db.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at)
      VALUES (${book.id}, ${'relay-' + book.id}, 1, 'member-me', 'active', '2026-10-01T00:00:00Z') ON CONFLICT (book_id) DO NOTHING`);
    await expect(
      t.database.transaction((tx) =>
        withCapture(tx, { entity: 'event_person', id: 'p-x', bookId: book.id }, () =>
          tx.run(sql`INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES (${book.id}, 'p-x', 'Someone', NULL, NULL)`),
        ),
      ),
    ).rejects.toThrow(/outside a shared event/);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd packages/db && npx vitest run test/sync/event-authority.test.ts test/sync/event-capture.test.ts`
Expected: FAIL — `../../src/sync/events/authority` does not exist; `Unknown shared entity "event_expense"`.

- [ ] **Step 4: Write the pure writer rules**

`packages/db/src/sync/events/authority.ts`:

```ts
/*
 * Who may write a shared event's rows (shared events spec §3, D8; rulings R1–R3, R11). One pure predicate, read from
 * the row as it stood, the row as it would be, the key and the writing member — never another row — so this phone's
 * own write (judged at capture, against its pre-image) and a peer's op (judged on apply, against the stored row and the
 * authority view's member) are decided alike on every phone.
 *
 * - An expense's money (`event_expense`) is its payer's member's alone when the payer paid from an account in the app
 *   (`payerMemberId` set); anyone's when it was paid outside the app. Its details (`event_expense_detail`: split,
 *   category, note) are anyone's — which is why the two are separate entities under one key, and why no money travels
 *   in the detail (Review Focus 5).
 * - A settlement is either side's member's; anyone's when neither side has the app.
 * - `memberId` on a person, `payerMemberId` on an expense and `fromMemberId`/`toMemberId` on a settlement are set once,
 *   from null, by the member they name, who must be that row's person (a claim, a takeover); never moved after. Who
 *   paid an expense is fixed once its payer's member is; who paid whom in a settlement is always fixed.
 * - A void stays a void; records are voided or removed, never deleted; categories and plan items may be deleted.
 */

export const EVENT_ENTITIES: ReadonlySet<string> = new Set(['shared_event', 'event_person', 'event_category', 'event_expense', 'event_expense_detail', 'event_settlement', 'event_item']);

const NEVER_DELETED: ReadonlySet<string> = new Set(['shared_event', 'event_person', 'event_expense', 'event_expense_detail', 'event_settlement']);

interface ClaimedField {
  field: string;
  /** The person the field may only ever name. */
  person: (key: Record<string, string>, row: Record<string, unknown>) => unknown;
}

const CLAIMED: Readonly<Record<string, readonly ClaimedField[]>> = {
  event_person: [{ field: 'memberId', person: (key) => key.id }],
  event_expense: [{ field: 'payerMemberId', person: (_key, row) => row.payerPersonId }],
  event_settlement: [
    { field: 'fromMemberId', person: (_key, row) => row.fromPersonId },
    { field: 'toMemberId', person: (_key, row) => row.toPersonId },
  ],
};

const named = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** The members a record's money belongs to; empty when it is anyone's. */
function writersOf(entity: string, row: Record<string, unknown>): string[] {
  if (entity === 'event_expense') return named(row.payerMemberId) ? [row.payerMemberId] : [];
  if (entity === 'event_settlement') return [row.fromMemberId, row.toMemberId].filter(named);
  return [];
}

const changedFields = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  Object.keys(after).filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));

/** Why this write is refused (the text after "AUTHORITY: "), or null. */
export function eventWriteRefusal(
  entity: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  key: Record<string, string>,
  member: string | null,
): string | null {
  if (!EVENT_ENTITIES.has(entity)) return null;
  if (after === null) return before !== null && NEVER_DELETED.has(entity) ? 'a record is voided or removed, never deleted' : null;
  const claims = CLAIMED[entity] ?? [];
  // A takeover changes nothing but a claimed field going from null to the member it names (R6): the other side of a
  // settlement already being a member's does not stand in its way.
  const takeover =
    before !== null &&
    changedFields(before, after).length > 0 &&
    changedFields(before, after).every((field) => claims.some((c) => c.field === field && !named(before[field]) && after[field] === member && member === c.person(key, after)));
  const writers = writersOf(entity, before ?? after);
  if (writers.length > 0 && !(member !== null && writers.includes(member)) && !takeover) return 'only the person whose money it is changes it';
  for (const { field, person } of claims) {
    const was = before?.[field] ?? null;
    const now = after[field] ?? null;
    if (named(was)) {
      if (now !== was) return `${field} is set once`;
      continue;
    }
    if (now === null) continue;
    // It names only the row's own person. Set on a row that exists it is a claim or a takeover, made only by the member
    // it names; on a new record the writer rule above already judged who records it (a settlement names both sides'
    // members at once) — except a person, whom only the member it is makes as a member.
    const byItself = before !== null || entity === 'event_person';
    if (!named(now) || now !== person(key, after) || (byItself && now !== member)) return `${field} is set only by the person it names`;
  }
  if (before !== null) {
    if (entity === 'event_expense' && named(before.payerMemberId) && after.payerPersonId !== before.payerPersonId) return 'who paid is fixed';
    if (entity === 'event_settlement' && (after.fromPersonId !== before.fromPersonId || after.toPersonId !== before.toPersonId)) return 'who paid whom is fixed';
    if (named(before.voidedAt) && !named(after.voidedAt)) return 'a void stays a void';
  }
  return null;
}
```

- [ ] **Step 5: Register the seven entities**

In `packages/db/src/sync/shared-entities.ts`, insert before the `{ kind: 'purchase', … }` entry:

```ts
  /*
   * Shared events (shared events spec §3): the seven entities of an event's own relay book — a shared_books row with no
   * books row, as the net-worth group log is, tied to no workspace. book_id is that book's local id, written on insert;
   * each record's own id is `id`, so a deleted category or item never comes back (rule 3). Who may write what is
   * `events/authority.ts`'s, judged from the op, the stored row and the author alone (rulings R1–R3): none has a
   * `writer` here.
   */
  {
    kind: 'row',
    entity: 'shared_event',
    table: 'shared_events',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['book_id'],
    fields: { name: 'name', startsOn: 'starts_on', endsOn: 'ends_on', currency: 'currency', finishedAt: 'finished_at' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'event_person',
    table: 'event_people',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: { name: 'name', memberId: 'member_id', removedAt: 'removed_at' },
    localOnInsert: ['book_id'],
  },
  {
    kind: 'row',
    entity: 'event_category',
    table: 'event_categories',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: { name: 'name', icon: 'icon', sortOrder: 'sort_order', archivedAt: 'archived_at' },
    localOnInsert: ['book_id'],
  },
  {
    kind: 'row',
    entity: 'event_expense',
    table: 'event_expenses',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: {
      occurredOn: 'occurred_on',
      amountMinor: 'amount_minor',
      currency: 'currency',
      rateToEvent: 'rate_to_event',
      payerPersonId: 'payer_person_id',
      // Ruling R2: null for money paid outside the app, else the payer's member — who alone writes this row.
      payerMemberId: 'payer_member_id',
      voidedAt: 'voided_at',
    },
    localOnInsert: ['book_id'],
  },
  {
    kind: 'row',
    entity: 'event_expense_detail',
    table: 'event_expense_details',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: { note: 'note', categoryId: 'category_id', splitMode: 'split_mode', splitJson: 'split_json', recordedBy: 'recorded_by', updatedBy: 'updated_by' },
    localOnInsert: ['book_id'],
  },
  {
    kind: 'row',
    entity: 'event_settlement',
    table: 'event_settlements',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: {
      occurredOn: 'occurred_on',
      fromPersonId: 'from_person_id',
      toPersonId: 'to_person_id',
      fromMemberId: 'from_member_id',
      toMemberId: 'to_member_id',
      amountMinor: 'amount_minor',
      voidedAt: 'voided_at',
    },
    localOnInsert: ['book_id'],
  },
  {
    kind: 'row',
    entity: 'event_item',
    table: 'event_items_shared',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: {
      name: 'name',
      quantity: 'quantity',
      unitPriceMinor: 'unit_price_minor',
      categoryId: 'category_id',
      link: 'link',
      note: 'note',
      expenseId: 'expense_id',
      shareMinor: 'share_minor',
      sortOrder: 'sort_order',
    },
    localOnInsert: ['book_id'],
  },
```

and add to `NEVER_SYNCED_COLUMNS`, after `member_transfers: ['book_id'],`:

```ts
  // Shared events (migration 0069): book_id is the event book's local id, written on insert. shared_events is keyed
  // by it, so every one of its columns travels or is the key.
  event_people: ['book_id'],
  event_categories: ['book_id'],
  event_expenses: ['book_id'],
  event_expense_details: ['book_id'],
  event_settlements: ['book_id'],
  event_items_shared: ['book_id'],
```

- [ ] **Step 6: Decide a peer's op, keep the currency mark, and let every event member be an owner**

In `packages/db/src/sync/authority.ts`, add the import:

```ts
import { EVENT_ENTITIES, eventWriteRefusal } from './events/authority';
```

After `groupLogWorkspaceOf` add:

```ts
/**
 * The workspace this phone holds a shared event's relay book in (shared events §3), or null for any other book. From
 * `event_books`, which only this phone writes, when it shares or joins the event.
 */
export async function eventBookWorkspaceOf(tx: Db, bookId: string): Promise<string | null> {
  try {
    const [row] = await tx.values<[string]>(sql`SELECT workspace_id FROM event_books WHERE book_id = ${bookId}`);
    return row?.[0] ?? null;
  } catch {
    return null; // a database from before migration 0069 has no event books
  }
}
```

Add to `DecideContext`:

```ts
  /**
   * The book is a shared event's (shared events §3): every member is an owner — any of them may invite or remove — so a
   * member's own introduction may make itself an owner, as in a group log.
   */
  everyMemberOwns?: boolean;
```

In `decideOp`, right after `const entity = entityOf(op.entity);`, add:

```ts
  // Shared events (rulings R1–R3, R8): a peer's op is judged against the stored row by the one predicate capture used
  // on its author's phone; every entry, this phone's own included, moves the currency mark in log order.
  if (EVENT_ENTITIES.has(op.entity) && entity.kind === 'row') {
    if (!ctx.own) await decideEventRow(tx, bookId, author, entity, op);
    return noteEventLogTx(tx, bookId, op);
  }
```

In `decideMember`, change the `introducedAs` line to:

```ts
    const introducedAs = op.fields.role === 'member' || ((ctx.groupLog === true || ctx.everyMemberOwns === true) && op.fields.role === 'owner');
```

At the end of the file add:

```ts
/** A peer's op on a shared event's row (shared events §3): judged against the row stored here and the author's member. */
async function decideEventRow(tx: Db, bookId: string, author: string, entity: RowEntity, op: Op): Promise<void> {
  const key = parseOpId(entity, op.id);
  const stored = await storedRowOf(tx, entity, bookId, key);
  const member = await authorMemberOf(tx, bookId, author);
  const after = op.op === 'delete' ? null : { ...(stored ?? {}), ...op.fields };
  const why = eventWriteRefusal(entity.entity, stored, after, key, member);
  if (why) throw new AuthorityError(why);
}

/**
 * Ruling R8, in log order: the first expense the log takes locks the event's currency, on every phone at the same entry;
 * a currency named by a later `shared_event` op is stripped from it. Before the lock, the log's currency is kept here,
 * so a phone whose own change was stripped can be put back to it (`settleEventCurrencyTx`).
 */
async function noteEventLogTx(tx: Db, bookId: string, op: Op): Promise<Op> {
  if (op.op !== 'upsert') return op;
  if (op.entity === 'event_expense') {
    await tx.run(sql`INSERT INTO event_log_currency (book_id, currency, locked) VALUES (${bookId}, '', 1) ON CONFLICT (book_id) DO UPDATE SET locked = 1`);
    return op;
  }
  if (op.entity !== 'shared_event' || !('currency' in op.fields)) return op;
  const changed = op.changed ?? Object.keys(op.fields);
  if (!changed.includes('currency')) return op;
  const [mark] = await tx.values<[string, number]>(sql`SELECT currency, locked FROM event_log_currency WHERE book_id = ${bookId}`);
  if (mark && Number(mark[1]) === 1) return without(op, ['currency']);
  await tx.run(sql`
    INSERT INTO event_log_currency (book_id, currency, locked) VALUES (${bookId}, ${String(op.fields.currency)}, 0)
    ON CONFLICT (book_id) DO UPDATE SET currency = excluded.currency`);
  return op;
}

/** Puts this phone's own currency back to the log's when the log stripped it (R8). Nothing is emitted. */
export async function settleEventCurrencyTx(tx: Db, bookId: string): Promise<void> {
  const [mark] = await tx.values<[string, number]>(sql`SELECT currency, locked FROM event_log_currency WHERE book_id = ${bookId}`);
  if (!mark || Number(mark[1]) !== 1 || mark[0] === '') return;
  await tx.run(sql`UPDATE shared_events SET currency = ${mark[0]} WHERE book_id = ${bookId} AND currency <> ${mark[0]}`);
}
```

- [ ] **Step 7: Judge this phone's own writes at capture, and keep event rows in event books**

In `packages/db/src/sync/capture.ts`, extend the import from `./authority` with `eventBookWorkspaceOf`, and add:

```ts
import { EVENT_ENTITIES, eventWriteRefusal } from './events/authority';
```

In `withCapture`'s judging loop, insert at the top of the `for (const key of new Set([...before.keys(), ...after.keys()]))` body, right after `const entity = (was ?? now)!.entity;`:

```ts
    if (EVENT_ENTITIES.has(entity.entity)) {
      // Shared events (rulings R1–R3): the same predicate a peer's op meets, against this write's pre-image.
      const gone = !now || (was !== undefined && now.bookId !== was.bookId);
      const row = (was ?? now)!;
      const member = books.find((b) => b.bookId === row.bookId)?.memberId ?? null;
      const why = eventWriteRefusal(entity.entity, was?.values ?? null, gone ? null : now!.values, parseOpId(entity, row.id), member);
      if (why) throw new AuthorityError(why);
      // R8: once an expense is here the currency stays; the log decides a race (`noteEventLogTx`).
      if (entity.entity === 'shared_event' && was && now && was.values.currency !== now.values.currency) {
        const [expense] = await tx.values(sql`SELECT 1 FROM event_expenses WHERE book_id = ${row.bookId} LIMIT 1`);
        if (expense) throw new AuthorityError('the currency is fixed once an expense exists');
      }
      continue;
    }
```

In `refuseWrongLog`, add beside `isGroupLog`:

```ts
  const eventVerdicts = new Map<string, boolean>();
  const isEventBook = async (bookId: string) => {
    if (!eventVerdicts.has(bookId)) eventVerdicts.set(bookId, (await eventBookWorkspaceOf(tx, bookId)) !== null);
    return eventVerdicts.get(bookId)!;
  };
```

and inside the inner `for (const row of [was, now])` loop, after the `net_worth_group` check:

```ts
      // A shared event's rows live only in its own book, never in a workspace's (shared events §3).
      if (EVENT_ENTITIES.has(entity) && !(await isEventBook(row.bookId))) throw new AuthorityError(`${entity} outside a shared event's book`);
```

- [ ] **Step 8: Give an event book a context, and pass the owner rule and the currency put-back through the pull**

In `packages/db/src/sync/apply.ts`, extend the `./authority` import with `eventBookWorkspaceOf` and `settleEventCurrencyTx`.

In `bookContextTx`, after the group-log fallback (before `if (!row) throw …`), add:

```ts
  if (!row) {
    // A shared event's relay book (shared events §3) has no `books` row either: it is held in the workspace this phone
    // recorded when it shared or joined the event (`event_books`), in that workspace's currency.
    try {
      [row] = await tx.values<[string, string, string, string]>(sql`
        SELECT e.workspace_id, w.base_currency, w.base_currency, s.member_id
        FROM event_books e JOIN workspaces w ON w.id = e.workspace_id JOIN shared_books s ON s.book_id = e.book_id
        WHERE e.book_id = ${bookId}`);
    } catch {
      // a database from before migration 0069
    }
  }
```

In `pullAndApply`, after `const groupWorkspace = await groupLogWorkspaceOf(database.db, bookId);` add:

```ts
  // A shared event's book: every member an owner (shared events §3), as in a group log, but admitted by invite terms.
  const eventLog = (await eventBookWorkspaceOf(database.db, bookId)) !== null;
```

pass it into `decideOpsTx`'s context:

```ts
                  { bookId, author: entry.deviceId, hlc: changeSet.hlc, creator: run.creator, introducedMember: run.introducedMember, own, groupLog: groupWorkspace !== null, everyMemberOwns: eventLog },
```

and in the own-entry branch, after `if (members.size) await reconcileMembersTx(…);` add:

```ts
                  // R8: a currency change of this phone's own the log stripped is put back to the log's currency.
                  if (eventLog && changeSet.ops.some((op) => op.entity === 'shared_event')) await settleEventCurrencyTx(tx, bookId);
```

- [ ] **Step 9: Run the new tests, the entity schema test and the authority suites**

Run: `cd packages/db && npx vitest run test/sync/event-authority.test.ts test/sync/event-capture.test.ts test/sync/shared-entities.test.ts test/sync/authority.test.ts test/sync/net-worth-entities.test.ts test/sync/capture.test.ts`
Expected: PASS. `shared-entities.test.ts` now runs its column check for the seven new entities; a column missing from `fields`/`NEVER_SYNCED_COLUMNS` fails it — sort it into one list, never loosen the test.

- [ ] **Step 10: Run the whole db suite, the capture run and the typecheck**

Run: `npm run test -w @expanses/db && npm run typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/db/src/sync/events/authority.ts packages/db/src/sync/shared-entities.ts packages/db/src/sync/authority.ts packages/db/src/sync/capture.ts packages/db/src/sync/apply.ts packages/db/test/sync/event-authority.test.ts packages/db/test/sync/event-capture.test.ts
git commit -m "$(cat <<'EOF'
Shared events sync: seven entities in an event's own book, the payer's money written by the payer alone, claims and takeovers set once, and the currency locked in log order

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Derivation — each phone's own lines from the event's records

Spec §5 (the table, `event_postings`, "replaced… voided", card purchases keep everything), rulings R4–R6, R12. Like `postTransferSideTx` for `member_transfers`: one function brings this phone's transaction for one record in line with the record.

**Files:**
- Create: `packages/db/src/repos/shared-event-records.ts`
- Create: `packages/db/src/repos/shared-event-postings.ts`
- Modify: `packages/db/src/repos/ledger.ts` (`LedgerErrorCode` gains `'EVENT_POSTING'`; the public `voidTransaction` and `replaceTransaction` refuse a derived transaction)
- Modify: `packages/db/src/repos/points.ts` (`cardSpendLines`: a share category's own line never earns; the card line does)
- Modify: `packages/db/src/repos/fx.ts` (`upsertRate` retries records waiting for a rate)
- Modify: `packages/db/src/index.ts` (two export lines after `export * from './repos/event-items';`)
- Test: `packages/db/test/shared-event-postings.test.ts`

**Interfaces:**
- Consumes: Task 1's `myExpenseLines`, `mySettlementLines`, `parseSplitJson`, `SharedEventError`, `ExpenseRecord`, `SettlementRecord`; Task 3's `eventOnlyExists`, `eventPostingOfTx`; `postTransactionTx`, `replaceTransactionTx`, `voidTransactionTx`, `createAccountTx`, `ensureSystemAccountTx`.
- Produces:
  - `shared-event-records.ts` (exported from the index):
    - `interface EventBookRow { bookId: string; workspaceId: string; baseCurrency: string; eventId: string; balanceAccountId: string; me: string; state: string; name: string; startsOn: string; endsOn: string; currency: string; finishedAt: string | null }`
    - `interface StoredExpense extends ExpenseRecord { occurredOn: string; payerMemberId: string | null; voidedAt: string | null; categoryId: string | null; note: string | null; recordedBy: string; updatedBy: string | null }`
    - `interface StoredSettlement extends SettlementRecord { occurredOn: string; fromMemberId: string | null; toMemberId: string | null; voidedAt: string | null }`
    - `interface StoredPerson { personId: string; name: string; memberId: string | null; removedAt: string | null }`
    - `eventBookTx(db: Db, bookId: string): Promise<EventBookRow | null>`, `eventBookOfEventTx(db: Db, eventId: string): Promise<EventBookRow | null>`
    - `expenseRecordTx(db: Db, bookId: string, id: string): Promise<StoredExpense | null>`, `settlementRecordTx(db: Db, bookId: string, id: string): Promise<StoredSettlement | null>`
    - `eventRecordsTx(db: Db, bookId: string): Promise<{ expenses: StoredExpense[]; settlements: StoredSettlement[]; people: StoredPerson[] }>`
    - `openEventBookTx(tx: Db, ws: WorkspaceContext, input: { bookId: string; eventId: string; name: string; currency: string }): Promise<string>` (the trip-balance account's id)
  - `shared-event-postings.ts` (exported from the index):
    - `type EventPostingKind = 'expense' | 'settlement'`, `type EventUnposted = 'choose-account' | 'no-rate' | 'malformed'`
    - `interface EventPostingExtras { cardId?: string | null; mcc?: string | null; channel?: 'online' | 'offline' | null; photoIds?: string[] }`
    - `postEventRecordTx(tx: Tx, bookId: string, kind: EventPostingKind, recordId: string, author: string | null, extras?: EventPostingExtras): Promise<void>`
    - `setPaidFromTx(tx: Db, bookId: string, recordId: string, kind: EventPostingKind, account: { accountId: string; amountMinor: number | null } | null): Promise<void>`
    - `ensureShareAccountTx(tx: Db, book: EventBookRow, categoryId: string | null, earnCategoryId?: string | null): Promise<string>`
    - `followEventOpTx(tx: Tx, bookId: string, entity: string, id: string, author: string | null): Promise<void>`
    - `followSharedEventTx(tx: Db, bookId: string): Promise<void>`
    - `retryUnpostedEventRecords(database: Database, bookId?: string): Promise<number>`
    - `eventRatesWanted(database: Database): Promise<{ currency: string; onDate: string }[]>`
    - `rateToBaseTx(tx: Db, currency: string, base: string, on: string): Promise<number | null>` — units of `base` per one `currency` on or before `on`, else the latest known

- [ ] **Step 1: Write the failing tests**

`packages/db/test/shared-event-postings.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cardSpendLines,
  createAccount,
  eventRatesWanted,
  listAccounts,
  nativeBalances,
  openEventBookTx,
  ownerScope,
  postEventRecordTx,
  retryUnpostedEventRecords,
  saveEvent,
  setPaidFromTx,
  upsertRate,
  voidTransaction,
  ensureShareAccountTx,
  eventBookTx,
  followSharedEventTx,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { shareBookForTest } from './sync/sync-helpers';

/*
 * Each phone's own lines from a shared event's records (shared events §5). A week by the coast in lira; Rina's phone.
 * Invented rates: 1 EUR = 17,000 IDR and 1 TRY = 560 IDR on 1 October 2026; 1 EUR = 31.5 TRY on the record.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function coastWeek() {
  const t = await setupDb();
  executor = t.executor;
  const ws = ownerScope(t.ws);
  for (const [from, rate] of [['EUR', 17_000], ['TRY', 560]] as const) {
    await upsertRate(t.database, { fromCurrency: from, toCurrency: 'IDR', onDate: '2026-10-01', rate, source: 'manual', sourceDate: '2026-10-01' });
  }
  const wallet = await createAccount(t.database, ws, { name: 'Euro wallet', kind: 'asset', subtype: 'cash', currency: 'EUR' });
  const card = await createAccount(t.database, ws, { name: 'Travel card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const restaurants = (await listAccounts(t.database, ws)).find((a) => a.name === 'Restaurants')!;
  const eventId = await saveEvent(t.database, ws, { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
    INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', 'p-rina', 'Rina', 'p-rina', NULL), ('ev-book', 'p-andi', 'Andi', 'p-andi', NULL), ('ev-book', 'p-budi', 'Budi', NULL, NULL);
    INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-book', 'cat-dinners', 'Dinners', NULL, 0, NULL);
  `);
  const trip = await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Coast week', currency: 'TRY' }));
  const record = (id: string, over: { payer?: string; member?: string | null; amount?: number; currency?: string; rate?: string; people?: string[]; on?: string } = {}) =>
    t.database.execScript(`
      INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
        VALUES ('ev-book', '${id}', '${over.on ?? '2026-10-06'}', ${over.amount ?? 9000}, '${over.currency ?? 'EUR'}', '${over.rate ?? '31.5'}', '${over.payer ?? 'p-rina'}', ${over.member === null ? 'NULL' : `'${over.member ?? over.payer ?? 'p-rina'}'`}, NULL);
      INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by)
        VALUES ('ev-book', '${id}', NULL, 'cat-dinners', 'equal', '${JSON.stringify(over.people ?? ['p-rina', 'p-andi', 'p-budi'])}', 'p-rina', NULL);
    `);
  const derive = (id: string, author: string | null = null, kind: 'expense' | 'settlement' = 'expense') => t.database.transaction((tx) => postEventRecordTx(tx, 'ev-book', kind, id, author));
  const paidFrom = (id: string, accountId: string, amountMinor: number | null = null) => t.database.transaction((tx) => setPaidFromTx(tx, 'ev-book', id, 'expense', { accountId, amountMinor }));
  const posting = async (id: string) => {
    const [row] = await t.database.db.values<[string | null, string | null, string | null]>(sql`SELECT transaction_id, unposted, changed_by FROM event_postings WHERE book_id = 'ev-book' AND record_id = ${id}`);
    return row ? { transactionId: row[0], unposted: row[1], changedBy: row[2] } : null;
  };
  const linesOf = (transactionId: string) =>
    t.database.db.values<[string, number, string]>(sql`SELECT account_id, amount_minor, currency FROM entries WHERE transaction_id = ${transactionId} ORDER BY currency, account_id, amount_minor`);
  return { ...t, ws, wallet, card, restaurants, eventId, trip, record, derive, paidFrom, posting, linesOf };
}

describe('postEventRecordTx (spec §5)', () => {
  it('Rina paid €90 from her euro wallet for three: wallet −90, her share +30, the others’ lira on the trip balance', async () => {
    const t = await coastWeek();
    await t.record('exp-1');
    await t.paidFrom('exp-1', t.wallet.id);
    await t.derive('exp-1');
    const { transactionId, unposted } = (await t.posting('exp-1'))!;
    expect(unposted).toBeNull();
    const balances = await nativeBalances(t.database, t.ws);
    expect(balances[t.wallet.id]).toBe(-9_000);
    expect(balances[t.trip]).toBe(189_000);
    // In no workspace book, and on the event (§5.1, §6).
    expect(await t.database.db.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${transactionId}`)).toEqual([]);
    expect(await t.database.db.values(sql`SELECT event_id FROM transactions WHERE id = ${transactionId}`)).toEqual([[t.eventId]]);
  });

  it('Andi paid and Rina is in the split: her share, and the trip balance down by its lira figure; no money account moves', async () => {
    const t = await coastWeek();
    await t.record('exp-2', { payer: 'p-andi' });
    await t.derive('exp-2', 'p-andi');
    const balances = await nativeBalances(t.database, t.ws);
    expect(balances[t.trip]).toBe(-94_500);
    expect(balances[t.wallet.id] ?? 0).toBe(0);
  });

  it('posts nothing when Rina is neither the payer nor in the split', async () => {
    const t = await coastWeek();
    await t.record('exp-3', { payer: 'p-andi', people: ['p-andi', 'p-budi'] });
    await t.derive('exp-3', 'p-andi');
    expect((await t.posting('exp-3'))!.transactionId).toBeNull();
  });

  it('a friend’s split edit replaces the transaction and says who, without moving the wallet (Review Focus 5); a void voids it', async () => {
    const t = await coastWeek();
    await t.record('exp-1');
    await t.paidFrom('exp-1', t.wallet.id);
    await t.derive('exp-1');
    const first = (await t.posting('exp-1'))!.transactionId!;
    await t.database.execScript(`UPDATE event_expense_details SET split_json = '["p-rina","p-andi"]', updated_by = 'p-andi' WHERE id = 'exp-1'`);
    await t.derive('exp-1', 'p-andi');
    const after = (await t.posting('exp-1'))!;
    expect(after.transactionId).not.toBe(first);
    expect(after.changedBy).toBe('p-andi');
    const balances = await nativeBalances(t.database, t.ws);
    expect(balances[t.wallet.id]).toBe(-9_000);
    expect(balances[t.trip]).toBe(141_750); // Andi's half, €45 × 31.5
    await t.database.execScript(`UPDATE event_expenses SET voided_at = '2026-10-09T00:00:00Z' WHERE id = 'exp-1'`);
    await t.derive('exp-1');
    expect(await t.database.db.values(sql`SELECT status FROM transactions WHERE id = ${after.transactionId}`)).toEqual([['void']]);
    expect((await nativeBalances(t.database, t.ws))[t.wallet.id] ?? 0).toBe(0);
  });

  it('waits for an account when Rina paid but this phone has none for it (R6)', async () => {
    const t = await coastWeek();
    await t.record('exp-4');
    await t.derive('exp-4');
    expect((await t.posting('exp-4'))!.unposted).toBe('choose-account');
    await t.paidFrom('exp-4', t.wallet.id);
    await t.derive('exp-4');
    expect((await t.posting('exp-4'))!.unposted).toBeNull();
  });

  it('waits for a rate it does not have, names it, and posts once the rate is saved', async () => {
    const t = await coastWeek();
    await t.record('exp-5', { payer: 'p-andi', currency: 'USD', rate: '33.2', amount: 3_000, on: '2026-09-20' });
    await t.derive('exp-5', 'p-andi');
    expect((await t.posting('exp-5'))!.unposted).toBe('no-rate');
    expect(await eventRatesWanted(t.database)).toEqual([{ currency: 'USD', onDate: '2026-09-20' }]);
    await upsertRate(t.database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: '2026-09-20', rate: 15_900, source: 'manual', sourceDate: '2026-09-20' });
    expect((await t.posting('exp-5'))!.unposted).toBeNull(); // upsertRate retried it
    expect(await retryUnpostedEventRecords(t.database)).toBe(0);
  });

  it('a card keeps earning on the full charge, by the workspace category the share came from (R12)', async () => {
    const t = await coastWeek();
    await t.record('exp-6', { currency: 'TRY', rate: '1', amount: 30_000, people: ['p-rina', 'p-andi'] });
    await t.database.transaction(async (tx) => {
      const book = (await eventBookTx(tx, 'ev-book'))!;
      await ensureShareAccountTx(tx, book, 'cat-dinners', t.restaurants.id);
      await setPaidFromTx(tx, 'ev-book', 'exp-6', 'expense', { accountId: t.card.id, amountMinor: 168_000 });
    });
    await t.derive('exp-6');
    const lines = await cardSpendLines(t.database, t.ws, t.card.id, '2026-10-01', '2026-10-31');
    expect(lines).toEqual([expect.objectContaining({ amountMinor: 168_000, categoryId: t.restaurants.id, currency: 'IDR' })]);
    const transactionId = (await t.posting('exp-6'))!.transactionId!;
    expect(await t.database.db.values(sql`SELECT original_currency, original_amount_minor FROM transactions WHERE id = ${transactionId}`)).toEqual([['TRY', 30_000]]);
  });

  it('refuses a void or an edit of a derived transaction from anywhere but the event', async () => {
    const t = await coastWeek();
    await t.record('exp-1');
    await t.paidFrom('exp-1', t.wallet.id);
    await t.derive('exp-1');
    const transactionId = (await t.posting('exp-1'))!.transactionId!;
    await expect(voidTransaction(t.database, t.ws, transactionId)).rejects.toMatchObject({ code: 'EVENT_POSTING' });
  });

  it('follows the event’s name and dates into the local event and the trip balance', async () => {
    const t = await coastWeek();
    await t.database.execScript(`UPDATE shared_events SET name = 'Coast fortnight', ends_on = '2026-10-19' WHERE book_id = 'ev-book'`);
    await t.database.transaction((tx) => followSharedEventTx(tx, 'ev-book'));
    expect(await t.database.db.values(sql`SELECT name, ends_on FROM events WHERE id = ${t.eventId}`)).toEqual([['Coast fortnight', '2026-10-19']]);
    expect(await t.database.db.values(sql`SELECT name FROM accounts WHERE id = ${t.trip}`)).toEqual([['Coast fortnight']]);
  });
});

describe('settlements (spec §5)', () => {
  it('Andi pays Rina 2,900 lira; Rina received it into her euro wallet as €92', async () => {
    const t = await coastWeek();
    await t.database.execScript(`INSERT INTO event_settlements (book_id, id, occurred_on, from_person_id, to_person_id, from_member_id, to_member_id, amount_minor, voided_at)
      VALUES ('ev-book', 's-1', '2026-10-12', 'p-andi', 'p-rina', 'p-andi', 'p-rina', 290000, NULL)`);
    await t.database.transaction((tx) => setPaidFromTx(tx, 'ev-book', 's-1', 'settlement', { accountId: t.wallet.id, amountMinor: 9_200 }));
    await t.derive('s-1', 'p-andi', 'settlement');
    const balances = await nativeBalances(t.database, t.ws);
    expect(balances[t.wallet.id]).toBe(9_200);
    expect(balances[t.trip]).toBe(-290_000);
    const description = await t.database.db.values(sql`SELECT t.description FROM transactions t JOIN event_postings p ON p.transaction_id = t.id WHERE p.record_id = 's-1'`);
    expect(description).toEqual([['Andi paid Rina']]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/db && npx vitest run test/shared-event-postings.test.ts`
Expected: FAIL — `openEventBookTx` is not exported.

- [ ] **Step 3: Write the records reader**

`packages/db/src/repos/shared-event-records.ts`:

```ts
import { type ExpenseRecord, parseSplitJson, type SettlementRecord } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Db } from '../database';
import { createAccountTx } from './accounts';

/*
 * A shared event's records as this phone holds them (shared events §3), read in one place for the derivation, the
 * screens and the relay book's rules alike. Peer data is read defensively: an expense whose detail has not arrived yet
 * reads as absent rather than as an expense nobody shares.
 */

export interface EventBookRow {
  bookId: string;
  workspaceId: string;
  baseCurrency: string;
  /** The local `events` row the event lists under. */
  eventId: string;
  /** The trip balance: an `event_balance` asset in the event currency. */
  balanceAccountId: string;
  /** This phone's member in the event's book — its person id (ruling R1). */
  me: string;
  /** `shared_books.state`: 'active', 'needs_invite' or 'unshared'. */
  state: string;
  name: string;
  startsOn: string;
  endsOn: string;
  currency: string;
  finishedAt: string | null;
}

export interface StoredExpense extends ExpenseRecord {
  occurredOn: string;
  payerMemberId: string | null;
  voidedAt: string | null;
  categoryId: string | null;
  note: string | null;
  recordedBy: string;
  updatedBy: string | null;
}

export interface StoredSettlement extends SettlementRecord {
  occurredOn: string;
  fromMemberId: string | null;
  toMemberId: string | null;
  voidedAt: string | null;
}

export interface StoredPerson {
  personId: string;
  name: string;
  memberId: string | null;
  removedAt: string | null;
}

type BookRowValues = [string, string, string, string, string, string, string | null, string | null, string | null, string | null, string | null, string];

/*
 * The event currency is the log's once the log has locked it (ruling R8): a change this phone made before it heard of
 * the first expense is not the currency any record was converted to, even before it is put back.
 */
const bookSelect = sql`
  SELECT e.book_id, e.workspace_id, w.base_currency, e.event_id, e.balance_account_id, s.member_id,
         se.name, se.starts_on, se.ends_on,
         coalesce(CASE WHEN lc.locked = 1 AND lc.currency <> '' THEN lc.currency END, se.currency),
         se.finished_at, s.state
  FROM event_books e
  JOIN workspaces w ON w.id = e.workspace_id
  JOIN shared_books s ON s.book_id = e.book_id
  LEFT JOIN shared_events se ON se.book_id = e.book_id
  LEFT JOIN event_log_currency lc ON lc.book_id = e.book_id`;

function bookRowOf(row: BookRowValues | undefined): EventBookRow | null {
  // Before the event's own row has arrived (a joiner mid-pull), there is no currency to post in: nothing yet.
  if (!row || row[6] === null || row[9] === null) return null;
  return {
    bookId: row[0],
    workspaceId: row[1],
    baseCurrency: row[2],
    eventId: row[3],
    balanceAccountId: row[4],
    me: row[5],
    name: row[6],
    startsOn: row[7] ?? '',
    endsOn: row[8] ?? '',
    currency: row[9],
    finishedAt: row[10],
    state: row[11],
  };
}

export async function eventBookTx(db: Db, bookId: string): Promise<EventBookRow | null> {
  const [row] = await db.values<BookRowValues>(sql`${bookSelect} WHERE e.book_id = ${bookId}`);
  return bookRowOf(row);
}

export async function eventBookOfEventTx(db: Db, eventId: string): Promise<EventBookRow | null> {
  const [row] = await db.values<BookRowValues>(sql`${bookSelect} WHERE e.event_id = ${eventId}`);
  return bookRowOf(row);
}

type ExpenseValues = [string, string, number, string, string, string, string | null, string | null, string | null, string | null, string, string, string, string | null];

const expenseSelect = sql`
  SELECT x.id, x.occurred_on, x.amount_minor, x.currency, x.rate_to_event, x.payer_person_id, x.payer_member_id, x.voided_at,
         d.note, d.category_id, d.split_mode, d.split_json, d.recorded_by, d.updated_by
  FROM event_expenses x JOIN event_expense_details d ON d.book_id = x.book_id AND d.id = x.id`;

function expenseOf(row: ExpenseValues): StoredExpense {
  const [id, occurredOn, amountMinor, currency, rateToEvent, payerPersonId, payerMemberId, voidedAt, note, categoryId, splitMode, splitJson, recordedBy, updatedBy] = row;
  return {
    id,
    occurredOn,
    amountMinor: Number(amountMinor),
    currency,
    rateToEvent,
    payerPersonId,
    payerMemberId,
    voidedAt,
    voided: voidedAt !== null,
    note,
    categoryId,
    split: parseSplitJson(splitMode, splitJson),
    recordedBy,
    updatedBy,
  };
}

/** One expense with its details, or null while either half is missing here. Throws `SharedEventError` on a split it cannot read. */
export async function expenseRecordTx(db: Db, bookId: string, id: string): Promise<StoredExpense | null> {
  const [row] = await db.values<ExpenseValues>(sql`${expenseSelect} WHERE x.book_id = ${bookId} AND x.id = ${id}`);
  return row ? expenseOf(row) : null;
}

type SettlementValues = [string, string, string, string, string | null, string | null, number, string | null];

const settlementSelect = sql`SELECT id, occurred_on, from_person_id, to_person_id, from_member_id, to_member_id, amount_minor, voided_at FROM event_settlements`;

function settlementOf([id, occurredOn, fromPersonId, toPersonId, fromMemberId, toMemberId, amountMinor, voidedAt]: SettlementValues): StoredSettlement {
  return { id, occurredOn, fromPersonId, toPersonId, fromMemberId, toMemberId, amountMinor: Number(amountMinor), voidedAt, voided: voidedAt !== null };
}

export async function settlementRecordTx(db: Db, bookId: string, id: string): Promise<StoredSettlement | null> {
  const [row] = await db.values<SettlementValues>(sql`${settlementSelect} WHERE book_id = ${bookId} AND id = ${id}`);
  return row ? settlementOf(row) : null;
}

/** Every record of the event here, oldest first, ties by id: the order every phone reads them in. */
export async function eventRecordsTx(db: Db, bookId: string): Promise<{ expenses: StoredExpense[]; settlements: StoredSettlement[]; people: StoredPerson[] }> {
  const expenses: StoredExpense[] = [];
  for (const row of await db.values<ExpenseValues>(sql`${expenseSelect} WHERE x.book_id = ${bookId} ORDER BY x.occurred_on, x.id`)) {
    try {
      expenses.push(expenseOf(row));
    } catch {
      // A split this phone cannot read is left out of the figures rather than failing the whole event.
    }
  }
  const settlements = (await db.values<SettlementValues>(sql`${settlementSelect} WHERE book_id = ${bookId} ORDER BY occurred_on, id`)).map(settlementOf);
  const people = (
    await db.values<[string, string, string | null, string | null]>(sql`SELECT id, name, member_id, removed_at FROM event_people WHERE book_id = ${bookId} ORDER BY name, id`)
  ).map(([personId, name, memberId, removedAt]) => ({ personId, name, memberId, removedAt }));
  return { expenses, settlements, people };
}

/**
 * Holds a shared event's book on this phone (shared events §5): its trip-balance account — an asset in the event
 * currency, named after the event — and the local record of which workspace and which `events` row it belongs to.
 * Written by the one who shares the event and by every joiner, never by a peer's op.
 */
export async function openEventBookTx(tx: Db, ws: WorkspaceContext, input: { bookId: string; eventId: string; name: string; currency: string }): Promise<string> {
  const account = await createAccountTx(tx, ownerScope(ws), { name: input.name, kind: 'asset', subtype: 'event_balance', currency: input.currency });
  await tx.run(sql`
    INSERT INTO event_books (book_id, workspace_id, event_id, balance_account_id) VALUES (${input.bookId}, ${ws.workspaceId}, ${input.eventId}, ${account.id})`);
  return account.id;
}
```

- [ ] **Step 4: Write the derivation**

`packages/db/src/repos/shared-event-postings.ts`:

```ts
import { MoneyError, type MyLines, myExpenseLines, mySettlementLines, type PaidFromAccount, SharedEventError, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { ensureSystemAccountTx } from './accounts';
import { eventOnlyExists } from './event-only';
import { postTransactionTx, type PostTransactionInput, replaceTransactionTx, voidTransactionTx } from './ledger';
import { type EventBookRow, eventBookTx, expenseRecordTx, settlementRecordTx } from './shared-event-records';

/*
 * What a shared event's records put in this phone's own books (shared events §5) — the way `postTransferSideTx` follows
 * a transfer between partners. One function brings this phone's transaction for one record in line with it: posted,
 * replaced (`replaceTransactionTx`, which carries a card purchase's card, MCC, channel, photos, statement match and
 * points), voided, or left waiting with the reason why (`event_postings.unposted`). The lines are core's
 * (`myExpenseLines`, `mySettlementLines`); this reads the record, this phone's paying account and the day's rates
 * (as `rateOf` in transfers.ts does), and writes through the ledger's doors.
 *
 * The share category is this phone's own copy of the event's category: an expense account in no workspace book, so the
 * posting has no `book_transactions` row and is in no workspace (§5.1). The account a person paid from never syncs; it
 * is kept here, in `event_postings`, with its own-currency figure when that differs (ruling R5).
 */

export type EventPostingKind = 'expense' | 'settlement';
export type EventUnposted = 'choose-account' | 'no-rate' | 'malformed';

/** Facts about a purchase this phone recorded itself, set on its first posting only; a replacement carries them. */
export interface EventPostingExtras {
  cardId?: string | null;
  mcc?: string | null;
  channel?: 'online' | 'offline' | null;
  photoIds?: string[];
}

interface PostingRow {
  transactionId: string | null;
  accountId: string | null;
  accountAmountMinor: number | null;
}

const wsOf = (book: EventBookRow): WorkspaceContext => ({ workspaceId: book.workspaceId, baseCurrency: book.baseCurrency });

async function ensurePostingTx(tx: Db, bookId: string, recordId: string, kind: EventPostingKind): Promise<PostingRow> {
  await tx.run(sql`INSERT INTO event_postings (book_id, record_id, kind) VALUES (${bookId}, ${recordId}, ${kind}) ON CONFLICT (book_id, record_id) DO NOTHING`);
  const [row] = await tx.values<[string | null, string | null, number | null]>(
    sql`SELECT transaction_id, account_id, account_amount_minor FROM event_postings WHERE book_id = ${bookId} AND record_id = ${recordId}`,
  );
  return { transactionId: row![0], accountId: row![1], accountAmountMinor: row![2] === null ? null : Number(row![2]) };
}

async function setUnpostedTx(tx: Db, bookId: string, recordId: string, reason: EventUnposted | null): Promise<void> {
  await tx.run(sql`UPDATE event_postings SET unposted = ${reason} WHERE book_id = ${bookId} AND record_id = ${recordId}`);
}

/**
 * The account this person paid a record from or received it into, and what it moved in its own currency (null when that
 * is the record's own currency). Local only (ruling R5): written when this phone records, settles or takes over.
 */
export async function setPaidFromTx(tx: Db, bookId: string, recordId: string, kind: EventPostingKind, account: { accountId: string; amountMinor: number | null } | null): Promise<void> {
  await ensurePostingTx(tx, bookId, recordId, kind);
  await tx.run(sql`
    UPDATE event_postings SET account_id = ${account?.accountId ?? null}, account_amount_minor = ${account?.amountMinor ?? null}
    WHERE book_id = ${bookId} AND record_id = ${recordId}`);
}

/**
 * This phone's own copy of an event category (or of "no category", keyed ''): an expense account filed in no book, made
 * the first time a record needs it. `earnCategoryId` is the workspace category a card earns by on these purchases
 * (ruling R12): kept the first time one is given.
 */
export async function ensureShareAccountTx(tx: Db, book: EventBookRow, categoryId: string | null, earnCategoryId: string | null = null): Promise<string> {
  const key = categoryId ?? '';
  const [found] = await tx.values<[string, string | null]>(sql`SELECT account_id, earn_category_id FROM event_category_accounts WHERE book_id = ${book.bookId} AND category_id = ${key}`);
  if (found) {
    if (earnCategoryId && !found[1]) await tx.run(sql`UPDATE event_category_accounts SET earn_category_id = ${earnCategoryId} WHERE book_id = ${book.bookId} AND category_id = ${key}`);
    return found[0];
  }
  const [named] = categoryId ? await tx.values<[string, string | null]>(sql`SELECT name, icon FROM event_categories WHERE book_id = ${book.bookId} AND id = ${categoryId}`) : [];
  const id = uuidv7();
  // Straight into `accounts`, never through `createAccountTx`, which files every category into a book.
  await tx.run(sql`
    INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at)
    VALUES (${id}, ${book.workspaceId}, NULL, 'expense', 'category', ${named?.[0] ?? 'Shared spending'}, ${named?.[1] ?? null}, NULL, 'derived', NULL, 0, NULL, ${new Date().toISOString()})`);
  await tx.run(sql`INSERT INTO event_category_accounts (book_id, category_id, account_id, earn_category_id) VALUES (${book.bookId}, ${key}, ${id}, ${earnCategoryId})`);
  return id;
}

async function earnCategoryTx(tx: Db, bookId: string, categoryId: string | null): Promise<string | null> {
  const [row] = await tx.values<[string | null]>(sql`SELECT earn_category_id FROM event_category_accounts WHERE book_id = ${bookId} AND category_id = ${categoryId ?? ''}`);
  return row?.[0] ?? null;
}

async function accountTx(tx: Db, accountId: string): Promise<{ currency: string; subtype: string } | null> {
  const [row] = await tx.values<[string | null, string]>(sql`SELECT currency, subtype FROM accounts WHERE id = ${accountId} AND archived_at IS NULL`);
  return row && row[0] ? { currency: row[0], subtype: row[1] } : null;
}

/** Units of `base` per one unit of `currency` on or before `on`, else the latest known; null when none. As transfers.ts reads it. */
export async function rateToBaseTx(tx: Db, currency: string, base: string, on: string): Promise<number | null> {
  if (currency === base) return 1;
  const [row] = await tx.values<[number]>(sql`
    SELECT rate FROM fx_rates WHERE from_currency = ${currency} AND to_currency = ${base}
    ORDER BY (on_date <= ${on}) DESC, CASE WHEN on_date <= ${on} THEN on_date END DESC, on_date DESC LIMIT 1`);
  const rate = row ? Number(row[0]) : NaN;
  return rate > 0 && Number.isFinite(rate) ? rate : null;
}

async function ratesForTx(tx: Db, base: string, currencies: readonly string[], on: string): Promise<Record<string, number> | null> {
  const out: Record<string, number> = {};
  for (const currency of new Set(currencies)) {
    if (currency === base) continue;
    const rate = await rateToBaseTx(tx, currency, base, on);
    if (rate === null) return null;
    out[currency] = rate;
  }
  return out;
}

/** Whether a posted transaction already reads as `input`: date, words, original pair and every line. Nothing to replace. */
async function samePostingTx(tx: Db, transactionId: string, input: PostTransactionInput): Promise<boolean> {
  const [head] = await tx.values<[string, string, string | null, number | null, string | null]>(
    sql`SELECT occurred_on, description, original_currency, original_amount_minor, event_id FROM transactions WHERE id = ${transactionId}`,
  );
  if (!head || head[0] !== input.occurredOn || head[1] !== input.description.trim() || head[4] !== (input.eventId ?? null)) return false;
  if (head[2] !== (input.originalCurrency ?? null) || (head[3] === null ? null : Number(head[3])) !== (input.originalAmountMinor ?? null)) return false;
  const entries = await tx.values<[string, number]>(sql`SELECT account_id, amount_minor FROM entries WHERE transaction_id = ${transactionId}`);
  const key = (pairs: [string, number][]) => pairs.map(([a, m]) => `${a}:${m}`).sort().join(',');
  return key(entries.map(([a, m]) => [a, Number(m)])) === key(input.lines.map((line) => [line.accountId, line.amountMinor]));
}

interface Built {
  lines: MyLines;
  occurredOn: string;
  description: string;
  original: { currency: string; amountMinor: number } | null;
}

async function expenseBuiltTx(tx: Db, book: EventBookRow, recordId: string, posting: PostingRow): Promise<Built | null> {
  const record = await expenseRecordTx(tx, book.bookId, recordId);
  if (!record) return null;
  const exchange = await ensureSystemAccountTx(tx, wsOf(book), 'currency_exchange');
  const share = await ensureShareAccountTx(tx, book, record.categoryId);
  let paidFrom: PaidFromAccount | null = null;
  let original: Built['original'] = null;
  // Ruling R6: "I paid" posts only from an account this phone holds, on a record that names this member as its payer's.
  if (record.payerPersonId === book.me && record.payerMemberId === book.me && posting.accountId) {
    const account = await accountTx(tx, posting.accountId);
    if (account) {
      const same = account.currency === record.currency;
      const charged = same ? record.amountMinor : posting.accountAmountMinor;
      if (charged !== null) {
        const card = account.subtype === 'credit_card';
        paidFrom = { accountId: posting.accountId, currency: account.currency, chargedMinor: charged, spendCategoryId: card ? ((await earnCategoryTx(tx, book.bookId, record.categoryId)) ?? share) : null };
        if (!same) original = { currency: record.currency, amountMinor: record.amountMinor };
      }
    }
  }
  const lines = myExpenseLines({ expense: record, eventCurrency: book.currency, me: book.me, accounts: { shareAccountId: share, eventBalanceAccountId: book.balanceAccountId, exchangeAccountId: exchange }, paidFrom });
  const [category] = record.categoryId ? await tx.values<[string]>(sql`SELECT name FROM event_categories WHERE book_id = ${book.bookId} AND id = ${record.categoryId}`) : [];
  return { lines, occurredOn: record.occurredOn, description: record.note?.trim() || category?.[0] || 'Shared spending', original };
}

async function settlementBuiltTx(tx: Db, book: EventBookRow, recordId: string, posting: PostingRow): Promise<Built | null> {
  const record = await settlementRecordTx(tx, book.bookId, recordId);
  if (!record) return null;
  const exchange = await ensureSystemAccountTx(tx, wsOf(book), 'currency_exchange');
  const mine = (record.fromPersonId === book.me && record.fromMemberId === book.me) || (record.toPersonId === book.me && record.toMemberId === book.me);
  let account: { accountId: string; currency: string; amountMinor: number } | null = null;
  if (mine && posting.accountId) {
    const held = await accountTx(tx, posting.accountId);
    const amountMinor = held ? (held.currency === book.currency ? record.amountMinor : posting.accountAmountMinor) : null;
    if (held && amountMinor !== null) account = { accountId: posting.accountId, currency: held.currency, amountMinor };
  }
  const lines = mySettlementLines({ settlement: record, eventCurrency: book.currency, me: book.me, eventBalanceAccountId: book.balanceAccountId, exchangeAccountId: exchange, account });
  const names = new Map(await tx.values<[string, string]>(sql`SELECT id, name FROM event_people WHERE book_id = ${book.bookId}`));
  return { lines, occurredOn: record.occurredOn, description: `${names.get(record.fromPersonId) ?? 'Someone'} paid ${names.get(record.toPersonId) ?? 'someone'}`, original: null };
}

/**
 * Brings this phone's transaction for one record in line with it. `author` is the member whose change this follows —
 * the authority view's for a peer's op, null for this phone's own write — and is what "Changed by Andi" reads.
 */
export async function postEventRecordTx(tx: Tx, bookId: string, kind: EventPostingKind, recordId: string, author: string | null, extras: EventPostingExtras = {}): Promise<void> {
  const book = await eventBookTx(tx, bookId);
  if (!book) return;
  const ws = wsOf(book);
  const posting = await ensurePostingTx(tx, bookId, recordId, kind);
  const [status] = posting.transactionId ? await tx.values<[string]>(sql`SELECT status FROM transactions WHERE id = ${posting.transactionId}`) : [];
  const posted = status?.[0] === 'posted' ? posting.transactionId : null;
  const voidPosted = async () => {
    if (posted) await voidTransactionTx(tx, ws, posted, {}, author ?? undefined);
  };
  let built: Built | null;
  try {
    built = kind === 'expense' ? await expenseBuiltTx(tx, book, recordId, posting) : await settlementBuiltTx(tx, book, recordId, posting);
  } catch (error) {
    if (error instanceof SharedEventError || error instanceof MoneyError) return setUnpostedTx(tx, bookId, recordId, 'malformed');
    throw error;
  }
  if (!built) return setUnpostedTx(tx, bookId, recordId, 'malformed');
  if (built.lines.kind === 'needs-account') {
    await voidPosted();
    return setUnpostedTx(tx, bookId, recordId, 'choose-account');
  }
  if (built.lines.kind === 'none') {
    await voidPosted();
    return setUnpostedTx(tx, bookId, recordId, null);
  }
  const rates = await ratesForTx(tx, book.baseCurrency, built.lines.lines.map((line) => line.currency), built.occurredOn);
  if (!rates) return setUnpostedTx(tx, bookId, recordId, 'no-rate');
  // The trip balance is in the event currency; while it is still empty it follows the event's (R8), so a currency this
  // phone changed before it heard of the first expense never leaves it in the wrong one.
  await tx.run(sql`
    UPDATE accounts SET currency = ${book.currency}
    WHERE id = ${book.balanceAccountId} AND currency <> ${book.currency} AND NOT EXISTS (SELECT 1 FROM entries WHERE account_id = ${book.balanceAccountId})`);
  const input: PostTransactionInput = {
    occurredOn: built.occurredOn,
    description: built.description,
    lines: built.lines.lines,
    ratesToBase: rates,
    eventId: book.eventId,
    originalCurrency: built.original?.currency ?? null,
    originalAmountMinor: built.original?.amountMinor ?? null,
    ...(author ? { syncAuthor: author } : {}),
  };
  const changedBy = author !== null && author !== book.me ? author : null;
  if (posted) {
    if (await samePostingTx(tx, posted, input)) return setUnpostedTx(tx, bookId, recordId, null);
    const replaced = await replaceTransactionTx(tx, ws, posted, input);
    await tx.run(sql`UPDATE event_postings SET transaction_id = ${replaced}, unposted = NULL, changed_by = ${changedBy} WHERE book_id = ${bookId} AND record_id = ${recordId}`);
    return;
  }
  const id = await postTransactionTx(tx, ws, { ...input, cardId: extras.cardId ?? null, mcc: extras.mcc ?? null, channel: extras.channel ?? null, ...(extras.photoIds ? { photoIds: extras.photoIds } : {}) });
  await tx.run(sql`UPDATE event_postings SET transaction_id = ${id}, unposted = NULL, changed_by = ${changedBy} WHERE book_id = ${bookId} AND record_id = ${recordId}`);
}

/** The event's name, dates and Done follow into the local `events` row and the trip balance's name (and, while it is empty, its currency). */
export async function followSharedEventTx(tx: Db, bookId: string): Promise<void> {
  const book = await eventBookTx(tx, bookId);
  if (!book) return;
  await tx.run(sql`UPDATE events SET name = ${book.name}, starts_on = ${book.startsOn}, ends_on = ${book.endsOn}, finished_at = ${book.finishedAt} WHERE id = ${book.eventId}`);
  await tx.run(sql`UPDATE accounts SET name = ${book.name} WHERE id = ${book.balanceAccountId}`);
  const [used] = await tx.values(sql`SELECT 1 FROM entries WHERE account_id = ${book.balanceAccountId} LIMIT 1`);
  if (!used) await tx.run(sql`UPDATE accounts SET currency = ${book.currency} WHERE id = ${book.balanceAccountId}`);
}

/** What one applied (or locally written) op of an event's book means for this phone's own books. */
export async function followEventOpTx(tx: Tx, bookId: string, entity: string, id: string, author: string | null): Promise<void> {
  if (entity === 'shared_event') return followSharedEventTx(tx, bookId);
  if (entity === 'event_expense' || entity === 'event_expense_detail') return postEventRecordTx(tx, bookId, 'expense', id, author);
  if (entity === 'event_settlement') return postEventRecordTx(tx, bookId, 'settlement', id, author);
  if (entity === 'event_category') {
    await tx.run(sql`
      UPDATE accounts SET name = (SELECT name FROM event_categories WHERE book_id = ${bookId} AND id = ${id})
      WHERE id = (SELECT account_id FROM event_category_accounts WHERE book_id = ${bookId} AND category_id = ${id})
        AND EXISTS (SELECT 1 FROM event_categories WHERE book_id = ${bookId} AND id = ${id})`);
  }
}

/**
 * Tries again every record this phone left waiting for a rate, or for a detail that had not arrived: after a rate is
 * saved and after each sync of an event's book. Returns how many now post.
 */
export async function retryUnpostedEventRecords(database: Database, bookId?: string): Promise<number> {
  if (!(await eventOnlyExists(database.db))) return 0;
  const rows = await database.db.values<[string, string, string]>(
    bookId === undefined
      ? sql`SELECT book_id, record_id, kind FROM event_postings WHERE unposted IN ('no-rate', 'malformed') ORDER BY book_id, record_id`
      : sql`SELECT book_id, record_id, kind FROM event_postings WHERE unposted IN ('no-rate', 'malformed') AND book_id = ${bookId} ORDER BY record_id`,
  );
  let posted = 0;
  for (const [book, record, kind] of rows) {
    const done = await database.transaction(async (tx) => {
      await postEventRecordTx(tx, book, kind as EventPostingKind, record, null);
      const [row] = await tx.values<[string | null]>(sql`SELECT unposted FROM event_postings WHERE book_id = ${book} AND record_id = ${record}`);
      return row?.[0] === null;
    });
    if (done) posted += 1;
  }
  return posted;
}

/** The currencies and days the records waiting for a rate need, so the app can fetch them (each pair once). */
export async function eventRatesWanted(database: Database): Promise<{ currency: string; onDate: string }[]> {
  if (!(await eventOnlyExists(database.db))) return [];
  const rows = await database.db.values<[string, string, string, string | null]>(
    sql`SELECT book_id, record_id, kind, account_id FROM event_postings WHERE unposted = 'no-rate' ORDER BY book_id, record_id`,
  );
  const wanted = new Map<string, { currency: string; onDate: string }>();
  for (const [bookId, recordId, kind, accountId] of rows) {
    const book = await eventBookTx(database.db, bookId);
    if (!book) continue;
    const record = kind === 'expense' ? await expenseRecordTx(database.db, bookId, recordId).catch(() => null) : await settlementRecordTx(database.db, bookId, recordId);
    if (!record) continue;
    const currencies = [book.currency, ...('currency' in record ? [record.currency] : [])];
    if (accountId) {
      const account = await accountTx(database.db, accountId);
      if (account) currencies.push(account.currency);
    }
    for (const currency of currencies) {
      if ((await rateToBaseTx(database.db, currency, book.baseCurrency, record.occurredOn)) !== null) continue;
      wanted.set(`${currency}|${record.occurredOn}`, { currency, onDate: record.occurredOn });
    }
  }
  return [...wanted.values()];
}
```

- [ ] **Step 5: Keep the ledger's public doors off derived transactions**

In `packages/db/src/repos/ledger.ts`:

Extend the error codes:

```ts
export type LedgerErrorCode = 'INVALID_DATE' | 'NOT_FOUND' | 'ALREADY_VOID' | 'INVALID_ORIGINAL' | 'INVALID_MCC' | 'TWO_BOOKS' | 'OTHER_BOOK' | 'INVALID_BILL_MONTH' | 'POCKET_PARENT' | 'OTHER_DAY' | 'INVALID_EXACT' | 'EVENT_POSTING';
```

Extend the Task 3 import to `import { eventOnlyExists, eventPostingOfTx, notEventOnly } from './event-only';` and add:

```ts
/**
 * A transaction a shared event put in this phone's books follows its record (shared events §5): deleting or editing it
 * anywhere but the event would leave it disagreeing with the record and every other phone. Only the derivation, which
 * calls the `…Tx` doors directly, changes it.
 */
async function refuseEventPostingTx(tx: Db, id: string): Promise<void> {
  if (await eventPostingOfTx(tx, id)) throw new LedgerError('EVENT_POSTING', 'This follows a shared event’s record. Change it on the event.');
}
```

and replace the two public wrappers:

```ts
export function voidTransaction(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  return database.transaction(async (tx) => {
    await refuseEventPostingTx(tx, id);
    await voidTransactionTx(tx, ws, id);
  });
}

/** Edit = void the original and post the replacement atomically. */
export function replaceTransaction(
  database: Database,
  ws: WorkspaceContext,
  id: string,
  input: PostTransactionInput,
): Promise<string> {
  return database.transaction(async (tx) => {
    await refuseEventPostingTx(tx, id);
    return replaceTransactionTx(tx, ws, id, input);
  });
}
```

- [ ] **Step 6: Points earn on the card line, never on a share line (R12)**

In `packages/db/src/repos/points.ts` `cardSpendLines`, before the first query add:

```ts
  // Shared events (ruling R12): a purchase paid by card for several people has a share line of only this person's part,
  // so it earns on the card line instead (its spend category is set) and the share category's own line is skipped.
  const shareLinesOut = (await eventOnlyExists(database.db)) ? sql`AND a.id NOT IN (SELECT account_id FROM event_category_accounts)` : sql``;
```

add `${shareLinesOut}` as a line after `AND a.kind = 'expense'` in the first query, and add the import `import { eventOnlyExists } from './event-only';`.

- [ ] **Step 7: A saved rate posts what waited for it**

In `packages/db/src/repos/fx.ts`, add `import { retryUnpostedEventRecords } from './shared-event-postings';` and, after the transfers retry block in `upsertRate`, add:

```ts
  // Shared events §5: a record this phone could not post for want of this rate posts now. Never the save's failure.
  try {
    await retryUnpostedEventRecords(database);
  } catch (error) {
    console.warn('Saved the rate; a shared event’s record could not be posted yet', error);
  }
```

- [ ] **Step 8: Export**

In `packages/db/src/index.ts`, after `export * from './repos/event-items';` add:

```ts
export * from './repos/shared-event-records';
export * from './repos/shared-event-postings';
```

- [ ] **Step 9: Run the tests, the ledger, points and fx suites, then everything**

Run: `cd packages/db && npx vitest run test/shared-event-postings.test.ts test/ledger.test.ts test/points.test.ts test/fx.test.ts test/event-only-readers.test.ts`
Expected: PASS.
Run: `npm run test -w @expanses/db && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/repos/shared-event-records.ts packages/db/src/repos/shared-event-postings.ts packages/db/src/repos/ledger.ts packages/db/src/repos/points.ts packages/db/src/repos/fx.ts packages/db/src/index.ts packages/db/test/shared-event-postings.test.ts
git commit -m "$(cat <<'EOF'
Each phone posts its own share of a shared event: paid, shared, settled, replaced on an edit, voided on a void, waiting with a reason when it cannot

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Writes — record, edit and void an expense; settle up; take over; people, currency, Done, categories

Spec §5 ("Recording: the Add screen writes the event records and my local transaction in one db transaction"), §6 (Settle up, People, Currency, Done), §7 (payer-only, remove a name, Done read-only), D3, D4, D8, D9, rulings R5–R7, R9, R13. Every write is one db transaction: the records under `withCapture`, then `postEventRecordTx`.

**Files:**
- Create: `packages/db/src/repos/shared-event-writes.ts`
- Modify: `packages/db/src/index.ts` (one export line after the two Task 5 added)
- Test: `packages/db/test/shared-event-writes.test.ts`

**Interfaces:**
- Consumes: Task 1 (`sharesOf`, `splitJsonOf`, `isRateString`, `balances`, `convertMinor`, `SplitInput`); Task 4 (entities, capture-time rules); Task 5 (`eventBookOfEventTx`, `expenseRecordTx`, `settlementRecordTx`, `eventRecordsTx`, `postEventRecordTx`, `setPaidFromTx`, `followEventOpTx`, `rateToBaseTx`, `EventBookRow`).
- Produces (exported from the index):
  - `class SharedEventDbError extends Error { readonly code: 'NOT_SHARED' | 'FINISHED' | 'PAYER_ONLY' | 'INVALID' | 'NOT_SETTLED' | 'IN_USE' | 'HAS_APP' | 'NO_RATE' }`
  - `sharedEventOf(database: Database, ws: WorkspaceContext, eventId: string): Promise<EventBookRow | null>`
  - `interface SharedExpenseInput { occurredOn: string; amountMinor: number; currency: string; rateToEvent: string; payerPersonId: string; paidFrom: { accountId: string; chargedMinor: number | null; cardId?: string | null } | null; split: SplitInput; categoryId: string | null; note: string | null; mcc?: string | null; channel?: 'online' | 'offline' | null; photoIds?: string[] }`
  - `recordSharedExpense(database, ws, eventId: string, input: SharedExpenseInput): Promise<string>`
  - `interface SharedExpensePatch { occurredOn?: string; amountMinor?: number; currency?: string; rateToEvent?: string; chargedMinor?: number | null; split?: SplitInput; categoryId?: string | null; note?: string | null }`
  - `editSharedExpense(database, ws, eventId: string, expenseId: string, patch: SharedExpensePatch): Promise<void>`
  - `voidSharedExpense(database, ws, eventId: string, expenseId: string): Promise<void>`
  - `interface SettlementInput { occurredOn: string; fromPersonId: string; toPersonId: string; amountMinor: number; account: { accountId: string; amountMinor: number | null } | null }`
  - `recordSettlement(database, ws, eventId: string, input: SettlementInput): Promise<string>`, `voidSettlement(database, ws, eventId: string, settlementId: string): Promise<void>`
  - `takeOverRecords(database, ws, eventId: string, input: { accountId: string; recordIds: readonly string[] }): Promise<void>`
  - `addEventPerson(database, ws, eventId: string, name: string): Promise<string>`, `renameEventPerson(database, ws, eventId: string, personId: string, name: string): Promise<void>`, `removeEventPerson(database, ws, eventId: string, personId: string): Promise<void>`
  - `setSharedEventCurrency(database, ws, eventId: string, currency: string): Promise<void>`, `finishSharedEvent(database, ws, eventId: string, finished: boolean): Promise<void>`
  - `saveEventCategory(database, ws, eventId: string, input: { id?: string; name: string; icon?: string | null }): Promise<string>`, `archiveEventCategory(database, ws, eventId: string, categoryId: string): Promise<void>`
  - `openSharedEventTx(tx: Db, ws: WorkspaceContext, eventId: string, allowDone?: boolean): Promise<EventBookRow>` — the event, open for writing (shared, active, not Done), else a `SharedEventDbError`
  - `personRefusalTx(db: Db, book: EventBookRow, personId: string): Promise<SharedEventDbError | null>` — why a person may not be removed (zero balance and in no record, D9); Task 8 reuses it for a person with the app.

- [ ] **Step 1: Write the failing tests**

`packages/db/test/shared-event-writes.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addEventPerson,
  createAccount,
  editSharedExpense,
  finishSharedEvent,
  nativeBalances,
  openEventBookTx,
  ownerScope,
  recordSettlement,
  recordSharedExpense,
  removeEventPerson,
  saveEvent,
  setSharedEventCurrency,
  takeOverRecords,
  upsertRate,
  voidSharedExpense,
  type SharedExpenseInput,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { installCaptureTriggers, uncapturedWrites } from './sync/capture-harness';
import { outboxOps, shareBookForTest } from './sync/sync-helpers';

/*
 * Writing a shared event (shared events §5, §6, §7). A week by the coast in lira, on the phone of `me`. Rina and Andi
 * have the app; Budi and Dewi do not. Every write is captured whole (§6.4) and posts this phone's own share at once.
 * Invented rates: 1 EUR = 17,000 IDR, 1 TRY = 560 IDR.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function coastWeek(me = 'p-rina', claimed: Record<string, string | null> = { 'p-rina': 'p-rina', 'p-andi': 'p-andi', 'p-budi': null, 'p-dewi': null }) {
  const t = await setupDb();
  executor = t.executor;
  const ws = ownerScope(t.ws);
  for (const [from, rate] of [['EUR', 17_000], ['TRY', 560]] as const) {
    await upsertRate(t.database, { fromCurrency: from, toCurrency: 'IDR', onDate: '2026-10-01', rate, source: 'manual', sourceDate: '2026-10-01' });
  }
  const wallet = await createAccount(t.database, ws, { name: 'Euro wallet', kind: 'asset', subtype: 'cash', currency: 'EUR' });
  const lira = await createAccount(t.database, ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' });
  const eventId = await saveEvent(t.database, ws, { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
  await shareBookForTest(t.database, 'ev-book', me);
  const names: Record<string, string> = { 'p-rina': 'Rina', 'p-andi': 'Andi', 'p-budi': 'Budi', 'p-dewi': 'Dewi' };
  await t.database.execScript(`
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
    INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-book', 'cat-dinners', 'Dinners', NULL, 0, NULL);
    ${Object.entries(claimed).map(([id, member]) => `INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', '${id}', '${names[id]}', ${member ? `'${member}'` : 'NULL'}, NULL);`).join('\n')}
  `);
  const trip = await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Coast week', currency: 'TRY' }));
  await installCaptureTriggers(t.database, 'ev-book');
  const dinner = (over: Partial<SharedExpenseInput> = {}): SharedExpenseInput => ({
    occurredOn: '2026-10-06',
    amountMinor: 9_000,
    currency: 'EUR',
    rateToEvent: '31.5',
    payerPersonId: me,
    paidFrom: { accountId: wallet.id, chargedMinor: null },
    split: { mode: 'equal', people: ['p-rina', 'p-andi', 'p-budi'] },
    categoryId: 'cat-dinners',
    note: 'Fish dinner',
    ...over,
  });
  const balanceOf = async (id: string) => (await nativeBalances(t.database, ws))[id] ?? 0;
  return { ...t, ws, wallet, lira, eventId, trip, dinner, balanceOf };
}

describe('recordSharedExpense', () => {
  it('writes both records and this phone’s share in one go; the account, card and channel never travel', async () => {
    const t = await coastWeek();
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ channel: 'offline', mcc: '5812' }));
    const ops = await outboxOps(t.database);
    expect(ops.map((op) => [op.entity, op.id])).toEqual([['event_expense', id], ['event_expense_detail', id]]);
    const fields = ops.flatMap((op) => (op.op === 'upsert' ? Object.keys(op.fields) : []));
    for (const local of ['accountId', 'account', 'cardId', 'mcc', 'channel', 'photoIds', 'chargedMinor']) expect(fields).not.toContain(local);
    expect(ops[0]!.op === 'upsert' && ops[0]!.fields.payerMemberId).toBe('p-rina');
    expect(await t.balanceOf(t.wallet.id)).toBe(-9_000);
    expect(await t.balanceOf(t.trip)).toBe(189_000);
    expect(await uncapturedWrites(t.database, 'ev-book')).toEqual([]);
  });

  it('takes a payment by a person without the app, anyone’s to change after (D3)', async () => {
    const t = await coastWeek();
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ payerPersonId: 'p-budi', paidFrom: null }));
    expect(await t.database.db.values(sql`SELECT payer_member_id FROM event_expenses WHERE id = ${id}`)).toEqual([[null]]);
    expect(await t.balanceOf(t.trip)).toBe(-94_500);
  });

  it('refuses a payment by a person with the app (R13), and a split that does not add up', async () => {
    const t = await coastWeek();
    await expect(recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ payerPersonId: 'p-andi', paidFrom: null }))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ split: { mode: 'amounts', shares: [{ personId: 'p-rina', minor: 1 }] } })),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('asks what a card in another currency was charged', async () => {
    const t = await coastWeek();
    await expect(recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ paidFrom: { accountId: t.lira.id, chargedMinor: null } }))).rejects.toThrow(/charged/);
  });
});

describe('editSharedExpense and voidSharedExpense (D8)', () => {
  it('lets anyone change a payment made outside the app, and only the payer change their own money', async () => {
    const t = await coastWeek();
    const budis = await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ payerPersonId: 'p-budi', paidFrom: null }));
    await editSharedExpense(t.database, t.ws, t.eventId, budis, { amountMinor: 6_000 });
    expect(await t.balanceOf(t.trip)).toBe(-63_000);
    await t.database.execScript(`
      INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at) VALUES ('ev-book', 'exp-andi', '2026-10-07', 30000, 'TRY', '1', 'p-andi', 'p-andi', NULL);
      INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by) VALUES ('ev-book', 'exp-andi', 'Boat', NULL, 'equal', '["p-rina","p-andi"]', 'p-andi', NULL);
    `);
    await expect(editSharedExpense(t.database, t.ws, t.eventId, 'exp-andi', { amountMinor: 1_000 })).rejects.toMatchObject({ code: 'PAYER_ONLY', message: expect.stringContaining('Andi') });
    await expect(voidSharedExpense(t.database, t.ws, t.eventId, 'exp-andi')).rejects.toMatchObject({ code: 'PAYER_ONLY' });
    await editSharedExpense(t.database, t.ws, t.eventId, 'exp-andi', { split: { mode: 'equal', people: ['p-andi'] }, note: 'Boat, Andi alone' });
    expect(await t.database.db.values(sql`SELECT split_json, updated_by FROM event_expense_details WHERE id = 'exp-andi'`)).toEqual([['["p-andi"]', 'p-rina']]);
  });

  it('voids Rina’s own expense: its transaction goes void and the wallet comes back', async () => {
    const t = await coastWeek();
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner());
    await voidSharedExpense(t.database, t.ws, t.eventId, id);
    expect(await t.balanceOf(t.wallet.id)).toBe(0);
    expect(await t.balanceOf(t.trip)).toBe(0);
  });
});

describe('recordSettlement', () => {
  it('records Budi paying Rina 945 lira into her lira cash; refuses Rina writing what passed between Andi and Budi', async () => {
    const t = await coastWeek();
    await recordSettlement(t.database, t.ws, t.eventId, { occurredOn: '2026-10-12', fromPersonId: 'p-budi', toPersonId: 'p-rina', amountMinor: 94_500, account: { accountId: t.lira.id, amountMinor: null } });
    expect(await t.balanceOf(t.lira.id)).toBe(94_500);
    expect(await t.balanceOf(t.trip)).toBe(-94_500);
    await expect(
      recordSettlement(t.database, t.ws, t.eventId, { occurredOn: '2026-10-12', fromPersonId: 'p-andi', toPersonId: 'p-budi', amountMinor: 1_000, account: null }),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('takeOverRecords (R6)', () => {
  it('Budi, who has just claimed his name, takes over the dinner Andi recorded as paid by him', async () => {
    const t = await coastWeek('p-budi', { 'p-rina': 'p-rina', 'p-andi': 'p-andi', 'p-budi': 'p-budi', 'p-dewi': null });
    await t.database.execScript(`
      INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at) VALUES ('ev-book', 'exp-b', '2026-10-06', 9000, 'EUR', '31.5', 'p-budi', NULL, NULL);
      INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by) VALUES ('ev-book', 'exp-b', 'Market', NULL, 'equal', '["p-rina","p-andi","p-budi"]', 'p-andi', NULL);
    `);
    await takeOverRecords(t.database, t.ws, t.eventId, { accountId: t.wallet.id, recordIds: ['exp-b'] });
    expect(await t.database.db.values(sql`SELECT payer_member_id FROM event_expenses WHERE id = 'exp-b'`)).toEqual([['p-budi']]);
    expect(await t.balanceOf(t.wallet.id)).toBe(-9_000);
    const ops = await outboxOps(t.database);
    expect(ops).toContainEqual(expect.objectContaining({ entity: 'event_expense', id: 'exp-b', fields: expect.objectContaining({ payerMemberId: 'p-budi' }) }));
  });
});

describe('people, currency and Done (D9, R9)', () => {
  it('removes a name at zero balance and in no record; refuses one who owes, one in a record and one with the app', async () => {
    const t = await coastWeek();
    await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner());
    // Dewi's own ticket, paid by Dewi for Dewi alone: a zero balance, but a record that names her.
    await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ payerPersonId: 'p-dewi', paidFrom: null, split: { mode: 'equal', people: ['p-dewi'] }, note: 'Ticket' }));
    const eko = await addEventPerson(t.database, t.ws, t.eventId, 'Eko');
    await expect(addEventPerson(t.database, t.ws, t.eventId, ' eko ')).rejects.toMatchObject({ code: 'INVALID' });
    await removeEventPerson(t.database, t.ws, t.eventId, eko);
    expect(await t.database.db.values(sql`SELECT removed_at IS NOT NULL FROM event_people WHERE id = ${eko}`)).toEqual([[1]]);
    await expect(removeEventPerson(t.database, t.ws, t.eventId, 'p-budi')).rejects.toMatchObject({ code: 'NOT_SETTLED', message: expect.stringContaining('Budi') });
    await expect(removeEventPerson(t.database, t.ws, t.eventId, 'p-dewi')).rejects.toMatchObject({ code: 'IN_USE' });
    await expect(removeEventPerson(t.database, t.ws, t.eventId, 'p-andi')).rejects.toMatchObject({ code: 'HAS_APP' });
  });

  it('changes the currency until the first expense, the trip balance with it, and not after', async () => {
    const t = await coastWeek();
    await setSharedEventCurrency(t.database, t.ws, t.eventId, 'EUR');
    expect(await t.database.db.values(sql`SELECT currency FROM accounts WHERE id = ${t.trip}`)).toEqual([['EUR']]);
    await setSharedEventCurrency(t.database, t.ws, t.eventId, 'TRY');
    await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner());
    await expect(setSharedEventCurrency(t.database, t.ws, t.eventId, 'EUR')).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('keeps a Done event read-only until it is reopened', async () => {
    const t = await coastWeek();
    await finishSharedEvent(t.database, t.ws, t.eventId, true);
    await expect(recordSharedExpense(t.database, t.ws, t.eventId, t.dinner())).rejects.toMatchObject({ code: 'FINISHED', message: expect.stringContaining('Coast week') });
    await finishSharedEvent(t.database, t.ws, t.eventId, false);
    await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/db && npx vitest run test/shared-event-writes.test.ts`
Expected: FAIL — `recordSharedExpense` is not exported.

- [ ] **Step 3: Write the writes**

`packages/db/src/repos/shared-event-writes.ts`:

```ts
import { balances, convertMinor, isRateString, isSupportedCurrency, SharedEventError, sharesOf, splitJsonOf, type SplitInput, uuidv7 } from '@expanses/core';
import { type SQL, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { withCapture } from '../sync/capture';
import { followEventOpTx, postEventRecordTx, rateToBaseTx, setPaidFromTx } from './shared-event-postings';
import { type EventBookRow, eventBookOfEventTx, eventRecordsTx, expenseRecordTx, settlementRecordTx, type StoredExpense } from './shared-event-records';

/*
 * Writing a shared event (shared events §5–§7). Each write is one db transaction: the records under `withCapture` —
 * judged there by the same rules a peer's op meets (sync/events/authority.ts) — then this phone's own transaction for
 * them (`postEventRecordTx`). The account a person paid from, a card, an MCC, a channel and photos stay on this phone:
 * they go to `event_postings` and the local transaction, never into a record.
 *
 * Every message names people and never says "you" (the owner's rule).
 */

export type SharedEventDbErrorCode = 'NOT_SHARED' | 'FINISHED' | 'PAYER_ONLY' | 'INVALID' | 'NOT_SETTLED' | 'IN_USE' | 'HAS_APP' | 'NO_RATE';

export class SharedEventDbError extends Error {
  readonly code: SharedEventDbErrorCode;

  constructor(code: SharedEventDbErrorCode, message: string) {
    super(message);
    this.name = 'SharedEventDbError';
    this.code = code;
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const invalid = (message: string) => new SharedEventDbError('INVALID', message);

/** The shared event behind a local event in this workspace, or null for an event that is not shared. */
export async function sharedEventOf(database: Database, ws: WorkspaceContext, eventId: string): Promise<EventBookRow | null> {
  const book = await eventBookOfEventTx(database.db, eventId).catch(() => null);
  return book && book.workspaceId === ws.workspaceId ? book : null;
}

/** The event, open for writing: shared and active here, and not Done unless `allowDone` (R9). */
export async function openSharedEventTx(tx: Db, ws: WorkspaceContext, eventId: string, allowDone = false): Promise<EventBookRow> {
  const book = await eventBookOfEventTx(tx, eventId);
  if (!book || book.workspaceId !== ws.workspaceId) throw new SharedEventDbError('NOT_SHARED', 'That event is not shared here');
  if (book.state !== 'active') throw new SharedEventDbError('NOT_SHARED', `${book.name} is no longer shared here, and is kept read-only`);
  if (book.finishedAt && !allowDone) throw new SharedEventDbError('FINISHED', `${book.name} is done. Reopen it to change anything.`);
  return book;
}

interface PersonRow {
  name: string;
  memberId: string | null;
  removed: boolean;
}

async function peopleTx(tx: Db, bookId: string): Promise<Map<string, PersonRow>> {
  const rows = await tx.values<[string, string, string | null, string | null]>(sql`SELECT id, name, member_id, removed_at FROM event_people WHERE book_id = ${bookId}`);
  return new Map(rows.map(([id, name, memberId, removedAt]) => [id, { name, memberId, removed: removedAt !== null }]));
}

const nameIn = (people: Map<string, PersonRow>, personId: string) => people.get(personId)?.name ?? 'Someone';

async function accountCurrencyTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<string> {
  const [row] = await tx.values<[string | null]>(sql`SELECT currency FROM accounts WHERE id = ${accountId} AND workspace_id = ${ws.workspaceId} AND kind IN ('asset', 'liability') AND archived_at IS NULL`);
  if (!row || !row[0]) throw invalid('Choose an account');
  return row[0];
}

/** The account's own-currency figure to keep (R5): null when the account is in `currency`, else a figure above zero. */
async function chargedFor(tx: Db, ws: WorkspaceContext, accountId: string, currency: string, charged: number | null | undefined): Promise<number | null> {
  const own = await accountCurrencyTx(tx, ws, accountId);
  if (own === currency) return null;
  const [named] = await tx.values<[string]>(sql`SELECT name FROM accounts WHERE id = ${accountId}`);
  if (charged === null || charged === undefined || !Number.isSafeInteger(charged) || charged <= 0) throw invalid(`Enter what ${named?.[0] ?? 'the account'} was charged in ${own}`);
  return charged;
}

/** The figures of an expense, checked as the screen should already have: date, amount, currency, rate, split, category. */
async function checkExpenseTx(tx: Db, book: EventBookRow, people: Map<string, PersonRow>, e: { occurredOn: string; amountMinor: number; currency: string; rateToEvent: string; payerPersonId: string; split: SplitInput; categoryId: string | null }): Promise<void> {
  if (!DATE.test(e.occurredOn)) throw invalid('Pick a date');
  if (!Number.isSafeInteger(e.amountMinor) || e.amountMinor <= 0) throw invalid('Enter an amount above zero');
  if (!isSupportedCurrency(e.currency)) throw invalid(`Unsupported currency ${e.currency}`);
  if (!isRateString(e.rateToEvent)) throw invalid(`Enter the rate to ${book.currency}`);
  if (e.currency === book.currency && Number(e.rateToEvent) !== 1) throw invalid(`An amount in ${book.currency} has rate 1`);
  try {
    sharesOf(e);
  } catch (error) {
    if (error instanceof SharedEventError) throw invalid(error.code === 'SPLIT_MISMATCH' ? 'The amounts must add up to the total' : 'Tick at least one person to share it');
    throw error;
  }
  const named = e.split.mode === 'equal' ? e.split.people : e.split.shares.map((s) => s.personId);
  for (const personId of [e.payerPersonId, ...named]) {
    const person = people.get(personId);
    if (!person || person.removed) throw invalid('That person is no longer in this event');
  }
  if (e.categoryId !== null) {
    const [category] = await tx.values(sql`SELECT 1 FROM event_categories WHERE book_id = ${book.bookId} AND id = ${e.categoryId} AND archived_at IS NULL`);
    if (!category) throw invalid('Pick one of the event’s categories');
  }
}

export interface SharedExpenseInput {
  occurredOn: string;
  amountMinor: number;
  currency: string;
  rateToEvent: string;
  payerPersonId: string;
  /** This person's own account, when this person paid (R13): what it was charged in its own currency when that differs. */
  paidFrom: { accountId: string; chargedMinor: number | null; cardId?: string | null } | null;
  split: SplitInput;
  categoryId: string | null;
  note: string | null;
  mcc?: string | null;
  channel?: 'online' | 'offline' | null;
  photoIds?: string[];
}

const targets = (bookId: string, id: string) => [
  { entity: 'event_expense', id, bookId },
  { entity: 'event_expense_detail', id, bookId },
];

export async function recordSharedExpense(database: Database, ws: WorkspaceContext, eventId: string, input: SharedExpenseInput): Promise<string> {
  const id = uuidv7();
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const people = await peopleTx(tx, book.bookId);
    await checkExpenseTx(tx, book, people, input);
    const mine = input.payerPersonId === book.me;
    // R13: a person with the app records their own payments.
    if (!mine && people.get(input.payerPersonId)?.memberId) throw invalid(`${nameIn(people, input.payerPersonId)} records what ${nameIn(people, input.payerPersonId)} paid`);
    if (mine && !input.paidFrom) throw invalid(`Choose the account ${nameIn(people, book.me)} paid from`);
    const charged = mine ? await chargedFor(tx, ws, input.paidFrom!.accountId, input.currency, input.paidFrom!.chargedMinor) : null;
    await withCapture(tx, targets(book.bookId, id), async () => {
      await tx.run(sql`
        INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
        VALUES (${book.bookId}, ${id}, ${input.occurredOn}, ${input.amountMinor}, ${input.currency}, ${input.rateToEvent}, ${input.payerPersonId}, ${mine ? book.me : null}, NULL)`);
      await tx.run(sql`
        INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by)
        VALUES (${book.bookId}, ${id}, ${input.note?.trim() || null}, ${input.categoryId}, ${input.split.mode}, ${splitJsonOf(input.split)}, ${book.me}, NULL)`);
    });
    if (mine) await setPaidFromTx(tx, book.bookId, id, 'expense', { accountId: input.paidFrom!.accountId, amountMinor: charged });
    await postEventRecordTx(tx, book.bookId, 'expense', id, null, { cardId: input.paidFrom?.cardId ?? null, mcc: input.mcc ?? null, channel: input.channel ?? null, ...(input.photoIds ? { photoIds: input.photoIds } : {}) });
  });
  return id;
}

export interface SharedExpensePatch {
  occurredOn?: string;
  amountMinor?: number;
  currency?: string;
  rateToEvent?: string;
  /** What this person's own account was charged, when it is in another currency. */
  chargedMinor?: number | null;
  split?: SplitInput;
  categoryId?: string | null;
  note?: string | null;
}

async function liveExpenseTx(tx: Db, book: EventBookRow, expenseId: string): Promise<StoredExpense> {
  const record = await expenseRecordTx(tx, book.bookId, expenseId);
  if (!record || record.voided) throw invalid('That expense was deleted');
  return record;
}

/** D8: the money of an expense paid from a member's account is that member's alone. */
function refuseUnlessPayer(record: StoredExpense, book: EventBookRow, people: Map<string, PersonRow>): void {
  if (record.payerMemberId !== null && record.payerMemberId !== book.me) {
    const who = nameIn(people, record.payerPersonId);
    throw new SharedEventDbError('PAYER_ONLY', `Only ${who} changes the amount, currency, rate or date of what ${who} paid, or deletes it`);
  }
}

export async function editSharedExpense(database: Database, ws: WorkspaceContext, eventId: string, expenseId: string, patch: SharedExpensePatch): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const people = await peopleTx(tx, book.bookId);
    const record = await liveExpenseTx(tx, book, expenseId);
    const next = {
      occurredOn: patch.occurredOn ?? record.occurredOn,
      amountMinor: patch.amountMinor ?? record.amountMinor,
      currency: patch.currency ?? record.currency,
      rateToEvent: patch.rateToEvent ?? record.rateToEvent,
      payerPersonId: record.payerPersonId,
      split: patch.split ?? record.split,
      categoryId: patch.categoryId !== undefined ? patch.categoryId : record.categoryId,
      note: patch.note !== undefined ? patch.note?.trim() || null : record.note,
    };
    const money = next.occurredOn !== record.occurredOn || next.amountMinor !== record.amountMinor || next.currency !== record.currency || next.rateToEvent !== record.rateToEvent;
    if (money) refuseUnlessPayer(record, book, people);
    await checkExpenseTx(tx, book, people, next);
    const detail = splitJsonOf(next.split) !== splitJsonOf(record.split) || next.categoryId !== record.categoryId || next.note !== record.note;
    await withCapture(tx, targets(book.bookId, expenseId), async () => {
      if (money) {
        await tx.run(sql`
          UPDATE event_expenses SET occurred_on = ${next.occurredOn}, amount_minor = ${next.amountMinor}, currency = ${next.currency}, rate_to_event = ${next.rateToEvent}
          WHERE book_id = ${book.bookId} AND id = ${expenseId}`);
      }
      if (detail) {
        await tx.run(sql`
          UPDATE event_expense_details SET note = ${next.note}, category_id = ${next.categoryId}, split_mode = ${next.split.mode}, split_json = ${splitJsonOf(next.split)}, updated_by = ${book.me}
          WHERE book_id = ${book.bookId} AND id = ${expenseId}`);
      }
    });
    if (record.payerMemberId === book.me && (patch.chargedMinor !== undefined || next.currency !== record.currency)) {
      const [held] = await tx.values<[string | null]>(sql`SELECT account_id FROM event_postings WHERE book_id = ${book.bookId} AND record_id = ${expenseId}`);
      if (held?.[0]) await setPaidFromTx(tx, book.bookId, expenseId, 'expense', { accountId: held[0], amountMinor: await chargedFor(tx, ws, held[0], next.currency, patch.chargedMinor) });
    }
    await postEventRecordTx(tx, book.bookId, 'expense', expenseId, null);
  });
}

export async function voidSharedExpense(database: Database, ws: WorkspaceContext, eventId: string, expenseId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const record = await liveExpenseTx(tx, book, expenseId);
    refuseUnlessPayer(record, book, await peopleTx(tx, book.bookId));
    await withCapture(tx, { entity: 'event_expense', id: expenseId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_expenses SET voided_at = ${new Date().toISOString()} WHERE book_id = ${book.bookId} AND id = ${expenseId}`),
    );
    // Any plan item it answered is put back on the list.
    await withCapture(tx, { entity: 'event_item', bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_items_shared SET expense_id = NULL, share_minor = NULL WHERE book_id = ${book.bookId} AND expense_id = ${expenseId}`),
    );
    await postEventRecordTx(tx, book.bookId, 'expense', expenseId, null);
  });
}

export interface SettlementInput {
  occurredOn: string;
  fromPersonId: string;
  toPersonId: string;
  /** In the event currency. */
  amountMinor: number;
  /** This person's own account, when this person paid or received it; its own-currency figure when that differs. */
  account: { accountId: string; amountMinor: number | null } | null;
}

export async function recordSettlement(database: Database, ws: WorkspaceContext, eventId: string, input: SettlementInput): Promise<string> {
  const id = uuidv7();
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const people = await peopleTx(tx, book.bookId);
    if (!DATE.test(input.occurredOn)) throw invalid('Pick a date');
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw invalid('Enter an amount above zero');
    if (input.fromPersonId === input.toPersonId) throw invalid('A settle-up is between two people');
    for (const personId of [input.fromPersonId, input.toPersonId]) if (!people.get(personId) || people.get(personId)!.removed) throw invalid('That person is no longer in this event');
    const fromMember = people.get(input.fromPersonId)!.memberId;
    const toMember = people.get(input.toPersonId)!.memberId;
    // §3: either side's member writes it; anyone when neither side has the app.
    if ((fromMember || toMember) && book.me !== fromMember && book.me !== toMember) {
      throw invalid(`Only ${[fromMember ? nameIn(people, input.fromPersonId) : null, toMember ? nameIn(people, input.toPersonId) : null].filter(Boolean).join(' or ')} records this`);
    }
    const party = book.me === input.fromPersonId || book.me === input.toPersonId;
    if (party && !input.account) throw invalid(`Choose the account ${nameIn(people, book.me)} ${book.me === input.fromPersonId ? 'paid from' : 'received it into'}`);
    const figure = party ? await chargedFor(tx, ws, input.account!.accountId, book.currency, input.account!.amountMinor) : null;
    await withCapture(tx, { entity: 'event_settlement', id, bookId: book.bookId }, () =>
      tx.run(sql`
        INSERT INTO event_settlements (book_id, id, occurred_on, from_person_id, to_person_id, from_member_id, to_member_id, amount_minor, voided_at)
        VALUES (${book.bookId}, ${id}, ${input.occurredOn}, ${input.fromPersonId}, ${input.toPersonId}, ${fromMember}, ${toMember}, ${input.amountMinor}, NULL)`),
    );
    if (party) await setPaidFromTx(tx, book.bookId, id, 'settlement', { accountId: input.account!.accountId, amountMinor: figure });
    await postEventRecordTx(tx, book.bookId, 'settlement', id, null);
  });
  return id;
}

export async function voidSettlement(database: Database, ws: WorkspaceContext, eventId: string, settlementId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const record = await settlementRecordTx(tx, book.bookId, settlementId);
    if (!record || record.voided) throw invalid('That settle-up was deleted');
    const members = [record.fromMemberId, record.toMemberId].filter((m): m is string => m !== null);
    if (members.length > 0 && !members.includes(book.me)) {
      const people = await peopleTx(tx, book.bookId);
      throw new SharedEventDbError('PAYER_ONLY', `Only ${nameIn(people, record.fromPersonId)} or ${nameIn(people, record.toPersonId)} deletes this settle-up`);
    }
    await withCapture(tx, { entity: 'event_settlement', id: settlementId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_settlements SET voided_at = ${new Date().toISOString()} WHERE book_id = ${book.bookId} AND id = ${settlementId}`),
    );
    await postEventRecordTx(tx, book.bookId, 'settlement', settlementId, null);
  });
}

/** A figure in `from` converted to `to` at the day's rates on this phone (both through the base currency), or null. */
async function convertedTx(tx: Db, book: EventBookRow, minor: number, from: string, to: string, on: string): Promise<number | null> {
  if (from === to) return minor;
  const fromRate = await rateToBaseTx(tx, from, book.baseCurrency, on);
  const toRate = await rateToBaseTx(tx, to, book.baseCurrency, on);
  return fromRate === null || toRate === null ? null : convertMinor(minor, from, to, fromRate / toRate);
}

/**
 * R6: this person's records that are not in this phone's books yet — paid by them before they claimed their name, on a
 * stale view, or before a lost phone — are taken over: the record names this member (a takeover op, set once) and this
 * phone keeps the account they came from, with the day's converted figure when the currencies differ.
 */
export async function takeOverRecords(database: Database, ws: WorkspaceContext, eventId: string, input: { accountId: string; recordIds: readonly string[] }): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const own = await accountCurrencyTx(tx, ws, input.accountId);
    for (const recordId of input.recordIds) {
      const expense = await expenseRecordTx(tx, book.bookId, recordId);
      if (expense) {
        if (expense.voided || expense.payerPersonId !== book.me || (expense.payerMemberId !== null && expense.payerMemberId !== book.me)) throw invalid('Only what this person paid can be taken over');
        const figure = own === expense.currency ? null : await convertedTx(tx, book, expense.amountMinor, expense.currency, own, expense.occurredOn);
        if (own !== expense.currency && figure === null) throw new SharedEventDbError('NO_RATE', `No ${expense.currency} or ${own} rate for ${expense.occurredOn} yet`);
        if (expense.payerMemberId === null) {
          await withCapture(tx, { entity: 'event_expense', id: recordId, bookId: book.bookId }, () =>
            tx.run(sql`UPDATE event_expenses SET payer_member_id = ${book.me} WHERE book_id = ${book.bookId} AND id = ${recordId}`),
          );
        }
        await setPaidFromTx(tx, book.bookId, recordId, 'expense', { accountId: input.accountId, amountMinor: figure });
        await postEventRecordTx(tx, book.bookId, 'expense', recordId, null);
        continue;
      }
      const settlement = await settlementRecordTx(tx, book.bookId, recordId);
      if (!settlement || settlement.voided) throw invalid('That record was deleted');
      const side = settlement.fromPersonId === book.me ? 'from' : settlement.toPersonId === book.me ? 'to' : null;
      if (side === null) throw invalid('Only a settle-up this person paid or received can be taken over');
      const figure = own === book.currency ? null : await convertedTx(tx, book, settlement.amountMinor, book.currency, own, settlement.occurredOn);
      if (own !== book.currency && figure === null) throw new SharedEventDbError('NO_RATE', `No ${book.currency} or ${own} rate for ${settlement.occurredOn} yet`);
      const memberColumn = side === 'from' ? 'from_member_id' : 'to_member_id';
      if ((side === 'from' ? settlement.fromMemberId : settlement.toMemberId) === null) {
        await withCapture(tx, { entity: 'event_settlement', id: recordId, bookId: book.bookId }, () =>
          tx.run(sql`UPDATE event_settlements SET ${sql.raw(memberColumn)} = ${book.me} WHERE book_id = ${book.bookId} AND id = ${recordId}`),
        );
      }
      await setPaidFromTx(tx, book.bookId, recordId, 'settlement', { accountId: input.accountId, amountMinor: figure });
      await postEventRecordTx(tx, book.bookId, 'settlement', recordId, null);
    }
  });
}

export async function addEventPerson(database: Database, ws: WorkspaceContext, eventId: string, name: string): Promise<string> {
  const id = uuidv7();
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const trimmed = name.trim();
    if (!trimmed) throw invalid('Enter a name');
    const taken = [...(await peopleTx(tx, book.bookId)).values()].some((p) => !p.removed && p.name.toLowerCase() === trimmed.toLowerCase());
    if (taken) throw invalid(`${trimmed} is already in this event`);
    await withCapture(tx, { entity: 'event_person', id, bookId: book.bookId }, () =>
      tx.run(sql`INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES (${book.bookId}, ${id}, ${trimmed}, NULL, NULL)`),
    );
  });
  return id;
}

export async function renameEventPerson(database: Database, ws: WorkspaceContext, eventId: string, personId: string, name: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const trimmed = name.trim();
    if (!trimmed) throw invalid('Enter a name');
    await withCapture(tx, { entity: 'event_person', id: personId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_people SET name = ${trimmed} WHERE book_id = ${book.bookId} AND id = ${personId}`),
    );
  });
}

/** D9: why this person cannot leave or be removed now, or null — a balance that is not zero, or a record naming them. */
export async function personRefusalTx(db: Db, book: EventBookRow, personId: string): Promise<SharedEventDbError | null> {
  const { expenses, settlements, people } = await eventRecordsTx(db, book.bookId);
  const name = people.find((p) => p.personId === personId)?.name ?? 'This person';
  const owed = balances(expenses, settlements, book.currency, [personId])[personId] ?? 0;
  if (owed !== 0) return new SharedEventDbError('NOT_SETTLED', `${name}'s balance is not zero yet: settle up first`);
  return null;
}

export async function removeEventPerson(database: Database, ws: WorkspaceContext, eventId: string, personId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const people = await peopleTx(tx, book.bookId);
    const person = people.get(personId);
    if (!person || person.removed) return;
    if (person.memberId) throw new SharedEventDbError('HAS_APP', `${person.name} has the app: remove ${person.name} from People`);
    const unsettled = await personRefusalTx(tx, book, personId);
    if (unsettled) throw unsettled;
    const { expenses, settlements } = await eventRecordsTx(tx, book.bookId);
    const named =
      expenses.some((e) => !e.voided && (e.payerPersonId === personId || sharesOf(e).some((s) => s.personId === personId))) ||
      settlements.some((s) => !s.voided && (s.fromPersonId === personId || s.toPersonId === personId));
    if (named) throw new SharedEventDbError('IN_USE', `${person.name} is in an expense or a settle-up, so ${person.name} stays`);
    await withCapture(tx, { entity: 'event_person', id: personId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_people SET removed_at = ${new Date().toISOString()} WHERE book_id = ${book.bookId} AND id = ${personId}`),
    );
  });
}

async function writeEventTx(tx: Tx, book: EventBookRow, set: SQL): Promise<void> {
  await withCapture(tx, { entity: 'shared_event', id: book.bookId, bookId: book.bookId }, () => tx.run(sql`UPDATE shared_events SET ${set} WHERE book_id = ${book.bookId}`));
  await followEventOpTx(tx, book.bookId, 'shared_event', book.bookId, null);
}

export async function setSharedEventCurrency(database: Database, ws: WorkspaceContext, eventId: string, currency: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    if (!isSupportedCurrency(currency)) throw invalid(`Unsupported currency ${currency}`);
    const [spent] = await tx.values(sql`SELECT 1 FROM event_expenses WHERE book_id = ${book.bookId} LIMIT 1`);
    if (spent) throw invalid(`${book.name}'s currency is fixed once something is spent`);
    await writeEventTx(tx, book, sql`currency = ${currency}`);
  });
}

export async function finishSharedEvent(database: Database, ws: WorkspaceContext, eventId: string, finished: boolean): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId, true);
    await writeEventTx(tx, book, sql`finished_at = ${finished ? new Date().toISOString() : null}`);
  });
}

export async function saveEventCategory(database: Database, ws: WorkspaceContext, eventId: string, input: { id?: string; name: string; icon?: string | null }): Promise<string> {
  const id = input.id ?? uuidv7();
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const name = input.name.trim();
    if (!name) throw invalid('Enter a name');
    await withCapture(tx, { entity: 'event_category', id, bookId: book.bookId }, () =>
      tx.run(sql`
        INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at)
        VALUES (${book.bookId}, ${id}, ${name}, ${input.icon ?? null}, (SELECT coalesce(max(sort_order), 0) + 1 FROM event_categories WHERE book_id = ${book.bookId}), NULL)
        ON CONFLICT (book_id, id) DO UPDATE SET name = excluded.name, icon = excluded.icon`),
    );
    await followEventOpTx(tx, book.bookId, 'event_category', id, null);
  });
  return id;
}

export async function archiveEventCategory(database: Database, ws: WorkspaceContext, eventId: string, categoryId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    await withCapture(tx, { entity: 'event_category', id: categoryId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_categories SET archived_at = ${new Date().toISOString()} WHERE book_id = ${book.bookId} AND id = ${categoryId}`),
    );
  });
}
```

- [ ] **Step 4: Export**

In `packages/db/src/index.ts`, after `export * from './repos/shared-event-postings';` add:

```ts
export * from './repos/shared-event-writes';
```

- [ ] **Step 5: Run the tests, then everything with the capture run**

Run: `cd packages/db && npx vitest run test/shared-event-writes.test.ts`
Expected: PASS. If `uncapturedWrites` names a write, the write bypassed `withCapture`: wrap it, never loosen the harness.
Run: `npm run test -w @expanses/db && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repos/shared-event-writes.ts packages/db/src/index.ts packages/db/test/shared-event-writes.test.ts
git commit -m "$(cat <<'EOF'
Writing a shared event: expenses and settle-ups with this phone's own share in the same transaction, takeovers, people, currency and Done

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Reads — the event page, the events list, the Debts page; and the shared plan

Spec §6 (header "Spent ₺ 12.600 · Fandrian's share ₺ 4.200", Spending rows, Balances with suggested payments, Events list "Shared with N people", Debts page), §7 ("Not sent yet", "Changed by Andi"), D6, D7.

**Files:**
- Create: `packages/db/src/repos/shared-event-reads.ts`
- Create: `packages/db/src/repos/shared-event-plan.ts`
- Modify: `packages/db/src/index.ts` (two export lines after `export * from './repos/shared-event-writes';`)
- Test: `packages/db/test/shared-event-reads.test.ts`

**Interfaces:**
- Consumes: Task 1 (`balances`, `fewestPayments`, `expenseInEvent`, `sharesOf`, `toEvent`, `eventPlan`); Task 5 (`eventBookOfEventTx`, `eventRecordsTx`, `EventUnposted`); Task 6 (`openSharedEventTx`, `SharedEventDbError`, `recordSharedExpense`… in tests); `tidyLink` from `event-items.ts`; `withCapture`.
- Produces (exported from the index):
  - `initialsOf(name: string): string`, `splitText(split: SplitInput): string`
  - `interface SharedPersonView { personId: string; name: string; initials: string; hasApp: boolean; isMe: boolean; removed: boolean; balanceMinor: number }`
  - `interface RecordPostingView { transactionId: string | null; unposted: EventUnposted | null; changedByName: string | null; accountCurrency: string | null }`
  - `interface SharedExpenseView { expenseId: string; occurredOn: string; amountMinor: number; currency: string; rateToEvent: string; eventAmountMinor: number; payerPersonId: string; payerName: string; payerHasAccount: boolean; categoryId: string | null; categoryName: string | null; note: string | null; split: SplitInput; splitText: string; myShareMinor: number; myShareEventMinor: number; voided: boolean; unsent: boolean; payerOnly: boolean; posting: RecordPostingView | null }`
  - `interface SharedSettlementView { settlementId: string; occurredOn: string; fromPersonId: string; fromName: string; toPersonId: string; toName: string; amountMinor: number; voided: boolean; unsent: boolean; mine: boolean; posting: RecordPostingView | null }`
  - `interface NamedPayment extends SuggestedPayment { fromName: string; toName: string }`
  - `interface SharedEventView { eventId: string; bookId: string; name: string; startsOn: string; endsOn: string; currency: string; finishedAt: string | null; state: string; me: string; myName: string; people: SharedPersonView[]; categories: { categoryId: string; name: string; icon: string | null; archived: boolean }[]; expenses: SharedExpenseView[]; settlements: SharedSettlementView[]; spentMinor: number; myShareMinor: number; payments: NamedPayment[]; waiting: { recordId: string; kind: 'expense' | 'settlement'; reason: EventUnposted }[]; currencyLocked: boolean }`
  - `sharedEventView(database: Database, ws: WorkspaceContext, eventId: string): Promise<SharedEventView | null>`
  - `interface SharedEventSummary { eventId: string; people: { name: string; initials: string }[]; sharedWith: number }`, `sharedEventSummaries(database, ws): Promise<Record<string, SharedEventSummary>>`
  - `interface EventBalanceRow { eventId: string; name: string; currency: string; balanceMinor: number; payments: NamedPayment[] }`, `eventBalanceRows(database, ws): Promise<EventBalanceRow[]>`
  - `interface SharedItemInput { id?: string; name: string; quantity: number; unitPriceMinor: number; categoryId: string | null; link: string | null; note: string | null }`
  - `saveSharedItem(database, ws, eventId: string, input: SharedItemInput): Promise<string>`, `removeSharedItem(database, ws, eventId: string, itemId: string): Promise<void>`, `linkSharedItem(database, ws, eventId: string, itemId: string, link: { expenseId: string; shareMinor: number } | null): Promise<void>`, `sharedEventPlan(database, ws, eventId: string): Promise<EventPlan | null>`

- [ ] **Step 1: Write the failing tests**

`packages/db/test/shared-event-reads.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  eventBalanceRows,
  initialsOf,
  linkSharedItem,
  openEventBookTx,
  ownerScope,
  recordSettlement,
  recordSharedExpense,
  saveEvent,
  saveSharedItem,
  sharedEventPlan,
  sharedEventSummaries,
  sharedEventView,
  splitText,
  upsertRate,
  voidSharedExpense,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { clearOutbox, shareBookForTest } from './sync/sync-helpers';

/*
 * Reading a shared event (shared events §6, §7): what the event page, the events list and the Debts page show. Rina's
 * phone; Rina and Andi have the app, Budi and Dewi do not. Invented rates: 1 EUR = 17,000 IDR, 1 TRY = 560 IDR.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function coastWeek() {
  const t = await setupDb();
  executor = t.executor;
  const ws = ownerScope(t.ws);
  for (const [from, rate] of [['EUR', 17_000], ['TRY', 560]] as const) {
    await upsertRate(t.database, { fromCurrency: from, toCurrency: 'IDR', onDate: '2026-10-01', rate, source: 'manual', sourceDate: '2026-10-01' });
  }
  const wallet = await createAccount(t.database, ws, { name: 'Euro wallet', kind: 'asset', subtype: 'cash', currency: 'EUR' });
  const lira = await createAccount(t.database, ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' });
  const eventId = await saveEvent(t.database, ws, { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
    INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-book', 'cat-dinners', 'Dinners', NULL, 0, NULL);
    INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES
      ('ev-book', 'p-rina', 'Rina Sari', 'p-rina', NULL), ('ev-book', 'p-andi', 'Andi', 'p-andi', NULL),
      ('ev-book', 'p-budi', 'Budi', NULL, NULL), ('ev-book', 'p-dewi', 'Dewi', NULL, NULL);
  `);
  await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Coast week', currency: 'TRY' }));
  // Rina paid €90 for three; Budi paid 1,800 lira for Rina and Budi; Andi's boat (recorded on Andi's phone, here raw).
  await recordSharedExpense(t.database, ws, eventId, {
    occurredOn: '2026-10-06', amountMinor: 9_000, currency: 'EUR', rateToEvent: '31.5', payerPersonId: 'p-rina', paidFrom: { accountId: wallet.id, chargedMinor: null },
    split: { mode: 'equal', people: ['p-rina', 'p-andi', 'p-budi'] }, categoryId: 'cat-dinners', note: 'Fish dinner',
  });
  await recordSharedExpense(t.database, ws, eventId, {
    occurredOn: '2026-10-07', amountMinor: 180_000, currency: 'TRY', rateToEvent: '1', payerPersonId: 'p-budi', paidFrom: null,
    split: { mode: 'equal', people: ['p-rina', 'p-budi'] }, categoryId: null, note: 'Market',
  });
  await t.database.execScript(`
    INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at) VALUES ('ev-book', 'exp-boat', '2026-10-08', 60000, 'TRY', '1', 'p-andi', 'p-andi', NULL);
    INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by) VALUES ('ev-book', 'exp-boat', 'Boat', NULL, 'equal', '["p-andi","p-dewi"]', 'p-andi', NULL);
  `);
  return { ...t, ws, wallet, lira, eventId };
}

describe('sharedEventView', () => {
  it('reads the header, each row and each person’s balance in the event currency', async () => {
    const t = await coastWeek();
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.currency).toBe('TRY');
    expect(view.myName).toBe('Rina Sari');
    // Spent: 283,500 (€90) + 180,000 + 60,000; Rina's share: 94,500 + 90,000.
    expect(view.spentMinor).toBe(523_500);
    expect(view.myShareMinor).toBe(184_500);
    const dinner = view.expenses.find((e) => e.note === 'Fish dinner')!;
    expect(dinner).toMatchObject({ payerName: 'Rina Sari', payerHasAccount: true, splitText: 'Equal · 3 people', myShareMinor: 3_000, myShareEventMinor: 94_500, eventAmountMinor: 283_500, categoryName: 'Dinners', unsent: true, payerOnly: false });
    expect(view.expenses.find((e) => e.expenseId === 'exp-boat')).toMatchObject({ payerOnly: true, myShareMinor: 0, unsent: false });
    expect(Object.fromEntries(view.people.map((p) => [p.name, p.balanceMinor]))).toEqual({ 'Rina Sari': 99_000, Andi: -64_500, Budi: -4_500, Dewi: -30_000 });
    expect(view.people.find((p) => p.isMe)?.initials).toBe('RS');
  });

  it('suggests the fewest payments, by name, and the same list however it is asked', async () => {
    const t = await coastWeek();
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.payments).toEqual([
      { fromPersonId: 'p-andi', fromName: 'Andi', toPersonId: 'p-rina', toName: 'Rina Sari', amountMinor: 64_500 },
      { fromPersonId: 'p-dewi', fromName: 'Dewi', toPersonId: 'p-rina', toName: 'Rina Sari', amountMinor: 30_000 },
      { fromPersonId: 'p-budi', fromName: 'Budi', toPersonId: 'p-rina', toName: 'Rina Sari', amountMinor: 4_500 },
    ]);
  });

  it('says a record is not sent while it waits in the outbox, and what waits for an account', async () => {
    const t = await coastWeek();
    await clearOutbox(t.database);
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.expenses.every((e) => !e.unsent)).toBe(true);
    expect(view.waiting).toEqual([]);
    expect(view.currencyLocked).toBe(true);
  });

  it('is null for an event that is not shared', async () => {
    const t = await coastWeek();
    const other = await saveEvent(t.database, t.ws, { name: 'Hill weekend', startsOn: '2026-11-01', endsOn: '2026-11-02' });
    expect(await sharedEventView(t.database, t.ws, other)).toBeNull();
  });
});

describe('the events list and the Debts page', () => {
  it('names the people an event is shared with', async () => {
    const t = await coastWeek();
    expect((await sharedEventSummaries(t.database, t.ws))[t.eventId]).toEqual({
      eventId: t.eventId,
      sharedWith: 3,
      people: [
        { name: 'Andi', initials: 'A' },
        { name: 'Budi', initials: 'B' },
        { name: 'Dewi', initials: 'D' },
      ],
    });
  });

  it('shows the trip balance and the payments that involve this person; a settle-up moves both', async () => {
    const t = await coastWeek();
    const [row] = await eventBalanceRows(t.database, t.ws);
    expect(row).toMatchObject({ eventId: t.eventId, name: 'Coast week', currency: 'TRY' });
    expect(row!.balanceMinor).toBe(94_500 + 94_500 - 90_000); // the others' share of the dinner, less Rina's half of the market
    expect(row!.payments.map((p) => `${p.fromName}→${p.toName} ${p.amountMinor}`)).toEqual(['Andi→Rina Sari 64500', 'Dewi→Rina Sari 30000', 'Budi→Rina Sari 4500']);
    await recordSettlement(t.database, t.ws, t.eventId, { occurredOn: '2026-10-12', fromPersonId: 'p-budi', toPersonId: 'p-rina', amountMinor: 4_500, account: { accountId: t.lira.id, amountMinor: null } });
    const [after] = await eventBalanceRows(t.database, t.ws);
    expect(after!.payments.map((p) => p.fromName)).toEqual(['Andi', 'Dewi']);
  });
});

describe('the shared plan (D7)', () => {
  it('an item answered by an expense is bought at its share; a void puts it back on the list', async () => {
    const t = await coastWeek();
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    const dinner = view.expenses.find((e) => e.note === 'Fish dinner')!;
    const item = await saveSharedItem(t.database, t.ws, t.eventId, { name: 'Fish dinner', quantity: 1, unitPriceMinor: 250_000, categoryId: 'cat-dinners', link: null, note: null });
    await linkSharedItem(t.database, t.ws, t.eventId, item, { expenseId: dinner.expenseId, shareMinor: 283_500 });
    const plan = (await sharedEventPlan(t.database, t.ws, t.eventId))!;
    expect(plan.lines.flatMap((l) => l.items)).toEqual([expect.objectContaining({ name: 'Fish dinner', bought: true, actualMinor: 283_500, differenceMinor: 33_500 })]);
    await voidSharedExpense(t.database, t.ws, t.eventId, dinner.expenseId);
    const after = (await sharedEventPlan(t.database, t.ws, t.eventId))!;
    expect(after.lines.flatMap((l) => l.items)).toEqual([expect.objectContaining({ name: 'Fish dinner', bought: false })]);
  });
});

describe('words', () => {
  it('makes initials and split text', () => {
    expect(initialsOf('Rina Sari')).toBe('RS');
    expect(initialsOf('  andi ')).toBe('A');
    expect(splitText({ mode: 'equal', people: ['a', 'b', 'c'] })).toBe('Equal · 3 people');
    expect(splitText({ mode: 'amounts', shares: [{ personId: 'a', minor: 1 }] })).toBe('By amount · 1 person');
  });
});
```

Figures for the test, worked by hand: dinner €90 → 94,500 each for Rina, Andi, Budi (paid 283,500 by Rina); market 180,000 TRY → 90,000 each for Rina and Budi (paid by Budi); boat 60,000 TRY → 30,000 each for Andi and Dewi (paid by Andi). Rina: 283,500 − 94,500 − 90,000 = 99,000. Andi: 60,000 − 94,500 − 30,000 = −64,500. Budi: 180,000 − 94,500 − 90,000 = −4,500. Dewi: −30,000. Sum 0.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/db && npx vitest run test/shared-event-reads.test.ts`
Expected: FAIL — `sharedEventView` is not exported.

- [ ] **Step 3: Write the reads**

`packages/db/src/repos/shared-event-reads.ts`:

```ts
import { balances, expenseInEvent, fewestPayments, sharesOf, type SplitInput, type SuggestedPayment, toEvent } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import type { ChangeSet } from '../sync/types';
import type { EventUnposted } from './shared-event-postings';
import { type EventBookRow, eventBookOfEventTx, eventRecordsTx } from './shared-event-records';

/*
 * What the screens read of a shared event (shared events §6, §7). Figures are in the event currency unless a field
 * says otherwise; "my" is this phone's person, named on every screen and never called "you".
 */

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

export function splitText(split: SplitInput): string {
  const count = split.mode === 'equal' ? split.people.length : split.shares.length;
  return `${split.mode === 'equal' ? 'Equal' : 'By amount'} · ${count} ${count === 1 ? 'person' : 'people'}`;
}

export interface SharedPersonView {
  personId: string;
  name: string;
  initials: string;
  hasApp: boolean;
  isMe: boolean;
  removed: boolean;
  balanceMinor: number;
}

export interface RecordPostingView {
  transactionId: string | null;
  unposted: EventUnposted | null;
  /** "Changed by Andi": who last changed the record when it was not this phone's person. */
  changedByName: string | null;
  /** The currency of the account this phone's person paid it from or received it into, when one is kept here (R5). */
  accountCurrency: string | null;
}

export interface SharedExpenseView {
  expenseId: string;
  occurredOn: string;
  amountMinor: number;
  currency: string;
  rateToEvent: string;
  eventAmountMinor: number;
  payerPersonId: string;
  payerName: string;
  /** Paid from an account in the app: its money is its payer's member's alone (D8). */
  payerHasAccount: boolean;
  categoryId: string | null;
  categoryName: string | null;
  note: string | null;
  split: SplitInput;
  splitText: string;
  /** This phone's person's share in the expense's own currency, and in the event currency. */
  myShareMinor: number;
  myShareEventMinor: number;
  voided: boolean;
  /** Still in this phone's outbox: "Not sent yet" (§7). */
  unsent: boolean;
  /** Its amount, currency, rate, date and delete are another member's alone. */
  payerOnly: boolean;
  posting: RecordPostingView | null;
}

export interface SharedSettlementView {
  settlementId: string;
  occurredOn: string;
  fromPersonId: string;
  fromName: string;
  toPersonId: string;
  toName: string;
  amountMinor: number;
  voided: boolean;
  unsent: boolean;
  /** This phone's person paid or received it. */
  mine: boolean;
  posting: RecordPostingView | null;
}

export interface NamedPayment extends SuggestedPayment {
  fromName: string;
  toName: string;
}

export interface SharedEventView {
  eventId: string;
  bookId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  currency: string;
  finishedAt: string | null;
  state: string;
  me: string;
  myName: string;
  people: SharedPersonView[];
  categories: { categoryId: string; name: string; icon: string | null; archived: boolean }[];
  expenses: SharedExpenseView[];
  settlements: SharedSettlementView[];
  spentMinor: number;
  myShareMinor: number;
  payments: NamedPayment[];
  /** Records not in this phone's books, and why (R6). */
  waiting: { recordId: string; kind: 'expense' | 'settlement'; reason: EventUnposted }[];
  /** The currency can no longer change: something is spent. */
  currencyLocked: boolean;
}

/** The record ids whose ops still wait in this phone's outbox for the event's book. */
async function unsentIdsTx(db: Db, bookId: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const [json] of await db.values<[string]>(sql`SELECT entry_json FROM sync_outbox WHERE book_id = ${bookId}`)) {
    for (const op of (JSON.parse(json) as ChangeSet).ops) out.add(op.id);
  }
  return out;
}

async function postingsTx(db: Db, bookId: string, names: Map<string, string>): Promise<Map<string, RecordPostingView>> {
  const rows = await db.values<[string, string | null, string | null, string | null, string | null]>(sql`
    SELECT p.record_id, p.transaction_id, p.unposted, p.changed_by, a.currency FROM event_postings p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.book_id = ${bookId}`);
  return new Map(
    rows.map(([id, transactionId, unposted, changedBy, accountCurrency]) => [
      id,
      { transactionId, unposted: unposted as EventUnposted | null, changedByName: changedBy ? (names.get(changedBy) ?? null) : null, accountCurrency },
    ]),
  );
}

const named = (payments: SuggestedPayment[], names: Map<string, string>): NamedPayment[] =>
  payments.map((p) => ({ fromPersonId: p.fromPersonId, fromName: names.get(p.fromPersonId) ?? 'Someone', toPersonId: p.toPersonId, toName: names.get(p.toPersonId) ?? 'Someone', amountMinor: p.amountMinor }));

async function viewOfTx(db: Db, book: EventBookRow): Promise<SharedEventView> {
  const { expenses, settlements, people } = await eventRecordsTx(db, book.bookId);
  const names = new Map(people.map((p) => [p.personId, p.name]));
  const owed = balances(expenses, settlements, book.currency, people.map((p) => p.personId));
  const unsent = await unsentIdsTx(db, book.bookId);
  const postings = await postingsTx(db, book.bookId, names);
  const categories = (
    await db.values<[string, string, string | null, string | null]>(sql`SELECT id, name, icon, archived_at FROM event_categories WHERE book_id = ${book.bookId} ORDER BY sort_order, name`)
  ).map(([categoryId, name, icon, archivedAt]) => ({ categoryId, name, icon, archived: archivedAt !== null }));
  const categoryName = new Map(categories.map((c) => [c.categoryId, c.name]));
  let spentMinor = 0;
  let myShareMinor = 0;
  const expenseViews: SharedExpenseView[] = expenses.map((e) => {
    const { paidMinor } = expenseInEvent(e, book.currency);
    const mine = sharesOf(e).find((s) => s.personId === book.me)?.minor ?? 0;
    const mineInEvent = mine === 0 ? 0 : toEvent(mine, e.currency, e.rateToEvent, book.currency);
    if (!e.voided) {
      spentMinor += paidMinor;
      myShareMinor += mineInEvent;
    }
    return {
      expenseId: e.id,
      occurredOn: e.occurredOn,
      amountMinor: e.amountMinor,
      currency: e.currency,
      rateToEvent: e.rateToEvent,
      eventAmountMinor: paidMinor,
      payerPersonId: e.payerPersonId,
      payerName: names.get(e.payerPersonId) ?? 'Someone',
      payerHasAccount: e.payerMemberId !== null,
      categoryId: e.categoryId,
      categoryName: e.categoryId ? (categoryName.get(e.categoryId) ?? null) : null,
      note: e.note,
      split: e.split,
      splitText: splitText(e.split),
      myShareMinor: mine,
      myShareEventMinor: mineInEvent,
      voided: e.voided,
      unsent: unsent.has(e.id),
      payerOnly: e.payerMemberId !== null && e.payerMemberId !== book.me,
      posting: postings.get(e.id) ?? null,
    };
  });
  const settlementViews: SharedSettlementView[] = settlements.map((s) => ({
    settlementId: s.id,
    occurredOn: s.occurredOn,
    fromPersonId: s.fromPersonId,
    fromName: names.get(s.fromPersonId) ?? 'Someone',
    toPersonId: s.toPersonId,
    toName: names.get(s.toPersonId) ?? 'Someone',
    amountMinor: s.amountMinor,
    voided: s.voided,
    unsent: unsent.has(s.id),
    mine: s.fromPersonId === book.me || s.toPersonId === book.me,
    posting: postings.get(s.id) ?? null,
  }));
  const waiting = [...postings]
    .filter(([, p]) => p.unposted !== null)
    .map(([recordId, p]) => ({ recordId, kind: (expenses.some((e) => e.id === recordId) ? 'expense' : 'settlement') as 'expense' | 'settlement', reason: p.unposted! }));
  return {
    eventId: book.eventId,
    bookId: book.bookId,
    name: book.name,
    startsOn: book.startsOn,
    endsOn: book.endsOn,
    currency: book.currency,
    finishedAt: book.finishedAt,
    state: book.state,
    me: book.me,
    myName: names.get(book.me) ?? 'Someone',
    people: people.map((p) => ({ personId: p.personId, name: p.name, initials: initialsOf(p.name), hasApp: p.memberId !== null, isMe: p.personId === book.me, removed: p.removedAt !== null, balanceMinor: owed[p.personId] ?? 0 })),
    categories,
    expenses: expenseViews,
    settlements: settlementViews,
    spentMinor,
    myShareMinor,
    payments: named(fewestPayments(owed), names),
    waiting,
    currencyLocked: expenses.length > 0,
  };
}

export async function sharedEventView(database: Database, ws: WorkspaceContext, eventId: string): Promise<SharedEventView | null> {
  const book = await eventBookOfEventTx(database.db, eventId).catch(() => null);
  if (!book || book.workspaceId !== ws.workspaceId) return null;
  return viewOfTx(database.db, book);
}

export interface SharedEventSummary {
  eventId: string;
  /** The others in the event, by name: the initials the events list draws. */
  people: { name: string; initials: string }[];
  sharedWith: number;
}

/** Every shared event of this workspace, by its local event id, for the events list. */
export async function sharedEventSummaries(database: Database, ws: WorkspaceContext): Promise<Record<string, SharedEventSummary>> {
  const out: Record<string, SharedEventSummary> = {};
  const rows = await database.db.values<[string, string, string]>(sql`
    SELECT e.event_id, e.book_id, s.member_id FROM event_books e JOIN shared_books s ON s.book_id = e.book_id WHERE e.workspace_id = ${ws.workspaceId}`).catch(() => []);
  for (const [eventId, bookId, me] of rows) {
    const people = (
      await database.db.values<[string]>(sql`SELECT name FROM event_people WHERE book_id = ${bookId} AND id <> ${me} AND removed_at IS NULL ORDER BY name, id`)
    ).map(([name]) => ({ name, initials: initialsOf(name) }));
    out[eventId] = { eventId, people, sharedWith: people.length };
  }
  return out;
}

export interface EventBalanceRow {
  eventId: string;
  name: string;
  currency: string;
  /** The trip balance in this phone's books: positive, the group owes this person. */
  balanceMinor: number;
  /** The suggested payments this person is in. */
  payments: NamedPayment[];
}

/** The Debts page's trips (spec §5): each shared event with a balance here or a payment this person is in. */
export async function eventBalanceRows(database: Database, ws: WorkspaceContext): Promise<EventBalanceRow[]> {
  const out: EventBalanceRow[] = [];
  const events = await database.db.values<[string]>(sql`SELECT event_id FROM event_books WHERE workspace_id = ${ws.workspaceId}`).catch(() => []);
  for (const [eventId] of events) {
    const book = await eventBookOfEventTx(database.db, eventId);
    if (!book) continue;
    const view = await viewOfTx(database.db, book);
    const [held] = await database.db.values<[number]>(sql`
      SELECT coalesce(sum(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE e.account_id = ${book.balanceAccountId} AND t.status = 'posted'`);
    const payments = view.payments.filter((p) => p.fromPersonId === book.me || p.toPersonId === book.me);
    const balanceMinor = Number(held?.[0] ?? 0);
    if (balanceMinor !== 0 || payments.length > 0) out.push({ eventId, name: book.name, currency: book.currency, balanceMinor, payments });
  }
  return out;
}
```

- [ ] **Step 4: Write the shared plan**

`packages/db/src/repos/shared-event-plan.ts`:

```ts
import { type EventPlan, eventPlan, expenseInEvent, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { withCapture } from '../sync/capture';
import { tidyLink } from './event-items';
import { eventBookOfEventTx, eventRecordsTx } from './shared-event-records';
import { openSharedEventTx, SharedEventDbError } from './shared-event-writes';

/*
 * The shared plan (shared events D7): the same list of things to buy an event has always had — a name, how many, a
 * price each, a category — but in the event currency and in the event's book, so everyone sees it, ticks it and buys
 * from it. An item is answered by an expense (not a transaction) and its share of it, so `eventPlan` reads it exactly as
 * it reads a local plan, with expense ids where transaction ids were.
 */

export interface SharedItemInput {
  id?: string;
  name: string;
  quantity: number;
  /** In the event currency. */
  unitPriceMinor: number;
  categoryId: string | null;
  link: string | null;
  note: string | null;
}

const invalid = (message: string) => new SharedEventDbError('INVALID', message);

export async function saveSharedItem(database: Database, ws: WorkspaceContext, eventId: string, input: SharedItemInput): Promise<string> {
  const id = input.id ?? uuidv7();
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const name = input.name.trim();
    if (!name) throw invalid('Name the thing to buy');
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw invalid('How many is a whole number above nought');
    if (!Number.isSafeInteger(input.unitPriceMinor) || input.unitPriceMinor <= 0) throw invalid('Enter a price above nought');
    const link = tidyLink(input.link);
    await withCapture(tx, { entity: 'event_item', id, bookId: book.bookId }, () =>
      tx.run(sql`
        INSERT INTO event_items_shared (book_id, id, name, quantity, unit_price_minor, category_id, link, note, expense_id, share_minor, sort_order)
        VALUES (${book.bookId}, ${id}, ${name}, ${input.quantity}, ${input.unitPriceMinor}, ${input.categoryId}, ${link}, ${input.note?.trim() || null}, NULL, NULL,
                (SELECT coalesce(max(sort_order), 0) + 1 FROM event_items_shared WHERE book_id = ${book.bookId}))
        ON CONFLICT (book_id, id) DO UPDATE SET name = excluded.name, quantity = excluded.quantity, unit_price_minor = excluded.unit_price_minor,
          category_id = excluded.category_id, link = excluded.link, note = excluded.note`),
    );
  });
  return id;
}

export async function removeSharedItem(database: Database, ws: WorkspaceContext, eventId: string, itemId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    await withCapture(tx, { entity: 'event_item', id: itemId, bookId: book.bookId }, () => tx.run(sql`DELETE FROM event_items_shared WHERE book_id = ${book.bookId} AND id = ${itemId}`));
  });
}

/** The tick: this item was bought by that expense, at this share of it (event currency); null takes it back off. */
export async function linkSharedItem(database: Database, ws: WorkspaceContext, eventId: string, itemId: string, link: { expenseId: string; shareMinor: number } | null): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    if (link) {
      const expense = (await eventRecordsTx(tx, book.bookId)).expenses.find((e) => e.id === link.expenseId && !e.voided);
      if (!expense) throw invalid('That expense was deleted');
      const { paidMinor } = expenseInEvent(expense, book.currency);
      if (!Number.isSafeInteger(link.shareMinor) || link.shareMinor <= 0 || link.shareMinor > paidMinor) throw invalid('The share is above nought and no more than the expense');
    }
    await withCapture(tx, { entity: 'event_item', id: itemId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_items_shared SET expense_id = ${link?.expenseId ?? null}, share_minor = ${link?.shareMinor ?? null} WHERE book_id = ${book.bookId} AND id = ${itemId}`),
    );
  });
}

/** The plan against what was spent, through `eventPlan`, in the event currency. Null for an event that is not shared. */
export async function sharedEventPlan(database: Database, ws: WorkspaceContext, eventId: string): Promise<EventPlan | null> {
  const book = await eventBookOfEventTx(database.db, eventId).catch(() => null);
  if (!book || book.workspaceId !== ws.workspaceId) return null;
  const { expenses } = await eventRecordsTx(database.db, book.bookId);
  const categories = await database.db.values<[string, string]>(sql`SELECT id, name FROM event_categories WHERE book_id = ${book.bookId}`);
  const items = await database.db.values<[string, string, number, number, string | null, string | null, string | null, string | null, number | null]>(sql`
    SELECT id, name, quantity, unit_price_minor, category_id, link, note, expense_id, share_minor FROM event_items_shared WHERE book_id = ${book.bookId} ORDER BY sort_order, id`);
  return eventPlan({
    items: items.map(([id, name, quantity, unitPriceMinor, categoryId, link, note, expenseId, shareMinor]) => ({
      id,
      name,
      quantity: Number(quantity),
      unitPriceMinor: Number(unitPriceMinor),
      categoryId,
      link,
      note,
      purchase: expenseId && shareMinor !== null ? { transactionId: expenseId, shareMinor: Number(shareMinor) } : null,
    })),
    actuals: expenses
      .filter((e) => !e.voided)
      .map((e) => ({ transactionId: e.id, occurredOn: e.occurredOn, description: e.note ?? 'Shared spending', categoryId: e.categoryId ?? '', amountBaseMinor: expenseInEvent(e, book.currency).paidMinor })),
    categoryNames: Object.fromEntries(categories),
  });
}
```

- [ ] **Step 5: Export**

In `packages/db/src/index.ts`, after `export * from './repos/shared-event-writes';` add:

```ts
export * from './repos/shared-event-reads';
export * from './repos/shared-event-plan';
```

- [ ] **Step 6: Run the tests and the db suite**

Run: `cd packages/db && npx vitest run test/shared-event-reads.test.ts && cd ../.. && npm run test -w @expanses/db && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repos/shared-event-reads.ts packages/db/src/repos/shared-event-plan.ts packages/db/src/index.ts packages/db/test/shared-event-reads.test.ts
git commit -m "$(cat <<'EOF'
Reading a shared event: header, rows, balances, the fewest payments by name, what is not sent yet, the events list and the Debts page; and a plan everyone shares

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The event's relay book — share, invite, join and claim a name, leave, remove a person with the app

Spec §3 ("its own relay book, made the way `openGroupLog` makes the net-worth group log… Joining uses the household invite link (`cicis://join/…`) and its claim flow, pointed at the event's relay book"), §6 (Joining: "I'm Budi" or a new name), §7 (claim once, leave at zero with rotation, remove at zero, lost phone, app version), rulings R1, R9, R10.

**Files:**
- Create: `packages/db/src/sync/events/event-log.ts`
- Create: `packages/db/src/sync/events/version.ts`
- Modify: `packages/db/src/sync/invite.ts` (`InvitePreview.event`, `EventInviteDetails`)
- Modify: `packages/db/src/sync/seed.ts` (`SharingErrorCode` gains `'NAME_TAKEN' | 'APP_OUTDATED' | 'NOT_SETTLED' | 'LAST_MEMBER'`)
- Modify: `packages/db/src/sync/engine.ts` (`createInvite` reads an event book's subject; `shareEvent`, `createEventInvite`, `joinEvent`, `leaveEvent`, `removeEventMember`, `eventHost`)
- Modify: `packages/db/src/repos/sharing.ts` (`SharedBookSummary.kind: 'workspace' | 'event'`)
- Modify: `apps/web/package.json` (`"version": "0.4.0"`, R10)
- Test: `packages/db/test/sync/trip.ts` (helper)
- Test: `packages/db/test/sync/shared-events-join.test.ts`

**Interfaces:**
- Consumes: Task 4 (`everyMemberOwns` admission as owner, `bookContextTx` for event books); Task 5 (`openEventBookTx`, `eventBookTx`, `eventBookOfEventTx`, `eventRecordsTx`); Task 6 (`personRefusalTx`, `removeEventPerson`, `SharedEventDbError`, and `recordSharedExpense` in tests); `rowUpsertsTx`, `writeChangeSetsTx`, `withCapture`, `viewDevice`, `viewActiveDevices`; `eventOf` (event-scope.ts).
- Produces:
  - `interface EventInviteDetails { name: string; startsOn: string; endsOn: string; currency: string; people: { personId: string; name: string; claimed: boolean }[]; minAppVersion: string }` (invite.ts); `InvitePreview.event?: EventInviteDetails` — `PreviewedInvite` carries it to the screens.
  - `SHARED_EVENTS_MIN_APP_VERSION = '0.4.0'`, `meetsVersion(have: string | null, want: string): boolean` (version.ts)
  - On `SyncEngine`:
    - `shareEvent(ws: WorkspaceContext, input: { eventId: string; currency: string; personName: string; deviceName: string; names?: readonly string[] }): Promise<{ bookId: string; personId: string }>`
    - `createEventInvite(bookId: string, input: { inviterName: string; forPersonId?: string }): Promise<CreatedInvite>` — `forPersonId` makes a same-member invite: a person's new phone (§7 Lost phone)
    - `joinEvent(code: string, input: { ws: WorkspaceContext; personId: string | null; name: string; deviceName: string }): Promise<{ bookId: string; eventId: string; personId: string; result: SyncOnceResult }>`
    - `leaveEvent(bookId: string): Promise<void>`
    - `removeEventMember(ws: WorkspaceContext, eventId: string, personId: string): Promise<void>` — any person: a name (Task 6's rule) or a person with the app (their devices removed first)
  - `SharedBookSummary.kind: 'workspace' | 'event'` from `listSharedBooks`.

- [ ] **Step 1: Write the test helper**

`packages/db/test/sync/trip.ts`:

```ts
import { saveEvent, ownerScope, upsertRate } from '../../src/index';
import { Household, type Device } from './household';

/*
 * A shared event among devices on one in-memory relay (shared events §3): real keys, real invites and claims, real
 * sealing — `Household`'s devices, but sharing an event instead of a workspace. Invented rates on every device:
 * 1 EUR = 17,000 IDR, 1 TRY = 560 IDR, from 1 October 2026.
 */
export class Trip {
  readonly home = new Household();
  bookId = '';
  private readonly events = new Map<Device, string>();

  async device(name: string, appVersion = '0.4.0'): Promise<Device> {
    const device = await this.home.device(name, `workspace-${name}`, 'IDR', appVersion);
    for (const [from, rate] of [['EUR', 17_000], ['TRY', 560]] as const) {
      await upsertRate(device.database, { fromCurrency: from, toCurrency: 'IDR', onDate: '2026-10-01', rate, source: 'manual', sourceDate: '2026-10-01' });
    }
    return device;
  }

  /** `owner` makes "Coast week" in lira and shares it, with these names for people without the app. */
  async share(owner: Device, names: string[] = [], currency = 'TRY'): Promise<string> {
    const eventId = await saveEvent(owner.database, ownerScope(owner.ws), { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
    const { bookId } = await owner.engine.shareEvent(owner.ws, { eventId, currency, personName: owner.name, deviceName: `${owner.name}'s phone`, names });
    this.bookId = bookId;
    this.events.set(owner, eventId);
    return bookId;
  }

  /** `joiner` joins on an invite from `inviter`, claiming the name `claim` or adding its own. */
  async join(joiner: Device, inviter: Device, claim: string | null = null, code?: string): Promise<void> {
    const invite = code ?? (await inviter.engine.createEventInvite(this.bookId, { inviterName: inviter.name })).code;
    const preview = await joiner.engine.previewInvite(invite);
    const personId = claim ? preview.event!.people.find((p) => p.name === claim)!.personId : null;
    const { eventId } = await joiner.engine.joinEvent(invite, { ws: joiner.ws, personId, name: claim ?? joiner.name, deviceName: `${joiner.name}'s phone` });
    this.events.set(joiner, eventId);
  }

  eventOf(device: Device): string {
    return this.events.get(device)!;
  }

  /** Every device drains, then every device pulls, three times over: nothing is left in flight. */
  async settle(devices: readonly Device[] = this.home.devices): Promise<void> {
    for (let round = 0; round < 3; round += 1) for (const d of devices) await d.engine.syncOnce(this.bookId);
  }
}
```

- [ ] **Step 2: Write the failing tests**

`packages/db/test/sync/shared-events-join.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listSharedBooks, recordSharedExpense, voidSharedExpense } from '../../src/index';
import type { Device } from './household';
import { Trip } from './trip';

/*
 * An event's own relay book (shared events §3, §6, §7): Rina shares "Coast week" with Budi as a name; Andi joins with
 * his own name; Budi installs the app and claims his. Each step is the real invite, claim and pull.
 */

/** The event's people on one phone: each name, and whether it has the app (1) or not (0). */
const people = (d: Device, bookId: string) =>
  d.database.db.values<[string, number]>(sql`SELECT name, member_id IS NOT NULL FROM event_people WHERE book_id = ${bookId} AND removed_at IS NULL ORDER BY name`);

describe('sharing and joining an event', () => {
  it('Andi joins as himself and Budi claims his name; every phone holds the same people, its own event and trip balance', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    const budi = await trip.device('Budi');
    const bookId = await trip.share(rina, ['Budi']);
    await trip.join(andi, rina);
    await trip.join(budi, andi, 'Budi'); // any member invites: every member owns the event's book
    await trip.settle();
    for (const d of [rina, andi, budi]) {
      expect(await people(d, bookId)).toEqual([['Andi', 1], ['Budi', 1], ['Rina', 1]]);
      const [event] = await d.database.db.values<[string, string]>(sql`SELECT e.name, a.currency FROM event_books b JOIN events e ON e.id = b.event_id JOIN accounts a ON a.id = b.balance_account_id WHERE b.book_id = ${bookId}`);
      expect(event).toEqual(['Coast week', 'TRY']);
      expect(await d.database.db.values(sql`SELECT entity, error FROM sync_skipped WHERE book_id = ${bookId}`)).toEqual([]);
    }
    // Budi's member is his person (R1).
    const [budiPerson] = await budi.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`);
    expect(await rina.database.db.values(sql`SELECT name FROM event_people WHERE book_id = ${bookId} AND id = ${budiPerson![0]}`)).toEqual([['Budi']]);
    expect((await listSharedBooks(rina.database)).find((b) => b.bookId === bookId)?.kind).toBe('event');
  });

  it('seals the people into the preview, and a currency an older build refuses before it claims anything (R10)', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    await trip.share(rina, ['Budi']);
    const { code } = await rina.engine.createEventInvite(trip.bookId, { inviterName: 'Rina' });
    const preview = await andi.engine.previewInvite(code);
    expect(preview.baseCurrency).toBe('XXX');
    expect(preview.event).toMatchObject({ name: 'Coast week', currency: 'TRY', minAppVersion: '0.4.0' });
    expect(preview.event!.people.map((p) => [p.name, p.claimed])).toEqual([['Budi', false], ['Rina', true]]);
    await expect(andi.engine.joinBook(code, { ws: andi.ws, memberName: 'Andi', deviceName: 'phone' })).rejects.toMatchObject({ code: 'CURRENCY' });
    expect((await andi.engine.previewInvite(code)).claimed).toBe(false);
  });

  it('refuses a build below the minimum before claiming', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const old = await trip.device('Old', '0.3.0');
    await trip.share(rina);
    const { code } = await rina.engine.createEventInvite(trip.bookId, { inviterName: 'Rina' });
    await expect(old.engine.joinEvent(code, { ws: old.ws, personId: null, name: 'Old', deviceName: 'phone' })).rejects.toMatchObject({ code: 'APP_OUTDATED' });
    expect((await old.engine.previewInvite(code)).claimed).toBe(false);
  });

  it('a name is claimed once: of two phones claiming Budi on invites made together, the second is refused and leaves nothing behind', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const budi = await trip.device('Budi');
    const impostor = await trip.device('Other');
    await trip.share(rina, ['Budi']);
    const first = (await rina.engine.createEventInvite(trip.bookId, { inviterName: 'Rina' })).code;
    const second = (await rina.engine.createEventInvite(trip.bookId, { inviterName: 'Rina' })).code;
    await trip.join(budi, rina, 'Budi', first);
    await expect(trip.join(impostor, rina, 'Budi', second)).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    expect(await impostor.database.db.values(sql`SELECT 1 FROM event_books`)).toEqual([]);
    expect(await impostor.database.db.values(sql`SELECT 1 FROM shared_books`)).toEqual([]);
    await trip.settle([rina, budi]);
    expect(await people(rina, trip.bookId)).toEqual([['Budi', 1], ['Rina', 1]]);
  });
});

describe('leaving and removing (D9)', () => {
  it('Andi cannot leave while he owes; at zero he leaves, his own books keep the event, and Rina’s phone rotates the key', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    await trip.share(rina);
    await trip.join(andi, rina);
    await trip.settle([rina, andi]);
    const [andiPerson] = await andi.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    const [rinaPerson] = await rina.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    const dinner = await recordSharedExpense(rina.database, rina.ws, trip.eventOf(rina), {
      occurredOn: '2026-10-06', amountMinor: 60_000, currency: 'TRY', rateToEvent: '1', payerPersonId: rinaPerson![0],
      paidFrom: { accountId: rina.bank, chargedMinor: 336_000 }, split: { mode: 'equal', people: [rinaPerson![0], andiPerson![0]] }, categoryId: null, note: 'Dinner',
    });
    await trip.settle([rina, andi]);
    await expect(andi.engine.leaveEvent(trip.bookId)).rejects.toMatchObject({ code: 'NOT_SETTLED', message: expect.stringContaining('Andi') });
    await voidSharedExpense(rina.database, rina.ws, trip.eventOf(rina), dinner);
    await trip.settle([rina, andi]);
    await andi.engine.leaveEvent(trip.bookId);
    await trip.settle([rina]);
    expect(await andi.database.db.values(sql`SELECT state FROM shared_books WHERE book_id = ${trip.bookId}`)).toEqual([['unshared']]);
    expect(await andi.database.db.values(sql`SELECT 1 FROM event_books WHERE book_id = ${trip.bookId}`)).toEqual([[1]]);
    expect(await rina.database.db.values(sql`SELECT epoch FROM shared_books WHERE book_id = ${trip.bookId}`)).toEqual([[2]]);
  });

  it('Rina removes Andi, who has the app, at zero and in no record: his devices go and his name is marked removed', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    await trip.share(rina);
    await trip.join(andi, rina);
    await trip.settle([rina, andi]);
    const [andiPerson] = await andi.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    await rina.engine.removeEventMember(rina.ws, trip.eventOf(rina), andiPerson![0]);
    await trip.settle([rina, andi]);
    expect(await rina.database.db.values(sql`SELECT removed_at IS NOT NULL FROM event_people WHERE book_id = ${trip.bookId} AND id = ${andiPerson![0]}`)).toEqual([[1]]);
    expect(await andi.database.db.values(sql`SELECT state FROM shared_books WHERE book_id = ${trip.bookId}`)).toEqual([['unshared']]);
  });

  it('a person’s new phone joins as the same person on an invite made for them (§7 Lost phone)', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    const andiNew = await trip.device('Andi');
    await trip.share(rina);
    await trip.join(andi, rina);
    await trip.settle([rina, andi]);
    const [andiPerson] = await andi.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    const { code } = await rina.engine.createEventInvite(trip.bookId, { inviterName: 'Rina', forPersonId: andiPerson![0] });
    await andiNew.engine.joinEvent(code, { ws: andiNew.ws, personId: null, name: 'Andi', deviceName: 'new phone' });
    await trip.settle([rina, andiNew]);
    expect(await andiNew.database.db.values(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`)).toEqual([[andiPerson![0]]]);
    expect(await people(andiNew, trip.bookId)).toEqual([['Andi', 1], ['Rina', 1]]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/db && npx vitest run test/sync/shared-events-join.test.ts`
Expected: FAIL — `owner.engine.shareEvent is not a function`.

- [ ] **Step 4: The version gate and the preview's event**

`packages/db/src/sync/events/version.ts`:

```ts
/*
 * Shared events need every phone in on them to know the seven entities (shared events §7, "App version"; ruling R10).
 * A joiner below this version is refused before it claims anything; a build that predates events altogether refuses the
 * invite itself, by its preview's currency ('XXX').
 */

/** The lowest app version that understands shared events. */
export const SHARED_EVENTS_MIN_APP_VERSION = '0.4.0';

const segment = (parts: readonly string[], i: number) => {
  const n = Number(parts[i]);
  return Number.isFinite(n) ? n : 0;
};

/** Whether `have` is at least `want`, release segment by release segment; an unknown version never is. */
export function meetsVersion(have: string | null, want: string): boolean {
  if (have === null) return false;
  const a = have.split('.');
  const b = want.split('.');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (segment(a, i) !== segment(b, i)) return segment(a, i) > segment(b, i);
  }
  return true;
}
```

In `packages/db/src/sync/invite.ts`, add above `InvitePreview`:

```ts
/** What an invite to a shared event shows before anything is claimed (shared events §6, Joining). */
export interface EventInviteDetails {
  name: string;
  startsOn: string;
  endsOn: string;
  /** The event currency. The preview's own `baseCurrency` is 'XXX', so a build without events refuses it (ruling R10). */
  currency: string;
  /** Everyone in the event when the invite was made: "I'm Budi" picks one not yet claimed. */
  people: { personId: string; name: string; claimed: boolean }[];
  minAppVersion: string;
}
```

and add to `InvitePreview`:

```ts
  /** Set on an invite to a shared event's book rather than a workspace's. */
  event?: EventInviteDetails;
```

In `packages/db/src/sync/seed.ts`, extend `SharingErrorCode` after `| 'NOT_LEFT'`:

```ts
  // Shared events (shared events §7): a name already claimed, a build too old to join, a balance not settled, the last
  // person with the app.
  | 'NAME_TAKEN'
  | 'APP_OUTDATED'
  | 'NOT_SETTLED'
  | 'LAST_MEMBER';
```

(and remove the `;` that ended `| 'NOT_LEFT'`).

- [ ] **Step 5: Write the event log**

`packages/db/src/sync/events/event-log.ts`:

```ts
import { isSupportedCurrency, sharesOf, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../../context';
import type { Database, Tx } from '../../database';
import { eventOf } from '../../repos/event-scope';
import { eventBookOfEventTx, eventBookTx, eventRecordsTx, openEventBookTx } from '../../repos/shared-event-records';
import { personRefusalTx, removeEventPerson, SharedEventDbError } from '../../repos/shared-event-writes';
import { clearAuthorityTx, viewActiveDevices, viewDevice } from '../authority';
import { captureConfigOf, LastOwnerError, rowUpsertsTx, withCapture, writeChangeSetsTx } from '../capture';
import { randomBytes } from '../crypto';
import type { PreviewedInvite, SyncOnceResult } from '../engine';
import { type EventInviteDetails, inviteAad, inviteKeyOf, type InviteKey, openInviteJson, parseInviteCode } from '../invite';
import type { DeviceKeys } from '../keys';
import { base64UrlToBytes } from '../relay-signing';
import type { Sealer } from '../seal';
import { SharingError } from '../seed';
import { type SyncTransport, SyncTransportError } from '../types';
import { meetsVersion, SHARED_EVENTS_MIN_APP_VERSION } from './version';

/*
 * A shared event's own relay book (shared events §3): a `shared_books` row with no `books` row, made the way
 * `openGroupLog` makes the net-worth group log, but tied to no workspace — so a friend who shares no workspace with
 * anyone here can join. Joining is the household's invite and claim, pointed at this book; the preview carries the
 * event and its people, sealed, so the joiner can say "I'm Budi" before claiming anything.
 *
 * A person's id is the member id they join as (ruling R1): claiming Budi is joining as Budi's id, and the authority
 * view refuses a second introduction of the same member in log order, on every phone alike. Every member is an owner of
 * the book (`everyMemberOwns`), so any of them invites, links a new phone or removes a person.
 */

export interface EventLogHost {
  database: Database;
  transport: SyncTransport;
  device: DeviceKeys;
  sealer: Sealer;
  now: () => number;
  appVersion?: string;
  syncOnce(bookId: string): Promise<SyncOnceResult>;
  previewInvite(code: string): Promise<PreviewedInvite>;
  leave(bookId: string): Promise<void>;
  removeDevice(bookId: string, target: string): Promise<void>;
}

async function quietly(run: Promise<unknown>): Promise<void> {
  try {
    await run;
  } catch (error) {
    if (!(error instanceof SyncTransportError)) throw error;
  }
}

/** What an invite to this event book shows (the engine's `createInvite` seals it into the preview), or null. */
export async function eventInviteDetails(database: Database, bookId: string): Promise<EventInviteDetails | null> {
  const [row] = await database.db.values<[string, string, string, string]>(sql`SELECT name, starts_on, ends_on, currency FROM shared_events WHERE book_id = ${bookId}`).catch(() => []);
  if (!row) return null;
  const people = await database.db.values<[string, string, string | null]>(sql`SELECT id, name, member_id FROM event_people WHERE book_id = ${bookId} AND removed_at IS NULL ORDER BY name, id`);
  return {
    name: row[0],
    startsOn: row[1],
    endsOn: row[2],
    currency: row[3],
    people: people.map(([personId, name, memberId]) => ({ personId, name, claimed: memberId !== null })),
    minAppVersion: SHARED_EVENTS_MIN_APP_VERSION,
  };
}

export interface ShareEventInput {
  eventId: string;
  currency: string;
  /** What this person is called in the event. */
  personName: string;
  deviceName: string;
  /** People without the app, by name (D3). */
  names?: readonly string[];
}

/**
 * Shares a local event (§3): the relay book, epoch 1's key, this phone's hold on it (`openEventBookTx`: the trip
 * balance), this member as owner and this device, the event and its people, in one transaction, written into the outbox
 * as the log's first entries — this device's introduction first, so it is the creator's seed. A failure deletes the relay
 * book again, as `shareBook` does. The event's categories, plan and tagged spending are moved in afterwards
 * (`convertEventToShared`, Task 10), as ordinary captured writes.
 */
export async function shareEvent(host: EventLogHost, ws: WorkspaceContext, input: ShareEventInput): Promise<{ bookId: string; personId: string }> {
  const event = await eventOf(host.database, ownerScope(ws), input.eventId);
  if ((await host.database.db.values(sql`SELECT 1 FROM event_books WHERE event_id = ${input.eventId}`)).length > 0) throw new SharingError('ALREADY_SHARED', `${event.name} is already shared`);
  if (!isSupportedCurrency(input.currency)) throw new SharingError('CURRENCY', `Unsupported currency ${input.currency}`);
  const personName = input.personName.trim();
  if (!personName) throw new SharingError('BAD_CODE', 'Enter the name this person goes by');
  const names = [...new Set((input.names ?? []).map((n) => n.trim()).filter((n) => n && n.toLowerCase() !== personName.toLowerCase()))];
  const { bookId: relayBookId } = await host.transport.createBook(host.device.public);
  const bookId = uuidv7();
  const memberId = uuidv7();
  const key = randomBytes(32);
  const now = new Date(host.now()).toISOString();
  try {
    await host.database.transaction(async (tx) => {
      await host.sealer.storeEpochKeyTx(tx, bookId, 1, key);
      await tx.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${relayBookId}, 1, ${memberId}, 'active', ${now})`);
      await openEventBookTx(tx, ws, { bookId, eventId: input.eventId, name: event.name, currency: input.currency });
      await tx.run(sql`INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${bookId}, ${memberId}, ${personName}, 'owner', ${now})`);
      await tx.run(sql`
        INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at, app_version)
        VALUES (${bookId}, ${host.device.deviceId}, ${memberId}, ${input.deviceName}, ${JSON.stringify(host.device.public.signJwk)}, ${JSON.stringify(host.device.public.agreeJwk)}, ${now}, NULL, ${host.appVersion ?? null})`);
      await tx.run(sql`
        INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES (${bookId}, ${event.name}, ${event.startsOn}, ${event.endsOn}, ${input.currency}, ${event.finishedAt})`);
      await tx.run(sql`INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES (${bookId}, ${memberId}, ${personName}, ${memberId}, NULL)`);
      for (const name of names) await tx.run(sql`INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES (${bookId}, ${uuidv7()}, ${name}, NULL, NULL)`);
      const book = { bookId, memberId, epoch: 1 };
      const ops = [
        ...(await rowUpsertsTx(tx, book, 'member')),
        ...(await rowUpsertsTx(tx, book, 'device')).filter((op) => op.id === host.device.deviceId),
        ...(await rowUpsertsTx(tx, book, 'shared_event')),
        ...(await rowUpsertsTx(tx, book, 'event_person')),
      ];
      await writeChangeSetsTx(tx, captureConfigOf(host.database), book, ops);
    });
  } catch (error) {
    host.sealer.forget();
    await host.transport.deleteBook(relayBookId).catch(() => undefined);
    throw error;
  }
  await quietly(host.syncOnce(bookId));
  return { bookId, personId: memberId };
}

/** Everything this phone holds of an event's log, gone so a rejoin or a refused join starts from nothing (local bookkeeping kept). */
async function dropEventLogTx(tx: Tx, bookId: string): Promise<void> {
  for (const table of ['shared_events', 'event_people', 'event_categories', 'event_expenses', 'event_expense_details', 'event_settlements', 'event_items_shared', 'event_log_currency']) {
    await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId}`);
  }
  for (const table of ['sync_outbox', 'sync_cursor', 'book_epoch_keys', 'sync_field_clocks', 'sync_tombstones', 'sync_skipped', 'book_devices', 'book_members']) {
    await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId}`);
  }
  await clearAuthorityTx(tx, bookId);
}

export interface JoinEventInput {
  ws: WorkspaceContext;
  /** The name claimed ("I'm Budi"), by its person id; null to join under a new name. */
  personId: string | null;
  name: string;
  deviceName: string;
}

/**
 * Joins an event (§6 Joining): every refusal before the claim; then the claim, the keys, this phone's hold on the book
 * (a local `events` row and a trip balance), the introduction as an owner — as the claimed person's member (R1), or a
 * new one — and a pull of the whole log; then the claim of the name, or the new name, as a captured write. A phone
 * whose introduction the log refused (another phone claimed the same name a moment earlier) is taken back out and told
 * so. A phone that held the book before (a restored phone, state `needs_invite`) joins again as the person its invite
 * names, keeping its own postings.
 */
export async function joinEvent(host: EventLogHost, code: string, input: JoinEventInput): Promise<{ bookId: string; eventId: string; personId: string; result: SyncOnceResult }> {
  const preview = await host.previewInvite(code);
  const event = preview.event;
  if (!event) throw new SharingError('BAD_CODE', 'That invite is to a workspace, not an event');
  if (preview.claimed) throw new SharingError('INVITE_CLAIMED', 'Someone has already used this invite');
  if (preview.expired) throw new SharingError('INVITE_EXPIRED', 'This invite has expired');
  if (!meetsVersion(host.appVersion ?? null, event.minAppVersion)) throw new SharingError('APP_OUTDATED', `Update cicis to join ${event.name}`);
  const terms = preview.terms;
  if (!terms || terms.inviteId !== preview.inviteId) throw new SharingError('BAD_CODE', 'That invite is not complete');
  const bookId = preview.bookId;
  const [held] = await host.database.db.values<[string, string | null]>(sql`
    SELECT e.event_id, s.state FROM event_books e LEFT JOIN shared_books s ON s.book_id = e.book_id WHERE e.book_id = ${bookId}`);
  if (held && held[1] === 'active') throw new SharingError('ALREADY_SHARED', `${event.name} is already on this device`);
  if (held && !terms.sameMember) throw new SharingError('INVITE_MISMATCH', `This invite is for someone new: ask for an invite for this person's new phone`);
  let memberId: string;
  if (terms.sameMember) memberId = terms.memberId!;
  else if (input.personId) {
    const named = event.people.find((p) => p.personId === input.personId);
    if (!named || named.claimed) throw new SharingError('NAME_TAKEN', `${named?.name ?? 'That name'} already has the app`);
    memberId = input.personId;
  } else memberId = uuidv7();
  const name = (terms.sameMember ? (preview.memberName ?? input.name) : input.name).trim();
  if (!name) throw new SharingError('BAD_CODE', 'Enter the name this person goes by');

  const { inviteId, secret } = parseInviteCode(code);
  const claim = await host.transport.claimInvite(inviteId, host.device.public);
  const keys = await openInviteJson<InviteKey[]>(await inviteKeyOf(secret, inviteId), claim.keys, inviteAad('keys', inviteId));
  if (keys.length === 0) throw new SharingError('NO_KEYS', 'That invite carries no keys; ask for a new one');
  const epochs = new Set(keys.map((k) => k.epoch));
  const epoch = epochs.has(claim.epoch) ? claim.epoch : Math.max(...epochs);
  const now = new Date(host.now()).toISOString();
  host.sealer.forget();
  let eventId = held?.[0] ?? '';
  await host.database.transaction(async (tx) => {
    if (held) {
      await dropEventLogTx(tx, bookId);
      await tx.run(sql`
        INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${claim.bookId}, ${epoch}, ${memberId}, 'active', ${now})
        ON CONFLICT (book_id) DO UPDATE SET relay_book_id = excluded.relay_book_id, epoch = excluded.epoch, member_id = excluded.member_id, state = 'active', synced_at = NULL, unshared_by = NULL, unshared_reason = NULL`);
    } else {
      eventId = uuidv7();
      await tx.run(sql`
        INSERT INTO events (id, workspace_id, name, starts_on, ends_on, planned_minor, goal_id, set_id, finished_at, archived_at, created_at)
        VALUES (${eventId}, ${input.ws.workspaceId}, ${event.name}, ${event.startsOn}, ${event.endsOn}, NULL, NULL, NULL, NULL, NULL, ${now})`);
      await tx.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${claim.bookId}, ${epoch}, ${memberId}, 'active', ${now})`);
      await openEventBookTx(tx, input.ws, { bookId, eventId, name: event.name, currency: event.currency });
    }
    for (const k of keys) await host.sealer.storeEpochKeyTx(tx, bookId, k.epoch, base64UrlToBytes(k.key));
  });
  // The introduction, with the signed terms it joins on, as a change-set of its own (§8.2 step 7).
  await host.database.transaction(async (tx) => {
    const newMember = !terms.sameMember;
    if (newMember) await tx.run(sql`INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${bookId}, ${memberId}, ${name}, 'owner', ${now}) ON CONFLICT (book_id, member_id) DO NOTHING`);
    await tx.run(sql`
      INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at, app_version)
      VALUES (${bookId}, ${host.device.deviceId}, ${memberId}, ${input.deviceName}, ${JSON.stringify(host.device.public.signJwk)}, ${JSON.stringify(host.device.public.agreeJwk)}, ${now}, NULL, ${host.appVersion ?? null})
      ON CONFLICT (book_id, device_id) DO UPDATE SET member_id = excluded.member_id, name = excluded.name, added_at = excluded.added_at, removed_at = NULL, app_version = excluded.app_version`);
    const book = { bookId, memberId, epoch };
    const ops = [
      ...(await rowUpsertsTx(tx, book, 'device')).filter((op) => op.id === host.device.deviceId),
      ...(newMember ? (await rowUpsertsTx(tx, book, 'member')).filter((op) => op.id === memberId) : []),
    ];
    await writeChangeSetsTx(tx, captureConfigOf(host.database), book, ops, { invite: terms });
  });
  let result = await host.syncOnce(bookId);
  // R1: of two phones claiming one name, the log admitted the other. This one leaves nothing behind.
  if ((await host.database.transaction((tx) => viewDevice(tx, bookId, host.device.deviceId))) === null) {
    await host.database.transaction(async (tx) => {
      const book = await eventBookTx(tx, bookId);
      await dropEventLogTx(tx, bookId);
      await tx.run(sql`DELETE FROM shared_books WHERE book_id = ${bookId}`);
      await tx.run(sql`DELETE FROM event_books WHERE book_id = ${bookId}`);
      if (!held) {
        await tx.run(sql`DELETE FROM events WHERE id = ${eventId}`);
        if (book) await tx.run(sql`DELETE FROM accounts WHERE id = ${book.balanceAccountId} AND NOT EXISTS (SELECT 1 FROM entries WHERE account_id = ${book.balanceAccountId})`);
      }
    });
    throw new SharingError('NAME_TAKEN', `${name} was claimed on another phone a moment ago. Ask for a new invite.`);
  }
  if (!terms.sameMember) {
    await host.database.transaction(async (tx) => {
      const [person] = await tx.values<[string | null]>(sql`SELECT member_id FROM event_people WHERE book_id = ${bookId} AND id = ${memberId}`);
      await withCapture(tx, { entity: 'event_person', id: memberId, bookId }, async () => {
        if (!person) await tx.run(sql`INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES (${bookId}, ${memberId}, ${name}, ${memberId}, NULL)`);
        else if (person[0] === null) await tx.run(sql`UPDATE event_people SET member_id = ${memberId} WHERE book_id = ${bookId} AND id = ${memberId}`);
      });
    });
    result = await host.syncOnce(bookId);
  }
  return { bookId, eventId, personId: memberId, result };
}

/** D9: leaving needs a zero balance. This person's records stay; their devices leave and the others rotate (§7). */
export async function leaveEvent(host: EventLogHost, bookId: string): Promise<void> {
  const book = await eventBookTx(host.database.db, bookId);
  if (!book) throw new SharingError('NOT_FOUND', 'That event is not shared on this device');
  const refusal = await personRefusalTx(host.database.db, book, book.me);
  if (refusal) throw new SharingError('NOT_SETTLED', refusal.message);
  try {
    await host.leave(bookId);
  } catch (error) {
    if (error instanceof LastOwnerError) throw new SharingError('LAST_MEMBER', `${book.name} needs someone else with the app before the last one leaves`);
    throw error;
  }
}

/**
 * Removes a person (D9): at zero balance and in no record. A name without the app is Task 6's `removeEventPerson`; a
 * person with the app has their devices removed from the book first (any member may: every member owns it), and the
 * others rotate on their next sync, as they do when anyone leaves.
 */
export async function removeEventMember(host: EventLogHost, ws: WorkspaceContext, eventId: string, personId: string): Promise<void> {
  const book = await eventBookOfEventTx(host.database.db, eventId);
  if (!book || book.workspaceId !== ws.workspaceId) throw new SharingError('NOT_FOUND', 'That event is not shared on this device');
  const [person] = await host.database.db.values<[string, string | null]>(sql`SELECT name, member_id FROM event_people WHERE book_id = ${book.bookId} AND id = ${personId}`);
  if (!person) return;
  if (person[1] === null) return removeEventPerson(host.database, ws, eventId, personId);
  if (personId === book.me) throw new SharedEventDbError('INVALID', `${person[0]} leaves from the event's menu instead`);
  const refusal = await personRefusalTx(host.database.db, book, personId);
  if (refusal) throw refusal;
  const { expenses, settlements } = await eventRecordsTx(host.database.db, book.bookId);
  const named =
    expenses.some((e) => !e.voided && (e.payerPersonId === personId || sharesOf(e).some((s) => s.personId === personId))) ||
    settlements.some((s) => !s.voided && (s.fromPersonId === personId || s.toPersonId === personId));
  if (named) throw new SharedEventDbError('IN_USE', `${person[0]} is in an expense or a settle-up, so ${person[0]} stays`);
  const devices = await host.database.transaction(async (tx) => {
    const out: string[] = [];
    for (const deviceId of await viewActiveDevices(tx, book.bookId)) if ((await viewDevice(tx, book.bookId, deviceId))?.memberId === personId) out.push(deviceId);
    return out;
  });
  for (const deviceId of devices) await host.removeDevice(book.bookId, deviceId);
  await host.database.transaction((tx) =>
    withCapture(tx, { entity: 'event_person', id: personId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_people SET removed_at = ${new Date(host.now()).toISOString()} WHERE book_id = ${book.bookId} AND id = ${personId}`),
    ),
  );
  await quietly(host.syncOnce(book.bookId));
}
```

- [ ] **Step 6: Wire the engine**

In `packages/db/src/sync/engine.ts`, add `type EventInviteDetails` to the existing `./invite` import, and add:

```ts
import { eventInviteDetails, type EventLogHost, joinEvent as joinEventLog, type JoinEventInput, leaveEvent as leaveEventLog, removeEventMember as removeEventMemberLog, shareEvent as shareEventLog, type ShareEventInput } from './events/event-log';
```

In `createInvite`, replace the `books` lookup and the `preview` literal:

```ts
    const subject = await this.inviteSubject(bookId);
    if (!subject) throw new SharingError('NOT_FOUND', 'That workspace is not here');
```

```ts
    const preview: InvitePreview = {
      bookId,
      relayBookId: shared.relayBookId,
      bookName: subject.name,
      inviterName: input.inviterName,
      inviterMemberId: shared.memberId,
      ...(named ? { memberName: named[0] } : {}),
      // R10: an event's invite names no currency an older build could take, so it refuses it before claiming.
      baseCurrency: subject.event ? 'XXX' : subject.currency,
      terms,
      ...(subject.event ? { event: subject.event } : {}),
    };
```

and add, in the class:

```ts
  /** What an invite is to: a workspace's book, or a shared event's (shared events §3). */
  private async inviteSubject(bookId: string): Promise<{ name: string; currency: string; event?: EventInviteDetails } | null> {
    const [book] = await this.database.db.values<[string, string]>(sql`SELECT name, base_currency FROM books WHERE id = ${bookId}`);
    if (book) return { name: book[0], currency: book[1] };
    const event = await eventInviteDetails(this.database, bookId);
    return event ? { name: event.name, currency: event.currency, event } : null;
  }

  /* ------------------------------------------------------------- shared events */

  private eventHost(): EventLogHost {
    return {
      database: this.database,
      transport: this.transport,
      device: this.device,
      sealer: this.sealer,
      now: this.now,
      ...(this.appVersion === undefined ? {} : { appVersion: this.appVersion }),
      syncOnce: (bookId) => this.syncOnce(bookId),
      previewInvite: (code) => this.previewInvite(code),
      leave: (bookId) => this.leave(bookId),
      removeDevice: (bookId, target) => this.removeDevice(bookId, target),
    };
  }

  /** Shares a local event as its own relay book (shared events §3). */
  shareEvent(ws: WorkspaceContext, input: ShareEventInput): Promise<{ bookId: string; personId: string }> {
    return shareEventLog(this.eventHost(), ws, input);
  }

  /** An invite to an event; `forPersonId` makes it a person's new phone's (§7 Lost phone). */
  createEventInvite(bookId: string, input: { inviterName: string; forPersonId?: string }): Promise<CreatedInvite> {
    return this.createInvite(bookId, { inviterName: input.inviterName, ...(input.forPersonId ? { sameMember: true, memberId: input.forPersonId } : {}) });
  }

  joinEvent(code: string, input: JoinEventInput): Promise<{ bookId: string; eventId: string; personId: string; result: SyncOnceResult }> {
    return joinEventLog(this.eventHost(), code, input);
  }

  leaveEvent(bookId: string): Promise<void> {
    return leaveEventLog(this.eventHost(), bookId);
  }

  removeEventMember(ws: WorkspaceContext, eventId: string, personId: string): Promise<void> {
    return removeEventMemberLog(this.eventHost(), ws, eventId, personId);
  }
```

- [ ] **Step 7: Say which shared books are events**

In `packages/db/src/repos/sharing.ts`, add to `SharedBookSummary`:

```ts
  /** A workspace's book, or a shared event's (shared events §3): the sharing screens list workspaces only. */
  kind: 'workspace' | 'event';
```

and in `listSharedBooks`, before the loop read the event books once and set the kind:

```ts
  const eventBooks = new Set(
    (await database.db.values<[string]>(sql`SELECT book_id FROM event_books`).catch(() => [] as [string][])).map(([id]) => id),
  );
```

```ts
    out.push({ bookId, relayBookId, state: state as SharedBookState, memberId, members: await membersOf(database, bookId), unsharedBy, unsharedReason, kind: eventBooks.has(bookId) ? 'event' : 'workspace' });
```

- [ ] **Step 8: The app's version**

In `apps/web/package.json`, `"version": "0.3.0"` becomes `"version": "0.4.0"` (R10: a phone carries the version shared events need, and says so on its own device row).

- [ ] **Step 9: Run the tests, then the sharing suites, then everything**

Run: `cd packages/db && npx vitest run test/sync/shared-events-join.test.ts test/sync/join.test.ts test/sync/invite-owner.test.ts test/sync/group-log.test.ts`
Expected: PASS.
Run: `npm run test -w @expanses/db && npm run test -w @expanses/web && npm run typecheck`
Expected: PASS. If a web test pins `SharedBookSummary` literals, add `kind: 'workspace'` to the literal.

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/sync/events packages/db/src/sync/invite.ts packages/db/src/sync/seed.ts packages/db/src/sync/engine.ts packages/db/src/repos/sharing.ts apps/web/package.json packages/db/test/sync/trip.ts packages/db/test/sync/shared-events-join.test.ts
git commit -m "$(cat <<'EOF'
A shared event is its own relay book: shared, joined by name on the household's invite link, claimed once, left at zero, and an older build refuses it before claiming

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Apply derives each phone's lines; three phones converge

Spec §3 ("apply derives postings"), §5 ("On other phones, applying the records derives their own lines"), §7 (two edits at once, void beats edit, offline, payer's money, changes reaching my books, currency), Review Focus 2, 4 and 5 across phones.

**Files:**
- Modify: `packages/db/src/sync/apply.ts` (`applyChangeSetTx`: follow each applied event op in a savepoint of its own; own-entry branch: after the currency put-back, follow the event)
- Modify: `packages/db/src/sync/engine.ts` (`syncOnce`: an event book's sync retries what waited)
- Test: `packages/db/test/sync/shared-events-sync.test.ts`

**Interfaces:**
- Consumes: Task 4 (`EVENT_ENTITIES`, `settleEventCurrencyTx`, `eventBookWorkspaceOf`); Task 5 (`followEventOpTx`, `followSharedEventTx`, `retryUnpostedEventRecords`); Task 6 (writes, `takeOverRecords`); Task 7 (`sharedEventView`); Task 8 (`Trip`, `shareEvent`, `joinEvent`).
- Produces: no new names. Behaviour: a peer's applied event op brings this phone's own transaction in line (posted, replaced with "Changed by", voided, or waiting); a derivation the ledger refuses never rolls back the record it follows.

- [ ] **Step 1: Write the failing convergence tests**

`packages/db/test/sync/shared-events-sync.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAccount,
  editSharedExpense,
  nativeBalances,
  ownerScope,
  recordSettlement,
  recordSharedExpense,
  setSharedEventCurrency,
  sharedEventView,
  takeOverRecords,
  voidSharedExpense,
  type SharedEventView,
} from '../../src/index';
import { encodeHlc } from '../../src/sync/hlc';
import type { ChangeSet, Op } from '../../src/sync/types';
import type { Device } from './household';
import { Trip } from './trip';

/*
 * Three phones on one relay (shared events §3, §5, §7): Rina and Andi with the app, Budi as a name until he joins. Each
 * phone posts only its own share; every phone suggests the same payments; a friend's edit never moves the payer's
 * account; a void beats an edit; a record made offline goes when the phone is back. Invented rates on every phone:
 * 1 EUR = 17,000 IDR, 1 TRY = 560 IDR.
 */

interface Phone {
  device: Device;
  eventId: string;
  person: string;
  euro: string;
}

async function coastWeek() {
  const trip = new Trip();
  const rina = await trip.device('Rina');
  const andi = await trip.device('Andi');
  const budi = await trip.device('Budi');
  await trip.share(rina, ['Budi']);
  await trip.join(andi, rina);
  await trip.settle([rina, andi]);
  const phone = async (d: Device): Promise<Phone> => {
    const [person] = await d.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    const euro = await createAccount(d.database, ownerScope(d.ws), { name: `${d.name} euros`, kind: 'asset', subtype: 'cash', currency: 'EUR' });
    return { device: d, eventId: trip.eventOf(d), person: person![0], euro: euro.id };
  };
  const view = async (p: Phone): Promise<SharedEventView> => (await sharedEventView(p.device.database, ownerScope(p.device.ws), p.eventId))!;
  const personNamed = async (p: Phone, name: string) => (await view(p)).people.find((x) => x.name === name)!.personId;
  const tripBalance = async (p: Phone) => {
    const [row] = await p.device.database.db.values<[string]>(sql`SELECT balance_account_id FROM event_books WHERE book_id = ${trip.bookId}`);
    return (await nativeBalances(p.device.database, ownerScope(p.device.ws)))[row![0]] ?? 0;
  };
  return { trip, rina: await phone(rina), andi: await phone(andi), budiDevice: budi, phone, view, personNamed, tripBalance };
}

type Setup = Awaited<ReturnType<typeof coastWeek>>;

async function dinner(s: Setup) {
  const budi = await s.personNamed(s.rina, 'Budi');
  return recordSharedExpense(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, {
    occurredOn: '2026-10-06', amountMinor: 9_000, currency: 'EUR', rateToEvent: '31.5', payerPersonId: s.rina.person,
    paidFrom: { accountId: s.rina.euro, chargedMinor: null }, split: { mode: 'equal', people: [s.rina.person, s.andi.person, budi] }, categoryId: null, note: 'Fish dinner',
  });
}

async function boat(s: Setup) {
  return recordSharedExpense(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, {
    occurredOn: '2026-10-08', amountMinor: 60_000, currency: 'TRY', rateToEvent: '1', payerPersonId: s.andi.person,
    paidFrom: { accountId: s.andi.device.bank, chargedMinor: 336_000 }, split: { mode: 'equal', people: [s.rina.person, s.andi.person] }, categoryId: null, note: 'Boat',
  });
}

/** One change-set of one op, signed by `from`'s real key, straight onto the event's relay book. */
async function forge(s: Setup, from: Device, member: string, op: Op): Promise<void> {
  const [row] = await from.database.db.values<[string, number]>(sql`SELECT relay_book_id, epoch FROM shared_books WHERE book_id = ${s.trip.bookId}`);
  const cs: ChangeSet = { v: 1, hlc: encodeHlc(Date.now() + 1_000, 0, from.deviceId), member, ops: [op] };
  await from.transport.append(row![0], await from.engine.sealer.seal(s.trip.bookId, Number(row![1]), cs));
}

describe('three phones, one event', () => {
  it('each phone posts its own share, and its trip balance is its Balances line (Review Focus 2)', async () => {
    const s = await coastWeek();
    await dinner(s);
    await boat(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    for (const p of [s.rina, s.andi]) {
      const me = (await s.view(p)).people.find((x) => x.isMe)!;
      expect(await s.tripBalance(p)).toBe(me.balanceMinor);
    }
    expect(await s.tripBalance(s.rina)).toBe(189_000 - 30_000);
    expect(await s.tripBalance(s.andi)).toBe(30_000 - 94_500);
    // Andi's bank paid the boat on Andi's phone only; nothing of it on Rina's.
    expect((await nativeBalances(s.andi.device.database, ownerScope(s.andi.device.ws)))[s.andi.device.bank]).toBe(-336_000);
    expect((await nativeBalances(s.rina.device.database, ownerScope(s.rina.device.ws)))[s.rina.device.bank] ?? 0).toBe(0);
  });

  it('every phone suggests the same payments (Review Focus 4)', async () => {
    const s = await coastWeek();
    await dinner(s);
    await boat(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    expect((await s.view(s.andi)).payments).toEqual((await s.view(s.rina)).payments);
    expect((await s.view(s.rina)).payments.length).toBeGreaterThan(0);
  });

  it('a friend’s split edit replaces the payer’s posting and says who, without moving the payer’s wallet (Review Focus 5)', async () => {
    const s = await coastWeek();
    const id = await dinner(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    await editSharedExpense(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, id, { split: { mode: 'equal', people: [s.rina.person, s.andi.person] } });
    await s.trip.settle([s.rina.device, s.andi.device]);
    const rinaBooks = await nativeBalances(s.rina.device.database, ownerScope(s.rina.device.ws));
    expect(rinaBooks[s.rina.euro]).toBe(-9_000);
    expect(await s.tripBalance(s.rina)).toBe(141_750);
    expect((await s.view(s.rina)).expenses.find((e) => e.expenseId === id)!.posting!.changedByName).toBe('Andi');
    // Andi cannot touch the money of what Rina paid — not through the screen, not through a forged op.
    await expect(editSharedExpense(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, id, { amountMinor: 1 })).rejects.toMatchObject({ code: 'PAYER_ONLY' });
    await forge(s, s.andi.device, s.andi.person, { entity: 'event_expense', id, op: 'upsert', fields: { amountMinor: 1 } });
    await s.trip.settle([s.rina.device, s.andi.device]);
    expect((await nativeBalances(s.rina.device.database, ownerScope(s.rina.device.ws)))[s.rina.euro]).toBe(-9_000);
    const skipped = await s.rina.device.database.db.values<[string, string]>(sql`SELECT entity, error FROM sync_skipped WHERE book_id = ${s.trip.bookId}`);
    expect(skipped).toEqual([['event_expense', expect.stringMatching(/^AUTHORITY: only the person whose money it is/)]]);
  });

  it('a void beats an edit made at the same time', async () => {
    const s = await coastWeek();
    const id = await dinner(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    await voidSharedExpense(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, id);
    await editSharedExpense(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, id, { note: 'Fish dinner, two tables' });
    await s.trip.settle([s.rina.device, s.andi.device]);
    for (const p of [s.rina, s.andi]) {
      expect((await s.view(p)).expenses.find((e) => e.expenseId === id)!.voided).toBe(true);
      expect(await s.tripBalance(p)).toBe(0);
    }
  });

  it('Budi claims his name, takes over what was recorded as paid by him, and the books agree', async () => {
    const s = await coastWeek();
    const budiPerson = await s.personNamed(s.rina, 'Budi');
    const market = await recordSharedExpense(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, {
      occurredOn: '2026-10-07', amountMinor: 180_000, currency: 'TRY', rateToEvent: '1', payerPersonId: budiPerson, paidFrom: null,
      split: { mode: 'equal', people: [s.rina.person, budiPerson] }, categoryId: null, note: 'Market',
    });
    await s.trip.settle([s.rina.device, s.andi.device]);
    await s.trip.join(s.budiDevice, s.rina.device, 'Budi');
    await s.trip.settle([s.rina.device, s.andi.device, s.budiDevice]);
    const budi = await s.phone(s.budiDevice);
    expect((await s.view(budi)).waiting).toEqual([{ recordId: market, kind: 'expense', reason: 'choose-account' }]);
    await takeOverRecords(budi.device.database, ownerScope(budi.device.ws), budi.eventId, { accountId: budi.device.cash, recordIds: [market] });
    await s.trip.settle([s.rina.device, s.andi.device, s.budiDevice]);
    expect((await s.view(s.rina)).expenses.find((e) => e.expenseId === market)!.payerHasAccount).toBe(true);
    expect((await s.view(budi)).waiting).toEqual([]);
    expect(await s.tripBalance(budi)).toBe((await s.view(budi)).people.find((x) => x.isMe)!.balanceMinor);
  });

  it('Andi settles up in rupiah; Rina says where it arrived; both balances are zero for Andi', async () => {
    const s = await coastWeek();
    await boat(s);
    const dinnerId = await dinner(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    const owed = (await s.view(s.andi)).payments.find((p) => p.fromPersonId === s.andi.person && p.toPersonId === s.rina.person)!;
    const settlement = await recordSettlement(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, {
      occurredOn: '2026-10-12', fromPersonId: s.andi.person, toPersonId: s.rina.person, amountMinor: owed.amountMinor, account: { accountId: s.andi.device.bank, amountMinor: 361_200 },
    });
    await s.trip.settle([s.rina.device, s.andi.device]);
    expect((await s.view(s.rina)).waiting).toEqual([{ recordId: settlement, kind: 'settlement', reason: 'choose-account' }]);
    await takeOverRecords(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, { accountId: s.rina.device.bank, recordIds: [settlement] });
    await s.trip.settle([s.rina.device, s.andi.device]);
    expect((await s.view(s.rina)).people.find((x) => x.personId === s.andi.person)!.balanceMinor).toBe(0);
    expect(await s.tripBalance(s.andi)).toBe(0);
    expect(dinnerId).toBeTruthy();
  });

  it('a record made while the phone is offline waits as "Not sent yet", then reaches the others', async () => {
    const s = await coastWeek();
    const id = await boat(s); // not synced
    expect((await s.view(s.andi)).expenses.find((e) => e.expenseId === id)!.unsent).toBe(true);
    expect((await s.view(s.rina)).expenses.find((e) => e.expenseId === id)).toBeUndefined();
    await s.trip.settle([s.andi.device, s.rina.device]);
    expect((await s.view(s.andi)).expenses.find((e) => e.expenseId === id)!.unsent).toBe(false);
    expect((await s.view(s.rina)).expenses.find((e) => e.expenseId === id)).toBeDefined();
  });

  it('a currency changed on a phone that had not heard of the first expense goes back to the log’s on every phone (R8)', async () => {
    const s = await coastWeek();
    await dinner(s);
    await s.rina.device.engine.syncOnce(s.trip.bookId);
    await setSharedEventCurrency(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, 'EUR');
    await s.trip.settle([s.andi.device, s.rina.device]);
    for (const p of [s.rina, s.andi]) {
      expect(await p.device.database.db.values(sql`SELECT currency FROM shared_events WHERE book_id = ${s.trip.bookId}`)).toEqual([['TRY']]);
      expect(await p.device.database.db.values(sql`SELECT a.currency FROM event_books b JOIN accounts a ON a.id = b.balance_account_id WHERE b.book_id = ${s.trip.bookId}`)).toEqual([['TRY']]);
    }
    expect(await s.tripBalance(s.andi)).toBe(-94_500);
  });
});
```

Figures, worked by hand: the dinner €90 at 31.5 is 94,500 lira for each of three (Rina paid 283,500); the boat 600 lira is 30,000 for each of two (Andi paid). Rina 283,500 − 94,500 − 30,000 = 159,000 = 189,000 − 30,000; Andi 60,000 − 94,500 − 30,000 = −64,500 = 30,000 − 94,500. After Andi's split edit the dinner is two shares of €45: 141,750 each, so Rina's trip balance reads 141,750.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/db && npx vitest run test/sync/shared-events-sync.test.ts`
Expected: FAIL — on the first test, Andi's trip balance reads 30,000 (Andi's own boat) instead of −64,500: Rina's dinner never posted on Andi's phone.

- [ ] **Step 3: Follow each applied event op, in a savepoint of its own**

In `packages/db/src/sync/apply.ts`, add the imports:

```ts
import { EVENT_ENTITIES } from './events/authority';
import { followEventOpTx, followSharedEventTx } from '../repos/shared-event-postings';
```

Add, after `guarded`:

```ts
/**
 * Shared events §5: what a peer's applied op means for this phone's own books (`followEventOpTx`). In a savepoint of
 * its own, after the op itself: a ledger refusal here is this phone's alone — a rate, an account it no longer has — so
 * it never rolls back the record every other phone took in. The posting waits, marked, and the next retry tries again.
 */
async function followEventGuarded(tx: Tx, ctx: BookContext, entity: string, id: string, author: string | null): Promise<void> {
  const name = sql.raw(`follow_op_${(savepoints += 1)}`);
  await tx.run(sql`SAVEPOINT ${name}`);
  try {
    await followEventOpTx(tx, ctx.bookId, entity, id, author);
    await tx.run(sql`RELEASE ${name}`);
  } catch (error) {
    await tx.run(sql`ROLLBACK TO ${name}`);
    await tx.run(sql`RELEASE ${name}`);
    if (!deterministicRefusal(error)) throw error;
    await tx.run(sql`UPDATE event_postings SET unposted = 'malformed' WHERE book_id = ${ctx.bookId} AND record_id = ${id}`);
    console.warn(`sync: this phone could not post its share of ${entity} ${id}; it waits`, error);
  }
}
```

In `applyChangeSetTx`, replace the row-op `guarded` call with:

```ts
    // Who may write what (task 5 fix rounds 1–2): a refused op is a recorded skip, the same on every device.
    const skippedBefore = run.skipped.length;
    await guarded(tx, ctx, run, op, async () => {
      if (decision instanceof AuthorityError) throw decision;
      const keptBecause = op.op === 'delete' && CATEGORY_SETTINGS.has(op.entity) ? kept.get(op.id) : undefined;
      if (keptBecause) throw new SkipOp(keptBecause);
      await applyRowOp(tx, ctx, entity, op, changeSet.hlc);
      // Joint net worth §7.2 (task 8): this device's side of a transfer between partners follows its row — posted only
      // for a party, while the group is active and the author (the authority view's, never the change-set's claim) is in it.
      if (entity.entity === 'member_transfer' && op.op === 'upsert') await postTransferSideTx(tx, ctx.bookId, op.id, await authorMemberOf(tx, ctx.bookId, author));
    });
    // Shared events §5: an applied record brings this phone's own share in line, authored by the view's member.
    if (EVENT_ENTITIES.has(entity.entity) && run.skipped.length === skippedBefore) {
      await followEventGuarded(tx, ctx, entity.entity, op.id, await authorMemberOf(tx, ctx.bookId, author));
    }
```

In `pullAndApply`'s own-entry branch, replace the Task 4 put-back line with:

```ts
                  // R8: a currency change of this phone's own the log stripped is put back to the log's currency, and the
                  // event (its local row, its trip balance) follows.
                  if (eventLog && changeSet.ops.some((op) => op.entity === 'shared_event')) {
                    await settleEventCurrencyTx(tx, bookId);
                    await followSharedEventTx(tx, bookId);
                  }
```

- [ ] **Step 4: An event book's sync retries what waited**

In `packages/db/src/sync/engine.ts`, add `import { retryUnpostedEventRecords } from '../repos/shared-event-postings';` and extend the `./authority` import with `eventBookWorkspaceOf`. In `syncOnce`, right after `const result = await this.syncBook(bookId, seen);`:

```ts
    // Shared events §5: a record left waiting here (a rate, a detail not yet arrived) is tried again after the pull.
    if (!result.stopped && (await eventBookWorkspaceOf(this.database.db, bookId)) !== null) {
      try {
        await retryUnpostedEventRecords(this.database, bookId);
      } catch (error) {
        console.warn('Synced the event; a waiting share could not be posted yet', error);
      }
    }
```

- [ ] **Step 5: Run the convergence tests, then the sync property suites**

Run: `cd packages/db && npx vitest run test/sync/shared-events-sync.test.ts test/sync/shared-events-join.test.ts test/sync/convergence.property.test.ts test/sync/member-transfer.test.ts`
Expected: PASS.

- [ ] **Step 6: Run everything with the capture run and the typecheck**

Run: `npm run test -w @expanses/db && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/sync/apply.ts packages/db/src/sync/engine.ts packages/db/test/sync/shared-events-sync.test.ts
git commit -m "$(cat <<'EOF'
Every phone derives its own share as a shared event's records arrive: same balances, same suggestions, the payer's account untouched by a friend, a void beating an edit

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Moves — tagging a purchase into a shared event, and sharing an existing event

Spec §6 ("Tagging into a shared event… The transaction leaves its workspace and becomes an expense paid by this person with a 100 % own share"; "Sharing an existing event: asks once, then moves its tagged transactions the same way and turns its category set into the event's categories and its plan into shared items"), §5 ("An expense I paid from a card keeps everything a card purchase has"), D2, Review Focus 3, ruling R12.

**Files:**
- Create: `packages/db/src/repos/shared-event-moves.ts`
- Modify: `packages/db/src/index.ts` (one export line after the Task 7 lines)
- Test: `packages/db/test/shared-event-moves.test.ts`

**Interfaces:**
- Consumes: Task 5 (`ensureShareAccountTx`, `postEventRecordTx`, `rateToBaseTx`, `eventBookOfEventTx`); Task 6 (`openSharedEventTx`, `SharedEventDbError`); Task 7 (`saveSharedItem`, `linkSharedItem`); `rateString`, `convertMinor`, `splitJsonOf`; `listSetCategories`, `listEventItems`, `listTransactions`.
- Produces (exported from the index):
  - `interface MoveRefusal { transactionId: string; why: string }`
  - `moveIntoSharedEvent(database: Database, ws: WorkspaceContext, eventId: string, transactionIds: readonly string[]): Promise<{ moved: { transactionId: string; expenseId: string }[]; kept: MoveRefusal[] }>`
  - `convertEventToShared(database: Database, ws: WorkspaceContext, eventId: string): Promise<{ moved: number; kept: MoveRefusal[] }>`

- [ ] **Step 1: Write the failing tests**

`packages/db/test/shared-event-moves.test.ts`:

```ts
import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addPhoto,
  addSetCategory,
  cardSpendLines,
  convertEventToShared,
  createAccount,
  createCardAccount,
  createCategorySet,
  inBook,
  linkEventItem,
  listAccounts,
  listTransactions,
  moveIntoSharedEvent,
  openEventBookTx,
  ownerScope,
  personalBook,
  postTransaction,
  saveEvent,
  saveEventItem,
  setPostedOn,
  sharedEventPlan,
  sharedEventView,
  transferLines,
  upsertRate,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { shareBookForTest } from './sync/sync-helpers';

/*
 * Moving spending into a shared event (shared events §6, D2): the purchase leaves its workspace and becomes an expense
 * paid by this person, all theirs, without losing anything a card purchase has (Review Focus 3). Invented rates:
 * 1 TRY = 560 IDR.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function coastWeek() {
  const t = await setupDb();
  executor = t.executor;
  const ws = ownerScope(t.ws);
  const book = await personalBook(t.database, t.ws);
  const inPersonal = inBook(t.ws, book.id);
  await upsertRate(t.database, { fromCurrency: 'TRY', toCurrency: 'IDR', onDate: '2026-10-01', rate: 560, source: 'manual', sourceDate: '2026-10-01' });
  const eventId = await saveEvent(t.database, ws, { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
  const share = async () => {
    await shareBookForTest(t.database, 'ev-book', 'p-rina');
    await t.database.execScript(`
      INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
      INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', 'p-rina', 'Rina', 'p-rina', NULL);
    `);
    await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Coast week', currency: 'TRY' }));
  };
  return { ...t, ws, inPersonal, eventId, share };
}

describe('moveIntoSharedEvent', () => {
  it('keeps a card purchase’s card, MCC, channel, photo, posting date, original currency and points (Review Focus 3)', async () => {
    const t = await coastWeek();
    await t.share();
    const card = await createCardAccount(t.database, t.ws, { name: 'Travel card', subtype: 'credit_card', currency: 'IDR', last4: '4321' });
    const [cardRow] = await t.database.db.values<[string]>(sql`SELECT id FROM cards WHERE account_id = ${card.id}`);
    const restaurants = (await listAccounts(t.database, t.inPersonal)).find((a) => a.name === 'Restaurants')!;
    const purchase = await postTransaction(t.database, t.inPersonal, {
      occurredOn: '2026-10-06', description: 'Harbour grill', lines: expenseLines({ categoryAccountId: restaurants.id, paymentAccountId: card.id, amountMinor: 168_000, currency: 'IDR' }),
      cardId: cardRow![0], mcc: '5812', channel: 'offline', originalCurrency: 'TRY', originalAmountMinor: 30_000,
    });
    await addPhoto(t.database, t.ws, { transactionId: purchase, fileName: 'grill.jpg', mime: 'image/jpeg', byteSize: 1_000 });
    await setPostedOn(t.database, t.ws, purchase, '2026-10-08');
    const earning = (lines: Awaited<ReturnType<typeof cardSpendLines>>) => lines.map((l) => ({ amountMinor: l.amountMinor, categoryId: l.categoryId, mcc: l.mcc, currency: l.currency }));
    const before = earning(await cardSpendLines(t.database, t.ws, card.id, '2026-10-01', '2026-10-31'));

    const { moved, kept } = await moveIntoSharedEvent(t.database, t.ws, t.eventId, [purchase]);
    expect(kept).toEqual([]);
    const [now] = await listTransactions(t.database, t.ws, { accountId: card.id });
    expect(now!.id).not.toBe(purchase);
    expect(now).toMatchObject({ cardId: cardRow![0], mcc: '5812', channel: 'offline', photoCount: 1, originalCurrency: 'TRY', originalAmountMinor: 30_000, eventId: t.eventId });
    expect(await t.database.db.values(sql`SELECT posted_on FROM card_postings WHERE transaction_id = ${now!.id}`)).toEqual([['2026-10-08']]);
    expect(earning(await cardSpendLines(t.database, t.ws, card.id, '2026-10-01', '2026-10-31'))).toEqual(before);
    // It left the workspace (D2) and is the event's: one expense, all Rina's, paid by Rina from an account in the app.
    expect((await listTransactions(t.database, t.inPersonal)).map((v) => v.description)).not.toContain('Harbour grill');
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.expenses).toEqual([expect.objectContaining({ expenseId: moved[0]!.expenseId, amountMinor: 30_000, currency: 'TRY', payerHasAccount: true, splitText: 'Equal · 1 person', categoryName: 'Restaurants', note: 'Harbour grill' })]);
  });

  it('keeps out what cannot move, and says why', async () => {
    const t = await coastWeek();
    await t.share();
    const bank = await createAccount(t.database, t.ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const cash = await createAccount(t.database, t.ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    const transfer = await postTransaction(t.database, t.ws, { occurredOn: '2026-10-06', description: 'Top up', lines: transferLines({ fromAccountId: bank.id, toAccountId: cash.id, amountMinor: 500_000, currency: 'IDR' }) });
    const { moved, kept } = await moveIntoSharedEvent(t.database, t.ws, t.eventId, [transfer]);
    expect(moved).toEqual([]);
    expect(kept).toEqual([{ transactionId: transfer, why: 'Only a purchase from one account under one category moves into a shared event' }]);
  });
});

describe('convertEventToShared', () => {
  it('turns the set into the event’s categories, the plan into shared items in lira, and moves the tagged spending', async () => {
    const t = await coastWeek();
    const setId = await createCategorySet(t.database, t.ws, 'Trips');
    const meals = await addSetCategory(t.database, t.ws, setId, 'Meals');
    await t.database.execScript(`UPDATE events SET set_id = '${setId}' WHERE id = '${t.eventId}'`);
    const wallet = await createAccount(t.database, t.ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    const lunch = await postTransaction(t.database, t.ws, {
      occurredOn: '2026-10-07', description: 'Lunch', lines: expenseLines({ categoryAccountId: meals, paymentAccountId: wallet.id, amountMinor: 840_000, currency: 'IDR' }), eventId: t.eventId,
    });
    const item = await saveEventItem(t.database, t.ws, t.eventId, { name: 'Lunch by the sea', unitPriceMinor: 1_120_000, categoryAccountId: meals });
    await linkEventItem(t.database, t.ws, item, lunch, 840_000);
    await t.share();

    const out = await convertEventToShared(t.database, t.ws, t.eventId);
    expect(out).toEqual({ moved: 1, kept: [] });
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.categories.map((c) => c.name)).toEqual(['Meals']);
    // Rp 840,000 at 560 rupiah a lira is ₺1,500 (150,000 kuruş); the item's Rp 1,120,000 is ₺2,000.
    expect(view.expenses).toEqual([expect.objectContaining({ amountMinor: 840_000, currency: 'IDR', rateToEvent: rateOf(1, 560), categoryName: 'Meals' })]);
    const plan = (await sharedEventPlan(t.database, t.ws, t.eventId))!;
    expect(plan.lines.flatMap((l) => l.items)).toEqual([expect.objectContaining({ name: 'Lunch by the sea', unitPriceMinor: 200_000, bought: true, actualMinor: 150_000 })]);
    expect(await t.database.db.values(sql`SELECT 1 FROM book_transactions bt JOIN event_postings p ON p.transaction_id = bt.transaction_id`)).toEqual([]);
  });
});

/** The rate a move writes: IDR → TRY through the base, as `rateString(1 / 560)` writes it. */
function rateOf(from: number, to: number): string {
  return (from / to).toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/db && npx vitest run test/shared-event-moves.test.ts`
Expected: FAIL — `moveIntoSharedEvent` is not exported.

- [ ] **Step 3: Write the moves**

`packages/db/src/repos/shared-event-moves.ts`:

```ts
import { convertMinor, rateString, splitJsonOf, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { withCapture } from '../sync/capture';
import { listSetCategories } from './category-sets';
import { listEventItems } from './event-items';
import { eventOf } from './event-scope';
import { listTransactions } from './ledger';
import { saveSharedItem, linkSharedItem } from './shared-event-plan';
import { ensureShareAccountTx, postEventRecordTx, rateToBaseTx } from './shared-event-postings';
import type { EventBookRow } from './shared-event-records';
import { openSharedEventTx, SharedEventDbError } from './shared-event-writes';

/*
 * Moving spending into a shared event (shared events §6, D2). A purchase tagged into a shared event leaves its workspace:
 * only this person's share of a shared event is their spending, and a purchase moved in is all theirs — an expense paid
 * by this person, from the account it was paid from, split to them alone. The transaction is not posted again: it
 * becomes the expense's own derived transaction, replaced in place (`replaceTransactionTx`), so it keeps its card, MCC,
 * channel, photos, posting date, statement match and points (Review Focus 3), and its card earns by the category it
 * was filed under (R12).
 */

export interface MoveRefusal {
  transactionId: string;
  why: string;
}

const NOT_MOVABLE = 'Only a purchase from one account under one category moves into a shared event';

interface Movable {
  occurredOn: string;
  description: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  moneyAccountId: string;
  moneyCurrency: string;
  chargedMinor: number;
  /** The purchase's own currency and amount: the original pair when the account charged another currency. */
  currency: string;
  amountMinor: number;
}

/** A posted purchase from one money account under one category, not already a shared event's; else why not. */
async function movableTx(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<Movable | string> {
  const [head] = await tx.values<[string, string, string, string | null, number | null]>(sql`
    SELECT occurred_on, description, status, original_currency, original_amount_minor FROM transactions WHERE id = ${transactionId} AND workspace_id = ${ws.workspaceId}`);
  if (!head || head[2] !== 'posted') return 'That transaction was deleted';
  if ((await tx.values(sql`SELECT 1 FROM event_postings WHERE transaction_id = ${transactionId}`)).length > 0) return 'Already in a shared event';
  const lines = await tx.values<[string, number, string, string, string, string, string | null]>(sql`
    SELECT e.account_id, e.amount_minor, e.currency, a.kind, a.subtype, a.name, a.icon FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId}`);
  const categories = lines.filter((l) => l[3] === 'expense');
  const money = lines.filter((l) => (l[3] === 'asset' || l[3] === 'liability') && !['receivable', 'payable', 'event_balance'].includes(l[4]));
  if (categories.length !== 1 || money.length !== 1 || lines.length !== 2) return NOT_MOVABLE;
  const [category] = categories;
  const [paid] = money;
  if (Number(category![1]) <= 0) return 'A refund stays where it is';
  const original = head[3] !== null && head[4] !== null;
  return {
    occurredOn: head[0],
    description: head[1],
    categoryId: category![0],
    categoryName: category![5],
    categoryIcon: category![6],
    moneyAccountId: paid![0],
    moneyCurrency: paid![2],
    chargedMinor: -Number(paid![1]),
    currency: original ? head[3]! : category![2],
    amountMinor: original ? Number(head[4]) : Number(category![1]),
  };
}

/** The event category by this name, made (captured) when the event has none yet. */
async function eventCategoryNamedTx(tx: Db, book: EventBookRow, name: string, icon: string | null): Promise<string> {
  const [found] = await tx.values<[string]>(sql`SELECT id FROM event_categories WHERE book_id = ${book.bookId} AND lower(name) = lower(${name}) AND archived_at IS NULL ORDER BY sort_order, id LIMIT 1`);
  if (found) return found[0];
  const id = uuidv7();
  await withCapture(tx, { entity: 'event_category', id, bookId: book.bookId }, () =>
    tx.run(sql`
      INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at)
      VALUES (${book.bookId}, ${id}, ${name}, ${icon}, (SELECT coalesce(max(sort_order), 0) + 1 FROM event_categories WHERE book_id = ${book.bookId}), NULL)`),
  );
  return id;
}

/** Units of the event currency per one `currency` on the day, through the base currency; null without a rate. */
async function rateToEventTx(tx: Db, book: EventBookRow, currency: string, on: string): Promise<string | null> {
  if (currency === book.currency) return '1';
  const from = await rateToBaseTx(tx, currency, book.baseCurrency, on);
  const to = await rateToBaseTx(tx, book.currency, book.baseCurrency, on);
  return from === null || to === null ? null : rateString(from / to);
}

/**
 * Moves each purchase into the shared event, each in its own db transaction, so one that cannot move never holds the
 * others back. Returns what moved (with the expense each became) and what stayed, with why.
 */
export async function moveIntoSharedEvent(database: Database, ws: WorkspaceContext, eventId: string, transactionIds: readonly string[]): Promise<{ moved: { transactionId: string; expenseId: string }[]; kept: MoveRefusal[] }> {
  const moved: { transactionId: string; expenseId: string }[] = [];
  const kept: MoveRefusal[] = [];
  for (const transactionId of [...new Set(transactionIds)]) {
    const outcome = await database.transaction(async (tx): Promise<string | MoveRefusal> => {
      const book = await openSharedEventTx(tx, ws, eventId);
      const purchase = await movableTx(tx, ws, transactionId);
      if (typeof purchase === 'string') return { transactionId, why: purchase };
      const rateToEvent = await rateToEventTx(tx, book, purchase.currency, purchase.occurredOn);
      if (rateToEvent === null) return { transactionId, why: `No ${purchase.currency} or ${book.currency} rate for ${purchase.occurredOn} yet` };
      const categoryId = await eventCategoryNamedTx(tx, book, purchase.categoryName, purchase.categoryIcon);
      // R12: a card goes on earning by the category the purchase was filed under.
      await ensureShareAccountTx(tx, book, categoryId, purchase.categoryId);
      const expenseId = uuidv7();
      await withCapture(
        tx,
        [
          { entity: 'event_expense', id: expenseId, bookId: book.bookId },
          { entity: 'event_expense_detail', id: expenseId, bookId: book.bookId },
        ],
        async () => {
          await tx.run(sql`
            INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
            VALUES (${book.bookId}, ${expenseId}, ${purchase.occurredOn}, ${purchase.amountMinor}, ${purchase.currency}, ${rateToEvent}, ${book.me}, ${book.me}, NULL)`);
          await tx.run(sql`
            INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by)
            VALUES (${book.bookId}, ${expenseId}, ${purchase.description.trim() || null}, ${categoryId}, 'equal', ${splitJsonOf({ mode: 'equal', people: [book.me] })}, ${book.me}, NULL)`);
        },
      );
      // The purchase itself becomes the expense's derived transaction: replaced in place, never posted twice.
      await tx.run(sql`
        INSERT INTO event_postings (book_id, record_id, kind, transaction_id, account_id, account_amount_minor)
        VALUES (${book.bookId}, ${expenseId}, 'expense', ${transactionId}, ${purchase.moneyAccountId}, ${purchase.moneyCurrency === purchase.currency ? null : purchase.chargedMinor})`);
      await postEventRecordTx(tx, book.bookId, 'expense', expenseId, null);
      return expenseId;
    });
    if (typeof outcome === 'string') moved.push({ transactionId, expenseId: outcome });
    else kept.push(outcome);
  }
  return { moved, kept };
}

/**
 * Sharing an existing event (§6), once, right after it is shared: its category set becomes the event's categories (a
 * card still earning by the set's), its plan becomes shared items in the event currency at today's rate, and its tagged
 * spending moves in, each item still answered by what bought it. What cannot move stays tagged, as it was.
 */
export async function convertEventToShared(database: Database, ws: WorkspaceContext, eventId: string): Promise<{ moved: number; kept: MoveRefusal[] }> {
  const local = await eventOf(database, ownerScope(ws), eventId);
  const book = await database.transaction((tx) => openSharedEventTx(tx, ws, eventId));
  const today = new Date().toISOString().slice(0, 10);
  const toEventCurrency = await database.transaction(async (tx) => {
    const base = await rateToBaseTx(tx, book.currency, book.baseCurrency, today);
    return (minor: number) => (book.currency === book.baseCurrency ? minor : base === null ? null : convertMinor(minor, book.baseCurrency, book.currency, 1 / base));
  });
  // The set's categories, each tied to the workspace category a card earns by.
  const categoryFor = new Map<string, string>();
  if (local.setId) {
    for (const category of await listSetCategories(database, ownerScope(ws), local.setId)) {
      const id = await database.transaction(async (tx) => {
        const made = await eventCategoryNamedTx(tx, book, category.name, null);
        await ensureShareAccountTx(tx, book, made, category.id);
        return made;
      });
      categoryFor.set(category.id, id);
    }
  }
  const tagged = (await listTransactions(database, ownerScope(ws), { eventId, limit: 5_000 })).map((view) => view.id);
  const { moved, kept } = await moveIntoSharedEvent(database, ws, eventId, tagged);
  const expenseOf = new Map(moved.map((m) => [m.transactionId, m.expenseId]));
  for (const item of await listEventItems(database, ownerScope(ws), eventId)) {
    const price = toEventCurrency(item.unitPriceMinor);
    if (price === null || price <= 0) throw new SharedEventDbError('NO_RATE', `No ${book.currency} rate for today yet`);
    const sharedId = await saveSharedItem(database, ws, eventId, {
      name: item.name,
      quantity: item.quantity,
      unitPriceMinor: price,
      categoryId: item.categoryAccountId ? (categoryFor.get(item.categoryAccountId) ?? null) : null,
      link: item.link,
      note: item.note,
    });
    const expenseId = item.transactionId ? expenseOf.get(item.transactionId) : undefined;
    const share = item.shareMinor !== null ? toEventCurrency(item.shareMinor) : null;
    if (expenseId && share !== null && share > 0) await linkSharedItem(database, ws, eventId, sharedId, { expenseId, shareMinor: share });
  }
  return { moved: moved.length, kept };
}
```

- [ ] **Step 4: Export**

In `packages/db/src/index.ts`, after `export * from './repos/shared-event-plan';` add:

```ts
export * from './repos/shared-event-moves';
```

- [ ] **Step 5: Run the tests and the suites the move leans on**

Run: `cd packages/db && npx vitest run test/shared-event-moves.test.ts test/card-on-purchase.test.ts test/transaction-extras.test.ts test/statements.test.ts test/event-items.test.ts`
Expected: PASS. The share a moved item keeps is `toEventCurrency(840_000) = 150,000` kuruş and its price `200,000`: if `linkSharedItem` refuses the share as larger than the expense (rounding), recompute both from the same converted figures rather than relaxing the check.
Run: `npm run test -w @expanses/db && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repos/shared-event-moves.ts packages/db/src/index.ts packages/db/test/shared-event-moves.test.ts
git commit -m "$(cat <<'EOF'
Moving into a shared event: a purchase leaves its workspace keeping its card, MCC, photos and points, and an existing event brings its categories, plan and spending

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Web — the shared event's page (Spending, Balances, Plan), Settle up, Take over, the events list and the Debts page

Spec §6 (Events list "Shared with N people"; event page header, tabs, rows; Balances, suggested payments, Settle up asking for an account), §5 (the trip balance on the Debts page), §7 ("Not sent yet", "Changed by Andi"), D10 (an event that is not shared keeps today's page). Copy names people; never "you".

**Files:**
- Create: `apps/web/src/features/events/shared-queries.ts`
- Create: `apps/web/src/features/events/shared-view.ts`
- Create: `apps/web/src/features/events/shared-view.test.ts`
- Create: `apps/web/src/features/events/SharedEventPage.tsx`
- Create: `apps/web/src/features/events/SettleUpSheet.tsx`
- Create: `apps/web/src/features/events/TakeOverSheet.tsx`
- Create: `apps/web/src/features/events/SharedPlanTab.tsx`
- Modify: `apps/web/src/features/events/EventDetailPage.tsx` (rename the existing component `LocalEventPage`; a new `EventDetailPage` picks)
- Modify: `apps/web/src/features/events/EventsPage.tsx` (`EventListRow` shows the people of a shared event)
- Create: `apps/web/src/features/debts/trip-rows.ts`
- Create: `apps/web/src/features/debts/trip-rows.test.ts`
- Modify: `apps/web/src/features/debts/LendBorrowPage.tsx` (a "Trips" group under the two sides)

**Interfaces:**
- Consumes: Task 6 (`recordSettlement`, `takeOverRecords`), Task 7 (`sharedEventView`, `sharedEventSummaries`, `eventBalanceRows`, `sharedEventPlan`, `saveSharedItem`, view types), Task 5 (`eventRatesWanted`); web `useApp`, `useInvalidateAll`, `useResolveRates`, `useAccounts`; `buyTarget`, `addSpendingTarget` (buy-item.ts); `eventDates` (EventsPage.tsx).
- Produces (used by Tasks 12 and 13):
  - `shared-queries.ts`: `useSharedEventView(eventId: string | null)`, `useSharedEventSummaries()`, `useSharedEventPlan(eventId: string | null)`, `useEventBalanceRows()`, `useFetchEventRates(active: boolean): void`
  - `shared-view.ts`: `possessive(name: string): string`, `headerLine(view: SharedEventView): string`, `sharedWithText(count: number): string`, `expenseRow(e: SharedExpenseView, view: SharedEventView): { title: string; detail: string; amount: string; share: string | null; flags: string[] }`, `settlementRow(s: SharedSettlementView, view: SharedEventView): { title: string; amount: string; flags: string[] }`, `balanceLine(p: SharedPersonView, currency: string): string`, `paymentLine(p: NamedPayment, currency: string): string`, `mineToSettle(view: SharedEventView): NamedPayment[]`, `waitingLine(view: SharedEventView): string | null`, `moneyAccounts(accounts: readonly AccountRow[]): AccountRow[]`
  - `SharedEventPage({ view }: { view: SharedEventView })` — Task 12 adds its ⋯ menu.
  - `trip-rows.ts`: `tripSubtitle(row: EventBalanceRow): string`

- [ ] **Step 1: Write the failing pure tests**

`apps/web/src/features/events/shared-view.test.ts`:

```ts
import { formatMinor } from '@expanses/core';
import type { AccountRow, SharedEventView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { balanceLine, expenseRow, headerLine, mineToSettle, moneyAccounts, paymentLine, possessive, settlementRow, sharedWithText, waitingLine } from './shared-view';

/*
 * The words of a shared event's page (shared events §6, §7). Every line names a person; none says "you". Figures are
 * written by `formatMinor`, as every screen writes them.
 */

const view = (over: Partial<SharedEventView> = {}): SharedEventView => ({
  eventId: 'ev', bookId: 'book', name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', finishedAt: null, state: 'active',
  me: 'p-rina', myName: 'Rina', people: [], categories: [], expenses: [], settlements: [], spentMinor: 1_260_000, myShareMinor: 420_000,
  payments: [
    { fromPersonId: 'p-andi', fromName: 'Andi', toPersonId: 'p-rina', toName: 'Rina', amountMinor: 290_000 },
    { fromPersonId: 'p-budi', fromName: 'Budi', toPersonId: 'p-dewi', toName: 'Dewi', amountMinor: 190_000 },
  ],
  waiting: [], currencyLocked: true, ...over,
});

const expense = {
  expenseId: 'e1', occurredOn: '2026-10-06', amountMinor: 9_000, currency: 'EUR', rateToEvent: '31.5', eventAmountMinor: 283_500, payerPersonId: 'p-andi', payerName: 'Andi',
  payerHasAccount: true, categoryId: 'c', categoryName: 'Dinners', note: 'Fish dinner', split: { mode: 'equal' as const, people: ['p-rina', 'p-andi', 'p-budi'] },
  splitText: 'Equal · 3 people', myShareMinor: 3_000, myShareEventMinor: 94_500, voided: false, unsent: true, payerOnly: true,
  posting: { transactionId: 't', unposted: null, changedByName: 'Andi', accountCurrency: null },
};

describe('shared event words', () => {
  it('reads the header as what was spent and this person’s share', () => {
    expect(headerLine(view())).toBe(`Spent ${formatMinor(1_260_000, 'TRY')} · Rina's share ${formatMinor(420_000, 'TRY')}`);
    expect(possessive('Andis')).toBe("Andis'");
  });

  it('says who it is shared with, by count', () => {
    expect(sharedWithText(2)).toBe('Shared with 2 people');
    expect(sharedWithText(1)).toBe('Shared with 1 person');
  });

  it('writes a spending row in its own currency, with who paid, the category, the split, the share and its flags', () => {
    expect(expenseRow(expense, view())).toEqual({
      title: 'Fish dinner',
      detail: 'Andi paid · Dinners · Equal · 3 people',
      amount: formatMinor(9_000, 'EUR'),
      share: `Rina's share ${formatMinor(3_000, 'EUR')}`,
      flags: ['Not sent yet', 'Changed by Andi'],
    });
    expect(expenseRow({ ...expense, myShareMinor: 0, unsent: false, voided: true, posting: { transactionId: null, unposted: 'choose-account', changedByName: null, accountCurrency: null } }, view()).flags).toEqual([
      'Deleted',
      "Not in Rina's books yet",
    ]);
  });

  it('writes a settle-up, a balance and a suggested payment by name', () => {
    const s = { settlementId: 's', occurredOn: '2026-10-12', fromPersonId: 'p-andi', fromName: 'Andi', toPersonId: 'p-rina', toName: 'Rina', amountMinor: 290_000, voided: false, unsent: false, mine: true, posting: null };
    expect(settlementRow(s, view())).toEqual({ title: 'Andi paid Rina', amount: formatMinor(290_000, 'TRY'), flags: [] });
    const person = { personId: 'p-andi', name: 'Andi', initials: 'A', hasApp: true, isMe: false, removed: false, balanceMinor: -290_000 };
    expect(balanceLine(person, 'TRY')).toBe(`Andi owes ${formatMinor(290_000, 'TRY')}`);
    expect(balanceLine({ ...person, balanceMinor: 480_000 }, 'TRY')).toBe(`Andi is owed ${formatMinor(480_000, 'TRY')}`);
    expect(balanceLine({ ...person, balanceMinor: 0 }, 'TRY')).toBe('Andi is settled');
    expect(paymentLine(view().payments[0]!, 'TRY')).toBe(`Andi pays Rina ${formatMinor(290_000, 'TRY')}`);
  });

  it('offers Settle up only on the payments this person is in, and counts what waits for an account', () => {
    expect(mineToSettle(view()).map((p) => p.fromName)).toEqual(['Andi']);
    expect(waitingLine(view())).toBeNull();
    expect(waitingLine(view({ waiting: [{ recordId: 'a', kind: 'expense', reason: 'choose-account' }, { recordId: 'b', kind: 'settlement', reason: 'choose-account' }, { recordId: 'c', kind: 'expense', reason: 'no-rate' }] }))).toBe(
      "2 records are not in Rina's books yet",
    );
  });

  it('offers money accounts and cards that are open', () => {
    const account = (id: string, kind: string, subtype: string, archivedAt: string | null = null) => ({ id, kind, subtype, archivedAt, name: id, currency: 'IDR' }) as unknown as AccountRow;
    expect(moneyAccounts([account('bank', 'asset', 'bank'), account('card', 'liability', 'credit_card'), account('trip', 'asset', 'event_balance'), account('old', 'asset', 'cash', '2026-01-01'), account('food', 'expense', 'category')]).map((a) => a.id)).toEqual(['bank', 'card']);
  });
});
```

`apps/web/src/features/debts/trip-rows.test.ts`:

```ts
import { formatMinor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { tripSubtitle } from './trip-rows';

describe('a trip on the Debts page', () => {
  it('lists the payments this person is in, by name', () => {
    expect(tripSubtitle({ eventId: 'e', name: 'Coast week', currency: 'TRY', balanceMinor: 480_000, payments: [
      { fromPersonId: 'a', fromName: 'Andi', toPersonId: 'r', toName: 'Rina', amountMinor: 290_000 },
      { fromPersonId: 'b', fromName: 'Budi', toPersonId: 'r', toName: 'Rina', amountMinor: 190_000 },
    ] })).toBe(`Andi pays Rina ${formatMinor(290_000, 'TRY')} · Budi pays Rina ${formatMinor(190_000, 'TRY')}`);
    expect(tripSubtitle({ eventId: 'e', name: 'Coast week', currency: 'TRY', balanceMinor: 0, payments: [] })).toBe('Settled');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && npx vitest run src/features/events/shared-view.test.ts src/features/debts/trip-rows.test.ts`
Expected: FAIL — `./shared-view` and `./trip-rows` do not exist.

- [ ] **Step 3: Write the words**

`apps/web/src/features/events/shared-view.ts`:

```ts
import { formatMinor } from '@expanses/core';
import { type AccountRow, type NamedPayment, type SharedEventView, type SharedExpenseView, type SharedPersonView, type SharedSettlementView, SPENDABLE_SUBTYPES } from '@expanses/db';

/*
 * The words of a shared event's page (shared events §6, §7), kept out of the components so a test can hold them to
 * the owner's rule: every line names a person, none says "you". Figures are `formatMinor`'s, in the currency each
 * figure is in — a row in its own currency, the header and balances in the event's.
 */

export const possessive = (name: string): string => (name.endsWith('s') ? `${name}'` : `${name}'s`);

export function headerLine(view: SharedEventView): string {
  return `Spent ${formatMinor(view.spentMinor, view.currency)} · ${possessive(view.myName)} share ${formatMinor(view.myShareMinor, view.currency)}`;
}

export function sharedWithText(count: number): string {
  return `Shared with ${count} ${count === 1 ? 'person' : 'people'}`;
}

function postingFlags(posting: SharedExpenseView['posting'], view: SharedEventView): string[] {
  return [
    posting?.changedByName ? `Changed by ${posting.changedByName}` : null,
    posting?.unposted === 'choose-account' ? `Not in ${possessive(view.myName)} books yet` : null,
    posting?.unposted === 'no-rate' ? 'Waiting for a rate' : null,
  ].filter((flag): flag is string => flag !== null);
}

export function expenseRow(e: SharedExpenseView, view: SharedEventView): { title: string; detail: string; amount: string; share: string | null; flags: string[] } {
  return {
    title: e.note ?? e.categoryName ?? 'Shared spending',
    detail: [`${e.payerName} paid`, e.categoryName, e.splitText].filter(Boolean).join(' · '),
    amount: formatMinor(e.amountMinor, e.currency),
    share: e.myShareMinor > 0 ? `${possessive(view.myName)} share ${formatMinor(e.myShareMinor, e.currency)}` : null,
    flags: [e.voided ? 'Deleted' : null, e.unsent ? 'Not sent yet' : null, ...postingFlags(e.posting, view)].filter((flag): flag is string => flag !== null),
  };
}

export function settlementRow(s: SharedSettlementView, view: SharedEventView): { title: string; amount: string; flags: string[] } {
  return {
    title: `${s.fromName} paid ${s.toName}`,
    amount: formatMinor(s.amountMinor, view.currency),
    flags: [s.voided ? 'Deleted' : null, s.unsent ? 'Not sent yet' : null, ...postingFlags(s.posting, view)].filter((flag): flag is string => flag !== null),
  };
}

export function balanceLine(p: SharedPersonView, currency: string): string {
  if (p.balanceMinor > 0) return `${p.name} is owed ${formatMinor(p.balanceMinor, currency)}`;
  if (p.balanceMinor < 0) return `${p.name} owes ${formatMinor(-p.balanceMinor, currency)}`;
  return `${p.name} is settled`;
}

export function paymentLine(p: NamedPayment, currency: string): string {
  return `${p.fromName} pays ${p.toName} ${formatMinor(p.amountMinor, currency)}`;
}

/** The suggested payments this phone's person pays or receives: where Settle up is offered. */
export function mineToSettle(view: SharedEventView): NamedPayment[] {
  return view.payments.filter((p) => p.fromPersonId === view.me || p.toPersonId === view.me);
}

/** "2 records are not in Rina's books yet" — what waits for an account here (ruling R6), or null. */
export function waitingLine(view: SharedEventView): string | null {
  const count = view.waiting.filter((w) => w.reason === 'choose-account').length;
  if (count === 0) return null;
  return `${count} ${count === 1 ? 'record is' : 'records are'} not in ${possessive(view.myName)} books yet`;
}

/** The accounts money can be paid from or into on this event: everyday money and cards, still open. */
export function moneyAccounts(accounts: readonly AccountRow[]): AccountRow[] {
  const spendable = SPENDABLE_SUBTYPES as readonly string[];
  return accounts.filter((a) => a.archivedAt === null && ((a.kind === 'asset' && spendable.includes(a.subtype)) || (a.kind === 'liability' && a.subtype === 'credit_card')));
}
```

`apps/web/src/features/debts/trip-rows.ts`:

```ts
import { formatMinor } from '@expanses/core';
import type { EventBalanceRow } from '@expanses/db';

/** Under a trip on the Debts page (shared events §5): the payments this person is in, by name, or "Settled". */
export function tripSubtitle(row: EventBalanceRow): string {
  if (row.payments.length === 0) return 'Settled';
  return row.payments.map((p) => `${p.fromName} pays ${p.toName} ${formatMinor(p.amountMinor, row.currency)}`).join(' · ');
}
```

- [ ] **Step 4: Run the pure tests**

Run: `cd apps/web && npx vitest run src/features/events/shared-view.test.ts src/features/debts/trip-rows.test.ts`
Expected: PASS.

- [ ] **Step 5: The queries**

`apps/web/src/features/events/shared-queries.ts`:

```ts
import { eventBalanceRows, eventRatesWanted, ownerScope, sharedEventPlan, sharedEventSummaries, sharedEventView } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';

/*
 * A shared event's reads (shared events §6). Owner-level, as every event read is: an event belongs to no workspace tab.
 * Every write ends in `useInvalidateAll`, which also nudges the sync, so these re-read after a record goes out or comes in.
 */

export function useSharedEventView(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['shared-event', ws.workspaceId, eventId], queryFn: () => sharedEventView(database, ownerScope(ws), eventId!), enabled: eventId !== null });
}

export function useSharedEventSummaries() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['shared-event-summaries', ws.workspaceId], queryFn: () => sharedEventSummaries(database, ownerScope(ws)) });
}

export function useSharedEventPlan(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['shared-event-plan', ws.workspaceId, eventId], queryFn: () => sharedEventPlan(database, ownerScope(ws), eventId!), enabled: eventId !== null });
}

export function useEventBalanceRows() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['event-balance-rows', ws.workspaceId], queryFn: () => eventBalanceRows(database, ownerScope(ws)) });
}

/**
 * Fetches the rates this phone's records wait for (§5): each pair once, while the page is open. Saving a rate posts
 * what waited for it (`upsertRate` retries), so the page only has to read again.
 */
export function useFetchEventRates(active: boolean): void {
  const { database } = useApp();
  const resolveRates = useResolveRates();
  const invalidate = useInvalidateAll();
  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      const wanted = await eventRatesWanted(database);
      for (const { currency, onDate } of wanted) await resolveRates([currency], onDate).catch(() => undefined);
      if (live && wanted.length > 0) await invalidate();
    })();
    return () => {
      live = false;
    };
  }, [active, database, resolveRates, invalidate]);
}
```

- [ ] **Step 6: Settle up and Take over**

`apps/web/src/features/events/SettleUpSheet.tsx`:

```tsx
import { convertMinor, isoDate, minorToMajorString, parseMajor } from '@expanses/core';
import { type NamedPayment, ownerScope, recordSettlement, type SharedEventView } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, ReadOnlyRow, SelectRow, SubmitRow, TextRow } from '../../ui/native';
import { moneyAccounts, paymentLine, possessive } from './shared-view';

/**
 * Settle up (shared events §6): records one suggested payment, in the event currency. When this person pays or
 * receives it, the sheet asks which account, and — for an account in another currency — what it moved there, filled in
 * at the day's rate and editable (a settle-up in rupiah for a lira trip).
 */
export function SettleUpSheet({ view, payment, onClose }: { view: SharedEventView; payment: NamedPayment; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = moneyAccounts(useAccounts().data ?? []);
  const party = payment.fromPersonId === view.me || payment.toPersonId === view.me;
  const [amount, setAmount] = useState(minorToMajorString(payment.amountMinor, view.currency));
  const [accountId, setAccountId] = useState('');
  const [moved, setMoved] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const foreign = account !== null && account.currency !== view.currency;

  async function pick(id: string) {
    setAccountId(id);
    const chosen = accounts.find((a) => a.id === id);
    if (!chosen?.currency || chosen.currency === view.currency) return setMoved('');
    const { rates } = await resolveRates([view.currency, chosen.currency], isoDate());
    const from = view.currency === ws.baseCurrency ? 1 : rates[view.currency];
    const to = chosen.currency === ws.baseCurrency ? 1 : rates[chosen.currency];
    if (from && to) setMoved(minorToMajorString(convertMinor(parseMajor(amount, view.currency), view.currency, chosen.currency, from / to), chosen.currency));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (party && !account) throw new Error(`Choose the account ${possessive(view.myName)} money ${payment.fromPersonId === view.me ? 'left' : 'arrived in'}`);
      const amountMinor = parseMajor(amount, view.currency);
      await recordSettlement(database, ownerScope(ws), view.eventId, {
        occurredOn: isoDate(),
        fromPersonId: payment.fromPersonId,
        toPersonId: payment.toPersonId,
        amountMinor,
        account: party && account ? { accountId: account.id, amountMinor: foreign ? parseMajor(moved, account.currency!) : null } : null,
      });
      await invalidate();
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Settle up" onClose={onClose}>
      <form aria-label="Settle up" onSubmit={(event) => void save(event)} data-testid="settle-up">
        <InsetGroup>
          <ReadOnlyRow label="Payment" value={paymentLine(payment, view.currency)} />
          <TextRow label={`Amount (${view.currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {party ? (
            <SelectRow label={payment.fromPersonId === view.me ? 'Paid from' : 'Received into'} value={accountId} onChange={(e) => void pick(e.target.value)}>
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </SelectRow>
          ) : null}
          {foreign ? <TextRow label={`In ${account!.currency}`} inputMode="decimal" value={moved} onChange={(e) => setMoved(e.target.value)} /> : null}
          <SubmitRow label={busy ? 'Saving…' : 'Record'} disabled={busy} />
        </InsetGroup>
        <ErrorBox error={error} />
      </form>
    </Sheet>
  );
}
```

`apps/web/src/features/events/TakeOverSheet.tsx`:

```tsx
import { ownerScope, type SharedEventView, takeOverRecords } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, SubmitRow } from '../../ui/native';
import { moneyAccounts, possessive, waitingLine } from './shared-view';

/**
 * Ruling R6: what this person paid or received that is not in their books yet — recorded for them before they joined,
 * or before a new phone — is taken over from one account. The day's rates are fetched first, so a figure in another
 * currency converts on this phone.
 */
export function TakeOverSheet({ view, onClose }: { view: SharedEventView; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = moneyAccounts(useAccounts().data ?? []);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const recordIds = view.waiting.filter((w) => w.reason === 'choose-account').map((w) => w.recordId);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) throw new Error(`Choose the account ${possessive(view.myName)} money came from`);
      for (const id of recordIds) {
        const expense = view.expenses.find((e) => e.expenseId === id);
        const settlement = view.settlements.find((s) => s.settlementId === id);
        const on = expense?.occurredOn ?? settlement?.occurredOn;
        if (on) await resolveRates([expense?.currency ?? view.currency, view.currency, account.currency!], on).catch(() => undefined);
      }
      await takeOverRecords(database, ownerScope(ws), view.eventId, { accountId: account.id, recordIds });
      await invalidate();
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Into the books" onClose={onClose}>
      <form aria-label="Take over" onSubmit={(event) => void save(event)}>
        <InsetGroup footer={waitingLine(view) ?? undefined}>
          <SelectRow label="From" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </SelectRow>
          <SubmitRow label={busy ? 'Saving…' : 'Add to the books'} disabled={busy || !accountId} />
        </InsetGroup>
        <ErrorBox error={error} />
      </form>
    </Sheet>
  );
}
```

- [ ] **Step 7: The plan tab**

`apps/web/src/features/events/SharedPlanTab.tsx`:

```tsx
import { formatMinor, parseMajor } from '@expanses/core';
import { ownerScope, saveSharedItem, type SharedEventView } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SubmitRow, TextRow } from '../../ui/native';
import { buyTarget } from './buy-item';
import { useSharedEventPlan } from './shared-queries';

/** The shared plan (D7): what the trip means to buy, in the event currency; Buy it now opens the Add screen on the item. */
export function SharedPlanTab({ view }: { view: SharedEventView }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const plan = useSharedEventPlan(view.eventId).data;
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<unknown>(null);
  const items = (plan?.lines ?? []).flatMap((line) => line.items);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await saveSharedItem(database, ownerScope(ws), view.eventId, { name, quantity: 1, unitPriceMinor: parseMajor(price, view.currency), categoryId: null, link: null, note: null });
      setName('');
      setPrice('');
      await invalidate();
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <>
      <InsetGroup header="To buy">
        {items.map((item) => (
          <InsetRow
            key={item.id}
            title={item.name}
            subtitle={item.bought ? `Bought · ${formatMinor(item.actualMinor ?? 0, view.currency)}` : `${item.quantity} × ${formatMinor(item.unitPriceMinor, view.currency)}`}
            value={formatMinor(item.estimateMinor, view.currency)}
            onClick={item.bought || view.finishedAt ? undefined : () => void navigate(buyTarget(view.eventId, item.id))}
            label={item.bought ? item.name : `Buy ${item.name} now`}
            testId="shared-plan-item"
          />
        ))}
      </InsetGroup>
      {view.finishedAt ? null : (
        <form aria-label="Add to the plan" onSubmit={(event) => void add(event)}>
          <InsetGroup>
            <TextRow label="Thing to buy" value={name} onChange={(e) => setName(e.target.value)} />
            <TextRow label={`Price (${view.currency})`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            <SubmitRow label="Add to the plan" disabled={!name.trim() || !price.trim()} />
          </InsetGroup>
          <ErrorBox error={error} />
        </form>
      )}
    </>
  );
}
```

- [ ] **Step 8: The page**

`apps/web/src/features/events/SharedEventPage.tsx`:

```tsx
import type { NamedPayment, SharedEventView } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { type CornerAction, InsetGroup, InsetRow, LargeTitle, SCREEN, type Segment, SegmentedControl } from '../../ui/native';
import { addSpendingTarget } from './buy-item';
import { eventDates } from './EventsPage';
import { SettleUpSheet } from './SettleUpSheet';
import { SharedPlanTab } from './SharedPlanTab';
import { useFetchEventRates } from './shared-queries';
import { balanceLine, expenseRow, headerLine, mineToSettle, paymentLine, settlementRow, waitingLine } from './shared-view';
import { TakeOverSheet } from './TakeOverSheet';

const TABS: readonly Segment[] = [
  { key: 'spending', label: 'Spending' },
  { key: 'balances', label: 'Balances' },
  { key: 'plan', label: 'Plan' },
];

/**
 * A shared event (shared events §6): its header — the dates, the currency, what was spent and this person's share —
 * then Spending, Balances and Plan. The ⋯ menu (People, Currency, Done, Leave) is `menu`'s, so this page reads the same
 * on every phone whatever its person may do.
 */
export function SharedEventPage({ view, menu = [] }: { view: SharedEventView; menu?: CornerAction[] }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('spending');
  const [settling, setSettling] = useState<NamedPayment | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  useFetchEventRates(view.waiting.some((w) => w.reason === 'no-rate'));
  const waiting = waitingLine(view);
  const actions: CornerAction[] = [
    {
      key: 'add',
      label: 'Add spending',
      glyph: <Plus size={22} aria-hidden />,
      run: () => void navigate(addSpendingTarget(view.eventId)),
      disabled: view.finishedAt !== null || view.state !== 'active',
    },
    ...menu,
  ];
  // Settle up is offered on a payment this person pays or receives, or one between two people without the app — §3's
  // writer rule for settlements, which the repository enforces again.
  const mine = new Set(mineToSettle(view));
  const offerSettle = (p: NamedPayment) => mine.has(p) || !view.people.some((x) => x.hasApp && (x.personId === p.fromPersonId || x.personId === p.toPersonId));

  return (
    <div className={SCREEN} data-testid="shared-event">
      <LargeTitle title={view.name} back="Events" backTo="/events" actions={actions} subtitle={`${eventDates(view)} · ${view.currency}`} />
      <p className="px-[4px] pb-[12px] text-[15px] leading-[20px] text-[var(--ph-ink-2)]" data-testid="shared-event-header">
        {headerLine(view)}
      </p>
      {waiting ? (
        <InsetGroup>
          <InsetRow title={waiting} subtitle="Choose the account it came from" onClick={() => setTakingOver(true)} testId="take-over-row" />
        </InsetGroup>
      ) : null}
      <SegmentedControl label={`${view.name} sections`} segments={TABS} value={tab} onChange={setTab} />
      {tab === 'spending' ? (
        <InsetGroup>
          {[
            ...view.expenses.map((e) => {
              const row = expenseRow(e, view);
              return (
                <InsetRow
                  key={e.expenseId}
                  title={row.title}
                  subtitle={[row.detail, row.share, ...row.flags].filter(Boolean).join(' · ')}
                  value={row.amount}
                  onClick={e.voided || view.finishedAt ? undefined : () => void navigate({ to: '/transactions/new', search: { event: view.eventId, expense: e.expenseId } })}
                  testId="shared-expense-row"
                />
              );
            }),
            ...view.settlements.map((s) => {
              const row = settlementRow(s, view);
              return <InsetRow key={s.settlementId} title={row.title} subtitle={row.flags.join(' · ') || undefined} value={row.amount} testId="shared-settlement-row" />;
            }),
          ]}
        </InsetGroup>
      ) : null}
      {tab === 'balances' ? (
        <>
          <InsetGroup header="Balances">
            {view.people
              .filter((p) => !p.removed)
              .map((p) => (
                <InsetRow key={p.personId} title={balanceLine(p, view.currency)} subtitle={p.hasApp ? undefined : 'Without the app'} testId="shared-balance-row" />
              ))}
          </InsetGroup>
          <InsetGroup header="To settle up">
            {view.payments.map((p) => (
              <InsetRow
                key={`${p.fromPersonId}-${p.toPersonId}`}
                title={paymentLine(p, view.currency)}
                onClick={offerSettle(p) && !view.finishedAt ? () => setSettling(p) : undefined}
                label={`Settle up: ${paymentLine(p, view.currency)}`}
                testId="shared-payment-row"
              />
            ))}
          </InsetGroup>
        </>
      ) : null}
      {tab === 'plan' ? <SharedPlanTab view={view} /> : null}
      {settling ? <SettleUpSheet view={view} payment={settling} onClose={() => setSettling(null)} /> : null}
      {takingOver ? <TakeOverSheet view={view} onClose={() => setTakingOver(false)} /> : null}
    </div>
  );
}
```

`/transactions/new`'s `expense` search key is added by Task 13 (it opens a shared expense for editing). Until then this line does not type-check, so add the key to `NewTransactionSearch` here, in `apps/web/src/features/transactions/new-search.ts`:

```ts
  /** A shared event's expense, opened for editing on the Add screen (shared events §6). Read only with `event`. */
  expense?: string;
```

and in `newTransactionSearch`:

```ts
  ...(text(search.event) && text(search.expense) ? { expense: text(search.expense) } : {}),
```

- [ ] **Step 9: The event page picks**

In `apps/web/src/features/events/EventDetailPage.tsx`, rename `export function EventDetailPage()` to `function LocalEventPage()` and add, above it:

```tsx
import { SharedEventPage } from './SharedEventPage';
import { useSharedEventView } from './shared-queries';

/**
 * An event's page: a shared event's own (shared events §6), or — for an event that is not shared — the page events have
 * always had, unchanged (D10).
 */
export function EventDetailPage() {
  const { eventId } = useParams({ from: '/events/$eventId' });
  const shared = useSharedEventView(eventId);
  if (shared.isPending) return null;
  if (shared.data) return <SharedEventPage view={shared.data} />;
  return <LocalEventPage />;
}
```

- [ ] **Step 10: The events list names the people**

In `apps/web/src/features/events/EventsPage.tsx`, add `import type { SharedEventSummary } from '@expanses/db';`, `import { useSharedEventSummaries } from './shared-queries';` and `import { sharedWithText } from './shared-view';`. Give `EventListRow` a `shared?: SharedEventSummary` prop; when set, the local plan line is not read (a shared event's plan is the shared one) and a line of initials and words replaces it:

```tsx
function EventListRow({ event, today, position, shared }: GroupChild & { event: EventRow; today: string; shared?: SharedEventSummary }) {
  const { ws } = useApp();
  const plan = useEventPlan(shared ? null : event.id).data;
```

and inside the text column, after the dates line:

```tsx
            {shared && (
              <span className="mt-[2px] flex items-center gap-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="event-shared-with">
                <span aria-hidden className="flex -space-x-1">
                  {shared.people.slice(0, 3).map((p) => (
                    <span key={p.name} className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--ph-fill)] text-[10px] font-semibold text-[var(--ph-ink-2)] ring-1 ring-[var(--ph-surface)]">
                      {p.initials}
                    </span>
                  ))}
                </span>
                <span className="truncate">{sharedWithText(shared.sharedWith)}</span>
              </span>
            )}
```

Where the page maps events to `EventListRow`, read `const summaries = useSharedEventSummaries().data ?? {};` once and pass `shared={summaries[event.id]}`.

- [ ] **Step 11: The Debts page lists trips**

In `apps/web/src/features/debts/LendBorrowPage.tsx`, add:

```tsx
import { useEventBalanceRows } from '../events/shared-queries';
import { tripSubtitle } from './trip-rows';

/**
 * Trips (shared events §5): each shared event's balance in this person's books — owed to them, or owed by them — and
 * the suggested payments they are in. The event page is one tap away, where Settle up is.
 */
function TripRows() {
  const trips = useEventBalanceRows().data ?? [];
  if (trips.length === 0) return null;
  return (
    <InsetGroup header="Trips">
      {trips.map((trip) => (
        <InsetRow
          key={trip.eventId}
          title={trip.name}
          subtitle={tripSubtitle(trip)}
          value={<Money minor={trip.balanceMinor} currency={trip.currency} tone="auto" />}
          valueTone="ink"
          to="/events/$eventId"
          params={{ eventId: trip.eventId }}
          testId="trip-row"
        />
      ))}
    </InsetGroup>
  );
}
```

and render `<TripRows />` after the two sides (before the page's closing `</div>`).

- [ ] **Step 12: Typecheck, the web suite, and the existing event e2e**

Run: `npm run typecheck && npm run test -w @expanses/web`
Expected: PASS.
Run: `npm run e2e -w @expanses/web -- events.spec.ts phone-events.spec.ts debts-page.spec.ts`
Expected: PASS — an event that is not shared reads exactly as before (D10).

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/features/events apps/web/src/features/debts apps/web/src/features/transactions/new-search.ts
git commit -m "$(cat <<'EOF'
A shared event's page: spending in each row's own currency, balances, the fewest payments and Settle up, the shared plan; the events list and Debts name the trip's people

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Web — People, Currency, Done and Leave; sharing an existing event; joining one

Spec §6 (⋯ holds People — invite link, add a name, remove — Currency until the first expense, Done, Leave; "Sharing an existing event: asks once…"; "Joining: the link opens 'Join Turkey trip'; the joiner picks a name ('I'm Budi') or adds their own"), §7 (Leave at zero, remove at zero, Done read-only, a person's new phone). Copy names people; never "you".

**Files:**
- Modify: `apps/web/src/sync/sync-service.ts` (`shareEvent`, `eventInvite`, `joinEvent`, `leaveEvent`, `removeEventMember`)
- Create: `apps/web/src/features/events/shared-menu.ts`
- Create: `apps/web/src/features/events/shared-menu.test.ts`
- Create: `apps/web/src/features/events/EventCurrencySheet.tsx`
- Create: `apps/web/src/features/events/PeoplePage.tsx`
- Create: `apps/web/src/features/events/ShareEventSheet.tsx`
- Modify: `apps/web/src/features/events/EventDetailPage.tsx` (the shared page gets its ⋯ menu; the local page gets "Share this event")
- Modify: `apps/web/src/app/router.tsx` (route `/events/$eventId/people`)
- Create: `apps/web/src/features/sharing/join-event.ts`
- Create: `apps/web/src/features/sharing/join-event.test.ts`
- Create: `apps/web/src/features/sharing/JoinEvent.tsx`
- Modify: `apps/web/src/features/sharing/JoinWorkspace.tsx` (an event's preview shows `JoinEvent`)

**Interfaces:**
- Consumes: Task 8 (`SyncEngine.shareEvent`, `createEventInvite`, `joinEvent`, `leaveEvent`, `removeEventMember`; `PreviewedInvite.event`); Task 6 (`addEventPerson`, `setSharedEventCurrency`, `finishSharedEvent`); Task 10 (`convertEventToShared`, `MoveRefusal`); Task 11 (`SharedEventPage`'s `menu` prop, `useSharedEventView`, `possessive`); `InviteCard`, `thisDeviceName`, `Sheet`.
- Produces:
  - `SyncService.shareEvent(ws: WorkspaceContext, input: { eventId: string; currency: string; personName: string; deviceName: string; names: string[] }): Promise<{ bookId: string }>`, `eventInvite(bookId: string, inviterName: string, forPersonId?: string): Promise<CreatedInvite>`, `joinEvent(code: string, input: { ws: WorkspaceContext; personId: string | null; name: string; deviceName: string }): Promise<{ eventId: string }>`, `leaveEvent(bookId: string): Promise<void>`, `removeEventMember(ws: WorkspaceContext, eventId: string, bookId: string, personId: string): Promise<void>`
  - `sharedEventMenu(view: SharedEventView, run: { people(): void; currency(): void; done(finished: boolean): void; leave(): void }): CornerAction[]`
  - `type EventInviteDetails = NonNullable<PreviewedInvite['event']>` and `joinChoices(event: EventInviteDetails): { key: string; label: string; personId: string | null; name: string }[]` (join-event.ts)

- [ ] **Step 1: Write the failing pure tests**

`apps/web/src/features/events/shared-menu.test.ts`:

```ts
import type { SharedEventView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { sharedEventMenu } from './shared-menu';

const noop = { people: () => undefined, currency: () => undefined, done: () => undefined, leave: () => undefined };
const view = (over: Partial<SharedEventView> = {}): SharedEventView => ({
  eventId: 'ev', bookId: 'b', name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', finishedAt: null, state: 'active', me: 'p-rina', myName: 'Rina',
  people: [{ personId: 'p-rina', name: 'Rina', initials: 'R', hasApp: true, isMe: true, removed: false, balanceMinor: 0 }],
  categories: [], expenses: [], settlements: [], spentMinor: 0, myShareMinor: 0, payments: [], waiting: [], currencyLocked: false, ...over,
});

describe('the shared event’s ⋯ menu (§6)', () => {
  it('holds People, Currency until the first expense, Done and Leave', () => {
    expect(sharedEventMenu(view(), noop).map((a) => [a.label, !!a.disabled])).toEqual([['People', false], ['Currency', false], ['Done', false], ['Leave', false]]);
  });

  it('greys Currency once something is spent, and Leave while the balance is not zero, saying why', () => {
    const menu = sharedEventMenu(view({ currencyLocked: true, people: [{ personId: 'p-rina', name: 'Rina', initials: 'R', hasApp: true, isMe: true, removed: false, balanceMinor: -500 }] }), noop);
    expect(menu.find((a) => a.key === 'currency')).toMatchObject({ disabled: true, detail: 'Fixed once something is spent' });
    expect(menu.find((a) => a.key === 'leave')).toMatchObject({ disabled: true, detail: "Rina's balance is not zero yet" });
  });

  it('offers Reopen on a Done event', () => {
    expect(sharedEventMenu(view({ finishedAt: '2026-10-13T00:00:00Z' }), noop).find((a) => a.key === 'done')?.label).toBe('Reopen');
  });
});
```

`apps/web/src/features/sharing/join-event.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { joinChoices } from './join-event';

describe('joining an event (§6)', () => {
  it('offers each name not yet claimed as "I’m …", then a new name', () => {
    expect(
      joinChoices({ name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', minAppVersion: '0.4.0', people: [
        { personId: 'p-budi', name: 'Budi', claimed: false },
        { personId: 'p-rina', name: 'Rina', claimed: true },
        { personId: 'p-dewi', name: 'Dewi', claimed: false },
      ] }),
    ).toEqual([
      { key: 'p-budi', label: 'I’m Budi', personId: 'p-budi', name: 'Budi' },
      { key: 'p-dewi', label: 'I’m Dewi', personId: 'p-dewi', name: 'Dewi' },
      { key: 'new', label: 'Someone new', personId: null, name: '' },
    ]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && npx vitest run src/features/events/shared-menu.test.ts src/features/sharing/join-event.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Write the two pure modules**

`apps/web/src/features/events/shared-menu.ts`:

```ts
import type { SharedEventView } from '@expanses/db';
import type { CornerAction } from '../../ui/native';
import { possessive } from './shared-view';

/**
 * A shared event's ⋯ menu (shared events §6): People; Currency until something is spent; Done (or Reopen); Leave, at a
 * zero balance only (D9). A line that cannot be taken yet stays in the menu, greyed, saying why.
 */
export function sharedEventMenu(view: SharedEventView, run: { people(): void; currency(): void; done(finished: boolean): void; leave(): void }): CornerAction[] {
  const owes = (view.people.find((p) => p.isMe)?.balanceMinor ?? 0) !== 0;
  return [
    { key: 'people', label: 'People', run: run.people },
    { key: 'currency', label: 'Currency', run: run.currency, disabled: view.currencyLocked, ...(view.currencyLocked ? { detail: 'Fixed once something is spent' } : {}) },
    { key: 'done', label: view.finishedAt ? 'Reopen' : 'Done', run: () => run.done(view.finishedAt === null) },
    { key: 'leave', label: 'Leave', destructive: true, run: run.leave, disabled: owes, ...(owes ? { detail: `${possessive(view.myName)} balance is not zero yet` } : {}) },
  ];
}
```

`apps/web/src/features/sharing/join-event.ts`:

```ts
import type { PreviewedInvite } from '@expanses/db';

/** What an event's invite shows (Task 8's `EventInviteDetails`, read off the preview so the package index is not touched). */
export type EventInviteDetails = NonNullable<PreviewedInvite['event']>;

/** "I'm Budi" for each name nobody has claimed yet, then a new name (shared events §6, Joining). */
export function joinChoices(event: EventInviteDetails): { key: string; label: string; personId: string | null; name: string }[] {
  return [
    ...event.people.filter((p) => !p.claimed).map((p) => ({ key: p.personId, label: `I’m ${p.name}`, personId: p.personId, name: p.name })),
    { key: 'new', label: 'Someone new', personId: null, name: '' },
  ];
}
```

- [ ] **Step 4: Run the pure tests**

Run: `cd apps/web && npx vitest run src/features/events/shared-menu.test.ts src/features/sharing/join-event.test.ts`
Expected: PASS.

- [ ] **Step 5: The sync service's event acts**

In `apps/web/src/sync/sync-service.ts`, add after `forgetSharing`:

```ts
  /* ------------------------------------------------------------- shared events */

  /** Share an event as its own relay book (shared events §3); polled from here on like any shared book. */
  async shareEvent(ws: WorkspaceContext, input: { eventId: string; currency: string; personName: string; deviceName: string; names: string[] }): Promise<{ bookId: string }> {
    const engine = await this.engine();
    const { bookId } = await engine.shareEvent(ws, input);
    await this.touched(bookId);
    await this.refresh();
    this.onApplied();
    return { bookId };
  }

  /** An invite to an event; for a person's new phone when `forPersonId` is given (§7). */
  async eventInvite(bookId: string, inviterName: string, forPersonId?: string): Promise<CreatedInvite> {
    const engine = await this.engine();
    return this.exclusive(bookId, () => engine.createEventInvite(bookId, { inviterName, ...(forPersonId ? { forPersonId } : {}) }));
  }

  /** Join an event: the claim, the book, the name, and a first pull of the whole log. */
  async joinEvent(code: string, input: { ws: WorkspaceContext; personId: string | null; name: string; deviceName: string }): Promise<{ eventId: string }> {
    const engine = await this.engine();
    const { bookId, eventId, result } = await engine.joinEvent(code, input);
    await this.touched(bookId, result);
    await this.refresh();
    this.onApplied();
    return { eventId };
  }

  /** Leave an event at a zero balance (D9): kept here read-only, no longer polled. */
  async leaveEvent(bookId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.leaveEvent(bookId));
  }

  /** Remove a person from an event at zero and in no record; a person with the app loses their devices in it. */
  async removeEventMember(ws: WorkspaceContext, eventId: string, bookId: string, personId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.removeEventMember(ws, eventId, personId));
  }
```

- [ ] **Step 6: Currency, People, and Share**

`apps/web/src/features/events/EventCurrencySheet.tsx`:

```tsx
import { CURRENCIES } from '@expanses/core';
import { ownerScope, setSharedEventCurrency, type SharedEventView } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, SubmitRow } from '../../ui/native';

/** The event currency, until something is spent (D5): every figure on the event is in it. */
export function EventCurrencySheet({ view, onClose }: { view: SharedEventView; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [currency, setCurrency] = useState(view.currency);
  const [error, setError] = useState<unknown>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await setSharedEventCurrency(database, ownerScope(ws), view.eventId, currency);
      await invalidate();
      onClose();
    } catch (failure) {
      setError(failure);
    }
  }
  return (
    <Sheet grouped title="Currency" onClose={onClose}>
      <form aria-label="Event currency" onSubmit={(event) => void save(event)}>
        <InsetGroup footer={`Every figure on ${view.name} is shown in it. Fixed once something is spent.`}>
          <SelectRow label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </SelectRow>
          <SubmitRow label="Save" />
        </InsetGroup>
        <ErrorBox error={error} />
      </form>
    </Sheet>
  );
}
```

`apps/web/src/features/events/PeoplePage.tsx`:

```tsx
import { addEventPerson, type CreatedInvite, ownerScope, type SharedPersonView } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, SubmitRow, TextRow } from '../../ui/native';
import { InviteCard } from '../sharing/InviteCard';
import { useSharedEventView } from './shared-queries';
import { balanceLine } from './shared-view';

/**
 * Who is in a shared event (shared events §6): those with the app and the names without it. An invite link for someone
 * new, a name added for someone without the app, a person's new phone, and removing a person at zero and in no record.
 */
export function PeoplePage() {
  const { eventId } = useParams({ from: '/events/$eventId/people' });
  const { database, ws, sync } = useApp();
  const invalidate = useInvalidateAll();
  const view = useSharedEventView(eventId).data;
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<{ invite: CreatedInvite; header: string } | null>(null);
  const [chosen, setChosen] = useState<SharedPersonView | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!view) return null;
  const live = view.people.filter((p) => !p.removed);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (failure) {
      setError(failure);
    }
  }

  async function addName(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await addEventPerson(database, ownerScope(ws), eventId, name);
      setName('');
    });
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title="People" back={view.name} backTo="/events/$eventId" backParams={{ eventId }} />
      <ErrorBox error={error} />
      <InsetGroup header="With the app">
        {live.filter((p) => p.hasApp).map((p) => (
          <InsetRow key={p.personId} title={p.isMe ? `${p.name} (this phone)` : p.name} subtitle={balanceLine(p, view.currency)} onClick={p.isMe ? undefined : () => setChosen(p)} testId="event-person" />
        ))}
      </InsetGroup>
      <InsetGroup header="Without the app">
        {live.filter((p) => !p.hasApp).map((p) => (
          <InsetRow key={p.personId} title={p.name} subtitle={balanceLine(p, view.currency)} onClick={() => setChosen(p)} testId="event-person" />
        ))}
      </InsetGroup>
      <form aria-label="Add a name" onSubmit={(event) => void addName(event)}>
        <InsetGroup footer="For someone without the app: anyone can record what they pay. They can claim the name when they join.">
          <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <SubmitRow label="Add a name" disabled={!name.trim()} />
        </InsetGroup>
      </form>
      <InsetGroup>
        <InsetRow title="Invite someone" onClick={() => void run(async () => setInvite({ invite: await sync.eventInvite(view.bookId, view.myName), header: `Invite to ${view.name}` }))} testId="event-invite" />
      </InsetGroup>
      {invite ? <InviteCard invite={invite.invite} bookName={view.name} inviterName={view.myName} header={invite.header} footer="Send it to the person joining." /> : null}
      {chosen ? (
        <Sheet grouped title={chosen.name} onClose={() => setChosen(null)}>
          <InsetGroup>
            {chosen.hasApp ? (
              <InsetRow
                title={`A new phone for ${chosen.name}`}
                onClick={() =>
                  void run(async () => {
                    setInvite({ invite: await sync.eventInvite(view.bookId, view.myName, chosen.personId), header: `${chosen.name}'s new phone` });
                    setChosen(null);
                  })
                }
              />
            ) : null}
            <InsetRow
              title={`Remove ${chosen.name}`}
              destructive
              onClick={() =>
                void run(async () => {
                  await sync.removeEventMember(ownerScope(ws), eventId, view.bookId, chosen.personId);
                  setChosen(null);
                })
              }
            />
          </InsetGroup>
        </Sheet>
      ) : null}
    </div>
  );
}
```

`apps/web/src/features/events/ShareEventSheet.tsx`:

```tsx
import { CURRENCIES, isoDate } from '@expanses/core';
import { convertEventToShared, type CreatedInvite, type EventRow, listTransactions, type MoveRefusal, ownerScope } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SubmitRow, TextRow } from '../../ui/native';
import { InviteCard } from '../sharing/InviteCard';
import { thisDeviceName } from '../sharing/SharingSection';

/**
 * Sharing an existing event (shared events §6): asked once, here. The event becomes a shared one in its currency; what
 * is tagged to it moves out of its workspace and becomes this person's own expenses in it, its category set becomes
 * the event's categories and its plan the shared plan. The rates every move needs are fetched first.
 */
export function ShareEventSheet({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const { database, ws, sync } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(ws.baseCurrency);
  const [names, setNames] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<{ invite: CreatedInvite; kept: MoveRefusal[] } | null>(null);

  async function share(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tagged = await listTransactions(database, ownerScope(ws), { eventId: event.id, limit: 5_000 });
      for (const day of new Set([isoDate(), ...tagged.map((t) => t.occurredOn)])) {
        const currencies = new Set([currency, ...tagged.filter((t) => t.occurredOn === day).flatMap((t) => [t.originalCurrency, ...t.entries.map((x) => x.currency)])]);
        await resolveRates([...currencies].filter((c): c is string => !!c && c !== ws.baseCurrency), day).catch(() => undefined);
      }
      const { bookId } = await sync.shareEvent(ownerScope(ws), {
        eventId: event.id,
        currency,
        personName: name,
        deviceName: thisDeviceName(),
        names: names.split(',').map((n) => n.trim()).filter(Boolean),
      });
      const { kept } = await convertEventToShared(database, ownerScope(ws), event.id);
      setDone({ invite: await sync.eventInvite(bookId, name), kept });
      await invalidate();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title={`Share ${event.name}`} onClose={done ? () => void navigate({ to: '/events/$eventId', params: { eventId: event.id } }).then(onClose) : onClose}>
      <ErrorBox error={error} />
      {done ? (
        <>
          <InviteCard invite={done.invite} bookName={event.name} inviterName={name} header={`Invite to ${event.name}`} footer="Send it to the people joining." />
          {done.kept.length > 0 ? (
            <InsetGroup header="Stayed where they were">
              {done.kept.map((k) => (
                <InsetRow key={k.transactionId} title={k.why} chevron={false} />
              ))}
            </InsetGroup>
          ) : null}
        </>
      ) : (
        <form aria-label="Share this event" onSubmit={(e) => void share(e)}>
          <InsetGroup footer={`Everyone in ${event.name} sees every expense of it, who paid and how it is split. What is tagged to it moves out of its workspace: in each person's own books only their own share counts.`}>
            <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="As the others will see it" required />
            <SelectRow label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </SelectRow>
            <TextRow label="Without the app" value={names} onChange={(e) => setNames(e.target.value)} placeholder="Names, with commas" />
            <SubmitRow label={busy ? 'Sharing…' : 'Share'} disabled={busy || !name.trim()} />
          </InsetGroup>
        </form>
      )}
    </Sheet>
  );
}
```

- [ ] **Step 7: Wire the menu, the share action and the People route**

In `apps/web/src/features/events/EventDetailPage.tsx`, add the imports:

```tsx
import { finishSharedEvent, ownerScope, type SharedEventView } from '@expanses/db';
import { EventCurrencySheet } from './EventCurrencySheet';
import { ShareEventSheet } from './ShareEventSheet';
import { sharedEventMenu } from './shared-menu';
```

replace `if (shared.data) return <SharedEventPage view={shared.data} />;` with `if (shared.data) return <SharedEventScreen view={shared.data} />;`, and add:

```tsx
/** The shared page with its ⋯ menu wired: People, Currency, Done or Reopen, Leave (shared events §6). */
function SharedEventScreen({ view }: { view: SharedEventView }) {
  const { database, ws, sync } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (failure) {
      setError(failure);
    }
  };
  const menu = sharedEventMenu(view, {
    people: () => void navigate({ to: '/events/$eventId/people', params: { eventId: view.eventId } }),
    currency: () => setCurrencyOpen(true),
    done: (finished) => void run(() => finishSharedEvent(database, ownerScope(ws), view.eventId, finished)),
    leave: () => {
      if (window.confirm(`Leave ${view.name}? What ${view.myName} recorded stays with the others, and ${view.myName}'s own books keep their share.`)) void run(() => sync.leaveEvent(view.bookId));
    },
  });
  return (
    <>
      <ErrorBox error={error} />
      <SharedEventPage view={view} menu={menu} />
      {currencyOpen ? <EventCurrencySheet view={view} onClose={() => setCurrencyOpen(false)} /> : null}
    </>
  );
}
```

In `LocalEventPage`, next to `const [page, setPage] = useState(0);` add `const [sharing, setSharing] = useState(false);`; after the `addSpending` action add:

```tsx
  const share: CornerAction = { key: 'share', label: 'Share this event', run: () => setSharing(true) };
```

pass `actions={[addSpending, share]}` to its `LargeTitle`, and render, at the end of its outermost `div`:

```tsx
      {sharing && event ? <ShareEventSheet event={event} onClose={() => setSharing(false)} /> : null}
```

In `apps/web/src/app/router.tsx`, import `{ PeoplePage } from '../features/events/PeoplePage'` and add after the `/events/$eventId` route:

```ts
  // A shared event's people (shared events §6): invite, add a name, a new phone, remove.
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId/people', component: PeoplePage }),
```

- [ ] **Step 8: Joining an event**

`apps/web/src/features/sharing/JoinEvent.tsx`:

```tsx
import { ownerScope, type PreviewedInvite } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, SubmitRow, TextRow } from '../../ui/native';
import { eventDates } from '../events/EventsPage';
import { joinChoices } from './join-event';
import { thisDeviceName } from './SharingSection';

/**
 * "Join Coast week" (shared events §6): the event, who invited, and who is joining — a name nobody has claimed ("I'm
 * Budi") or a new one. A same-person invite (a new phone) joins as that person, with nothing to choose.
 */
export function JoinEvent({ code, preview }: { code: string; preview: PreviewedInvite }) {
  const event = preview.event!;
  const { ws, sync } = useApp();
  const navigate = useNavigate();
  const choices = joinChoices(event);
  const same = preview.terms.sameMember;
  const [choice, setChoice] = useState(choices[0]!.key);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const picked = choices.find((c) => c.key === choice)!;
  const unusable = preview.claimed ? 'Someone has already used this invite. Ask for a new one.' : preview.expired ? 'This invite has expired. Ask for a new one.' : null;

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const joiningAs = same ? (preview.memberName ?? '') : picked.personId ? picked.name : name.trim();
      const { eventId } = await sync.joinEvent(code, { ws: ownerScope(ws), personId: same ? null : picked.personId, name: joiningAs, deviceName: thisDeviceName() });
      await navigate({ to: '/events/$eventId', params: { eventId } });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label={`Join ${event.name}`} onSubmit={(e) => void join(e)} data-testid="join-event">
      <ErrorBox error={error} />
      <InsetGroup wide header={`Join ${event.name}`} footer={unusable ?? 'Everyone in it sees every expense, who paid and how it is split.'}>
        <ReadOnlyRow label="Dates" value={eventDates(event)} />
        <ReadOnlyRow label="Currency" value={event.currency} />
        <ReadOnlyRow label="Invited by" value={preview.inviterName} />
      </InsetGroup>
      {unusable ? null : (
        <InsetGroup wide header={same ? undefined : 'Joining as'}>
          {same ? (
            <ReadOnlyRow label="Joining as" value={preview.memberName ?? ''} />
          ) : (
            choices.map((c) => <InsetRow key={c.key} title={c.label} value={choice === c.key ? '✓' : undefined} onClick={() => setChoice(c.key)} label={c.label} testId="join-choice" />)
          )}
          {!same && picked.personId === null ? <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="As the others will see it" /> : null}
          <SubmitRow label={busy ? 'Joining…' : 'Join'} disabled={busy || (!same && picked.personId === null && !name.trim())} />
        </InsetGroup>
      )}
    </form>
  );
}
```

In `apps/web/src/features/sharing/JoinWorkspace.tsx`, import `{ JoinEvent } from './JoinEvent'` and change `{preview ? (` (the second form) to render the event's join instead when the preview is an event's:

```tsx
      {preview?.event ? <JoinEvent code={code} preview={preview} /> : preview ? (
```

(the currency refusal is never computed for an event's preview: change `const refusal = preview && preview.baseCurrency !== ws.baseCurrency ? …` to `const refusal = preview && !preview.event && preview.baseCurrency !== ws.baseCurrency ? …`).

- [ ] **Step 9: Typecheck, the web suite and the sharing e2e**

Run: `npm run typecheck && npm run test -w @expanses/web`
Expected: PASS.
Run: `npm run e2e -w @expanses/web -- sharing.spec.ts events.spec.ts`
Expected: PASS — joining a workspace reads exactly as before.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/sync/sync-service.ts apps/web/src/features/events apps/web/src/app/router.tsx apps/web/src/features/sharing
git commit -m "$(cat <<'EOF'
Sharing an event, joining it by name, and its People, Currency, Done and Leave

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Web — the Add screen in a shared event, tagging that moves, and the receipt

Spec §6 ("Add screen in a shared event: the event filled in; Paid by…; Split ('Equal · 3 people', tap to tick people or type amounts); Category from the event's categories; any currency, with the rate to the event currency shown and editable"; "Tagging into a shared event (Select or the Event row): 'Moves to Turkey trip, shared with 2 people.'"), §7 ("Changed by Andi"; payer-only), D8, R13. A shared event's spending is recorded on its own card on the same route, `/transactions/new?event=…`: its rows (Paid by, Split, the event's categories, the rate) replace the workspace's (Paid with, Category from a book, With), so the workspace card is not bent to carry both.

**Files:**
- Create: `apps/web/src/features/transactions/shared-expense-form.ts`
- Create: `apps/web/src/features/transactions/shared-expense-form.test.ts`
- Create: `apps/web/src/features/transactions/SharedExpenseCard.tsx`
- Create: `apps/web/src/features/transactions/ShareSplitSheet.tsx`
- Create: `apps/web/src/features/transactions/shared-move.ts`
- Create: `apps/web/src/features/transactions/shared-move.test.ts`
- Modify: `apps/web/src/features/transactions/FormPage.tsx` (`NewTransactionRoute` opens the shared card for a shared event)
- Modify: `apps/web/src/features/transactions/MoreDetails.tsx` (the Event row: a shared event opens its own card when adding; says it moves when editing)
- Modify: `apps/web/src/features/transactions/TransactionCard.tsx` (an edit tagged into a shared event moves after it saves)
- Modify: `apps/web/src/features/transactions/TransactionsPage.tsx` (Select → Add to event moves into a shared event)
- Modify: `apps/web/src/features/transactions/ReceiptPage.tsx` ("Changed by", "From Coast week"; Edit opens the record)
- Modify: `packages/db/src/repos/shared-event-reads.ts` (`eventPostingOf`)

**Interfaces:**
- Consumes: Task 6 (`recordSharedExpense`, `editSharedExpense`, `voidSharedExpense`, `SharedExpenseInput`, `SharedExpensePatch`), Task 7 (`SharedEventView`, `SharedExpenseView`, `linkSharedItem`), Task 10 (`moveIntoSharedEvent`), Task 11 (`useSharedEventView`, `useSharedEventSummaries`, `moneyAccounts`, `possessive`); core `parseMajor`, `minorToMajorString`, `isRateString`, `rateString`, `sharesOf`, `toEvent`.
- Produces:
  - `eventPostingOf(database: Database, transactionId: string): Promise<{ eventId: string; kind: 'expense' | 'settlement'; recordId: string; changedByName: string | null } | null>` (db)
  - `shared-expense-form.ts`: `interface SharedExpenseDraft { occurredOn: string; note: string; amount: string; currency: string; rate: string; payer: string; accountId: string; charged: string; splitMode: 'equal' | 'amounts'; ticked: string[]; amounts: Record<string, string>; categoryId: string }`, `emptySharedDraft(view: SharedEventView, today: string): SharedExpenseDraft`, `draftFromExpense(view: SharedEventView, e: SharedExpenseView): SharedExpenseDraft`, `payerChoices(view: SharedEventView): { personId: string; label: string }[]`, `splitSummary(draft: SharedExpenseDraft): string`, `suggestedRate(currency: string, eventCurrency: string, base: string, ratesToBase: Record<string, number>): string | null`, `sharedDraftToInput(draft: SharedExpenseDraft, view: SharedEventView, accounts: readonly AccountRow[]): SharedExpenseInput`, `sharedDraftToPatch(draft: SharedExpenseDraft, view: SharedEventView, expenseId: string): SharedExpensePatch`, `moneyLocked(e: SharedExpenseView | null): string | null`
  - `shared-move.ts`: `moveHint(eventName: string, sharedWith: number): string`, `keptText(kept: readonly MoveRefusal[]): string`

- [ ] **Step 1: Write the failing pure tests**

`apps/web/src/features/transactions/shared-expense-form.test.ts`:

```ts
import { formatMinor } from '@expanses/core';
import type { AccountRow, SharedEventView, SharedExpenseView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { draftFromExpense, emptySharedDraft, moneyLocked, payerChoices, sharedDraftToInput, sharedDraftToPatch, splitSummary, suggestedRate } from './shared-expense-form';

/*
 * The Add screen in a shared event (shared events §6): Paid by this person (with an account) or a person without the
 * app (R13); Split equal over the ticked people or by amount; the event's categories; any currency with its rate to the
 * event's. Coast week is in lira; Rina's phone.
 */

const view: SharedEventView = {
  eventId: 'ev', bookId: 'b', name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', finishedAt: null, state: 'active', me: 'p-rina', myName: 'Rina',
  people: [
    { personId: 'p-rina', name: 'Rina', initials: 'R', hasApp: true, isMe: true, removed: false, balanceMinor: 0 },
    { personId: 'p-andi', name: 'Andi', initials: 'A', hasApp: true, isMe: false, removed: false, balanceMinor: 0 },
    { personId: 'p-budi', name: 'Budi', initials: 'B', hasApp: false, isMe: false, removed: false, balanceMinor: 0 },
    { personId: 'p-eko', name: 'Eko', initials: 'E', hasApp: false, isMe: false, removed: true, balanceMinor: 0 },
  ],
  categories: [{ categoryId: 'cat-dinners', name: 'Dinners', icon: null, archived: false }],
  expenses: [], settlements: [], spentMinor: 0, myShareMinor: 0, payments: [], waiting: [], currencyLocked: false,
};
const accounts = [
  { id: 'wallet', name: 'Euro wallet', kind: 'asset', subtype: 'cash', currency: 'EUR', archivedAt: null },
  { id: 'card', name: 'Travel card', kind: 'liability', subtype: 'credit_card', currency: 'IDR', archivedAt: null },
] as unknown as AccountRow[];

describe('the shared Add screen', () => {
  it('opens on this person paying, everyone still in the event ticked, in the event currency at rate 1', () => {
    const draft = emptySharedDraft(view, '2026-10-06');
    expect(draft).toMatchObject({ occurredOn: '2026-10-06', currency: 'TRY', rate: '1', payer: 'p-rina', splitMode: 'equal', ticked: ['p-rina', 'p-andi', 'p-budi'] });
    expect(splitSummary(draft)).toBe('Equal · 3 people');
  });

  it('offers this person and the people without the app as the payer (R13)', () => {
    expect(payerChoices(view)).toEqual([
      { personId: 'p-rina', label: 'Rina (this phone)' },
      { personId: 'p-budi', label: 'Budi' },
    ]);
  });

  it('suggests the rate to the event currency through the base currency', () => {
    expect(suggestedRate('EUR', 'TRY', 'IDR', { EUR: 17_640, TRY: 560 })).toBe('31.5');
    expect(suggestedRate('TRY', 'TRY', 'IDR', {})).toBe('1');
    expect(suggestedRate('EUR', 'TRY', 'IDR', { EUR: 17_640 })).toBeNull();
  });

  it('builds a euro dinner paid from the euro wallet, split three ways', () => {
    const draft = { ...emptySharedDraft(view, '2026-10-06'), note: 'Fish dinner', amount: '90', currency: 'EUR', rate: '31,5', accountId: 'wallet', categoryId: 'cat-dinners' };
    expect(sharedDraftToInput(draft, view, accounts)).toEqual({
      occurredOn: '2026-10-06', amountMinor: 9_000, currency: 'EUR', rateToEvent: '31.5', payerPersonId: 'p-rina',
      paidFrom: { accountId: 'wallet', chargedMinor: null }, split: { mode: 'equal', people: ['p-rina', 'p-andi', 'p-budi'] }, categoryId: 'cat-dinners', note: 'Fish dinner',
    });
  });

  it('asks what a card in another currency was charged, and takes amounts that add up', () => {
    const base = { ...emptySharedDraft(view, '2026-10-06'), amount: '300', accountId: 'card' };
    expect(() => sharedDraftToInput(base, view, accounts)).toThrow('Enter what Travel card was charged in IDR');
    expect(sharedDraftToInput({ ...base, charged: '168000' }, view, accounts).paidFrom).toEqual({ accountId: 'card', chargedMinor: 168_000 });
    const byAmount = { ...base, charged: '168000', splitMode: 'amounts' as const, amounts: { 'p-rina': '100', 'p-andi': '150' } };
    expect(() => sharedDraftToInput(byAmount, view, accounts)).toThrow(`The amounts add up to ${formatMinor(25_000, 'TRY')}, not ${formatMinor(30_000, 'TRY')}`);
    expect(sharedDraftToInput({ ...byAmount, amounts: { 'p-rina': '100', 'p-andi': '200' } }, view, accounts).split).toEqual({ mode: 'amounts', shares: [{ personId: 'p-rina', minor: 10_000 }, { personId: 'p-andi', minor: 20_000 }] });
  });

  it('records Budi’s payment with no account', () => {
    const draft = { ...emptySharedDraft(view, '2026-10-07'), amount: '1800', payer: 'p-budi', ticked: ['p-rina', 'p-budi'] };
    expect(sharedDraftToInput(draft, view, accounts)).toMatchObject({ payerPersonId: 'p-budi', paidFrom: null, split: { mode: 'equal', people: ['p-rina', 'p-budi'] } });
  });

  it('opens an expense another member paid with its money locked, and edits only what changed', () => {
    const andis: SharedExpenseView = {
      expenseId: 'e1', occurredOn: '2026-10-08', amountMinor: 60_000, currency: 'TRY', rateToEvent: '1', eventAmountMinor: 60_000, payerPersonId: 'p-andi', payerName: 'Andi', payerHasAccount: true,
      categoryId: null, categoryName: null, note: 'Boat', split: { mode: 'equal', people: ['p-rina', 'p-andi'] }, splitText: 'Equal · 2 people', myShareMinor: 30_000, myShareEventMinor: 30_000,
      voided: false, unsent: false, payerOnly: true, posting: null,
    };
    expect(moneyLocked(andis)).toBe('Only Andi changes the amount, currency, rate or date of what Andi paid');
    const draft = draftFromExpense(view, andis);
    expect(draft).toMatchObject({ amount: '600.00', currency: 'TRY', payer: 'p-andi', ticked: ['p-rina', 'p-andi'], note: 'Boat' });
    expect(sharedDraftToPatch({ ...draft, ticked: ['p-andi'] }, { ...view, expenses: [andis] }, 'e1')).toEqual({ split: { mode: 'equal', people: ['p-andi'] } });
  });
});
```

`apps/web/src/features/transactions/shared-move.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { keptText, moveHint } from './shared-move';

describe('tagging into a shared event (§6)', () => {
  it('says the purchase moves, and to whom it is shown', () => {
    expect(moveHint('Coast week', 2)).toBe('Moves to Coast week, shared with 2 people.');
    expect(moveHint('Coast week', 1)).toBe('Moves to Coast week, shared with 1 person.');
  });

  it('says what stayed, and why', () => {
    expect(keptText([{ transactionId: 't', why: 'A refund stays where it is' }])).toBe('1 stayed where it was: A refund stays where it is');
    expect(keptText([{ transactionId: 'a', why: 'x' }, { transactionId: 'b', why: 'y' }])).toBe('2 stayed where they were: x');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && npx vitest run src/features/transactions/shared-expense-form.test.ts src/features/transactions/shared-move.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Write the form model and the move words**

`apps/web/src/features/transactions/shared-expense-form.ts`:

```ts
import { formatMinor, isRateString, minorToMajorString, parseMajor, parseRate, rateString } from '@expanses/core';
import type { AccountRow, SharedEventView, SharedExpenseInput, SharedExpensePatch, SharedExpenseView } from '@expanses/db';
import { moneyAccounts } from '../events/shared-view';

/*
 * The Add screen in a shared event (shared events §6), as data: what the card holds, what it offers, and what it
 * sends. Every refusal is in words that name people and never say "you".
 */

export interface SharedExpenseDraft {
  occurredOn: string;
  note: string;
  /** Typed, in `currency`. */
  amount: string;
  currency: string;
  /** Units of the event currency per one `currency`, as typed; '1' in the event currency. */
  rate: string;
  /** The payer's person id. */
  payer: string;
  /** This person's own account, when this person paid. */
  accountId: string;
  /** What that account was charged, in its own currency, when it is not `currency`. */
  charged: string;
  splitMode: 'equal' | 'amounts';
  ticked: string[];
  amounts: Record<string, string>;
  categoryId: string;
}

const live = (view: SharedEventView) => view.people.filter((p) => !p.removed);

export function emptySharedDraft(view: SharedEventView, today: string): SharedExpenseDraft {
  return {
    occurredOn: today,
    note: '',
    amount: '',
    currency: view.currency,
    rate: '1',
    payer: view.me,
    accountId: '',
    charged: '',
    splitMode: 'equal',
    ticked: live(view).map((p) => p.personId),
    amounts: {},
    categoryId: '',
  };
}

export function draftFromExpense(view: SharedEventView, e: SharedExpenseView): SharedExpenseDraft {
  return {
    occurredOn: e.occurredOn,
    note: e.note ?? '',
    amount: minorToMajorString(e.amountMinor, e.currency),
    currency: e.currency,
    rate: e.rateToEvent,
    payer: e.payerPersonId,
    accountId: '',
    charged: '',
    splitMode: e.split.mode,
    ticked: e.split.mode === 'equal' ? [...e.split.people] : e.split.shares.map((s) => s.personId),
    amounts: e.split.mode === 'amounts' ? Object.fromEntries(e.split.shares.map((s) => [s.personId, minorToMajorString(s.minor, e.currency)])) : {},
    categoryId: e.categoryId ?? '',
  };
}

/** R13: this person, with one of their own accounts, or a person without the app. */
export function payerChoices(view: SharedEventView): { personId: string; label: string }[] {
  return live(view)
    .filter((p) => p.isMe || !p.hasApp)
    .map((p) => ({ personId: p.personId, label: p.isMe ? `${p.name} (this phone)` : p.name }));
}

export function splitSummary(draft: SharedExpenseDraft): string {
  const count = draft.splitMode === 'equal' ? draft.ticked.length : Object.values(draft.amounts).filter((v) => v.trim()).length;
  return `${draft.splitMode === 'equal' ? 'Equal' : 'By amount'} · ${count} ${count === 1 ? 'person' : 'people'}`;
}

/** The rate to suggest: the day's rates to the base currency, divided; '1' in the event currency; null without both. */
export function suggestedRate(currency: string, eventCurrency: string, base: string, ratesToBase: Record<string, number>): string | null {
  if (currency === eventCurrency) return '1';
  const from = currency === base ? 1 : ratesToBase[currency];
  const to = eventCurrency === base ? 1 : ratesToBase[eventCurrency];
  return from && to ? rateString(from / to) : null;
}

function rateOf(draft: SharedExpenseDraft, view: SharedEventView): string {
  if (draft.currency === view.currency) return '1';
  if (!draft.rate.trim()) throw new Error(`Enter the rate: ${view.currency} per 1 ${draft.currency}`);
  const typed = isRateString(draft.rate.trim()) ? draft.rate.trim() : rateString(parseRate(draft.rate));
  return typed;
}

function splitOf(draft: SharedExpenseDraft, amountMinor: number): SharedExpenseInput['split'] {
  if (draft.splitMode === 'equal') {
    if (draft.ticked.length === 0) throw new Error('Tick at least one person to share it');
    return { mode: 'equal', people: [...draft.ticked] };
  }
  const shares = Object.entries(draft.amounts)
    .filter(([, typed]) => typed.trim())
    .map(([personId, typed]) => ({ personId, minor: parseMajor(typed, draft.currency) }));
  const sum = shares.reduce((total, s) => total + s.minor, 0);
  if (sum !== amountMinor) throw new Error(`The amounts add up to ${formatMinor(sum, draft.currency)}, not ${formatMinor(amountMinor, draft.currency)}`);
  return { mode: 'amounts', shares };
}

export function sharedDraftToInput(draft: SharedExpenseDraft, view: SharedEventView, accounts: readonly AccountRow[]): SharedExpenseInput {
  if (!draft.amount.trim()) throw new Error('Enter an amount');
  const amountMinor = parseMajor(draft.amount, draft.currency);
  const mine = draft.payer === view.me;
  let paidFrom: SharedExpenseInput['paidFrom'] = null;
  if (mine) {
    const account = moneyAccounts(accounts).find((a) => a.id === draft.accountId);
    if (!account) throw new Error(`Choose the account ${view.myName} paid from`);
    const foreign = account.currency !== draft.currency;
    if (foreign && !draft.charged.trim()) throw new Error(`Enter what ${account.name} was charged in ${account.currency}`);
    paidFrom = { accountId: account.id, chargedMinor: foreign ? parseMajor(draft.charged, account.currency!) : null };
  }
  return {
    occurredOn: draft.occurredOn,
    amountMinor,
    currency: draft.currency,
    rateToEvent: rateOf(draft, view),
    payerPersonId: draft.payer,
    paidFrom,
    split: splitOf(draft, amountMinor),
    categoryId: draft.categoryId || null,
    note: draft.note.trim() || null,
  };
}

/** What an edit changed, and nothing else: an edit that does not touch the money never asks for its payer. */
export function sharedDraftToPatch(draft: SharedExpenseDraft, view: SharedEventView, expenseId: string): SharedExpensePatch {
  const original = view.expenses.find((e) => e.expenseId === expenseId);
  if (!original) throw new Error('That expense was deleted');
  const amountMinor = parseMajor(draft.amount, draft.currency);
  const split = splitOf(draft, amountMinor);
  const patch: SharedExpensePatch = {};
  if (draft.occurredOn !== original.occurredOn) patch.occurredOn = draft.occurredOn;
  if (amountMinor !== original.amountMinor) patch.amountMinor = amountMinor;
  if (draft.currency !== original.currency) patch.currency = draft.currency;
  const rate = rateOf(draft, view);
  if (rate !== original.rateToEvent) patch.rateToEvent = rate;
  if (JSON.stringify(split) !== JSON.stringify(original.split)) patch.split = split;
  if ((draft.categoryId || null) !== original.categoryId) patch.categoryId = draft.categoryId || null;
  if ((draft.note.trim() || null) !== original.note) patch.note = draft.note.trim() || null;
  // What this person's own account was charged, in its currency, when that is not the expense's (R5).
  const own = original.posting?.accountCurrency ?? null;
  if (draft.charged.trim() && own) patch.chargedMinor = parseMajor(draft.charged, own);
  return patch;
}

/** D8: the amount, currency, rate and date of what another member paid are theirs alone; said, not hidden. */
export function moneyLocked(e: SharedExpenseView | null): string | null {
  return e?.payerOnly ? `Only ${e.payerName} changes the amount, currency, rate or date of what ${e.payerName} paid` : null;
}
```

`apps/web/src/features/transactions/shared-move.ts`:

```ts
import type { MoveRefusal } from '@expanses/db';

/** Under the Event row and on Select's confirmation (shared events §6): tagging into a shared event moves it. */
export function moveHint(eventName: string, sharedWith: number): string {
  return `Moves to ${eventName}, shared with ${sharedWith} ${sharedWith === 1 ? 'person' : 'people'}.`;
}

/** What stayed behind a move, and the first reason. */
export function keptText(kept: readonly MoveRefusal[]): string {
  return `${kept.length} stayed where ${kept.length === 1 ? 'it was' : 'they were'}: ${kept[0]!.why}`;
}
```

- [ ] **Step 4: Run the pure tests**

Run: `cd apps/web && npx vitest run src/features/transactions/shared-expense-form.test.ts src/features/transactions/shared-move.test.ts`
Expected: PASS. `parseMajor('31,5', …)` is not used for rates: `parseRate` reads "31,5" as 31.5, and `rateString` writes '31.5'.

- [ ] **Step 5: Which record a derived transaction follows (db)**

In `packages/db/src/repos/shared-event-reads.ts`, add:

```ts
/** The shared event's record a transaction follows, for its receipt (§7 "Changed by"); null for any other transaction. */
export async function eventPostingOf(
  database: Database,
  transactionId: string,
): Promise<{ eventId: string; kind: 'expense' | 'settlement'; recordId: string; changedByName: string | null } | null> {
  const [row] = await database.db
    .values<[string, string, string, string | null]>(sql`
      SELECT b.event_id, p.kind, p.record_id, (SELECT name FROM event_people WHERE book_id = p.book_id AND id = p.changed_by)
      FROM event_postings p JOIN event_books b ON b.book_id = p.book_id WHERE p.transaction_id = ${transactionId}`)
    .catch(() => []);
  return row ? { eventId: row[0], kind: row[1] as 'expense' | 'settlement', recordId: row[2], changedByName: row[3] } : null;
}
```

- [ ] **Step 6: The split sheet and the card**

`apps/web/src/features/transactions/ShareSplitSheet.tsx`:

```tsx
import type { SharedEventView } from '@expanses/db';
import { Sheet } from '../../app/Sheet';
import { InsetGroup, InsetRow, SegmentedControl, TextRow } from '../../ui/native';
import type { SharedExpenseDraft } from './shared-expense-form';

/** Split (§6): tick the people sharing it equally, or type each one's amount. Everyone still in the event is offered. */
export function ShareSplitSheet({ view, draft, set, onClose }: { view: SharedEventView; draft: SharedExpenseDraft; set: (patch: Partial<SharedExpenseDraft>) => void; onClose: () => void }) {
  const people = view.people.filter((p) => !p.removed);
  return (
    <Sheet grouped title="Split" onClose={onClose}>
      <SegmentedControl label="How it is split" segments={[{ key: 'equal', label: 'Equal' }, { key: 'amounts', label: 'By amount' }]} value={draft.splitMode} onChange={(mode) => set({ splitMode: mode as 'equal' | 'amounts' })} />
      <InsetGroup>
        {people.map((p) =>
          draft.splitMode === 'equal' ? (
            <InsetRow
              key={p.personId}
              title={p.name}
              value={draft.ticked.includes(p.personId) ? '✓' : undefined}
              label={`${p.name} shares it`}
              onClick={() => set({ ticked: draft.ticked.includes(p.personId) ? draft.ticked.filter((id) => id !== p.personId) : [...draft.ticked, p.personId] })}
              testId="split-person"
            />
          ) : (
            <TextRow key={p.personId} label={p.name} inputMode="decimal" value={draft.amounts[p.personId] ?? ''} onChange={(e) => set({ amounts: { ...draft.amounts, [p.personId]: e.target.value } })} />
          ),
        )}
      </InsetGroup>
    </Sheet>
  );
}
```

`apps/web/src/features/transactions/SharedExpenseCard.tsx`:

```tsx
import { CURRENCIES, isoDate } from '@expanses/core';
import { editSharedExpense, linkSharedItem, ownerScope, recordSharedExpense, type SharedEventView, sharedEventView, voidSharedExpense } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SelectRow, SubmitRow, TextRow } from '../../ui/native';
import { moneyAccounts } from '../events/shared-view';
import { draftFromExpense, emptySharedDraft, moneyLocked, payerChoices, sharedDraftToInput, sharedDraftToPatch, splitSummary, suggestedRate } from './shared-expense-form';
import { ShareSplitSheet } from './ShareSplitSheet';

/**
 * The Add screen in a shared event (shared events §6): the event filled in; Paid by this person (from one of their
 * accounts, with what a card in another currency was charged) or a person without the app; Split; the event's
 * categories; any currency, with its rate to the event currency suggested from the day's rates and editable. Opened on
 * an expense, it edits it — the money of what another member paid is greyed, saying whose it is (D8).
 */
export function SharedExpenseCard({ view, expenseId, itemId, onDone }: { view: SharedEventView; expenseId?: string; itemId?: string; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts().data ?? [];
  const editing = expenseId ? (view.expenses.find((e) => e.expenseId === expenseId) ?? null) : null;
  const [draft, setDraft] = useState(() => (editing ? draftFromExpense(view, editing) : emptySharedDraft(view, isoDate())));
  const [splitting, setSplitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const locked = moneyLocked(editing);
  const mine = draft.payer === view.me;
  const account = moneyAccounts(accounts).find((a) => a.id === draft.accountId) ?? null;
  // Editing this person's own payment from an account in another currency: what it was charged, if the money changes.
  const ownCurrency = editing?.posting?.accountCurrency ?? null;

  async function pickCurrency(currency: string) {
    set({ currency });
    const { rates } = await resolveRates([currency, view.currency], draft.occurredOn).catch(() => ({ rates: {} as Record<string, number> }));
    const suggested = suggestedRate(currency, view.currency, ws.baseCurrency, rates);
    if (suggested) set({ rate: suggested });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The day's rates to the base currency, so this phone posts its share at once (§5).
      await resolveRates([draft.currency, view.currency, ...(account?.currency ? [account.currency] : [])], draft.occurredOn).catch(() => undefined);
      if (editing) {
        await editSharedExpense(database, ownerScope(ws), view.eventId, editing.expenseId, sharedDraftToPatch(draft, view, editing.expenseId));
      } else {
        const input = sharedDraftToInput(draft, view, accounts);
        const id = await recordSharedExpense(database, ownerScope(ws), view.eventId, input);
        // Buy it now: the expense is the item, so the item takes the whole of it as its share (D7).
        if (itemId) {
          const fresh = await sharedEventView(database, ownerScope(ws), view.eventId);
          const share = fresh?.expenses.find((e) => e.expenseId === id)?.eventAmountMinor;
          if (share) await linkSharedItem(database, ownerScope(ws), view.eventId, itemId, { expenseId: id, shareMinor: share });
        }
      }
      await invalidate();
      onDone();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setError(null);
    try {
      await voidSharedExpense(database, ownerScope(ws), view.eventId, editing.expenseId);
      await invalidate();
      onDone();
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <form aria-label={editing ? 'Edit shared spending' : 'Add shared spending'} onSubmit={(event) => void save(event)} data-testid="shared-expense-card">
      <LargeTitle title={editing ? 'Shared spending' : `Spending on ${view.name}`} back={view.name} onBack={onDone} />
      <ErrorBox error={error} />
      <InsetGroup footer={locked ?? undefined}>
        <ReadOnlyRow label="Event" value={view.name} />
        <TextRow label="Date" type="date" value={draft.occurredOn} disabled={!!locked} onChange={(e) => set({ occurredOn: e.target.value })} />
        <TextRow label="Note" value={draft.note} onChange={(e) => set({ note: e.target.value })} />
        <TextRow label="Amount" inputMode="decimal" value={draft.amount} disabled={!!locked} onChange={(e) => set({ amount: e.target.value })} />
        <SelectRow label="Currency" value={draft.currency} disabled={!!locked} onChange={(e) => void pickCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </SelectRow>
        {draft.currency !== view.currency ? (
          <TextRow label={`Rate to ${view.currency}`} hint={`${view.currency} per 1 ${draft.currency}`} inputMode="decimal" value={draft.rate} disabled={!!locked} onChange={(e) => set({ rate: e.target.value })} />
        ) : null}
      </InsetGroup>
      <InsetGroup>
        {editing ? (
          <ReadOnlyRow label="Paid by" value={editing.payerName} />
        ) : (
          <SelectRow label="Paid by" value={draft.payer} onChange={(e) => set({ payer: e.target.value })}>
            {payerChoices(view).map((p) => (
              <option key={p.personId} value={p.personId}>
                {p.label}
              </option>
            ))}
          </SelectRow>
        )}
        {mine && !editing ? (
          <SelectRow label="Paid with" value={draft.accountId} onChange={(e) => set({ accountId: e.target.value })}>
            <option value="">Choose…</option>
            {moneyAccounts(accounts).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </SelectRow>
        ) : null}
        {mine && account && account.currency !== draft.currency ? (
          <TextRow label={`Charged in ${account.currency}`} inputMode="decimal" value={draft.charged} onChange={(e) => set({ charged: e.target.value })} />
        ) : null}
        {editing && !locked && ownCurrency && ownCurrency !== draft.currency ? (
          <TextRow label={`Charged in ${ownCurrency}`} hint="Only when the amount changed" inputMode="decimal" value={draft.charged} onChange={(e) => set({ charged: e.target.value })} />
        ) : null}
        <InsetRow title="Split" value={splitSummary(draft)} onClick={() => setSplitting(true)} testId="split-row" />
        <SelectRow label="Category" value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
          <option value="">No category</option>
          {view.categories
            .filter((c) => !c.archived)
            .map((c) => (
              <option key={c.categoryId} value={c.categoryId}>
                {c.name}
              </option>
            ))}
        </SelectRow>
        <SubmitRow label={busy ? 'Saving…' : 'Save'} disabled={busy} />
      </InsetGroup>
      {editing && !locked ? (
        <InsetGroup>
          <InsetRow title="Delete" destructive onClick={() => void remove()} />
        </InsetGroup>
      ) : null}
      {splitting ? <ShareSplitSheet view={view} draft={draft} set={set} onClose={() => setSplitting(false)} /> : null}
    </form>
  );
}
```

- [ ] **Step 7: The route opens the shared card**

In `apps/web/src/features/transactions/FormPage.tsx` `NewTransactionRoute`, read `expense` from the search with the others (`const { mode, account, to, event, item, expense, ws: tab } = newRoute.useSearch();`), add:

```tsx
import { useSharedEventView } from '../events/shared-queries';
import { SharedExpenseCard } from './SharedExpenseCard';
```

and before `return (`:

```tsx
  // A shared event is recorded on its own card (shared events §6): Paid by, Split, its categories, its rate.
  const shared = useSharedEventView(event ?? null);
  if (event && shared.isPending) return <div className={SCREEN}><Card>Loading…</Card></div>;
  if (event && shared.data) {
    const toEvent = () => void navigate({ to: '/events/$eventId', params: { eventId: event }, replace: true });
    return (
      <div className={SCREEN}>
        <SharedExpenseCard view={shared.data} {...(expense ? { expenseId: expense } : {})} {...(item ? { itemId: item } : {})} onDone={toEvent} />
      </div>
    );
  }
```

(Hooks first: `useSharedEventView` sits with the other hooks at the top of the component, before any early return.)

- [ ] **Step 8: The Event row, an edit that moves, and Select**

In `apps/web/src/features/transactions/MoreDetails.tsx`, add the imports `import { useNavigate } from '@tanstack/react-router';`, `import { addSpendingTarget } from '../events/buy-item';`, `import { useSharedEventSummaries } from '../events/shared-queries';`, `import { moveHint } from './shared-move';` and, in the component, `const summaries = useSharedEventSummaries().data ?? {}; const navigate = useNavigate();`. Under the Event row add:

```tsx
        {rows.includes('event') && draft.editing && summaries[draft.eventId] ? (
          <p className="px-[16px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="moves-hint">
            {moveHint(eventName, summaries[draft.eventId]!.sharedWith)}
          </p>
        ) : null}
```

and change the sheet's pick to open a shared event's own card while adding:

```tsx
      {sheet === 'event' && (
        <EventSheet
          value={draft.eventId}
          onPick={(eventId) => (!draft.editing && summaries[eventId] ? void navigate({ ...addSpendingTarget(eventId), replace: true }) : set({ eventId }))}
          onClose={() => setSheet(null)}
        />
      )}
```

In `apps/web/src/features/transactions/TransactionCard.tsx`, add `moveIntoSharedEvent` and `ownerScope` to its `@expanses/db` import, `import { useSharedEventSummaries } from '../events/shared-queries';`, read `const sharedSummaries = useSharedEventSummaries().data ?? {};` with the other hooks, and replace the edit's save line:

```tsx
        else if (initial) {
          const replaced = await replaceTransaction(database, ws, initial.id, { ...post.input, ratesToBase, setAside: setAside.choice });
          // Tagged into a shared event by the Event row: it moves there now (shared events §6, D2).
          if (draft.eventId && draft.eventId !== initial.eventId && sharedSummaries[draft.eventId]) {
            const { kept } = await moveIntoSharedEvent(database, ownerScope(ws), draft.eventId, [replaced]);
            if (kept.length > 0) throw new Error(kept[0]!.why);
          }
        }
```

In `apps/web/src/features/transactions/TransactionsPage.tsx`, add the imports `moveIntoSharedEvent`, `sharedEventOf` and (if not there yet) `ownerScope` (db), `useSharedEventSummaries` (events/shared-queries), `useResolveRates` (lib/queries, if not imported), `{ keptText, moveHint }` (./shared-move), read `const sharedSummaries = useSharedEventSummaries().data ?? {};` and `const resolveRates = useResolveRates();` with the other hooks, and at the top of `tagChosen` add:

```tsx
    // Into a shared event, the rows move: they leave this workspace and become this person's own expenses there (§6).
    const shared = eventId ? sharedSummaries[eventId] : undefined;
    if (eventId && shared) {
      if (!window.confirm(moveHint(eventName(eventId) ?? 'the event', shared.sharedWith))) return;
      setTagging({ busy: true, error: null });
      try {
        // The day's rates every move needs: each purchase's currencies and the event's, through the base.
        const target = await sharedEventOf(database, ownerScope(ws), eventId);
        for (const row of chosen) {
          const tx = row.tx!;
          const currencies = [target?.currency, tx.originalCurrency, ...tx.entries.map((e) => e.currency)].filter((c): c is string => !!c);
          await resolveRates([...new Set(currencies)], tx.occurredOn).catch(() => undefined);
        }
        const { kept } = await moveIntoSharedEvent(database, ownerScope(ws), eventId, chosen.map((row) => row.id));
        await invalidate();
        stopSelecting();
        setTagging({ busy: false, error: kept.length > 0 ? new Error(keptText(kept)) : null });
      } catch (e) {
        setTagging({ busy: false, error: e });
      }
      return;
    }
```

- [ ] **Step 9: The receipt**

In `apps/web/src/features/transactions/ReceiptPage.tsx`, add `eventPostingOf` to the db import and:

```tsx
  // A transaction a shared event put here follows its record (§5): it is changed on the event, and says who changed it.
  const fromEvent = useQuery({ queryKey: ['event-posting', transactionId], queryFn: () => eventPostingOf(database, transactionId) }).data ?? null;
```

change `edit` to:

```tsx
  const edit = () =>
    fromEvent
      ? void navigate(fromEvent.kind === 'expense' ? { to: '/transactions/new', search: { event: fromEvent.eventId, expense: fromEvent.recordId } } : { to: '/events/$eventId', params: { eventId: fromEvent.eventId } })
      : phone
        ? void navigate({ to: '/transactions/$transactionId/edit', params: { transactionId } })
        : setEditing(true);
```

hide the delete control when `fromEvent` is set (wrap its button in `{fromEvent ? null : …}`: the ledger refuses it anyway, `EVENT_POSTING`), and under the hero add:

```tsx
      {fromEvent ? (
        <p className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]" data-testid="from-event">
          {fromEvent.changedByName ? `Changed by ${fromEvent.changedByName} · ` : ''}
          <Link to="/events/$eventId" params={{ eventId: fromEvent.eventId }} className="font-medium text-[var(--ph-tint)]">
            Open the event
          </Link>
        </p>
      ) : null}
```

(import `Link` from `@tanstack/react-router` if the file does not already).

- [ ] **Step 10: Typecheck, the web suite, and the add and select e2e**

Run: `npm run typecheck && npm run test -w @expanses/web && npm run test -w @expanses/db`
Expected: PASS.
Run: `npm run e2e -w @expanses/web -- add-transaction.spec.ts phone-select-to-event.spec.ts phone-add-transaction.spec.ts`
Expected: PASS — adding into an event that is not shared, and Select → Add to event into one, read exactly as before (D10).

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/features/transactions packages/db/src/repos/shared-event-reads.ts
git commit -m "$(cat <<'EOF'
Recording into a shared event: Paid by, Split, its categories and its rate on its own card; tagging into one moves the purchase; a receipt says who changed it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: End to end — two phones, a name without the app, a euro dinner in a lira trip, a settle-up in rupiah, the payer's money kept, a record made offline

Spec §9 step 5. Two browser contexts are two phones (each its own OPFS database and keys) on the local relay Worker the Playwright config starts; Budi is a name without the app. Rates are answered by a mock of the rates service (invented: 1 EUR = 17,640 IDR, 1 TRY = 560 IDR, so the suggested rate is 31.5).

**Files:**
- Create: `apps/web/e2e/shared-events.spec.ts`

**Interfaces:**
- Consumes: every screen of Tasks 11–13 by its labels and test ids (`shared-event`, `shared-event-header`, `event-shared-with`, `shared-expense-row`, `shared-expense-card`, `split-row`, `join-event`, `shared-payment-row`, `settle-up`, `take-over-row`, `trip-row`, `invite-link`); e2e helpers `openAccount` (accounts.ts), `addEvent` (event-plan.ts), `mockRates` (pockets.ts).
- Produces: nothing.

- [ ] **Step 1: Write the journey**

`apps/web/e2e/shared-events.spec.ts`:

```ts
import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { openAccount } from './accounts';
import { addEvent } from './event-plan';
import { mockRates } from './pockets';

/*
 * Shared events, end to end (shared events §9 step 5). Rina and Andi each on a phone of their own; Budi is a name
 * without the app. A week by the coast in lira: Rina pays a €90 fish dinner from her euro wallet for all three; Andi
 * cannot change what Rina paid; Andi records a boat while offline, which reaches Rina once he is back; Andi settles up
 * in rupiah; Rina takes the settle-up into her books; Debts shows what Budi still owes. Every figure is invented.
 */

test.describe.configure({ timeout: 300_000 });

const RATES = { EUR: 17_640, TRY: 560 };

async function secondPhone(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  return context.newPage();
}

/** The app comes back to the foreground: every shared book syncs (household sharing §9.4). */
async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await check();
  }).toPass({ timeout: 45_000, intervals: [500, 1_000, 2_000] });
}

/** A corner action by name, inline or under ⋯. */
async function corner(page: Page, name: string) {
  const inline = page.getByRole('button', { name, exact: true });
  if ((await inline.count()) > 0) return inline.click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
}

async function openTrip(page: Page) {
  await page.goto('/events');
  await page.getByTestId('event-row').filter({ hasText: 'Coast week' }).click();
  await expect(page.getByTestId('shared-event')).toBeVisible({ timeout: 30_000 });
}

const row = (page: Page, text: string) => page.getByTestId('shared-expense-row').filter({ hasText: text });

test('a trip in lira shared by two phones and a name: euro dinner, payer-only money, offline boat, settle-up in rupiah', async ({ page: rina, browser }, info) => {
  test.skip(info.project.name !== 'chromium', 'Two contexts on the desktop project; the phone shell is covered by its own specs');
  const andi = await secondPhone(browser, info);
  for (const phone of [rina, andi]) {
    phone.on('dialog', (dialog) => void dialog.accept());
    await mockRates(phone, RATES);
  }
  await openAccount(rina, { subtype: 'cash', name: 'Euro wallet', currency: 'EUR' });
  await openAccount(rina, { subtype: 'bank', name: 'Rina Bank', balance: '10000000' });
  await openAccount(andi, { subtype: 'bank', name: 'Andi Bank', balance: '10000000' });

  // Rina makes the trip and shares it in lira, with Budi as a name.
  await addEvent(rina, 'Coast week');
  await corner(rina, 'Share this event');
  const share = rina.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByLabel('Currency').selectOption('TRY');
  await share.getByLabel('Without the app').fill('Budi');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  const link = (await rina.getByTestId('invite-link').textContent({ timeout: 60_000 }))!.trim();
  expect(link).toMatch(/^cicis:\/\/join\//);

  // Andi joins under his own name: the link opens "Join Coast week".
  await andi.goto(`/join#${link.replace('cicis://join/', '')}`);
  const join = andi.getByTestId('join-event');
  await expect(join).toContainText('Join Coast week', { timeout: 30_000 });
  await expect(join.getByRole('button', { name: 'I’m Budi' })).toBeVisible();
  await join.getByRole('button', { name: 'Someone new' }).click();
  await join.getByLabel('Name', { exact: true }).fill('Andi');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(andi.getByTestId('shared-event')).toBeVisible({ timeout: 60_000 });

  // The events list names who it is shared with.
  await rina.goto('/events');
  await eventually(rina, () => expect(rina.getByTestId('event-shared-with')).toContainText('Shared with 2 people', { timeout: 1_000 }));

  // Rina pays a €90 fish dinner from her euro wallet, for all three; the rate to lira is suggested from the day's rates.
  await openTrip(rina);
  await corner(rina, 'Add spending');
  const card = rina.getByTestId('shared-expense-card');
  await card.getByLabel('Note', { exact: true }).fill('Fish dinner');
  await card.getByLabel('Amount', { exact: true }).fill('90');
  await card.getByLabel('Currency', { exact: true }).selectOption('EUR');
  await expect(card.getByLabel('Rate to TRY')).toHaveValue('31.5');
  await card.getByLabel('Paid with', { exact: true }).selectOption({ label: 'Euro wallet · EUR' });
  await expect(card.getByTestId('split-row')).toContainText('Equal · 3 people');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rina.getByTestId('shared-event-header')).toContainText(/Spent .*2\.835.*Rina's share .*945/);

  // Andi sees it, paid by Rina, with his share — and cannot change what Rina paid (D8).
  await openTrip(andi);
  await eventually(andi, () => expect(row(andi, 'Fish dinner')).toContainText('Rina paid', { timeout: 1_000 }));
  await expect(row(andi, 'Fish dinner')).toContainText("Andi's share");
  await row(andi, 'Fish dinner').click();
  const locked = andi.getByTestId('shared-expense-card');
  await expect(locked.getByLabel('Amount', { exact: true })).toBeDisabled();
  await expect(locked).toContainText('Only Rina changes the amount, currency, rate or date of what Rina paid');
  await openTrip(andi);

  // Andi, offline, records a ₺600 boat from his rupiah bank for himself and Rina: it waits as "Not sent yet".
  await andi.context().setOffline(true);
  await corner(andi, 'Add spending');
  const boat = andi.getByTestId('shared-expense-card');
  await boat.getByLabel('Note', { exact: true }).fill('Boat');
  await boat.getByLabel('Amount', { exact: true }).fill('600');
  await boat.getByLabel('Paid with', { exact: true }).selectOption({ label: 'Andi Bank · IDR' });
  await boat.getByLabel('Charged in IDR').fill('336000');
  await boat.getByTestId('split-row').click();
  await andi.getByRole('button', { name: 'Budi shares it' }).click();
  await andi.keyboard.press('Escape');
  await expect(boat.getByTestId('split-row')).toContainText('Equal · 2 people');
  await boat.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row(andi, 'Boat')).toContainText('Not sent yet');

  // Back online, it goes, and Rina has it.
  await andi.context().setOffline(false);
  await eventually(andi, () => expect(row(andi, 'Boat')).not.toContainText('Not sent yet', { timeout: 1_000 }));
  await openTrip(rina);
  await eventually(rina, () => expect(row(rina, 'Boat')).toContainText('Andi paid', { timeout: 1_000 }));

  // Balances: Budi owes ₺945, Andi ₺645, both to Rina; the same list on both phones (D6).
  await rina.getByRole('radio', { name: 'Balances' }).or(rina.getByRole('button', { name: 'Balances' })).first().click();
  const rinaPayments = rina.getByTestId('shared-payment-row');
  await expect(rinaPayments).toHaveCount(2);
  await expect(rinaPayments.nth(0)).toContainText(/Budi pays Rina .*945/);
  await expect(rinaPayments.nth(1)).toContainText(/Andi pays Rina .*645/);
  await andi.getByRole('radio', { name: 'Balances' }).or(andi.getByRole('button', { name: 'Balances' })).first().click();
  await expect(andi.getByTestId('shared-payment-row')).toHaveText(await rinaPayments.allTextContents());

  // Andi settles up in rupiah from his bank.
  await andi.getByTestId('shared-payment-row').filter({ hasText: 'Andi pays Rina' }).click();
  const settle = andi.getByTestId('settle-up');
  await settle.getByLabel('Paid from').selectOption({ label: 'Andi Bank · IDR' });
  await expect(settle.getByLabel('In IDR')).not.toHaveValue('');
  await settle.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(andi.getByTestId('shared-balance-row').filter({ hasText: 'Andi is settled' })).toBeVisible({ timeout: 30_000 });

  // Rina takes the settle-up into her books, into her rupiah bank (R6).
  await openTrip(rina);
  await eventually(rina, () => expect(rina.getByTestId('take-over-row')).toContainText("1 record is not in Rina's books yet", { timeout: 1_000 }));
  await rina.getByTestId('take-over-row').click();
  await rina.getByLabel('From', { exact: true }).selectOption({ label: 'Rina Bank · IDR' });
  await rina.getByRole('button', { name: 'Add to the books' }).click();
  await expect(rina.getByTestId('take-over-row')).toHaveCount(0, { timeout: 30_000 });

  // Debts shows the trip, and what Budi still owes.
  await rina.goto('/net-worth/lend-borrow');
  await expect(rina.getByTestId('trip-row').filter({ hasText: 'Coast week' })).toContainText(/Budi pays Rina .*945/);
});
```

- [ ] **Step 2: Run it**

Run: `npm run e2e -w @expanses/web -- shared-events.spec.ts --project=chromium`
Expected: PASS. A failure here is a defect in Tasks 8–13, never a reason to loosen a check: read the trace (`trace: 'retain-on-failure'`), fix the owning task's code, and run that task's own tests again before this one.

- [ ] **Step 3: Run the whole e2e suite once (D10: nothing that is not shared changed)**

Run: `npm run e2e -w @expanses/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/shared-events.spec.ts
git commit -m "$(cat <<'EOF'
Shared events end to end: two phones and a name, a euro dinner in a lira trip, the payer's money kept, a boat recorded offline, a settle-up in rupiah

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes (for the executor)

- **Spec coverage.** §1–§2 decisions: D1 (Task 8), D2 (Tasks 3, 10, 13), D3 (Tasks 6, 8, 9), D4 (Tasks 1, 6, 13), D5 (Tasks 1, 4, 6), D6 (Tasks 1, 7, 11), D7 (Tasks 7, 11), D8 (Tasks 4, 6, 9, 13), D9 (Tasks 6, 8), D10 (Tasks 11–14 run the existing event specs). §3 (Tasks 2, 4, 8), §4 (Task 1), §5 (Tasks 2, 5, 6, 9, 10), §5.1 (Task 3), §6 (Tasks 11–13), §7 (Tasks 4, 6, 8, 9, 11), §9 (the waves), §10 (Review Focus).
- **Out of scope, as §8 says:** no photo sync, no push, no recurring shared bills, no per-person home currency beyond each phone's own books, no pricing gate.
- **Names that cross tasks** (check when a task lands): `postEventRecordTx`, `setPaidFromTx`, `ensureShareAccountTx`, `followEventOpTx`, `followSharedEventTx`, `rateToBaseTx`, `retryUnpostedEventRecords`, `eventRatesWanted` (Task 5); `openSharedEventTx`, `personRefusalTx`, `SharedEventDbError` (Task 6); `sharedEventView`, `RecordPostingView.accountCurrency`, `NamedPayment` (Task 7); `EventLogHost`, `eventInviteDetails`, `SHARED_EVENTS_MIN_APP_VERSION` (Task 8); `EVENT_ENTITIES`, `eventWriteRefusal`, `settleEventCurrencyTx`, `eventBookWorkspaceOf` (Task 4).
