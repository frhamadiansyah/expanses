# Budget as a Percentage — Build 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A budget can be set as a % (of take-home, or of its parent's budget) that stays a % and follows its basis month by month.

**Architecture:**
- **Storage:** a side table `budget_shares` (migration 0069), shaped like `budget_frequencies`. No row means an amount budget. It syncs as a new shared entity, `budget_share`.
- **Resolving:** a pure core function turns caps (plan, the month's override, share) into the month's figures, top-down: a parent is resolved before its children.
  - `listBudgets(month)` applies it, so every reader — the sheet, the rows, the totals — sees resolved amounts only.
  - `budgets.amount_minor` keeps the figure resolved when the budget was saved, so an older build still reads a sensible cap.
- **Screens:** the one-budget sheet gets an Amount | % control. Edit budgets gets a "%" choice in each row's unit menu.

**Tech Stack:** TypeScript, drizzle (SQLite), vitest (and the `test:capture` suite), React 19, TanStack Query, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-budget-quick-set-design.md`, part 4 ("A budget as a percentage"). Build 1 (parts 1–3) is merged to main at 81c3106b.

## Global Constraints

- Country-neutral: rounding goes by the currency's exponent (`currencyInfo(currency).exponent`), never by currency name.
- Integer money arithmetic: a share of a figure is computed with BigInt, never with floating-point.
- A share is stored in hundredths of a percent: `share_bp` is an integer from 1 to 10000 (1550 = 15.5%). It is typed with up to two decimals, more than 0 and at most 100.
- What the % is of is decided automatically:
  - if the category's direct parent has a cap, the % is of the parent's cap (basis `'parent'`);
  - otherwise it is of take-home (basis `'take-home'`).
  The basis is fixed when the budget is saved.
- A resolved share is rounded to the nearest whole major unit, and it never goes above its basis.
- A % budget is monthly only. "Just this month" is always an amount.
- When a parent's budget is removed, every child that is a % of that parent becomes a fixed amount at its current figure, in the same transaction.
- A % of take-home is refused while take-home is 0: "Set a take-home first".
- No real statement data in fixtures. Copy never says "you". Corner buttons are glyphs only.
- Commit messages are sentences describing the behaviour, ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Test commands:
  - `npm test -w @expanses/core`
  - `npm test -w @expanses/db` (runs the capture suite too)
  - `npm test -w @expanses/web`
  - `npm run typecheck`
  - from `apps/web`: `npx playwright test <file> --project=<chromium|phone>`
  - Never run two Playwright invocations at once: both rebuild `dist`.

## Review Focus

1. **A % of a parent whose parent has a "just this month" figure.** The child follows that month's parent figure, not the plan. Covered in Task 1 (core).
2. **Take-home changed while Edit budgets is open.** The live total uses the take-home the sheet read when the screen opened; Save resolves against the same figure, and the page re-resolves after saving. A reasonable person sees the new figure once they're back on the page. Task 9 e2e changes take-home, then reopens.
3. **A synced share arriving on a device whose parent budget was deleted there.** The resolver falls back to the stored `amount_minor`, so the page shows a number, never 0 or NaN. Covered in Task 1 (`parent missing → plan`) and Task 4 (`listBudgets`).
4. **Switching Amount → % → Amount in the sheet without typing.** The figure must survive the round trip within one whole unit. Task 6 has a unit test on the converters.
5. **Removing the take-home entirely (0) after % budgets exist.** Their caps resolve to 0 and show as over. Nothing crashes, and the ✓ to re-save a % is refused with "Set a take-home first". Covered in Task 4 (resolve with 0) and Task 5 (refusal).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/budget/shares.ts` (new) | `ShareBasis`, `BudgetShare`, `parsePercentBp`, `formatBp`, `shareOfMinor`, `bpOf`, `resolveCaps` |
| `packages/core/src/index.ts` | exports |
| `packages/db/migrations/0069_budget_shares.sql` (new) | the table |
| `packages/db/src/migrations.ts` | registers 0069 |
| `packages/db/src/schema-budget.ts` | `budgetShares` table |
| `packages/db/src/repos/share-tables.ts` (new) | `budgetSharesExist(db)` guard |
| `packages/db/src/sync/shared-entities.ts`, `sync/apply.ts`, `sync/seed.ts` | the `budget_share` entity |
| `packages/db/src/repos/budgets.ts` | resolve in `listBudgets`; save, refuse and remove shares |
| `apps/web/src/features/budget/share-form.ts` (new) | amount ↔ % conversion for the screens |
| `apps/web/src/features/budget/CapSheet.tsx`, `BudgetPage.tsx` | Amount \| % control, basis, removal warning |
| `apps/web/src/features/budget/edit-budgets-model.ts`, `EditBudgetsPage.tsx` | share rows |
| `apps/web/e2e/budget-percent.spec.ts` (new) | journeys |

---

### Task 1: core — shares, parsing and resolving

**Files:**
- Create: `packages/core/src/budget/shares.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/budget-shares.test.ts`

**Interfaces:**
- Produces:
  - `type ShareBasis = 'take-home' | 'parent'`
  - `interface BudgetShare { basis: ShareBasis; bp: number }`
  - `parsePercentBp(text: string): number` — throws `ShareError` on anything not 0 < x ≤ 100 with at most 2 decimals
  - `formatBp(bp: number): string` — `1550` → `"15,5"`, `3000` → `"30"`
  - `shareOfMinor(baseMinor: number, bp: number, currency: string): number`
  - `bpOf(minor: number, baseMinor: number): number | null`
  - `interface CapToResolve { categoryId: string; planMinor: number; overrideMinor: number | null; share: BudgetShare | null }`
  - `resolveCaps(caps: readonly CapToResolve[], parentOf: (categoryId: string) => string | null, takeHomeMinor: number, currency: string): Map<string, { planMinor: number; amountMinor: number }>`
  - `class ShareError extends Error`

- [ ] **Step 1: Write the failing tests** — `packages/core/test/budget-shares.test.ts`

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bpOf, formatBp, parsePercentBp, resolveCaps, ShareError, shareOfMinor } from '../src/index';

describe('parsePercentBp and formatBp', () => {
  it('reads a percentage typed with a comma or a dot, up to two decimals', () => {
    expect(parsePercentBp('30')).toBe(3000);
    expect(parsePercentBp('15,5')).toBe(1550);
    expect(parsePercentBp('12.25%')).toBe(1225);
    expect(parsePercentBp(' 100 ')).toBe(10000);
  });

  it('refuses nothing, more than 100, three decimals and words', () => {
    for (const text of ['', '0', '0,00', '100,01', '12,345', 'abc', '-5']) expect(() => parsePercentBp(text)).toThrow(ShareError);
  });

  it('writes a share back as it would be typed', () => {
    expect(formatBp(3000)).toBe('30');
    expect(formatBp(1550)).toBe('15,5');
    expect(formatBp(1225)).toBe('12,25');
    expect(formatBp(5)).toBe('0,05');
  });
});

describe('shareOfMinor', () => {
  it('takes the share to the nearest whole unit', () => {
    expect(shareOfMinor(12_000_000, 1550, 'IDR')).toBe(1_860_000);
    expect(shareOfMinor(10_001, 3333, 'IDR')).toBe(3_333);
    expect(shareOfMinor(123_456, 5000, 'USD')).toBe(61_700);
  });

  it('never goes above its basis, even rounded', () => {
    expect(shareOfMinor(1_050, 10000, 'USD')).toBe(1_050);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e13 }), fc.integer({ min: 1, max: 10000 }), fc.constantFrom('IDR', 'USD', 'JPY'), (base, bp, currency) => {
        const share = shareOfMinor(base, bp, currency);
        return share >= 0 && share <= base;
      }),
    );
  });
});

describe('bpOf', () => {
  it('is the share an amount is of a basis, or null without one', () => {
    expect(bpOf(1_860_000, 12_000_000)).toBe(1550);
    expect(bpOf(20_000_000, 12_000_000)).toBe(10000);
    expect(bpOf(1, 12_000_000)).toBe(1);
    expect(bpOf(1_000, 0)).toBeNull();
  });
});

