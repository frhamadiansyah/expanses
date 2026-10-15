# Budget Quick Set — Build 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setting a budget takes two taps from the Budget page, and every budget can be set on one Edit budgets screen.

**Architecture:**
- Two small pure helpers go into `@expanses/core`: the outermost-cap total, taken out of `budgetSheet`, and rounding up to a whole major unit.
- One atomic writer goes into `@expanses/db`: `saveBudgets`.
- The rest is web, split three ways:
  - pure view models next to the existing `budget-view.ts`, unit-tested;
  - a reshaped `CapSheet` and `BudgetPage`;
  - a new route `/budget/edit`.
- Spending history comes from `budgetSheetFor` for the three months before the one shown. It goes through the same react-query key as the page, so its figures match what a cap measures. No new db reader is needed (the spec's `spendingHistory` is folded into the web hook).

**Tech Stack:** TypeScript, React 19, TanStack Router + Query, drizzle (SQLite), vitest, Playwright (projects `chromium` and `phone`).

**Spec:** `docs/superpowers/specs/2026-10-15-budget-quick-set-design.md` — parts 1–3. Part 4 (% budgets) is Build 2 and is **not** in this plan.

## Global Constraints

- Country-neutral: rounding is by the currency's exponent (`currencyInfo(currency).exponent`), never by currency name.
- Corner buttons carry a glyph, never a word (`ui/native/title.ts` `CornerAction`): the Budget page's Edit budgets is a ✎ corner labelled "Edit budgets".
- Copy never says "you".
- No real statement data in fixtures: invented names and amounts only.
- Money logic has unit tests (core, db, and the pure web models). UI is covered by Playwright.
- Commit messages are sentences describing the behaviour, ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Test commands:
  - `npm test -w @expanses/core`
  - `npm test -w @expanses/db`
  - `npm test -w @expanses/web`
  - `npm run typecheck`
  - from `apps/web`: `npx playwright test <file> --project=<chromium|phone>`

## Review Focus

1. **Programmatic focus on iOS.** WKWebView may not raise the keyboard for focus that no tap started. The sheet opens from a tap, so `autoFocus` should hold. This needs a device check on TestFlight, and Task 5's e2e asserts focus and selection in Chromium.
2. **A row typed with a non-monthly unit.** In Edit budgets, "1.200.000 /yr" counts as 100.000 in the live Budgeted total, not as 1.200.000. Task 4 has a test for this.
3. **Saving with a figure that can't be read** ("1.2.3,,"). Save is refused, nothing is written, and the row is named. Task 4 (model) and Task 7 (page) cover it.
4. **Back from Edit budgets with changes made.** The "Discard changes?" question appears. With no changes, it goes straight back. Task 8 e2e.
5. **A category whose only spending is in a sub-category.** Its root is listed under No budget yet as the header row, and the sub-category is indented under it. Task 3 has a test for this.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/budget/sheet.ts` | + `CapNode`, `outermostCapsTotal`; `budgetSheet` uses it |
| `packages/core/src/money/money.ts` | + `roundUpToMajor` |
| `packages/core/src/index.ts` | exports both |
| `packages/db/src/repos/budgets.ts` | `BudgetError.categoryAccountId`; shared row writers; + `saveBudgets` |
| `apps/web/src/features/budget/budget-view.ts` | + `noBudgetRows`, `historyOf`, `SpendHistory` |
| `apps/web/src/features/budget/edit-budgets-model.ts` (new) | pure model of the Edit budgets screen |
| `apps/web/src/features/budget/queries.ts` | + `useSpendingHistory` |
| `apps/web/src/features/budget/CapSheet.tsx` | known category only, auto-focus/select, Use a figure chips |
| `apps/web/src/features/budget/BudgetPage.tsx` | ✎ corner, No budget yet group, month from search |
| `apps/web/src/features/budget/BudgetSheets.tsx` | `NoBudgetSheet` deleted |
| `apps/web/src/features/budget/EditBudgetsPage.tsx` (new) | the Edit budgets screen |
| `apps/web/src/app/router.tsx` | `/budget` search `month`; route `/budget/edit` |
| `apps/web/e2e/budget.ts` | helpers move to the new paths |
| `apps/web/e2e/*.spec.ts` (budget ones) | updated; + `budget-quick-set.spec.ts`, `phone-budget-quick-set.spec.ts` |

---

### Task 1: core — outermost-cap total and rounding up to a whole unit

**Files:**
- Modify: `packages/core/src/budget/sheet.ts` (the walk near line 132)
- Modify: `packages/core/src/money/money.ts`
- Modify: `packages/core/src/index.ts` (lines ~34 and ~390)
- Test: `packages/core/test/budget-sheet.test.ts`, `packages/core/test/money.test.ts`

**Interfaces:**
- Produces:
  - `interface CapNode { capMinor: number | null; children: readonly CapNode[] }`
  - `outermostCapsTotal(lines: readonly CapNode[]): number`
  - `roundUpToMajor(minor: number, currency: string): number`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/budget-sheet.test.ts` (add `outermostCapsTotal` to its import from `'../src/index'`):

```ts
describe('outermostCapsTotal', () => {
  const node = (capMinor: number | null, children: { capMinor: number | null; children: never[] }[] = []) => ({ capMinor, children });

  it('counts a cap inside a capped branch once, as the outer cap', () => {
    expect(outermostCapsTotal([node(500, [node(200), node(100)]), node(300)])).toBe(800);
  });

  it('adds the children when their parent carries no cap', () => {
    expect(outermostCapsTotal([node(null, [node(200), node(null)])])).toBe(200);
  });

  it('is nothing when nothing is capped', () => {
    expect(outermostCapsTotal([node(null, [node(null)])])).toBe(0);
  });
});
```

Append to `packages/core/test/money.test.ts` (add `roundUpToMajor` to its import):

```ts
describe('roundUpToMajor', () => {
  it('leaves a whole figure alone and lifts a part one to the next whole unit', () => {
    expect(roundUpToMajor(1_420_000, 'IDR')).toBe(1_420_000);
    expect(roundUpToMajor(1_234, 'USD')).toBe(1_300);
    expect(roundUpToMajor(1_200, 'USD')).toBe(1_200);
    expect(roundUpToMajor(999, 'JPY')).toBe(999);
  });

  it('gives nothing for nothing or less', () => {
    expect(roundUpToMajor(0, 'USD')).toBe(0);
    expect(roundUpToMajor(-250, 'USD')).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @expanses/core -- budget-sheet money`
Expected: FAIL, because `outermostCapsTotal` and `roundUpToMajor` are not exported.

- [ ] **Step 3: Implement**

In `packages/core/src/budget/sheet.ts`, above `export function budgetSheet`:

```ts
/** What a cap total needs of a line: its own cap, and the lines under it. */
export interface CapNode {
  capMinor: number | null;
  children: readonly CapNode[];
}

/**
 * A budget inside a budgeted branch is a tighter cap, not another pocket of money: only the outermost cap in each
 * branch belongs in the total.
 */
export function outermostCapsTotal(lines: readonly CapNode[]): number {
  let total = 0;
  const walk = (rows: readonly CapNode[]) => {
    for (const row of rows) {
      if (row.capMinor !== null) total += row.capMinor;
      else walk(row.children);
    }
  };
  walk(lines);
  return total;
}
```

Replace the walk inside `budgetSheet` (the comment, `let capsTotalMinor = 0;`, `let overCount = 0;`, the `walk` closure and `walk(lines, false);`) with:

```ts
  const capsTotalMinor = outermostCapsTotal(lines);
  let overCount = 0;
  const countOver = (rows: BudgetLine[]) => {
    for (const row of rows) {
      if (row.overMinor > 0) overCount += 1;
      countOver(row.children);
    }
  };
  countOver(lines);
```

In `packages/core/src/money/money.ts`, after `wholeFromHundredths`:

```ts
/**
 * Up to the next whole major unit, by the currency's exponent: 12,34 USD → 13,00; a currency with no minor unit is
 * already whole. Nothing or less is nothing — a suggestion is never a negative cap.
 */
export function roundUpToMajor(minor: number, currency: string): number {
  assertMinor(minor);
  if (minor <= 0) return 0;
  const unit = 10 ** currencyInfo(currency).exponent;
  const rest = minor % unit;
  return rest === 0 ? minor : minor - rest + unit;
}
```

In `packages/core/src/index.ts`:
- add `roundUpToMajor,` to the `export { … } from './money/money';` list;
- change line ~390 to `export { budgetSheet, type BudgetCap, type BudgetLine, type BudgetSheet, type BudgetSheetInput, type CapNode, outermostCapsTotal, type SavingsRow } from './budget/sheet';`.

- [ ] **Step 4: Run the tests**

Run: `npm test -w @expanses/core`
Expected: all PASS. The existing `budgetSheet` tests still give the same `capsTotalMinor` and `overCount`.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "The outermost-cap total and rounding up to a whole unit are core helpers of their own

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: db — `saveBudgets` writes every change or none

**Files:**
- Modify: `packages/db/src/repos/budgets.ts`
- Test: `packages/db/test/budgets.test.ts`

**Interfaces:**
- Consumes: the existing `saveBudget`, `removeBudget`, `SaveBudgetInput`.
- Produces:
  - `class BudgetError { code; message; categoryAccountId?: string }`
  - `interface BudgetChanges { save: SaveBudgetInput[]; remove: string[] }`
  - `saveBudgets(database: Database, ws: WorkspaceContext, changes: BudgetChanges): Promise<void>`
  - `saveBudget` and `removeBudget` keep their signatures and behaviour.

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/test/budgets.test.ts` (add `saveBudgets` to the import):

```ts
describe('saveBudgets', () => {
  it('saves and removes together', async () => {
    const { database, ws, food, coffee } = await withCategories();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 5_000_000 });

    await saveBudgets(database, ws, { save: [{ categoryAccountId: coffee.id, amountMinor: 1_200_000, frequency: 'yearly' }], remove: [food.id] });

    const rows = await listBudgets(database, ws, '2026-09');
    expect(capOf(rows, food.id)).toBeUndefined();
    expect(capOf(rows, coffee.id)).toMatchObject({ planMinor: 100_000, frequency: 'yearly', amountAsSetMinor: 1_200_000 });
  });

  it('writes nothing when one row is refused, and names that row', async () => {
    const { database, ws, food, coffee } = await withCategories();

    const refused = saveBudgets(database, ws, {
      save: [
        { categoryAccountId: food.id, amountMinor: 5_000_000 },
        { categoryAccountId: coffee.id, amountMinor: 0 },
      ],
      remove: [],
    });

    await expect(refused).rejects.toMatchObject({ name: 'BudgetError', categoryAccountId: coffee.id });
    expect(await listBudgets(database, ws, '2026-09')).toHaveLength(0);
  });

  it('leaves a month of its own standing when the plan is saved', async () => {
    const { database, ws, food } = await withCategories();
    await saveBudget(database, ws, { categoryAccountId: food.id, amountMinor: 5_000_000 });
    await setBudgetOverride(database, ws, { categoryAccountId: food.id, month: '2026-12', amountMinor: 9_000_000 });

    await saveBudgets(database, ws, { save: [{ categoryAccountId: food.id, amountMinor: 6_000_000 }], remove: [] });

    expect(capOf(await listBudgets(database, ws, '2026-12'), food.id)).toMatchObject({ amountMinor: 9_000_000, planMinor: 6_000_000, overridden: true });
  });

  it('does nothing for no changes', async () => {
    const { database, ws } = await withCategories();
    await saveBudgets(database, ws, { save: [], remove: [] });
    expect(await listBudgets(database, ws, '2026-09')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @expanses/db -- budgets.test`
Expected: FAIL, because `saveBudgets` is not exported.

- [ ] **Step 3: Implement**

In `packages/db/src/repos/budgets.ts`:

1. Give `BudgetError` an optional category:

```ts
export class BudgetError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The category the refusal is about, when several were being saved at once. */
    readonly categoryAccountId?: string,
  ) {
    super(message);
    this.name = 'BudgetError';
  }
}
```

2. Take the checks and the writes out of `saveBudget` and `removeBudget`. Put this above `saveBudget`. `Tx` is the transaction type `database.transaction` hands its callback; reuse whatever name `database.ts` exports for it (grep `transaction(` in `packages/db/src/database.ts`). If none is exported, type the parameter `Parameters<Parameters<Database['transaction']>[0]>[0]`.

```ts
/** A budget's figure as a month, checked; the refusals every way of saving a budget shares. */
function checkedMonthly(input: SaveBudgetInput): { monthlyMinor: number; frequency: BudgetFrequency } {
  assertWholeMinor(input.amountMinor);
  if (input.amountMinor <= 0) throw new BudgetError('AMOUNT_RANGE', 'A budget must be above zero; remove it instead');
  const frequency = input.frequency ?? 'monthly';
  if (!BUDGET_FREQUENCIES.includes(frequency)) throw new BudgetError('BAD_FREQUENCY', `${String(frequency)} is not a unit a budget can be set in`);
  // Converted once, here. Every reader of budgets.amount_minor goes on reading a month.
  const monthlyMinor = perMonthMinor(input.amountMinor, frequency);
  if (monthlyMinor <= 0) throw new BudgetError('AMOUNT_RANGE', 'That comes to nothing a month; set it higher or choose a shorter period');
  return { monthlyMinor, frequency };
}

/** Writes one checked budget inside a transaction already open; its id back. */
async function writeBudget(tx: Tx, ws: WorkspaceContext, input: SaveBudgetInput, checked: { monthlyMinor: number; frequency: BudgetFrequency }, now: string): Promise<string> {
  const { monthlyMinor, frequency } = checked;
  const [existing] = await tx
    .select({ id: budgets.id })
    .from(budgets)
    .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, input.categoryAccountId)));
  const id = existing?.id ?? uuidv7();
  await withCapture(tx, [{ entity: 'budget', id }, { entity: 'budget_frequency', id }], async () => {
    if (existing) {
      await tx.update(budgets).set({ amountMinor: monthlyMinor, updatedAt: now }).where(eq(budgets.id, id));
    } else {
      await tx.insert(budgets).values({ id, workspaceId: ws.workspaceId, categoryAccountId: input.categoryAccountId, amountMinor: monthlyMinor, createdAt: now, updatedAt: now });
    }
    // Monthly is the absence of a row. Without 0053 the monthly figure is all that is kept, which is still the right money.
    if (await healthTablesExist(tx)) {
      await tx.delete(budgetFrequencies).where(eq(budgetFrequencies.budgetId, id));
      if (frequency !== 'monthly') {
        await tx.insert(budgetFrequencies).values({ budgetId: id, workspaceId: ws.workspaceId, frequency, amountAsSetMinor: input.amountMinor });
      }
    }
  });
  return id;
}

/** Deletes one category's budget and every override that only made sense against it, inside an open transaction. */
async function deleteBudget(tx: Tx, ws: WorkspaceContext, categoryAccountId: string): Promise<void> {
  const [existing] = await tx
    .select({ id: budgets.id })
    .from(budgets)
    .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, categoryAccountId)));
  if (!existing) return;
  await withCapture(tx, [{ entity: 'budget', id: existing.id }, { entity: 'budget_frequency', id: existing.id }, { entity: 'budget_override' }], async () => {
    if (await healthTablesExist(tx)) await tx.delete(budgetFrequencies).where(eq(budgetFrequencies.budgetId, existing.id));
    await tx.delete(budgetOverrides).where(eq(budgetOverrides.budgetId, existing.id));
    await tx.delete(budgets).where(eq(budgets.id, existing.id));
  });
}
```

3. Rewrite `saveBudget` and `removeBudget` on top of these, behaviour unchanged:

```ts
export async function saveBudget(database: Database, ws: WorkspaceContext, input: SaveBudgetInput): Promise<string> {
  const checked = checkedMonthly(input);
  await assertCategory(database, ws, input.categoryAccountId);
  const now = new Date().toISOString();
  return database.transaction((tx) => writeBudget(tx, ws, input, checked, now));
}

/** Removes the budget and every override that only made sense against it. */
export async function removeBudget(database: Database, ws: WorkspaceContext, categoryAccountId: string): Promise<void> {
  await database.transaction((tx) => deleteBudget(tx, ws, categoryAccountId));
}
```

4. Add `saveBudgets` after `removeBudget`:

```ts
export interface BudgetChanges {
  save: SaveBudgetInput[];
  remove: string[];
}

/**
 * Every budget the Edit budgets screen changed, written together: each row is checked before anything is written, so
 * one refusal leaves every budget as it was. A refusal names its category.
 */
export async function saveBudgets(database: Database, ws: WorkspaceContext, changes: BudgetChanges): Promise<void> {
  const checked: { input: SaveBudgetInput; monthly: { monthlyMinor: number; frequency: BudgetFrequency } }[] = [];
  for (const input of changes.save) {
    try {
      const monthly = checkedMonthly(input);
      await assertCategory(database, ws, input.categoryAccountId);
      checked.push({ input, monthly });
    } catch (e) {
      if (e instanceof BudgetError) throw new BudgetError(e.code, e.message, input.categoryAccountId);
      throw e;
    }
  }
  if (checked.length === 0 && changes.remove.length === 0) return;
  const now = new Date().toISOString();
  await database.transaction(async (tx) => {
    for (const categoryAccountId of changes.remove) await deleteBudget(tx, ws, categoryAccountId);
    for (const { input, monthly } of checked) await writeBudget(tx, ws, input, monthly, now);
  });
}
```

`assertWholeMinor` throws a `BudgetError`, so it is renamed with its category too.

- [ ] **Step 4: Run the tests**

Run: `npm test -w @expanses/db`
Expected: all PASS, including the capture suite (`vitest.capture.config.ts`). That suite proves the writes still capture for sync.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "Several budgets are saved in one go, and one refused leaves every budget as it was

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: web — the No budget yet rows and spending history, as pure views

**Files:**
- Modify: `apps/web/src/features/budget/budget-view.ts`
- Test: `apps/web/src/features/budget/budget-view.test.ts`

**Interfaces:**
- Consumes: `roundUpToMajor` (Task 1); the existing `NoBudgetEntry`.
- Produces:
  - `interface NoBudgetRow { line: BudgetLine; spentMinor: number; depth: 0 | 1 }`
  - `noBudgetRows(entries: readonly NoBudgetEntry[]): NoBudgetRow[]`
  - `interface SpendHistory { lastMinor: number; averageMinor: number }`
  - `historyOf(months: readonly (readonly BudgetLine[])[], currency: string): Map<string, SpendHistory>`. Here `months` is newest first: index 0 is the month before the one shown.

- [ ] **Step 1: Write the failing tests**

Append to `budget-view.test.ts` (add `historyOf, noBudgetRows` to the import; the file's `line(id, ownMinor, capMinor, children)` helper already exists):

```ts
describe('noBudgetRows', () => {
  it('lists an uncapped root, then its uncapped sub-categories one step in, each only when it spent', () => {
    const food = line('food', 0, null, [line('groceries', 300, null), line('snacks', 0, null)]);
    const fun = line('fun', 0, null);
    const view = spendingView([food, fun]);

    expect(noBudgetRows(view.noBudget).map((row) => [row.line.id, row.depth, row.spentMinor])).toEqual([
      ['food', 0, 300],
      ['groceries', 1, 300],
    ]);
  });

  it('leaves out a sub-category a capped parent already covers', () => {
    const view = spendingView([line('food', 0, 1_000, [line('groceries', 300, null)])]);
    expect(noBudgetRows(view.noBudget)).toEqual([]);
  });
});

describe('historyOf', () => {
  it('reads last month and the three-month average, rounded up to a whole unit', () => {
    const months = [[line('food', 1_000, null)], [line('food', 2_000, null)], [line('food', 1_001, null)]];
    expect(historyOf(months, 'USD').get('food')).toEqual({ lastMinor: 1_000, averageMinor: 1_400 });
  });

  it('counts a month a category did not appear in as nothing, and a sub-category by its own total', () => {
    const months = [[line('food', 0, null, [line('groceries', 600, null)])], [], []];
    const history = historyOf(months, 'IDR');
    expect(history.get('groceries')).toEqual({ lastMinor: 600, averageMinor: 200 });
    expect(history.get('food')).toEqual({ lastMinor: 600, averageMinor: 200 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @expanses/web -- budget-view`
Expected: FAIL, because `noBudgetRows` and `historyOf` are not exported.

- [ ] **Step 3: Implement**

Append to `budget-view.ts` (add `roundUpToMajor` to the `@expanses/core` import):

```ts
/** One row of the page's No budget yet group: a root, or one of its sub-categories one step in. */
export interface NoBudgetRow {
  line: BudgetLine;
  spentMinor: number;
  depth: 0 | 1;
}

/** What no cap covers and that spent something, roots by spend with their spending sub-categories under them. */
export function noBudgetRows(entries: readonly NoBudgetEntry[]): NoBudgetRow[] {
  return entries
    .filter((entry) => entry.spentMinor > 0)
    .flatMap((entry) => [
      { line: entry.line, spentMinor: entry.spentMinor, depth: 0 as const },
      ...entry.children.filter((child) => child.spentMinor > 0).map((child) => ({ line: child.line, spentMinor: child.spentMinor, depth: 1 as const })),
    ]);
}

/** What a category spent the month before, and on average over the months read. */
export interface SpendHistory {
  lastMinor: number;
  averageMinor: number;
}

/** Each category's history from earlier months' lines, newest first; a month it is missing from counts as nothing. */
export function historyOf(months: readonly (readonly BudgetLine[])[], currency: string): Map<string, SpendHistory> {
  const totals = new Map<string, number[]>();
  months.forEach((lines, index) => {
    const walk = (rows: readonly BudgetLine[]) => {
      for (const row of rows) {
        const list = totals.get(row.id) ?? months.map(() => 0);
        list[index] = row.totalMinor;
        totals.set(row.id, list);
        walk(row.children);
      }
    };
    walk(lines);
  });
  return new Map(
    [...totals].map(([id, list]) => [
      id,
      { lastMinor: Math.max(0, list[0] ?? 0), averageMinor: roundUpToMajor(Math.ceil(list.reduce((sum, minor) => sum + minor, 0) / months.length), currency) },
    ]),
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w @expanses/web -- budget-view`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/budget/budget-view.ts apps/web/src/features/budget/budget-view.test.ts
git commit -m "What no cap covers is listed root by root with its sub-categories, and each category knows what it spent before

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: web — the Edit budgets model

**Files:**
- Create: `apps/web/src/features/budget/edit-budgets-model.ts`
- Test: `apps/web/src/features/budget/edit-budgets-model.test.ts`

**Interfaces:**
- Consumes:
  - `outermostCapsTotal`, `CapNode`, `roundUpToMajor`, `parseMajor` (core)
  - `BudgetRow`, `SaveBudgetInput`, `BudgetChanges` (db)
  - `bareFigure` (`../networth/debt-rows`)
  - `perMonthPreview` (`./frequency-form`)
- Produces:
  - `interface EditRow { id: string; label: string; name: string; depth: number; parentId: string | null; hasChildren: boolean }`
  - `interface EditGroup { id: string; name: string; rows: EditRow[] }`
  - `interface RowState { amount: string; frequency: BudgetFrequency; filled: boolean }`
  - `type EditState = Record<string, RowState>`
  - `editGroups(lines: readonly BudgetLine[]): EditGroup[]`
  - `initialState(groups: readonly EditGroup[], budgets: readonly BudgetRow[], currency: string): EditState`
  - `monthlyOf(row: RowState | undefined, currency: string): number | null`
  - `liveCapsTotal(lines: readonly BudgetLine[], state: EditState, currency: string): number`
  - `fillFromLastMonth(groups: readonly EditGroup[], state: EditState, history: ReadonlyMap<string, { lastMinor: number }>, currency: string): EditState`
  - `changesOf(groups: readonly EditGroup[], state: EditState, budgets: readonly BudgetRow[], currency: string): BudgetChanges & { unreadable: string[] }`
  - `isDirty(state: EditState, initial: EditState): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import type { BudgetLine } from '@expanses/core';
import type { BudgetRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { changesOf, editGroups, fillFromLastMonth, initialState, isDirty, liveCapsTotal } from './edit-budgets-model';

function line(id: string, name: string, children: BudgetLine[] = []): BudgetLine {
  return { id, name, ownMinor: 0, totalMinor: 0, capMinor: null, overMinor: 0, children };
}
const budget = (categoryAccountId: string, amountAsSetMinor: number, frequency: BudgetRow['frequency'] = 'monthly'): BudgetRow => ({
  id: `b-${categoryAccountId}`,
  categoryAccountId,
  planMinor: amountAsSetMinor,
  amountMinor: amountAsSetMinor,
  overridden: false,
  frequency,
  amountAsSetMinor,
});

const lines = [line('t', 'Transport', [line('fuel', 'Fuel'), line('ride', 'Ride hailing')]), line('fun', 'Entertainment')];

describe('editGroups', () => {
  it('gives a root with children an All row first, its children one step in, and a lone root a single row; by name', () => {
    expect(editGroups(lines).map((group) => group.rows.map((row) => [row.label, row.depth]))).toEqual([
      [['Entertainment', 0]],
      [['All Transport', 0], ['Fuel', 1], ['Ride hailing', 1]],
    ]);
  });
});

describe('initialState', () => {
  it('shows a cap as it was typed, in its unit, and an uncapped row empty', () => {
    const state = initialState(editGroups(lines), [budget('fuel', 1_200_000, 'yearly')], 'IDR');
    expect(state.fuel).toEqual({ amount: '1.200.000', frequency: 'yearly', filled: false });
    expect(state.ride).toEqual({ amount: '', frequency: 'monthly', filled: false });
  });
});

describe('liveCapsTotal', () => {
  it('counts a yearly figure as its month, and a child inside a capped parent once', () => {
    const groups = editGroups(lines);
    const state = initialState(groups, [], 'IDR');
    state.fuel = { amount: '1.200.000', frequency: 'yearly', filled: false };
    state.fun = { amount: '300.000', frequency: 'monthly', filled: false };
    expect(liveCapsTotal(lines, state, 'IDR')).toBe(400_000);
    state.t = { amount: '1.000.000', frequency: 'monthly', filled: false };
    expect(liveCapsTotal(lines, state, 'IDR')).toBe(1_300_000);
  });

  it('leaves out a figure that cannot be read', () => {
    const state = initialState(editGroups(lines), [], 'IDR');
    state.fun = { amount: '1.2.3,,', frequency: 'monthly', filled: false };
    expect(liveCapsTotal(lines, state, 'IDR')).toBe(0);
  });
});

describe('fillFromLastMonth', () => {
  const history = new Map([
    ['fuel', { lastMinor: 560_000 }],
    ['ride', { lastMinor: 0 }],
    ['t', { lastMinor: 560_000 }],
    ['fun', { lastMinor: 125_000 }],
  ]);

  it('fills empty rows without children that spent, and nothing else', () => {
    const groups = editGroups(lines);
    const state = initialState(groups, [budget('fun', 200_000)], 'IDR');
    const next = fillFromLastMonth(groups, state, history, 'IDR');
    expect(next.fuel).toEqual({ amount: '560.000', frequency: 'monthly', filled: true });
    expect(next.ride.amount).toBe('');
    expect(next.t.amount).toBe('');
    expect(next.fun).toEqual(state.fun);
  });

  it('skips a row under a parent that already has a figure', () => {
    const groups = editGroups(lines);
    const state = initialState(groups, [budget('t', 900_000)], 'IDR');
    expect(fillFromLastMonth(groups, state, history, 'IDR').fuel.amount).toBe('');
  });
});

describe('changesOf', () => {
  it('saves new and changed rows, removes cleared ones, and leaves the untouched alone', () => {
    const groups = editGroups(lines);
    const budgets = [budget('fuel', 600_000), budget('fun', 200_000), budget('ride', 1_200_000, 'yearly')];
    const state = initialState(groups, budgets, 'IDR');
    state.fuel = { ...state.fuel, amount: '650.000' };
    state.fun = { ...state.fun, amount: '' };
    state.t = { amount: '1.000.000', frequency: 'monthly', filled: false };

    expect(changesOf(groups, state, budgets, 'IDR')).toEqual({
      save: [
        { categoryAccountId: 't', amountMinor: 1_000_000, frequency: 'monthly' },
        { categoryAccountId: 'fuel', amountMinor: 650_000, frequency: 'monthly' },
      ],
      remove: ['fun'],
      unreadable: [],
    });
  });

  it('names a figure that cannot be read instead of saving it', () => {
    const groups = editGroups(lines);
    const state = initialState(groups, [], 'IDR');
    state.fun = { amount: '1.2.3,,', frequency: 'monthly', filled: false };
    expect(changesOf(groups, state, [], 'IDR').unreadable).toEqual(['fun']);
  });
});

describe('isDirty', () => {
  it('is clean until a figure or a unit changes', () => {
    const groups = editGroups(lines);
    const initial = initialState(groups, [], 'IDR');
    expect(isDirty({ ...initial }, initial)).toBe(false);
    expect(isDirty({ ...initial, fun: { amount: '1', frequency: 'monthly', filled: false } }, initial)).toBe(true);
    expect(isDirty({ ...initial, fun: { amount: '', frequency: 'weekly', filled: false } }, initial)).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w @expanses/web -- edit-budgets-model`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `edit-budgets-model.ts`**

```ts
import { type BudgetFrequency, type BudgetLine, type CapNode, outermostCapsTotal, parseMajor, roundUpToMajor } from '@expanses/core';
import type { BudgetChanges, BudgetRow } from '@expanses/db';
import { bareFigure } from '../networth/debt-rows';
import { perMonthPreview } from './frequency-form';

/** One field on the Edit budgets screen: a category, named as the list shows it, and where it sits in its tree. */
export interface EditRow {
  id: string;
  /** "All Food" for a root that has children; the category's own name otherwise. */
  label: string;
  name: string;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
}

export interface EditGroup {
  id: string;
  name: string;
  rows: EditRow[];
}

/** What is typed in one row: the figure as typed, in its unit; `filled` when Fill from last month put it there. */
export interface RowState {
  amount: string;
  frequency: BudgetFrequency;
  filled: boolean;
}

export type EditState = Record<string, RowState>;

const byName = (a: BudgetLine, b: BudgetLine) => a.name.localeCompare(b.name);

/** One group per root, by name: a root with children leads with its own cap as "All <root>", then the tree under it. */
export function editGroups(lines: readonly BudgetLine[]): EditGroup[] {
  return [...lines].sort(byName).map((root) => {
    if (root.children.length === 0) {
      return { id: root.id, name: root.name, rows: [{ id: root.id, label: root.name, name: root.name, depth: 0, parentId: null, hasChildren: false }] };
    }
    const rows: EditRow[] = [{ id: root.id, label: `All ${root.name}`, name: root.name, depth: 0, parentId: null, hasChildren: true }];
    const walk = (parent: BudgetLine, depth: number) => {
      for (const child of [...parent.children].sort(byName)) {
        rows.push({ id: child.id, label: child.name, name: child.name, depth, parentId: parent.id, hasChildren: child.children.length > 0 });
        walk(child, depth + 1);
      }
    };
    walk(root, 1);
    return { id: root.id, name: root.name, rows };
  });
}

/** Every row as stored: the plan as it was typed, in the unit it was typed in. This month's own figure is not shown. */
export function initialState(groups: readonly EditGroup[], budgets: readonly BudgetRow[], currency: string): EditState {
  const byCategory = new Map(budgets.map((row) => [row.categoryAccountId, row]));
  const state: EditState = {};
  for (const row of groups.flatMap((group) => group.rows)) {
    const stored = byCategory.get(row.id);
    state[row.id] = { amount: stored ? bareFigure(stored.amountAsSetMinor, currency) : '', frequency: stored?.frequency ?? 'monthly', filled: false };
  }
  return state;
}

/** What a row comes to a month, or null when it is empty, unreadable or nothing. */
export function monthlyOf(row: RowState | undefined, currency: string): number | null {
  if (!row) return null;
  const minor = perMonthPreview(row.amount, row.frequency, currency);
  return minor !== null && minor > 0 ? minor : null;
}

/** The Budgeted figure as typed so far, counted as the sheet counts it: the outermost cap in each branch. */
export function liveCapsTotal(lines: readonly BudgetLine[], state: EditState, currency: string): number {
  const typed = (line: BudgetLine): CapNode => ({ capMinor: monthlyOf(state[line.id], currency), children: line.children.map(typed) });
  return outermostCapsTotal(lines.map(typed));
}

/**
 * Last month's spending, rounded up to a whole unit, into every row that is empty, has no children of its own, sits
 * under no parent with a figure, and spent something. Nothing else is touched.
 */
export function fillFromLastMonth(groups: readonly EditGroup[], state: EditState, history: ReadonlyMap<string, { lastMinor: number }>, currency: string): EditState {
  const next: EditState = { ...state };
  for (const group of groups) {
    const parentOf = new Map(group.rows.map((row) => [row.id, row.parentId]));
    const cappedAbove = (id: string) => {
      for (let up = parentOf.get(id) ?? null; up !== null; up = parentOf.get(up) ?? null) {
        if (monthlyOf(next[up], currency) !== null) return true;
      }
      return false;
    };
    for (const row of group.rows) {
      if (row.hasChildren || next[row.id]?.amount.trim() || cappedAbove(row.id)) continue;
      const spent = history.get(row.id)?.lastMinor ?? 0;
      if (spent <= 0) continue;
      next[row.id] = { amount: bareFigure(roundUpToMajor(spent, currency), currency), frequency: 'monthly', filled: true };
    }
  }
  return next;
}

/** What Save sends: new and changed rows, cleared ones removed, untouched ones left out; unreadable rows named. */
export function changesOf(groups: readonly EditGroup[], state: EditState, budgets: readonly BudgetRow[], currency: string): BudgetChanges & { unreadable: string[] } {
  const byCategory = new Map(budgets.map((row) => [row.categoryAccountId, row]));
  const out: BudgetChanges & { unreadable: string[] } = { save: [], remove: [], unreadable: [] };
  for (const row of groups.flatMap((group) => group.rows)) {
    const typed = state[row.id];
    if (!typed) continue;
    const stored = byCategory.get(row.id);
    if (!typed.amount.trim()) {
      if (stored) out.remove.push(row.id);
      continue;
    }
    let minor: number;
    try {
      minor = parseMajor(typed.amount, currency);
    } catch {
      out.unreadable.push(row.id);
      continue;
    }
    if (stored && minor === stored.amountAsSetMinor && typed.frequency === stored.frequency) continue;
    out.save.push({ categoryAccountId: row.id, amountMinor: minor, frequency: typed.frequency });
  }
  return out;
}

export function isDirty(state: EditState, initial: EditState): boolean {
  return Object.keys(state).some((id) => state[id]!.amount !== initial[id]?.amount || state[id]!.frequency !== initial[id]?.frequency);
}
```

`BudgetChanges` must be exported from `@expanses/db`. Task 2 exports it from `repos/budgets.ts`, which `index.ts` re-exports with `export *`.

- [ ] **Step 4: Run the tests**

Run: `npm test -w @expanses/web -- edit-budgets-model`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/budget/edit-budgets-model.ts apps/web/src/features/budget/edit-budgets-model.test.ts
git commit -m "Edit budgets has a model: the tree as rows, a fill from last month, a live total and what Save sends

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: web — the one-budget sheet opens ready to type, with figures to use

**Files:**
- Modify: `apps/web/src/features/budget/queries.ts`
- Modify: `apps/web/src/features/budget/CapSheet.tsx`
- Modify: `apps/web/src/features/budget/BudgetPage.tsx` (only the `<CapSheet …>` call and the `Open` type, so it compiles. Task 6 reshapes the rest.)

**Interfaces:**
- Consumes: `historyOf`, `SpendHistory` (Task 3); `roundUpToMajor` (Task 1).
- Produces:
  - `useSpendingHistory(month: string, currency: string): Map<string, SpendHistory> | null` (null until all three months are read)
  - `CapSheet` props `{ categoryId: string; name: string; history: SpendHistory | null; month; currency; ready; lineOf; rowOf; committed; onClose }`. The `options` prop is gone.

- [ ] **Step 1: Add the hook to `queries.ts`**

```ts
import { addMonths } from '@expanses/core';
import { useQueries } from '@tanstack/react-query';
import { historyOf } from './budget-view';

/**
 * What each category spent in the three months before `month`, read from those months' own sheets — the same
 * queries the page reads a month with, so a figure here is what a cap there would have measured. Null until all three
 * are read.
 */
export function useSpendingHistory(month: string, currency: string) {
  const { database, ws } = useApp();
  const months = [1, 2, 3].map((back) => addMonths(month, -back));
  const sheets = useQueries({
    queries: months.map((each) => ({ queryKey: ['budget-sheet', ws.workspaceId, ws.bookId ?? null, each], queryFn: () => budgetSheetFor(database, ws, each) })),
  });
  if (!sheets.every((sheet) => sheet.data)) return null;
  return historyOf(
    sheets.map((sheet) => sheet.data!.lines),
    currency,
  );
}
```

(Merge the imports with the file's existing ones.)

- [ ] **Step 2: Reshape `CapSheet.tsx`**

- Delete `CategoryOption`, the `options` prop, `picked`/`setPicked`, `choose`, and the whole `given === null` Category `SelectRow` block.
- Props become:

```ts
  categoryId: string;
  /** The category's name, for the sheet's title. */
  name: string;
  /** What it spent in the months before; null while those are still being read. */
  history: SpendHistory | null;
```

- `const categoryId = given ?? picked;` becomes `const { categoryId } = props` (destructure it directly). `row` and `line` are read as before. `name` comes from the prop.
- In `save()`, drop the `if (!categoryId) …` line.
- Cap field: add `autoFocus` and `onFocus={(e) => e.currentTarget.select()}` to the `TextRow`.
- After the first `InsetGroup` (the one holding Cap / Every / Per month / Just this month), add the chips:

```tsx
      {chips.length > 0 && (
        <section className="mb-[18px] w-full" data-testid="cap-chips">
          <p className="mb-[6px] px-[16px] text-[13px] leading-[18px] text-[var(--ph-ink-3)] uppercase">Use a figure</p>
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => takeFigure(chip.minor)}
                aria-label={`${chip.label}, ${bareFigure(chip.minor, currency)}`}
                className="ph-focus ph-tap flex min-h-[44px] flex-col items-start justify-center rounded-[12px] bg-[var(--ph-surface)] px-[14px] py-[4px] text-left ring-1 ring-[var(--ph-hair)] ring-inset"
              >
                <span className="text-[12px] leading-[16px] text-[var(--ph-ink-3)]">{chip.label}</span>
                <span className="tabular text-[15px] leading-[20px] font-semibold text-[var(--ph-tint)]">{bareFigure(chip.minor, currency)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
```

with, above the `return`:

```ts
  // Figures to start from, each rounded up to a whole unit; one that comes to nothing is not offered.
  const chips = [
    { key: 'last', label: 'Last month', minor: roundUpToMajor(history?.lastMinor ?? 0, currency) },
    { key: 'average', label: '3-month average', minor: history?.averageMinor ?? 0 },
    { key: 'spent', label: 'Spent so far', minor: roundUpToMajor(line?.totalMinor ?? 0, currency) },
  ].filter((chip) => chip.minor > 0);

  /** A chip's figure into the Cap row. The figures are a month's, so the unit becomes Month. Nothing is saved yet. */
  const takeFigure = (minor: number) => {
    setTouched(true);
    setFrequency('monthly');
    setAmount(bareFigure(minor, currency));
  };
```

- Update the doc comment above `CapSheet`. Drop "Opened from ⋯ Add a budget it asks for one first."; it is now always opened for a known category.

- [ ] **Step 3: Keep `BudgetPage` compiling**

- In `BudgetPage.tsx`, change `Open`'s cap member to `{ kind: 'cap'; id: string }` and `openCap` to `(id: string) => …`.
- Remove the `menu` entry `add`. The empty Budgeted row's `onClick={() => openCap(null)}` can temporarily do nothing; Task 6 replaces it.
- Add `const history = useSpendingHistory(month, currency);`.
- Render the sheet as:

```tsx
      {open?.kind === 'cap' && sheet && (
        <CapSheet
          key={open.id}
          categoryId={open.id}
          name={findLine(sheet.lines, open.id)?.name ?? 'Budget'}
          history={history?.get(open.id) ?? null}
          month={month}
          currency={planCurrency}
          ready={planReady}
          lineOf={(id) => findLine(sheet.lines, id)}
          rowOf={(id) => budgets.find((row) => row.categoryAccountId === id)}
          committed={committed}
          onClose={close}
        />
      )}
```

- Delete `options` (the `categories`… `flatMap` block) and the now-unused imports (`Plus`, `useCategorySetMembership`, `useInOpenBook` if nothing else uses them).

- [ ] **Step 4: Typecheck and unit tests**

Run: `npm run typecheck && npm test -w @expanses/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/budget
git commit -m "The cap sheet opens with its figure selected to type over, and offers last month, the average and the month so far

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: web — the Budget page sets a budget from its own rows

**Files:**
- Modify: `apps/web/src/features/budget/BudgetPage.tsx`
- Modify: `apps/web/src/features/budget/BudgetSheets.tsx` (delete `NoBudgetSheet` and its now-unused imports)
- Modify: `apps/web/src/app/router.tsx:165`

**Interfaces:**
- Consumes: `noBudgetRows` (Task 3); the `CapSheet` from Task 5.
- Produces:
  - `/budget` reads an optional `month` search (`YYYY-MM`). Task 7 sends people back with it.
  - `export const budgetSearch = (search: Record<string, unknown>): { month?: string }` in `apps/web/src/features/budget/budget-search.ts`.

- [ ] **Step 1: The search reader**

Create `apps/web/src/features/budget/budget-search.ts`:

```ts
/** `?month=2026-10`, read only when it is a month; anything else opens on this month. */
export const budgetSearch = (search: Record<string, unknown>): { month?: string } =>
  typeof search.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month) ? { month: search.month } : {};
```

In `router.tsx`, line 165 becomes:

```tsx
  createRoute({ getParentRoute: () => rootRoute, path: '/budget', component: BudgetPage, validateSearch: budgetSearch }),
```

- [ ] **Step 2: The page**

In `BudgetPage.tsx`:

- `const asked = useSearch({ strict: false }) as { month?: string };` (from `@tanstack/react-router`) and `const [month, setMonth] = useState(asked.month ?? monthOf(today));`.
- `const navigate = useNavigate();` and `const editBudgets = () => void navigate({ to: '/budget/edit', search: { month } });`.
- `actions` becomes:

```tsx
  const actions: CornerAction[] = [
    { key: 'edit', label: 'Edit budgets', glyph: <Pencil size={18} aria-hidden />, run: editBudgets },
    { key: 'more', label: 'More', glyph: <MoreHorizontal size={20} aria-hidden />, menu },
  ];
```

- The empty Budgeted row: `title` "Set budgets", `label="Set budgets"`, `onClick={editBudgets}`.
- Replace the whole `{view.noBudget.length > 0 && (<InsetGroup><InsetRow testId="no-budget" …/></InsetGroup>)}` block with:

```tsx
          {unbudgeted.length > 0 && (
            <InsetGroup
              header="No budget yet"
              trailing={
                <span className="tabular text-[13px] text-[var(--ph-ink-3)]">
                  <Money minor={view.noBudgetMinor} currency={currency} /> spent
                </span>
              }
              footer={
                <>
                  Several to set?{' '}
                  <button type="button" onClick={editBudgets} className="ph-focus font-semibold text-[var(--ph-tint)]">
                    Edit budgets
                  </button>{' '}
                  sets them all on one screen.
                </>
              }
            >
              {unbudgeted.map((row) => {
                const mark = row.depth === 0 ? markOf(row.line.id) : null;
                return (
                  <InsetRow
                    key={row.line.id}
                    testId={`uncapped-${row.line.name}`}
                    depth={row.depth}
                    icon={mark?.icon}
                    iconColour={mark?.colour}
                    title={row.line.name}
                    subtitle={<>{formatMinor(row.spentMinor, currency)} spent this month</>}
                    value={<span className="inline-flex h-[30px] items-center rounded-full bg-[var(--ph-tint-panel)] px-[14px] text-[14px] font-semibold text-[var(--ph-tint)]">Set</span>}
                    chevron={false}
                    onClick={() => openCap(row.line.id)}
                    label={`Set a budget for ${row.line.name}`}
                  />
                );
              })}
            </InsetGroup>
          )}
```

with `const unbudgeted = view ? noBudgetRows(view.noBudget) : [];` above the `return`. "Set" is drawn inside the row and the whole row is the one button, so there is no button inside a button.

- Remove the `no-budget` member from `Open`, the `NoBudgetSheet` render and its import.
- Check `InsetGroup`'s `trailing`: it is passed to `GroupHeader` and drawn at the header's right end. If `GroupHeader` styles it already, drop the span's classes.

- [ ] **Step 3: Delete `NoBudgetSheet`**

Remove the `NoBudgetSheet` function from `BudgetSheets.tsx`. Remove the imports only it used (`NoBudgetEntry`, `useCategoryMarks` type, `InsetRow` if unused).

- [ ] **Step 4: Typecheck and unit tests**

Run: `npm run typecheck && npm test -w @expanses/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "The Budget page lists what has no budget yet, sub-categories under their parent, each a tap from its cap; ⋯ no longer adds one

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: web — the Edit budgets screen

**Files:**
- Create: `apps/web/src/features/budget/EditBudgetsPage.tsx`
- Modify: `apps/web/src/app/router.tsx` (route next to `/budget`)

**Interfaces:**
- Consumes:
  - everything in `edit-budgets-model.ts` (Task 4)
  - `useBudgetSheet`, `useBudgets`, `useSpendingHistory` (Task 5)
  - `saveBudgets`, `BudgetError` (Task 2)
  - `budgetSearch` (Task 6)
- Produces: route `/budget/edit?month=YYYY-MM`. On save, or on back, it goes to `/budget?month=…`.

- [ ] **Step 1: The route**

In `router.tsx`, after the `/budget` route:

```tsx
  createRoute({ getParentRoute: () => rootRoute, path: '/budget/edit', component: EditBudgetsPage, validateSearch: budgetSearch }),
```

and `import { EditBudgetsPage } from '../features/budget/EditBudgetsPage';`.

- [ ] **Step 2: The page**

```tsx
import { BUDGET_FREQUENCIES, type BudgetFrequency, formatMinor, groupTypedAmount, isoDate, monthOf } from '@expanses/core';
import { BudgetError, saveBudgets } from '@expanses/db';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Check, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { InsetGroup, LargeTitle, Panel, SCREEN } from '../../ui/native';
import { useBooks, useOpenBook } from '../workspaces/queries';
import { bareFigure } from '../networth/debt-rows';
import { useCategoryMarks } from './budget-rows';
import { changesOf, editGroups, type EditRow, type EditState, fillFromLastMonth, initialState, isDirty, liveCapsTotal } from './edit-budgets-model';
import { FREQUENCY_WORDS } from './frequency-form';
import { useBudgets, useBudgetSheet, useSpendingHistory } from './queries';
import { useAccounts } from '../../lib/queries';

const UNIT_SHORT: Record<BudgetFrequency, string> = { daily: '/day', weekly: '/wk', monthly: '/mo', quarterly: '/qtr', yearly: '/yr' };

/** Every budget of the month's tree on one screen: type down the list, Save once. Edits the plan, never one month alone. */
export function EditBudgetsPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const asked = useSearch({ strict: false }) as { month?: string };
  const month = asked.month ?? monthOf(isoDate());

  const openBook = useOpenBook();
  const currency = openBook?.baseCurrency ?? ws.baseCurrency;
  const ready = useBooks().isSuccess;
  const sheet = useBudgetSheet(month).data;
  const budgetsQuery = useBudgets(month);
  const budgets = budgetsQuery.data;
  const history = useSpendingHistory(month, currency);
  const markOf = useCategoryMarks(useAccounts().data ?? []);

  const groups = useMemo(() => (sheet ? editGroups(sheet.lines) : []), [sheet]);
  const [initial, setInitial] = useState<EditState | null>(null);
  const [state, setState] = useState<EditState>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fields = useRef(new Map<string, HTMLInputElement>());

  // The stored figures are read once, when both have arrived; later re-reads must not wipe what is being typed.
  useEffect(() => {
    if (initial || !sheet || !budgets) return;
    const start = initialState(groups, budgets, currency);
    setInitial(start);
    setState(start);
  }, [initial, sheet, budgets, groups, currency]);

  const back = () => void navigate({ to: '/budget', search: { month } });
  const leave = () => {
    if (initial && isDirty(state, initial) && !window.confirm('Discard changes?')) return;
    back();
  };

  const order = groups.flatMap((group) => group.rows.map((row) => row.id));
  const nameOf = (id: string) => groups.flatMap((group) => group.rows).find((row) => row.id === id)?.label ?? 'A budget';

  async function save() {
    setError(null);
    if (!ready || busy || !budgets) return;
    const changes = changesOf(groups, state, budgets, currency);
    if (changes.unreadable.length > 0) {
      setError(new Error(`${nameOf(changes.unreadable[0]!)}: that figure cannot be read`));
      return;
    }
    try {
      setBusy(true);
      await saveBudgets(database, ws, changes);
      await invalidate();
      back();
    } catch (e) {
      setError(e instanceof BudgetError && e.categoryAccountId ? new Error(`${nameOf(e.categoryAccountId)}: ${e.message}`) : e);
      setBusy(false);
    }
  }

  const set = (id: string, patch: Partial<EditState[string]>) => setState((was) => ({ ...was, [id]: { ...was[id]!, ...patch, filled: false } }));
  const filled = history ? fillFromLastMonth(groups, state, history, currency) : state;
  const canFill = history !== null && order.some((id) => filled[id] !== state[id]);

  const budgeted = sheet ? liveCapsTotal(sheet.lines, state, currency) : 0;
  const income = sheet?.incomePlanMinor ?? 0;
  const debt = sheet?.debtPaymentsPlanMinor ?? 0;
  const goals = sheet?.savingsPlanMinor ?? 0;
  const unplanned = income - debt - goals - budgeted;
  const width = (minor: number) => (income > 0 ? `${Math.max(0, Math.min(100, (minor / income) * 100))}%` : '0%');

  return (
    <div className={SCREEN} data-testid="edit-budgets">
      <LargeTitle
        title="Edit budgets"
        back="Budget"
        onBack={leave}
        actions={[{ key: 'save', label: 'Save budgets', glyph: <Check size={20} aria-hidden />, run: () => void save(), disabled: !ready || busy || !initial }]}
      />

      <Panel className="mb-3 space-y-2" testId="edit-summary">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Budgeted</span>
          <span className="text-[13px] text-[var(--ph-ink-3)]">of {formatMinor(income, currency)} take-home</span>
        </div>
        <p className="tabular text-[24px] leading-[28px] font-bold tracking-[-0.02em]" data-testid="edit-budgeted">
          {formatMinor(budgeted, currency)}
        </p>
        <span aria-hidden className="flex h-[8px] w-full gap-[2px] overflow-hidden rounded-full bg-[var(--ph-track)]">
          <span className="block h-full bg-[var(--ph-ink-2)]" style={{ width: width(debt) }} />
          <span className="block h-full bg-[var(--ph-info-ink)]" style={{ width: width(goals) }} />
          <span className="block h-full bg-[var(--ph-tint)]" style={{ width: width(budgeted) }} />
        </span>
        <p className="text-[13px] leading-[18px] text-[var(--ph-ink-3)]" data-testid="edit-unplanned">
          Debt {formatMinor(debt, currency)} · Goals {formatMinor(goals, currency)} ·{' '}
          <b className={cx('font-semibold', unplanned < 0 ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink)]')}>
            {unplanned < 0 ? `Over by ${formatMinor(-unplanned, currency)}` : `Unplanned ${formatMinor(unplanned, currency)}`}
          </b>
        </p>
      </Panel>

      <div className="mb-2 flex w-full items-center justify-between md:max-w-2xl">
        <span className="px-[16px] text-[13px] text-[var(--ph-ink-3)] uppercase">Every month</span>
        <button
          type="button"
          disabled={!canFill}
          onClick={() => setState(filled)}
          className="ph-focus flex min-h-[44px] items-center gap-[6px] px-[8px] text-[15px] font-semibold text-[var(--ph-tint)] disabled:opacity-40"
        >
          <RotateCcw size={16} aria-hidden />
          Fill empty from last month
        </button>
      </div>

      <ErrorBox error={error} />

      {initial &&
        groups.map((group) => {
          const mark = markOf(group.id);
          return (
            <InsetGroup key={group.id} header={group.name}>
              {group.rows.map((row) => (
                <BudgetField
                  key={row.id}
                  row={row}
                  icon={row.depth === 0 ? mark.icon : null}
                  colour={mark.colour}
                  value={state[row.id]!}
                  currency={currency}
                  hint={hintOf(row, history?.get(row.id)?.lastMinor ?? 0, budgets?.find((b) => b.categoryAccountId === row.id), month, currency)}
                  focused={focused === row.id}
                  chips={history?.get(row.id) ?? null}
                  last={order[order.length - 1] === row.id}
                  register={(input) => (input ? fields.current.set(row.id, input) : fields.current.delete(row.id))}
                  onFocus={() => setFocused(row.id)}
                  onNext={() => fields.current.get(order[order.indexOf(row.id) + 1] ?? '')?.focus()}
                  onChange={(patch) => set(row.id, patch)}
                />
              ))}
            </InsetGroup>
          );
        })}
    </div>
  );
}

/** Under a row: what this month carries on its own when it does, else what last month spent. */
function hintOf(row: EditRow, lastMinor: number, stored: { overridden: boolean; amountMinor: number } | undefined, month: string, currency: string): string {
  if (stored?.overridden) {
    const name = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long' });
    return `${name} only: ${formatMinor(stored.amountMinor, currency)}`;
  }
  return lastMinor > 0 ? `Last month ${formatMinor(lastMinor, currency)}` : row.hasChildren ? 'Covers everything under it' : 'Nothing last month';
}

function BudgetField({
  row,
  icon,
  colour,
  value,
  currency,
  hint,
  focused,
  chips,
  last,
  register,
  onFocus,
  onNext,
  onChange,
  position,
}: {
  row: EditRow;
  icon: React.ReactNode;
  colour: string;
  value: EditState[string];
  currency: string;
  hint: string;
  focused: boolean;
  chips: { lastMinor: number; averageMinor: number } | null;
  last: boolean;
  register: (input: HTMLInputElement | null) => void;
  onFocus: () => void;
  onNext: () => void;
  onChange: (patch: Partial<EditState[string]>) => void;
  position?: { separator?: boolean };
}) {
  const offered = chips
    ? [
        { key: 'last', label: 'Last month', minor: chips.lastMinor },
        { key: 'average', label: '3-month average', minor: chips.averageMinor },
      ].filter((chip) => chip.minor > 0)
    : [];
  return (
    <div className={cx('relative', focused && 'bg-[var(--ph-tint-panel)]')} data-testid={`edit-row-${row.label}`}>
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 right-[16px] left-[16px] h-[0.5px] bg-[var(--ph-hair)]" />}
      <div className="flex min-h-[56px] items-center gap-[10px] py-[8px] pr-[12px]" style={{ paddingLeft: 16 + row.depth * 16 }}>
        {icon && (
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full" style={{ color: colour, background: `color-mix(in srgb, ${colour} 14%, var(--ph-surface))` }}>
            {icon}
          </span>
        )}
        <label htmlFor={`cap-${row.id}`} className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] leading-[20px] text-[var(--ph-ink)]">{row.label}</span>
          <span className="truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            {value.filled ? 'Filled from last month' : hint}
          </span>
        </label>
        <input
          id={`cap-${row.id}`}
          ref={register}
          aria-label={row.label}
          value={value.amount}
          placeholder="Amount"
          inputMode={currency === 'IDR' ? 'numeric' : 'decimal'}
          enterKeyHint={last ? 'done' : 'next'}
          onFocus={(e) => {
            onFocus();
            e.currentTarget.select();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (last) e.currentTarget.blur();
            else onNext();
          }}
          onChange={(e) => onChange({ amount: groupTypedAmount(e.target.value, currency) })}
          className={cx(
            'tabular h-[36px] w-[120px] rounded-[8px] px-[10px] text-right text-[16px] text-[var(--ph-ink)] outline-none',
            focused ? 'bg-[var(--ph-surface)] ring-2 ring-[var(--ph-tint)]' : 'bg-[var(--ph-fill)]',
          )}
        />
        <select
          aria-label={`${row.label} every`}
          value={value.frequency}
          onChange={(e) => onChange({ frequency: e.target.value as BudgetFrequency })}
          className="ph-focus h-[36px] w-[44px] appearance-none bg-transparent text-[13px] text-[var(--ph-ink-3)]"
        >
          {BUDGET_FREQUENCIES.map((key) => (
            <option key={key} value={key} aria-label={FREQUENCY_WORDS[key].every}>
              {UNIT_SHORT[key]}
            </option>
          ))}
        </select>
      </div>
      {focused && offered.length > 0 && (
        <div className="flex flex-wrap gap-2 pr-[12px] pb-[10px]" style={{ paddingLeft: 16 + row.depth * 16 }}>
          {offered.map((chip) => (
            <button
              key={chip.key}
              type="button"
              // Chips sit under the field; pressing one must not blur it first and fold the chips away.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange({ amount: bareFigure(chip.minor, currency), frequency: 'monthly' })}
              className="ph-focus min-h-[32px] rounded-full bg-[var(--ph-surface)] px-[12px] text-[13px] text-[var(--ph-tint)] ring-1 ring-[var(--ph-hair)] ring-inset"
            >
              {chip.label} · {bareFigure(chip.minor, currency)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

Notes for the implementer:
- `InsetGroup` clones each child with `position` (`GroupChild`). `BudgetField` accepts `position` and draws the separator itself, as `FigureRow` in `budget-rows.tsx` does.
- If `Panel` takes no `testId` prop, use `data-testid` on a wrapping `div`. Check `ui/native/Panel.tsx`.
- `useCategoryMarks` returns `{ icon, colour }` per id (see `budget-rows.tsx`).
- Hooks must not be called conditionally. Every hook above runs on every render; the guard is `initial &&` in the JSX.
- Import `ReactNode` from `react` instead of using `React.ReactNode`, to match the file style.

- [ ] **Step 3: Typecheck and unit tests**

Run: `npm run typecheck && npm test -w @expanses/web`
Expected: PASS.

- [ ] **Step 4: Look at it**

Run `npm run dev`. Open `/budget/edit` at 390px width and at desktop width. Check:
- rows are indented by depth;
- the focused row is highlighted with its chips under it;
- Enter moves to the next field;
- the Budgeted and Unplanned figures follow typing;
- Fill fills only empty leaf rows.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "Every budget can be set on one Edit budgets screen, filled from last month, and saved in one go

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: e2e — helpers on the new paths, old specs moved, new specs

**Files:**
- Modify: `apps/web/e2e/budget.ts`
- Modify: `apps/web/e2e/budget.spec.ts`, `phone-budget-page.spec.ts`, `phone-budget-tabs.spec.ts`, `phone-budget-frequency.spec.ts`, `category-sets.spec.ts`
- Create: `apps/web/e2e/budget-quick-set.spec.ts` (desktop), `apps/web/e2e/phone-budget-quick-set.spec.ts` (phone)

**Interfaces:**
- Consumes: the screens from Tasks 5–7. The testids used are:
  - `uncapped-<name>` (page row)
  - `line-<name>`, `drawer-<parent>`
  - `cap-chips`
  - `edit-budgets`, `edit-row-<label>`, `edit-budgeted`, `edit-unplanned`
  - field labels: the row's label for the amount, and `<label> every` for the unit.
- Produces: `addCap`, `setBudget` and `openCapOf` keep their names and arguments. `CapInput.option` still takes "— Groceries" (the leading "— " is stripped). `openNewCap` is deleted.

- [ ] **Step 1: Rewrite the helpers in `e2e/budget.ts`**

```ts
/** A category as the old picker named it ("— Groceries") or as the screens do ("Groceries"). */
const plain = (option: string) => option.replace(/^— /, '');

/** Opens Edit budgets from the Budget page's ✎ corner. */
export async function openEditBudgets(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Edit budgets', exact: true }).first().click();
  const screen = page.getByTestId('edit-budgets');
  await expect(screen).toBeVisible();
  return screen;
}

/**
 * Sets one cap on Edit budgets and saves; back on the Budget page when it returns. A root with sub-categories is
 * named "All <root>" there, so a parent is tried by that label first.
 */
export async function addCap(page: Page, input: CapInput) {
  if (input.thisMonthOnly) {
    const sheet = await openCapOf(page, input.option);
    await sheet.getByLabel('Just this month').check();
    await sheet.getByLabel('Cap', { exact: true }).fill(input.amount);
    await sheet.getByRole('button', { name: 'Save budget' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    return;
  }
  const screen = await openEditBudgets(page);
  const name = plain(input.option);
  const all = screen.getByLabel(`All ${name}`, { exact: true });
  const field = (await all.count()) > 0 ? all : screen.getByLabel(name, { exact: true });
  const label = (await all.count()) > 0 ? `All ${name}` : name;
  await screen.getByLabel(`${label} every`).selectOption(input.every ?? 'monthly');
  if (input.typed) {
    await field.click();
    await field.clear();
    await field.pressSequentially(input.amount, { delay: 30 });
  } else await field.fill(input.amount);
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByTestId('budget-page')).toBeVisible();
}

/** The cap sheet of a capped category, opened from its row on the Spending tab (its drawer opened first if folded). */
export async function openCapOf(page: Page, option: string): Promise<Locator> {
  const name = plain(option);
  const row = page.getByTestId(`line-${name}`);
  if (!(await row.isVisible())) {
    for (const drawer of await page.locator('[data-testid^="drawer-"][aria-expanded="false"]').all()) await drawer.click();
  }
  await row.click();
  return page.getByRole('dialog', { name });
}
```

- `setBudget` stays as written; it calls `addCap` and `openCapOf`.
- Delete `openNewCap`.
- Run `grep -rn "openNewCap\|'Add a budget'\|no-budget\|'No budget'" apps/web/e2e` and move each hit:
  - `openNewCap` + Category select → `openCapOf(page, name)` for a capped category, or a tap on `uncapped-<name>` for an uncapped one that spent.
  - `getByTestId('no-budget')` + the `No budget` dialog → `page.getByTestId('uncapped-<name>')` on the page itself.
  - The "leaving the category untouched refuses to save" test in `budget.spec.ts` (line 42) has nothing left to test, because the picker is gone. Delete it.
  - `phone-budget-page.spec.ts:50` and `phone-budget-frequency.spec.ts:7` (`menuitem 'Add a budget'`) → open the sheet from `uncapped-<name>`, or go through `addCap`.
  - `category-sets.spec.ts:170` → `await expect(page.getByTestId('uncapped-Diapering')).toHaveCount(0);`.

- [ ] **Step 2: New desktop spec `e2e/budget-quick-set.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { openEditBudgets } from './budget';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('a category that spent is a Set away from its cap, and the sheet opens ready to type', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Sample', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Corner shop', paidWith: 'Bank Sample', category: 'Personal care', amount: '85000' });

  await page.goto('/budget');
  await page.getByTestId('uncapped-Personal care').click();
  const sheet = page.getByRole('dialog', { name: 'Personal care' });
  const cap = sheet.getByLabel('Cap', { exact: true });
  await expect(cap).toBeFocused();
  // Spent so far is offered; taking it fills the Cap row, monthly.
  await sheet.getByRole('button', { name: /^Spent so far, 85\.000$/ }).click();
  await expect(cap).toHaveValue('85.000');
  await sheet.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByTestId('line-Personal care')).toContainText('left of 85.000');
  await expect(page.getByTestId('uncapped-Personal care')).toHaveCount(0);

  // Opened again, the figure is selected: typing replaces it.
  await page.getByTestId('line-Personal care').click();
  await page.keyboard.type('120000');
  await expect(page.getByRole('dialog', { name: 'Personal care' }).getByLabel('Cap', { exact: true })).toHaveValue('120.000');
});

test('Edit budgets sets several caps at once, counts a yearly one as its month, and Save brings them to the page', async ({ page }) => {
  await page.goto('/budget');
  const screen = await openEditBudgets(page);
  await screen.getByLabel('Personal care', { exact: true }).fill('300000');
  await screen.getByLabel('Personal care', { exact: true }).press('Enter');
  await screen.getByLabel('All Transportation', { exact: true }).fill('1200000');
  await screen.getByLabel('All Transportation every').selectOption('yearly');
  await expect(screen.getByTestId('edit-budgeted')).toHaveText('Rp 400.000');

  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByTestId('budget-page')).toBeVisible();
  await expect(page.getByTestId('line-Personal care')).toContainText('left of 300.000');
  await expect(page.getByTestId('line-Transportation')).toContainText('left of 100.000');
});

test('a figure that cannot be read keeps Edit budgets open and saves nothing', async ({ page }) => {
  await page.goto('/budget');
  const screen = await openEditBudgets(page);
  await screen.getByLabel('Personal care', { exact: true }).fill('1.2.3,,');
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(screen.getByText('Personal care: that figure cannot be read')).toBeVisible();
  await expect(page.getByTestId('edit-budgets')).toBeVisible();
});

test('back from Edit budgets with changes asks first; without them it simply goes back', async ({ page }) => {
  await page.goto('/budget');
  await openEditBudgets(page);
  await page.getByRole('button', { name: /Budget/ }).first().click();
  await expect(page.getByTestId('budget-page')).toBeVisible();

  const screen = await openEditBudgets(page);
  await screen.getByLabel('Personal care', { exact: true }).fill('50000');
  page.removeAllListeners('dialog');
  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: /Budget/ }).first().click();
  expect(asked).toBe('Discard changes?');
  await expect(page.getByTestId('edit-budgets')).toBeVisible();
});
```

If `groupTypedAmount` refuses to keep "1.2.3,," as typed, use a value it does keep that `parseMajor` rejects. Read `groupTypedAmount` in core to pick one. If none exists, delete that test and rely on Task 4's unit test.

The "Rp 400.000" in the second test assumes Personal care and Transportation are not nested in each other in the seeded tree. Check the default categories and adjust the names if they are.

- [ ] **Step 3: New phone spec `e2e/phone-budget-quick-set.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('by thumb: an uncapped sub-category sits under its parent with Set, and Fill from last month fills it on Edit budgets', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Sample', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Ride home', paidWith: 'Bank Sample', category: 'Ride hailing', amount: '64000' });

  await page.goto('/budget');
  const parent = page.getByTestId('uncapped-Transportation');
  const child = page.getByTestId('uncapped-Ride hailing');
  await expect(parent).toBeVisible();
  await expect(child).toContainText('64.000 spent this month');
  await child.tap();
  await expect(page.getByRole('dialog', { name: 'Ride hailing' }).getByLabel('Cap', { exact: true })).toBeFocused();
});
```

Fill from last month needs spending dated last month. If `addTransaction` takes a `date`, add a second test: record 64.000 on Ride hailing on the 10th of last month, open Edit budgets, tap Fill, and expect the `Ride hailing` field to have value `64.000` and `All Transportation` to stay empty. If `addTransaction` has no date option, cover Fill with Task 4's unit tests only and note that in the PR.

- [ ] **Step 4: Run every budget spec on both projects**

From `apps/web`:

Run: `npx playwright test budget category-sets --project=chromium && npx playwright test phone-budget --project=phone`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e
git commit -m "The budget walks set caps from the page's rows and from Edit budgets

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Whole-branch check

- [ ] **Step 1:** `npm run typecheck && npm test`. Expected: PASS everywhere.
- [ ] **Step 2:** From `apps/web`, `npx playwright test`. Expected: the full suite passes on both projects. Any failure outside budget specs gets the systematic-debugging skill before it is touched.
- [ ] **Step 3:** `grep -rn "NoBudgetSheet\|openNewCap\|Add a budget" apps/web/src apps/web/e2e`. Expected: no hits.
- [ ] **Step 4:** Note for the TestFlight device check: the sheet raises the keyboard on open (Review Focus 1), and Next moves down the Edit budgets list on the iOS keyboard.