describe('resolveCaps', () => {
  const parents: Record<string, string | null> = { food: null, groceries: 'food', snacks: 'food', fun: null };
  const parentOf = (id: string) => parents[id] ?? null;

  it('resolves a % of take-home, and a % of a parent from the parent’s own figure', () => {
    const caps = resolveCaps(
      [
        { categoryId: 'food', planMinor: 0, overrideMinor: null, share: { basis: 'take-home', bp: 3000 } },
        { categoryId: 'groceries', planMinor: 0, overrideMinor: null, share: { basis: 'parent', bp: 4000 } },
        { categoryId: 'fun', planMinor: 500_000, overrideMinor: null, share: null },
      ],
      parentOf,
      10_000_000,
      'IDR',
    );
    expect(caps.get('food')).toEqual({ planMinor: 3_000_000, amountMinor: 3_000_000 });
    expect(caps.get('groceries')).toEqual({ planMinor: 1_200_000, amountMinor: 1_200_000 });
    expect(caps.get('fun')).toEqual({ planMinor: 500_000, amountMinor: 500_000 });
  });

  it('follows the parent’s figure for this month alone, and lets a child’s own month figure win', () => {
    const caps = resolveCaps(
      [
        { categoryId: 'food', planMinor: 2_000_000, overrideMinor: 5_000_000, share: null },
        { categoryId: 'groceries', planMinor: 0, overrideMinor: null, share: { basis: 'parent', bp: 5000 } },
        { categoryId: 'snacks', planMinor: 0, overrideMinor: 90_000, share: { basis: 'parent', bp: 1000 } },
      ],
      parentOf,
      10_000_000,
      'IDR',
    );
    expect(caps.get('groceries')!.amountMinor).toBe(2_500_000);
    expect(caps.get('snacks')).toEqual({ planMinor: 500_000, amountMinor: 90_000 });
  });

  it('falls back to the stored figure when the parent has no cap, and gives nothing for a take-home of nothing', () => {
    const caps = resolveCaps(
      [
        { categoryId: 'groceries', planMinor: 700_000, overrideMinor: null, share: { basis: 'parent', bp: 4000 } },
        { categoryId: 'fun', planMinor: 400_000, overrideMinor: null, share: { basis: 'take-home', bp: 500 } },
      ],
      parentOf,
      0,
      'IDR',
    );
    expect(caps.get('groceries')!.amountMinor).toBe(700_000);
    expect(caps.get('fun')!.amountMinor).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @expanses/core -- budget-shares`
Expected: FAIL, because `parsePercentBp` and the others are not exported.

- [ ] **Step 3: Implement `packages/core/src/budget/shares.ts`**

```ts
import { currencyInfo } from '../money/currencies';
import { assertMinor } from '../money/money';

/** What a budget set as a % is a share of: the month's take-home, or its parent category's budget. */
export type ShareBasis = 'take-home' | 'parent';

/** A budget set as a % rather than an amount: of what, and how much, in hundredths of a percent (1550 = 15.5%). */
export interface BudgetShare {
  basis: ShareBasis;
  bp: number;
}

export class ShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareError';
  }
}

/** "15,5", "15.5" or "15,5%" → 1550. More than 0, at most 100, two decimals at most. */
export function parsePercentBp(text: string): number {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim().replace(/%$/, '').trim());
  if (!m) throw new ShareError('A share is a percentage with at most two decimals, such as 15 or 12,5');
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (bp <= 0 || bp > 10000) throw new ShareError('A share is more than 0% and at most 100%');
  return bp;
}

/** 1550 → "15,5": the share as it would be typed, a comma before its decimals, none when it is whole. */
export function formatBp(bp: number): string {
  const whole = Math.floor(bp / 100);
  const rest = bp % 100;
  if (rest === 0) return String(whole);
  return `${whole},${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * `bp` hundredths of a percent of `baseMinor`, to the nearest whole major unit and never above the basis. BigInt
 * throughout: a take-home times 10000 can pass the safe range of a double.
 */
export function shareOfMinor(baseMinor: number, bp: number, currency: string): number {
  assertMinor(baseMinor);
  if (baseMinor <= 0 || bp <= 0) return 0;
  const unit = BigInt(10 ** currencyInfo(currency).exponent);
  const exact = (BigInt(baseMinor) * BigInt(bp) * 2n + 10000n) / 20000n;
  const whole = ((exact * 2n + unit) / (2n * unit)) * unit;
  return Math.min(Number(whole), baseMinor);
}

/** The share an amount is of a basis, in hundredths of a percent, kept between 1 and 10000; null without a basis. */
export function bpOf(minor: number, baseMinor: number): number | null {
  if (baseMinor <= 0) return null;
  const bp = Number((BigInt(Math.max(0, minor)) * 20000n + BigInt(baseMinor)) / (2n * BigInt(baseMinor)));
  return Math.min(10000, Math.max(1, bp));
}

/** One stored cap: what was saved as a month, this month's own figure if any, and the share it is, if it is one. */
export interface CapToResolve {
  categoryId: string;
  planMinor: number;
  overrideMinor: number | null;
  share: BudgetShare | null;
}

/**
 * The month's figure for every cap, parents before their children. A % of take-home is of this month's take-home; a %
 * of a parent is of the parent's figure this month, its own month's figure included. A % whose parent has no cap here
 * keeps the figure it was saved at. A cap's own figure for this month always wins.
 */
export function resolveCaps(
  caps: readonly CapToResolve[],
  parentOf: (categoryId: string) => string | null,
  takeHomeMinor: number,
  currency: string,
): Map<string, { planMinor: number; amountMinor: number }> {
  const byCategory = new Map(caps.map((cap) => [cap.categoryId, cap]));
  const out = new Map<string, { planMinor: number; amountMinor: number }>();
  const resolving = new Set<string>();
  const resolve = (cap: CapToResolve): { planMinor: number; amountMinor: number } => {
    const done = out.get(cap.categoryId);
    if (done) return done;
    // A loop in the tree cannot happen in a category tree, but a figure is never worth hanging the page for.
    if (resolving.has(cap.categoryId)) return { planMinor: cap.planMinor, amountMinor: cap.overrideMinor ?? cap.planMinor };
    resolving.add(cap.categoryId);
    let planMinor = cap.planMinor;
    if (cap.share?.basis === 'take-home') planMinor = shareOfMinor(takeHomeMinor, cap.share.bp, currency);
    if (cap.share?.basis === 'parent') {
      const parentId = parentOf(cap.categoryId);
      const parent = parentId ? byCategory.get(parentId) : undefined;
      if (parent) planMinor = shareOfMinor(resolve(parent).amountMinor, cap.share.bp, currency);
    }
    const figure = { planMinor, amountMinor: cap.overrideMinor ?? planMinor };
    out.set(cap.categoryId, figure);
    return figure;
  };
  for (const cap of caps) resolve(cap);
  return out;
}
```

Append to `packages/core/src/index.ts`, after the `./budget/frequency` export:

```ts
export { type BudgetShare, bpOf, type CapToResolve, formatBp, parsePercentBp, resolveCaps, ShareError, type ShareBasis, shareOfMinor } from './budget/shares';
```

`currencyInfo` lives in `src/money/currencies.ts` and `assertMinor` in `src/money/money.ts` (both exist). If the exact import path differs, follow `src/money/money.ts`'s own import of `currencyInfo`.

- [ ] **Step 4: Run the tests**

Run: `npm test -w @expanses/core`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "A budget can be a share of take-home or of its parent, read and resolved to the month's figure in core

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: db — the `budget_shares` table

**Files:**
- Create: `packages/db/migrations/0069_budget_shares.sql`
- Create: `packages/db/src/repos/share-tables.ts`
- Modify: `packages/db/src/migrations.ts` (after line 68 and after line 144), `packages/db/src/schema-budget.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/budget-shares-migration.test.ts`

**Interfaces:**
- Produces:
  - `budgetShares` (drizzle table: `budgetId`, `workspaceId`, `basis`, `shareBp`), exported through `budgetSchema`
  - `budgetSharesExist(db: Db): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { budgetSharesExist } from '../src/index';
import { setupDb } from './helpers';

describe('migration 0069: budget shares', () => {
  it('adds the table, and the guard sees it', async () => {
    const { database } = await setupDb();
    expect(await budgetSharesExist(database.db)).toBe(true);
    const columns = await database.db.values<[string]>(sql`SELECT name FROM pragma_table_info('budget_shares') ORDER BY cid`);
    expect(columns.map(([name]) => name)).toEqual(['budget_id', 'workspace_id', 'basis', 'share_bp']);
  });

  it('refuses a basis it does not know and a share out of range', async () => {
    const { database } = await setupDb();
    await expect(database.db.run(sql`INSERT INTO budget_shares VALUES ('b1', 'w', 'salary', 100)`)).rejects.toThrow(/CHECK/);
    await expect(database.db.run(sql`INSERT INTO budget_shares VALUES ('b2', 'w', 'parent', 0)`)).rejects.toThrow(/CHECK/);
    await expect(database.db.run(sql`INSERT INTO budget_shares VALUES ('b3', 'w', 'parent', 10001)`)).rejects.toThrow(/CHECK/);
    await database.db.run(sql`INSERT INTO budget_shares VALUES ('b4', 'w', 'take-home', 10000)`);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w @expanses/db -- budget-shares-migration`
Expected: FAIL, because `budgetSharesExist` is not exported.

- [ ] **Step 3: Implement**

`packages/db/migrations/0069_budget_shares.sql`:

```sql
/* A budget set as a share — of the month's take-home, or of its parent category's budget — rather than an amount.
   budgets.amount_minor still holds a monthly figure (the one resolved when it was saved), so a database or a device
   that does not know this table reads a sensible cap. A side table, not a column, for the reason 0053 gives. No row:
   an amount. */
CREATE TABLE IF NOT EXISTS budget_shares (
  budget_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('take-home', 'parent')),
  share_bp INTEGER NOT NULL CHECK (share_bp BETWEEN 1 AND 10000)
);
CREATE INDEX IF NOT EXISTS budget_shares_workspace ON budget_shares (workspace_id);
```

`packages/db/src/migrations.ts`: after line 68 add `import budgetShares from '../migrations/0069_budget_shares.sql?raw';`. After the `exact_hundredths` entry add `  { version: 69, name: 'budget_shares', sql: budgetShares },`.

`packages/db/src/schema-budget.ts`: add (with `integer` imported from `drizzle-orm/sqlite-core` alongside the existing imports):

```ts
/** A budget set as a % (0069). No row: an amount. */
export const budgetShares = sqliteTable('budget_shares', {
  budgetId: text('budget_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  basis: text('basis', { enum: ['take-home', 'parent'] }).notNull(),
  shareBp: integer('share_bp').notNull(),
});
```

`packages/db/src/repos/share-tables.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/**
 * Whether migration 0069 has run here. Every read and write of budget_shares asks first, so a database stopped at an
 * older version behaves as before: every budget an amount. A yes is remembered per handle; a no is not, since
 * migrate() may still run on the same handle.
 */
const known = new WeakMap<Db, boolean>();

export async function budgetSharesExist(db: Db): Promise<boolean> {
  if (known.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'budget_shares'`);
  const exists = rows.length > 0;
  if (exists) known.set(db, true);
  return exists;
}
```

`packages/db/src/index.ts`: add `export * from './repos/share-tables';` beside `export * from './repos/health-tables';`.

- [ ] **Step 4: Run the tests**

Run: `npm test -w @expanses/db -- budget-shares-migration migration-safety`
Expected: PASS. `migration-safety` shows `LATEST_VERSION` is 69 and nothing is pending.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "Budgets can store a share in a table of their own (migration 0069)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: db — `budget_share` syncs like `budget_frequency`

**Files:**
- Modify: `packages/db/src/sync/shared-entities.ts` (after the `budget_frequency` entry, ~line 194; `NEVER_SYNCED_COLUMNS` ~line 406), `packages/db/src/sync/apply.ts` (`PARENTS` ~line 209; `deleteRow` ~line 229), `packages/db/src/sync/seed.ts:153`
- Test: `packages/db/test/sync/shared-entities.test.ts` (automatic), `packages/db/test/sync/skips.test.ts` (new case)

**Interfaces:**
- Consumes: the `budget_shares` table (Task 2).
- Produces: the entity name `'budget_share'`, usable as a `withCapture` target `{ entity: 'budget_share', id }` / `{ entity: 'budget_share', bookId }`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe` in `packages/db/test/sync/skips.test.ts` that holds the CHECK test, following its pattern:

```ts
  it('a share whose basis the schema does not know is skipped, not applied', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const db = await import('../../src/index');
    await db.saveBudget(fandri.database, db.inBook(fandri.ws, bookId), { categoryAccountId: await categoryOf(fandri.database, bookId, 'Groceries'), amountMinor: 100_000 });
    await home.settle();
    const [[budgetId]] = (await dewi.database.db.values<[string]>(sql`SELECT id FROM budgets`)) as [[string]];
    const seq = await appendOps(home, fandri, [{ entity: 'budget_share', id: budgetId, op: 'upsert', fields: { basis: 'salary', shareBp: 100 } }]);
    const result = await dewi.engine.syncOnce(bookId);
    expect(result.skipped.map((s) => [s.seq, s.entity])).toEqual([[seq, 'budget_share']]);
  });

  it('a share set on one device is the same share on the other', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const db = await import('../../src/index');
    await db.saveBudget(fandri.database, db.inBook(fandri.ws, bookId), { categoryAccountId: await categoryOf(fandri.database, bookId, 'Groceries'), amountMinor: 100_000 });
    await home.settle();
    const [[budgetId]] = (await dewi.database.db.values<[string]>(sql`SELECT id FROM budgets`)) as [[string]];
    await appendOps(home, fandri, [{ entity: 'budget_share', id: budgetId, op: 'upsert', fields: { basis: 'take-home', shareBp: 1500 } }]);
    await dewi.engine.syncOnce(bookId);
    expect(await dewi.database.db.values(sql`SELECT basis, share_bp FROM budget_shares WHERE budget_id = ${budgetId}`)).toEqual([['take-home', 1500]]);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w @expanses/db -- skips`
Expected: FAIL with `Unknown shared entity: budget_share`.

- [ ] **Step 3: Implement**

`shared-entities.ts`, after the `budget_frequency` entry:

```ts
  {
    kind: 'row',
    entity: 'budget_share',
    table: 'budget_shares',
    scopeRule: 'its budget_id is a budget of the book',
    scope: (bookId) => sql`t.budget_id IN (${budgetsOfBook(bookId)})`,
    // Keyed by budget_id, one row per budget (0069), as budget_frequency is.
    keyColumns: ['budget_id'],
    fields: { basis: 'basis', shareBp: 'share_bp' },
    localOnInsert: [],
  },
```

and in `NEVER_SYNCED_COLUMNS`: `  budget_shares: ['workspace_id'],`.

`apply.ts`:
- In `PARENTS`, after `budget_frequency`: `  budget_share: { table: 'budgets', from: 'key', name: 'budget_id' },`.
- In `deleteRow`'s budget branch, after the `budget_frequencies` delete:

```ts
    if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'budget_shares'`)).length > 0) {
      await tx.run(sql`DELETE FROM budget_shares WHERE budget_id = ${key.id}`);
    }
```

(Use `budgetSharesExist(tx)` from `../repos/share-tables` instead of the inline query if the import does not create a cycle; `apply.ts` already imports from repos for `removeCategorySettingsTx`.)

`seed.ts:153` becomes:

```ts
  ops.push(...(await rows('budget')), ...(await rows('budget_frequency')), ...(await rows('budget_share')), ...(await rows('budget_override')));
```

`rows()` and `snapshot()` read the table directly, so a database without 0069 would fail here. Every database the sync engine runs on has been migrated to the latest version first; check that `seed.ts`'s `rows` is only reached after `migrate`. If `rows` can run on an older database, guard the `budget_share` call with `budgetSharesExist(tx)`, as `capture-harness.ts` already skips tables that do not exist.

- [ ] **Step 4: Run the tests**

Run: `npm test -w @expanses/db -- sync`
Expected: PASS. `shared-entities.test.ts` checks that the new entity's columns are fully listed (`budget_id`, `basis`, `share_bp`, plus `workspace_id` as never synced).

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "A budget's share syncs to the household like its unit does, and goes with the budget it belongs to

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: db — `listBudgets` resolves shares

**Files:**
- Modify: `packages/db/src/repos/budgets.ts` (`BudgetRow` ~line 36, `listBudgets` ~line 258)
- Test: `packages/db/test/budget-shares.test.ts` (new)

**Interfaces:**
- Consumes: `resolveCaps`, `BudgetShare` (Task 1); `budgetShares`, `budgetSharesExist` (Task 2); `getBudgetIncome` (`./budget-settings`); `bookMoneyFor` (`./book-currency`).
- Produces: `BudgetRow` gains `share: BudgetShare | null`. `planMinor` and `amountMinor` are now resolved figures; `amountAsSetMinor` and `frequency` are unchanged.

- [ ] **Step 1: Write the failing tests**

The rows are inserted directly, since saving a share arrives in Task 5:

```ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listBudgets, saveBudget, saveExpectedIncome, setBudgetOverride, setIncomeOverride } from '../src/index';
import { setupDb } from './helpers';

async function withTree() {
  const { database, ws } = await setupDb();
  const food = await createAccount(database, ws, { name: 'Food', kind: 'expense', subtype: 'category', currency: null });
  const groceries = await createAccount(database, ws, { name: 'Groceries', kind: 'expense', subtype: 'category', currency: null, parentId: food.id });
  await saveExpectedIncome(database, ws, 10_000_000);
  return { database, ws, food, groceries };
}

async function makeShare(database: Awaited<ReturnType<typeof setupDb>>['database'], ws: { workspaceId: string }, budgetId: string, basis: string, bp: number) {
  await database.db.run(sql`INSERT INTO budget_shares VALUES (${budgetId}, ${ws.workspaceId}, ${basis}, ${bp})`);
}

const capOf = (rows: Awaited<ReturnType<typeof listBudgets>>, id: string) => rows.find((row) => row.categoryAccountId === id)!;

describe('listBudgets with shares', () => {
  it('reads a % of take-home and a % of its parent as the month’s figures, and names the share', async () => {
    const { database, ws, food, groceries } = await withTree();
    const foodId = await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 1 });
    const groceriesId = await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 1 });
    await makeShare(database, ws, foodId, 'take-home', 3000);
    await makeShare(database, ws, groceriesId, 'parent', 4000);

    const rows = await listBudgets(database, ws, '2026-10');
    expect(capOf(rows, food.id)).toMatchObject({ planMinor: 3_000_000, amountMinor: 3_000_000, share: { basis: 'take-home', bp: 3000 } });
    expect(capOf(rows, groceries.id)).toMatchObject({ amountMinor: 1_200_000, share: { basis: 'parent', bp: 4000 } });
  });

  it('follows a month with its own take-home, and leaves the next month on the usual one', async () => {
    const { database, ws, food } = await withTree();
    const foodId = await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 1 });
    await makeShare(database, ws, foodId, 'take-home', 3000);
    await setIncomeOverride(database, ws, { month: '2026-12', amountMinor: 20_000_000 });

    expect(capOf(await listBudgets(database, ws, '2026-12'), food.id).amountMinor).toBe(6_000_000);
    expect(capOf(await listBudgets(database, ws, '2027-01'), food.id).amountMinor).toBe(3_000_000);
  });

  it('lets a month’s own figure for a % budget win', async () => {
    const { database, ws, food } = await withTree();
    const foodId = await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 1 });
    await makeShare(database, ws, foodId, 'take-home', 3000);
    await setBudgetOverride(database, ws, { categoryAccountId: food.id, month: '2026-10', amountMinor: 4_000_000 });
    expect(capOf(await listBudgets(database, ws, '2026-10'), food.id)).toMatchObject({ planMinor: 3_000_000, amountMinor: 4_000_000, overridden: true });
  });

  it('gives an amount budget no share, and a % of take-home nothing when there is no take-home', async () => {
    const { database, ws, food, groceries } = await withTree();
    await saveExpectedIncome(database, ws, 0);
    const foodId = await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 1 });
    await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 250_000 });
    await makeShare(database, ws, foodId, 'take-home', 3000);
    const rows = await listBudgets(database, ws, '2026-10');
    expect(capOf(rows, food.id).amountMinor).toBe(0);
    expect(capOf(rows, groceries.id)).toMatchObject({ amountMinor: 250_000, share: null });
  });
});
```

If `saveExpectedIncome(database, ws, 0)` is refused, set the take-home through the same table the repo reads, or drop that line and start a separate `setupDb()` with no take-home saved.

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @expanses/db -- budget-shares.test`
Expected: FAIL: `amountMinor` is 1 instead of 3_000_000, and `share` is undefined.

- [ ] **Step 3: Implement in `budgets.ts`**

- Imports: `type BudgetShare, resolveCaps` from `@expanses/core`; `budgetShares` from `'../schema-budget'`; `budgetSharesExist` from `'./share-tables'`; `getBudgetIncome` from `'./budget-settings'`; `bookMoneyFor` from `'./book-currency'`. If `budget-settings` imports `budgets.ts`, check for a cycle with `npm run typecheck` and a test run. ES modules tolerate function-level cycles; if one appears, move the income read into `listBudgets`' caller and pass it in.
- `BudgetRow`: add `/** Set as a % of take-home or of its parent; null for an amount. */ share: BudgetShare | null;`, and change the doc of `planMinor`/`amountMinor` to "resolved for the month".
- In `listBudgets`, after `unitOf`:

```ts
  const shares = (await budgetSharesExist(database.db))
    ? await database.db
        .select({ budgetId: budgetShares.budgetId, basis: budgetShares.basis, shareBp: budgetShares.shareBp })
        .from(budgetShares)
        .where(eq(budgetShares.workspaceId, ws.workspaceId))
    : [];
  const shareOf = new Map(shares.map((row) => [row.budgetId, { basis: row.basis, bp: row.shareBp } satisfies BudgetShare]));

  // Only a month with a share in it needs the take-home and the tree; every other month reads as it always has.
  let resolved: ReturnType<typeof resolveCaps> | null = null;
  if (rows.some((row) => shareOf.has(row.id))) {
    const [income, money, parents] = await Promise.all([
      getBudgetIncome(database, ws, month),
      bookMoneyFor(database, ws),
      database.db
        .select({ id: accounts.id, parentId: accounts.parentId })
        .from(accounts)
        .where(eq(accounts.workspaceId, ws.workspaceId)),
    ]);
    const parentOf = new Map(parents.map((row) => [row.id, row.parentId]));
    resolved = resolveCaps(
      rows.map((row) => ({ categoryId: row.categoryAccountId, planMinor: row.amountMinor, overrideMinor: overrideOf.get(row.id) ?? null, share: shareOf.get(row.id) ?? null })),
      (id) => parentOf.get(id) ?? null,
      income.amountMinor,
      money.currency,
    );
  }
```

- In the `rows.map`, use:

```ts
    const figure = resolved?.get(row.categoryAccountId);
    return {
      id: row.id,
      categoryAccountId: row.categoryAccountId,
      planMinor: figure?.planMinor ?? row.amountMinor,
      amountMinor: figure?.amountMinor ?? override ?? row.amountMinor,
      overridden: override !== undefined,
      frequency: unitOf.get(row.id)?.frequency ?? 'monthly',
      amountAsSetMinor: unitOf.get(row.id)?.amountAsSetMinor ?? row.amountMinor,
      share: shareOf.get(row.id) ?? null,
    };
```

`accounts` is already imported in `budgets.ts`. `bookMoneyFor(database, ws).currency` is the open workspace's own currency, the one `budgetSheetFor` reads in.

- [ ] **Step 4: Run the tests**

Run: `npm test -w @expanses/db -- budget`
Expected: PASS: the new file, `budgets.test`, `budget-sheet.test` and `budget-frequency.test`. Existing rows have no share, so they read exactly as before.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "A budget set as a % reads as its month's figure: of that month's take-home, or of its parent's budget that month

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: db — saving, refusing and removing shares

**Files:**
- Modify: `packages/db/src/repos/budgets.ts` (`SaveBudgetInput`, `checkedMonthly`, `writeBudget`, `deleteBudget`, `saveBudget`, `removeBudget`, `saveBudgets`)
- Test: `packages/db/test/budget-shares.test.ts`, `packages/db/test/sync/capture.test.ts`

**Interfaces:**
- Consumes: Task 4's `listBudgets`.
- Produces:
  - `SaveBudgetInput.share?: BudgetShare | null`. The caller sends `amountMinor` as the share resolved now, which is what `budgets.amount_minor` keeps.
  - Refusals:
    - `NO_TAKE_HOME`: "Set a take-home first"
    - `NO_PARENT_CAP`: "Its parent has no budget to take a share of"
    - `BAD_SHARE`: "A share is more than 0% and at most 100%"
    - `BAD_FREQUENCY` for a share with a unit other than monthly: "A share is a month's figure"
  - `removeBudget` and `saveBudgets`' removals turn a removed parent's %-children into amounts.

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/test/budget-shares.test.ts` (import `BudgetError`, `removeBudget`, `saveBudgets` too):

```ts
describe('saving a share', () => {
  it('keeps the share and the figure it came to, and saving an amount again clears the share', async () => {
    const { database, ws, food } = await withTree();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 3_000_000, share: { basis: 'take-home', bp: 3000 } });
    expect(capOf(await listBudgets(database, ws, '2026-10'), food.id)).toMatchObject({ amountMinor: 3_000_000, share: { basis: 'take-home', bp: 3000 } });

    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 2_500_000 });
    expect(capOf(await listBudgets(database, ws, '2026-10'), food.id)).toMatchObject({ amountMinor: 2_500_000, share: null });
  });

  it('refuses a % of take-home while there is no take-home, a % of a parent with no budget, a share out of range and a weekly share', async () => {
    const { database, ws, food, groceries } = await withTree();
    await expect(saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 0, share: { basis: 'take-home', bp: 3000 } })).rejects.toMatchObject({ code: 'NO_TAKE_HOME', message: 'Set a take-home first' });
    await expect(saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 100_000, share: { basis: 'parent', bp: 1000 } })).rejects.toMatchObject({ code: 'NO_PARENT_CAP' });
    await expect(saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 100_000, share: { basis: 'take-home', bp: 10001 } })).rejects.toMatchObject({ code: 'BAD_SHARE' });
    await expect(saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 100_000, frequency: 'weekly', share: { basis: 'take-home', bp: 100 } })).rejects.toMatchObject({ code: 'BAD_FREQUENCY' });
    expect(await listBudgets(database, ws, '2026-10')).toHaveLength(0);
  });

  it('accepts a % of a parent saved in the same go as the parent', async () => {
    const { database, ws, food, groceries } = await withTree();
    await saveBudgets(database, ws, {
      save: [
        { categoryAccountId: groceries.id, amountMinor: 800_000, share: { basis: 'parent', bp: 4000 } },
        { categoryAccountId: food.id, amountMinor: 2_000_000 },
      ],
      remove: [],
    });
    expect(capOf(await listBudgets(database, ws, '2026-10'), groceries.id).amountMinor).toBe(800_000);
  });

  it('turns a removed parent’s %-children into amounts at their figure now', async () => {
    const { database, ws, food, groceries } = await withTree();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 2_000_000 });
    await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 800_000, share: { basis: 'parent', bp: 4000 } });

    await removeBudget(database, ws, food.id);
    expect(capOf(await listBudgets(database, ws, '2026-10'), groceries.id)).toMatchObject({ amountMinor: 800_000, share: null });
  });
});
```

Append to `packages/db/test/sync/capture.test.ts`, beside "a budget, its frequency, …":

```ts
  it('a budget set as a share carries its share, and removing it removes the share', async () => {
    const { database, ws, groceries } = await sharedHousehold();
    await saveExpectedIncome(database, ws, 10_000_000);
    await clearOutbox(database);
    const budgetId = await saveBudget(database, ws, { categoryAccountId: groceries.id, amountMinor: 1_000_000, share: { basis: 'take-home', bp: 1000 } });
    expect(await outboxOps(database)).toContainEqual({ entity: 'budget_share', id: budgetId, op: 'upsert', fields: { basis: 'take-home', shareBp: 1000 } });

    await clearOutbox(database);
    await removeBudget(database, ws, groceries.id);
    expect(await outboxOps(database)).toContainEqual({ entity: 'budget_share', id: budgetId, op: 'delete' });
  });
```

(Import `saveExpectedIncome` in that file if it is not imported already.)

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @expanses/db -- budget-shares capture`
Expected: FAIL. `share` is ignored on save, so there is no `budget_share` op and the refusals don't fire.

- [ ] **Step 3: Implement in `budgets.ts`**

1. `SaveBudgetInput`: add `/** Set as a % of take-home or of its parent: amountMinor is then the share resolved now. */ share?: BudgetShare | null;`.

2. `checkedMonthly`: before the amount checks, add:

```ts
  if (input.share) {
    const { basis, bp } = input.share;
    if (!Number.isInteger(bp) || bp < 1 || bp > 10000) throw new BudgetError('BAD_SHARE', 'A share is more than 0% and at most 100%');
    if ((input.frequency ?? 'monthly') !== 'monthly') throw new BudgetError('BAD_FREQUENCY', "A share is a month's figure");
    if (input.amountMinor <= 0 && basis === 'take-home') throw new BudgetError('NO_TAKE_HOME', 'Set a take-home first');
    if (input.amountMinor <= 0) throw new BudgetError('NO_PARENT_CAP', 'Its parent has no budget to take a share of');
  }
```

3. `writeBudget`:
   - Its capture targets gain `{ entity: 'budget_share', id }`.
   - Inside the `withCapture` callback, after the frequency block:

```ts
    if (await budgetSharesExist(tx)) {
      await tx.delete(budgetShares).where(eq(budgetShares.budgetId, id));
      if (input.share) await tx.insert(budgetShares).values({ budgetId: id, workspaceId: ws.workspaceId, basis: input.share.basis, shareBp: input.share.bp });
    }
```

4. Add a check run inside the transaction after every write of a call:

```ts
/** A % of a parent needs a parent with a budget: checked once every row of the call is written, so a parent saved in the same go counts. */
async function assertParentsCapped(tx: Tx, ws: WorkspaceContext, inputs: readonly SaveBudgetInput[]): Promise<void> {
  for (const input of inputs) {
    if (input.share?.basis !== 'parent') continue;
    const [category] = await tx.select({ parentId: accounts.parentId }).from(accounts).where(eq(accounts.id, input.categoryAccountId));
    const parentId = category?.parentId ?? null;
    const [parent] = parentId
      ? await tx.select({ id: budgets.id }).from(budgets).where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, parentId)))
      : [];
    if (!parent) throw new BudgetError('NO_PARENT_CAP', 'Its parent has no budget to take a share of', input.categoryAccountId);
  }
}
```

   Call it as the last line inside `saveBudget`'s transaction (`[input]`) and inside `saveBudgets`' transaction (`checked.map((c) => c.input)`). A throw rolls the transaction back.

5. `deleteBudget(tx, ws, categoryAccountId, figures: ReadonlyMap<string, number>)` — the new parameter is each category's figure now, read before the transaction. Before its `withCapture`:

```ts
  // Children that are a % of this budget become amounts at their figure now, in the same go.
  const children = (await budgetSharesExist(tx))
    ? await tx
        .select({ budgetId: budgets.id, categoryAccountId: budgets.categoryAccountId })
        .from(budgets)
        .innerJoin(budgetShares, eq(budgetShares.budgetId, budgets.id))
        .innerJoin(accounts, eq(accounts.id, budgets.categoryAccountId))
        .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgetShares.basis, 'parent'), eq(accounts.parentId, categoryAccountId)))
    : [];
```

   Add `...children.flatMap((child) => [{ entity: 'budget', id: child.budgetId }, { entity: 'budget_share', id: child.budgetId }])` and `{ entity: 'budget_share', id: existing.id }` to the capture targets. Inside the callback, before deleting the budget:

```ts
    for (const child of children) {
      const figure = figures.get(child.categoryAccountId);
      if (figure !== undefined && figure > 0) await tx.update(budgets).set({ amountMinor: figure, updatedAt: new Date().toISOString() }).where(eq(budgets.id, child.budgetId));
      await tx.delete(budgetShares).where(eq(budgetShares.budgetId, child.budgetId));
    }
    if (await budgetSharesExist(tx)) await tx.delete(budgetShares).where(eq(budgetShares.budgetId, existing.id));
```

6. `removeBudget` and `saveBudgets` read the figures before their transaction:

```ts
  const figures = new Map((await listBudgets(database, ws, monthOf(isoDate()))).map((row) => [row.categoryAccountId, row.planMinor]));
```

   Then pass `figures` to every `deleteBudget` call. Import `isoDate, monthOf` from `@expanses/core`.

The figure kept is `planMinor` (this month's resolved plan, without a month-only override), because the kept amount is the plan going forward.

- [ ] **Step 4: Run the tests**

Run: `npm test -w @expanses/db`
Expected: all PASS, including the capture suite. The capture harness fails any write to `budget_shares` that isn't covered by a target.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "A budget is saved as a % of take-home or of its parent, refused without one, and a removed parent leaves its %-children as amounts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: web — the one-budget sheet takes a %

**Files:**
- Create: `apps/web/src/features/budget/share-form.ts`
- Test: `apps/web/src/features/budget/share-form.test.ts`
- Modify: `apps/web/src/features/budget/CapSheet.tsx`, `apps/web/src/features/budget/BudgetPage.tsx`

**Interfaces:**
- Consumes: `parsePercentBp`, `formatBp`, `shareOfMinor`, `bpOf`, `BudgetShare`, `ShareBasis` (Task 1); `BudgetRow.share` (Task 4); `SaveBudgetInput.share` (Task 5).
- Produces:
  - `interface ShareBase { basis: ShareBasis; label: string; minor: number }`
  - `shareBaseOf(lines: readonly BudgetLine[], categoryId: string, takeHomeMinor: number): ShareBase`
  - `toPercent(amount: string, base: ShareBase, currency: string): string`
  - `toAmount(percent: string, base: ShareBase, currency: string): string`
  - `CapSheet` props gain `base: ShareBase` and `dependants: { name: string; minor: number }[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import type { BudgetLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { shareBaseOf, toAmount, toPercent } from './share-form';

const line = (id: string, name: string, capMinor: number | null, children: BudgetLine[] = []): BudgetLine => ({ id, name, ownMinor: 0, totalMinor: 0, capMinor, overMinor: 0, children });

describe('shareBaseOf', () => {
  it('is the parent’s budget when the parent has one, and take-home otherwise', () => {
    const lines = [line('food', 'Food', 2_000_000, [line('groceries', 'Groceries', null)]), line('fun', 'Fun', null, [line('games', 'Games', null)])];
    expect(shareBaseOf(lines, 'groceries', 10_000_000)).toEqual({ basis: 'parent', label: 'Food', minor: 2_000_000 });
    expect(shareBaseOf(lines, 'games', 10_000_000)).toEqual({ basis: 'take-home', label: 'take-home', minor: 10_000_000 });
    expect(shareBaseOf(lines, 'food', 10_000_000)).toEqual({ basis: 'take-home', label: 'take-home', minor: 10_000_000 });
  });
});

describe('toPercent and toAmount', () => {
  const base = { basis: 'take-home' as const, label: 'take-home', minor: 12_000_000 };

  it('turn a figure into its share and back within a whole unit', () => {
    expect(toPercent('1.860.000', base, 'IDR')).toBe('15,5');
    expect(toAmount('15,5', base, 'IDR')).toBe('1.860.000');
    expect(toAmount(toPercent('1.234.567', base, 'IDR'), base, 'IDR')).toBe('1.234.800');
  });

  it('keep an empty or unreadable figure as it is, and give no share without a basis', () => {
    expect(toPercent('', base, 'IDR')).toBe('');
    expect(toAmount('abc', base, 'IDR')).toBe('');
    expect(toPercent('500.000', { ...base, minor: 0 }, 'IDR')).toBe('');
  });
});
```

1.234.567 / 12.000.000 = 10.2880583% → bp 1029 → 12.000.000 × 10.29% = 1.234.800.

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @expanses/web -- share-form`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `share-form.ts`**

```ts
import { type BudgetLine, bpOf, formatBp, parseMajor, parsePercentBp, type ShareBasis, shareOfMinor } from '@expanses/core';
import { bareFigure } from '../networth/debt-rows';

/** What a % typed for a category is of: its parent's budget, or this month's take-home. */
export interface ShareBase {
  basis: ShareBasis;
  label: string;
  minor: number;
}

/** The parent's budget when the category's direct parent has one; take-home otherwise. */
export function shareBaseOf(lines: readonly BudgetLine[], categoryId: string, takeHomeMinor: number): ShareBase {
  const parentOf = (rows: readonly BudgetLine[], parent: BudgetLine | null): BudgetLine | null | undefined => {
    for (const row of rows) {
      if (row.id === categoryId) return parent;
      const found = parentOf(row.children, row);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const parent = parentOf(lines, null);
  if (parent && parent.capMinor !== null) return { basis: 'parent', label: parent.name, minor: parent.capMinor };
  return { basis: 'take-home', label: 'take-home', minor: takeHomeMinor };
}

/** A typed amount as its share of the basis; empty when it cannot be read or there is no basis. */
export function toPercent(amount: string, base: ShareBase, currency: string): string {
  if (!amount.trim()) return '';
  try {
    const bp = bpOf(parseMajor(amount, currency), base.minor);
    return bp === null ? '' : formatBp(bp);
  } catch {
    return '';
  }
}

/** A typed share as the amount it comes to; empty when it cannot be read. */
export function toAmount(percent: string, base: ShareBase, currency: string): string {
  try {
    return bareFigure(shareOfMinor(base.minor, parsePercentBp(percent), currency), currency);
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run them**

Run: `npm test -w @expanses/web -- share-form`
Expected: PASS.

- [ ] **Step 5: The sheet**

In `CapSheet.tsx`:
- New props: `base: ShareBase` and `dependants: { name: string; minor: number }[]`.
- State: `const [mode, setMode] = useState<'amount' | 'share'>(row?.share && !row.overridden ? 'share' : 'amount');`. When `mode === 'share'`, the starting `amount` is `formatBp(row.share.bp)`: change `startingFigure` to take the mode and return `formatBp(row!.share!.bp)` in share mode.
- Above the Cap row, inside the first group, add the control, hidden while Just this month is on (a month's own figure is always an amount):

```tsx
        {!thisMonthOnly && (
          <div className="px-[16px] py-[8px]">
            <SegmentedControl
              label="Set as"
              segments={[
                { key: 'amount', label: 'Amount' },
                { key: 'share', label: '%' },
              ]}
              value={mode}
              onChange={(key) => switchMode(key as 'amount' | 'share')}
            />
          </div>
        )}
```

```ts
  // Switching converts what is typed, so nothing is lost: 1.800.000 of a 12.000.000 take-home is 15%.
  const switchMode = (next: 'amount' | 'share') => {
    if (next === mode) return;
    setTouched(true);
    setAmount(next === 'share' ? toPercent(amount, base, currency) : toAmount(amount, base, currency));
    if (next === 'share') setFrequency('monthly');
    setMode(next);
  };
```

- The Cap row in share mode:
  - `label="Share"`, `placeholder="%"`, `inputMode="decimal"`.
  - `onChange` keeps only digits, a comma and a dot: `setAmount(e.target.value.replace(/[^\d.,]/g, ''))`.
  - `hint` is `= ${formatMinor(resolvedMinor, currency)} of ${base.label}`, where `resolvedMinor = (() => { try { return shareOfMinor(base.minor, parsePercentBp(amount), currency); } catch { return 0; } })()`.
- Hide the Every row in share mode.
- `switchMonth(on)`: when turning it on in share mode, call `switchMode('amount')` first.
- Chips: `takeFigure` also calls `setMode('amount')`.
- `save()`: in share mode, ahead of the amount branch:

```ts
      if (mode === 'share' && !thisMonthOnly) {
        const bp = parsePercentBp(amount);
        await saveBudget(database, ws, { categoryAccountId: categoryId, amountMinor: shareOfMinor(base.minor, bp, currency), frequency: 'monthly', share: { basis: base.basis, bp } });
      } else if (thisMonthOnly) …
```

  `parsePercentBp` throws a `ShareError`, and the `catch` already shows it in `ErrorBox`.
- `remove()`: when `dependants.length > 0` and not just this month, ask first:

```ts
      if (dependants.length > 0 && !(thisMonthOnly && row?.overridden)) {
        const kept = dependants.map((child) => `${child.name} keeps ${formatMinor(child.minor, currency)} a month`).join('; ');
        if (!window.confirm(`${kept}. Remove this budget?`)) return;
      }
```

In `BudgetPage.tsx`, pass to `CapSheet`:

```tsx
          base={shareBaseOf(sheet.lines, open.id, sheet.incomePlanMinor)}
          dependants={(findLine(sheet.lines, open.id)?.children ?? [])
            .filter((child) => budgets.find((row) => row.categoryAccountId === child.id)?.share?.basis === 'parent')
            .map((child) => ({ name: child.name, minor: child.capMinor ?? 0 }))}
```

- [ ] **Step 6: Typecheck, unit tests, commit**

Run: `npm run typecheck && npm test -w @expanses/web`
Expected: PASS.

```bash
git add apps/web/src/features/budget
git commit -m "The cap sheet sets a budget as an amount or a %, converts between them, and warns before a parent's removal turns its %-children into amounts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: web — the Edit budgets model takes shares

**Files:**
- Modify: `apps/web/src/features/budget/edit-budgets-model.ts`
- Test: `apps/web/src/features/budget/edit-budgets-model.test.ts`

**Interfaces:**
- Consumes: Task 1's core functions; `BudgetRow.share`.
- Produces:
  - `RowState` gains `mode: 'amount' | 'share'`; `rowStateOf`'s default has `mode: 'amount'`.
  - `typedCaps(lines: readonly BudgetLine[], state: EditState, takeHomeMinor: number, currency: string): Map<string, number>` — each row's monthly figure, with shares resolved top-down.
  - `liveCapsTotal(lines, state, takeHomeMinor, currency)` — **signature change**: `takeHomeMinor` is new.
  - `fillFromLastMonth(groups, state, history, currency)` — unchanged signature; fills `mode: 'amount'`.
  - `changesOf(groups, state, initial, budgets, takeHomeMinor, currency)` — **signature change**: `takeHomeMinor` is new.
  - `basisOfRow(row: EditRow, figures: Map<string, number>): ShareBasis`

- [ ] **Step 1: Write the failing tests**

Update every existing `RowState` literal in `edit-budgets-model.test.ts` to include `mode: 'amount'`. Update the calls: `liveCapsTotal(lines, state, 0, 'IDR')` and `changesOf(groups, state, initial, budgets, 0, 'IDR')`. Then append:

```ts
describe('shares on Edit budgets', () => {
  const take = 10_000_000;

  it('opens a % budget as its share, in share mode', () => {
    const stored = { ...budget('t', 3_000_000), share: { basis: 'take-home' as const, bp: 3000 } };
    expect(initialState(editGroups(lines), [stored], 'IDR').t).toEqual({ amount: '30', frequency: 'monthly', filled: false, mode: 'share' });
  });

  it('counts a % of take-home and a % of a typed parent in the live total', () => {
    const groups = editGroups(lines);
    const state = initialState(groups, [], 'IDR');
    state.t = { amount: '30', frequency: 'monthly', filled: false, mode: 'share' };
    state.fuel = { amount: '40', frequency: 'monthly', filled: false, mode: 'share' };
    expect(typedCaps(lines, state, take, 'IDR').get('fuel')).toBe(1_200_000);
    expect(liveCapsTotal(lines, state, take, 'IDR')).toBe(3_000_000);
  });

  it('sends a share with the basis the row has now and the figure it comes to', () => {
    const groups = editGroups(lines);
    const initial = initialState(groups, [], 'IDR');
    const state = { ...initial, t: { amount: '1.000.000', frequency: 'monthly' as const, filled: false, mode: 'amount' as const }, fuel: { amount: '25', frequency: 'monthly' as const, filled: false, mode: 'share' as const }, fun: { amount: '5', frequency: 'monthly' as const, filled: false, mode: 'share' as const } };
    expect(changesOf(groups, state, initial, [], take, 'IDR').save).toEqual([
      { categoryAccountId: 'fun', amountMinor: 500_000, frequency: 'monthly', share: { basis: 'take-home', bp: 500 } },
      { categoryAccountId: 't', amountMinor: 1_000_000, frequency: 'monthly' },
      { categoryAccountId: 'fuel', amountMinor: 250_000, frequency: 'monthly', share: { basis: 'parent', bp: 2500 } },
    ]);
  });

  it('names a share that cannot be read, and treats a change of mode as a change', () => {
    const groups = editGroups(lines);
    const initial = initialState(groups, [], 'IDR');
    const state = { ...initial, fun: { amount: '150', frequency: 'monthly' as const, filled: false, mode: 'share' as const } };
    expect(changesOf(groups, state, initial, [], take, 'IDR').unreadable).toEqual(['fun']);
    expect(isDirty({ ...initial, fun: { ...initial.fun!, mode: 'share' } }, initial)).toBe(true);
  });
});
```

Add `typedCaps` to the import.

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @expanses/web -- edit-budgets-model`
Expected: FAIL, because `typedCaps` is missing and `mode` is unknown.

- [ ] **Step 3: Implement**

In `edit-budgets-model.ts`:
- `RowState`: add `/** Typed as an amount in its unit, or as a % (always a month's). */ mode: 'amount' | 'share';`.
- `initialState`: for a stored row with `share`, use `{ amount: formatBp(stored.share.bp), frequency: 'monthly', filled: false, mode: 'share' }`; otherwise add `mode: 'amount'`.
- `rowStateOf` default: add `mode: 'amount'`.
- `monthlyOf` stays amount-only. In share mode it returns null, because a share needs its basis (see `typedCaps`):

```ts
export function monthlyOf(row: RowState | undefined, currency: string): number | null {
  if (!row || row.mode === 'share') return null;
  const minor = perMonthPreview(row.amount, row.frequency, currency);
  return minor !== null && minor > 0 ? minor : null;
}

/** Every row's month figure as typed: a share resolved against its typed parent, or against take-home without one. */
export function typedCaps(lines: readonly BudgetLine[], state: EditState, takeHomeMinor: number, currency: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (rows: readonly BudgetLine[], parentMinor: number | null) => {
    for (const line of rows) {
      const row = rowStateOf(state, line.id);
      let minor: number | null = null;
      if (row.mode === 'share') {
        try {
          const share = shareOfMinor(parentMinor ?? takeHomeMinor, parsePercentBp(row.amount), currency);
          minor = share > 0 ? share : null;
        } catch {
          minor = null;
        }
      } else minor = monthlyOf(row, currency);
      if (minor !== null) out.set(line.id, minor);
      walk(line.children, minor);
    }
  };
  walk(lines, null);
  return out;
}

/** What a row's % is of, by what is typed above it now: its parent's figure, or take-home. */
export function basisOfRow(row: EditRow, figures: Map<string, number>): ShareBasis {
  return row.parentId !== null && figures.has(row.parentId) ? 'parent' : 'take-home';
}
```

- `liveCapsTotal(lines, state, takeHomeMinor, currency)`:

```ts
  const figures = typedCaps(lines, state, takeHomeMinor, currency);
  const node = (line: BudgetLine): CapNode => ({ capMinor: figures.get(line.id) ?? null, children: line.children.map(node) });
  return outermostCapsTotal(lines.map(node));
```

- `fillFromLastMonth`: the filled state gains `mode: 'amount'`.
- `changesOf(groups, state, initial, budgets, takeHomeMinor, currency)`. It needs the lines to resolve, so rebuild them from `groups`: each `EditRow` has `parentId`. Compute `figures` with a walk over the rows in group order, parents first, which `editGroups` already guarantees:

```ts
  const figures = new Map<string, number>();
  for (const row of groups.flatMap((group) => group.rows)) {
    const typed = rowStateOf(state, row.id);
    if (typed.mode === 'share') {
      try {
        const base = row.parentId !== null && figures.has(row.parentId) ? figures.get(row.parentId)! : takeHomeMinor;
        const share = shareOfMinor(base, parsePercentBp(typed.amount), currency);
        if (share > 0) figures.set(row.id, share);
      } catch {
        // unreadable: named below
      }
    } else {
      const minor = monthlyOf(typed, currency);
      if (minor !== null) figures.set(row.id, minor);
    }
  }
```

  Then, in the existing per-row loop, compare `mode` with `loaded.mode` as well as amount and frequency. For a share row:

```ts
    if (typed.mode === 'share') {
      let bp: number;
      try {
        bp = parsePercentBp(typed.amount);
      } catch {
        out.unreadable.push(row.id);
        continue;
      }
      out.save.push({ categoryAccountId: row.id, amountMinor: figures.get(row.id) ?? 0, frequency: 'monthly', share: { basis: basisOfRow(row, figures), bp } });
      continue;
    }
```

  The order of `save` in the test above (`fun`, `t`, `fuel`) is the group order: Entertainment's group comes first by name.
- `isDirty`: also compare `mode`.
- Imports: `formatBp, parsePercentBp, type ShareBasis, shareOfMinor` from `@expanses/core`.

- [ ] **Step 4: Run them**

Run: `npm test -w @expanses/web -- edit-budgets-model`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/budget/edit-budgets-model.ts apps/web/src/features/budget/edit-budgets-model.test.ts
git commit -m "Edit budgets' model takes a % per row: resolved against its typed parent or take-home, and saved with the basis it has

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: web — Edit budgets offers "%" per row

**Files:**
- Modify: `apps/web/src/features/budget/EditBudgetsPage.tsx`

**Interfaces:**
- Consumes: Task 7's `typedCaps`, `liveCapsTotal(…, takeHomeMinor, …)`, `changesOf(…, takeHomeMinor, …)`, `RowState.mode`; Task 6's `toPercent`/`toAmount`/`ShareBase`.

- [ ] **Step 1: Wire the model's new signatures**

- `const takeHome = sheet?.incomePlanMinor ?? 0;` (this month's take-home, as the sheet reads it).
- `liveCapsTotal(sheet.lines, state, takeHome, currency)` and `changesOf(groups, state, initial, budgets, takeHome, currency)`.
- `const figures = sheet ? typedCaps(sheet.lines, state, takeHome, currency) : new Map<string, number>();`

- [ ] **Step 2: The row's unit menu gains "%"**

In `BudgetField`:
- The `<select>` value becomes `value.mode === 'share' ? 'share' : value.frequency`.
- After the frequency options, add `<option value="share" disabled={shareDisabled}>%</option>`.
- `onChange`:

```ts
          onChange={(e) => {
            const next = e.target.value;
            if (next === 'share') onChange({ mode: 'share', frequency: 'monthly', amount: toPercent(value.amount, base, currency) });
            else onChange({ mode: 'amount', frequency: next as BudgetFrequency, amount: value.mode === 'share' ? toAmount(value.amount, base, currency) : value.amount });
          }}
```

New `BudgetField` props:
- `base: ShareBase` — from the page: `{ basis: basisOfRow(row, figures), label: basisOfRow(row, figures) === 'parent' ? labelOf(row.parentId!) : 'take-home', minor: basisOfRow(row, figures) === 'parent' ? figures.get(row.parentId!)! : takeHome }`. Here `labelOf` returns the parent row's name: for a root it is `rows.find(r => r.id === id)?.name`.
- `shareDisabled: boolean` — `base.minor <= 0`.

In share mode:
- the input's `inputMode` is `"decimal"`;
- its `onChange` keeps digits, comma and dot: `onChange({ amount: e.target.value.replace(/[^\d.,]/g, '') })`;
- the hint reads `= ${formatMinor(figures.get(row.id) ?? 0, currency)} of ${base.label}`.

The row chips (`offered`) set `mode: 'amount'` along with their amount.

- [ ] **Step 3: The summary card**

After the Debt · Goals · Unplanned line, add:

```tsx
        {income > 0 ? (
          <p className="text-[13px] leading-[18px] text-[var(--ph-ink-3)]" data-testid="edit-share">
            {Math.round((budgeted / income) * 100)}% of take-home budgeted
          </p>
        ) : (
          <p className="text-[13px] leading-[18px] text-[var(--ph-warn)]">Set a take-home first to budget by %</p>
        )}
```

- [ ] **Step 4: Typecheck, unit tests, look at it**

Run: `npm run typecheck && npm test -w @expanses/web`
Expected: PASS.

Then `npm run dev`, open `/budget/edit` at 390 px, and check:
- picking "%" turns the figure into its share;
- the hint names the basis;
- the total follows;
- "%" is greyed out while take-home is 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/budget/EditBudgetsPage.tsx
git commit -m "Edit budgets sets any row as a %, of take-home or of the parent typed above it, and says how much of take-home is budgeted

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: e2e — journeys, then the whole branch

**Files:**
- Create: `apps/web/e2e/budget-percent.spec.ts`
- Modify: `apps/web/e2e/budget.ts`, if a helper for setting take-home is worth sharing (`setTakeHome(page, figure)`)

**Interfaces:**
- Consumes: the screens from Tasks 6–8. Testids and labels used:
  - `income-line`, the TakeHomeSheet's `Take-home` field and `Save take-home` button (existing);
  - `edit-budgets`, `edit-budgeted`, `edit-share`;
  - the row label and `<label> every`;
  - the sheet's `Set as` radiogroup and its `%` radio.

- [ ] **Step 1: Write the spec**

```ts
import { expect, type Page, test } from '@playwright/test';
import { budgetTab, capField, openCapOf, openEditBudgets } from './budget';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function setTakeHome(page: Page, figure: string) {
  await budgetTab(page, 'Plan');
  await page.getByTestId('income-line').click();
  const sheet = page.getByRole('dialog', { name: 'Take-home' });
  await sheet.getByLabel('Take-home', { exact: true }).fill(figure);
  await sheet.getByRole('button', { name: 'Save take-home' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await budgetTab(page, 'Spending');
}

test('a budget set as 30% of take-home follows the take-home when it changes', async ({ page }) => {
  await page.goto('/budget');
  await setTakeHome(page, '10000000');

  const screen = await openEditBudgets(page);
  const { field, label } = await capField(screen, 'Food and beverage');
  await screen.getByLabel(`${label} every`).selectOption('share');
  await field.fill('30');
  await expect(screen.getByTestId('edit-budgeted')).toContainText('3.000.000');
  await expect(screen.getByTestId('edit-share')).toContainText('30% of take-home');
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByTestId('line-Food and beverage')).toContainText('left of 3.000.000');

  await setTakeHome(page, '12000000');
  await expect(page.getByTestId('line-Food and beverage')).toContainText('left of 3.600.000');
});

test('the sheet turns a figure into its % and back, and keeps the budget a % after saving', async ({ page }) => {
  await page.goto('/budget');
  await setTakeHome(page, '12000000');
  const screen = await openEditBudgets(page);
  await (await capField(screen, 'Household')).field.fill('1860000');
  await page.getByRole('button', { name: 'Save budgets' }).click();

  const sheet = await openCapOf(page, 'Household');
  await sheet.getByRole('radio', { name: '%' }).click();
  await expect(sheet.getByLabel('Share', { exact: true })).toHaveValue('15,5');
  await expect(sheet).toContainText('of take-home');
  await sheet.getByRole('button', { name: 'Save budget' }).click();

  const again = await openCapOf(page, 'Household');
  await expect(again.getByRole('radio', { name: '%' })).toHaveAttribute('aria-checked', 'true');
  await expect(again.getByLabel('Share', { exact: true })).toHaveValue('15,5');
});

test('a % of a parent: removing the parent asks first, and the child keeps its figure as an amount', async ({ page }) => {
  await page.goto('/budget');
  const screen = await openEditBudgets(page);
  const parent = await capField(screen, 'Household');
  await parent.field.fill('2000000');
  const child = await capField(screen, 'Groceries');
  await screen.getByLabel(`${child.label} every`).selectOption('share');
  await child.field.fill('40');
  await expect(screen.getByTestId('edit-row-Groceries')).toContainText('of Household');
  await page.getByRole('button', { name: 'Save budgets' }).click();

  page.removeAllListeners('dialog');
  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  const sheet = await openCapOf(page, 'Household');
  await sheet.getByRole('button', { name: 'Remove budget' }).click();
  await expect.poll(() => asked).toContain('Groceries keeps Rp 800.000 a month');

  const groceries = await openCapOf(page, 'Groceries');
  await expect(groceries.getByRole('radio', { name: 'Amount' })).toHaveAttribute('aria-checked', 'true');
  await expect(groceries.getByLabel('Cap', { exact: true })).toHaveValue('800.000');
});
```

Check the `SegmentedControl`'s accessible roles in `ui/native/Segmented.tsx`. The budget tabs use `radiogroup` with `radio` items and `aria-checked` (see `e2e/budget.ts` `budgetTab` and `phone-budget-tabs.spec.ts`), so the same roles apply here. Check also that "Food and beverage" and "Household" with "Groceries" are seeded roots, as `budget-frequency.spec.ts` and `budget.spec.ts` show.

- [ ] **Step 2: Run it, fix what the run shows (systematic-debugging on any failure), then run every budget spec on both projects**

From `apps/web`:

Run: `npx playwright test budget-percent --project=chromium`
Expected: PASS.

Run: `npx playwright test budget category-sets bill-pause health-ratios-combinations events add-transaction phone-budget phone-health-ratios phone-bill-pause phone.spec --workers=5`
Expected: all PASS.

- [ ] **Step 3: Whole branch**

Run: `npm run typecheck && npm test`
Expected: all PASS.

Then, from `apps/web`: `npx playwright test --workers=5`. Expected: all PASS. A timeout under load is re-run with `--last-failed --workers=3` before it counts.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e
git commit -m "The budget walks set a % of take-home that follows it, turn a figure into its % and back, and keep a %-child's figure when its parent goes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
