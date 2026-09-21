# Health ratios, part 1 — essential vs lifestyle, budget frequency, compulsory goals, the emergency fund — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a category an Essential / Lifestyle mark; let the emergency fund count essential or all spending (plus loan principal, never the interest twice) through one shared function; prefill emergency months from household shape and income stability; default the debt-servicing guide to 30%; let every budget line be typed daily, weekly, monthly, quarterly or yearly and converted with 365/12 and 52/12; and fund compulsory goals (emergency fund, retirement) before additional ones.

**Architecture:** Migration **0053** adds three side tables — `category_needs`, `budget_frequencies`, and `goal_stage_terms` (used by Part 2) — behind one `WeakMap<Db, boolean>` guard, `healthTablesExist`. Pure rules live in `packages/core`: `needOf`/`resolveNeeds`, `perMonthMinor`, `emergencyMonthsFor`, `goalClass`/`fundingOrder`, `emergencyOutgoingMinor`. `periodFlows` gains `lifestyleSpendingMinor`; the ratio card and the emergency goal both size themselves with `emergencyOutgoingMinor`. `budgets.amount_minor` keeps holding the monthly figure, so every existing reader is untouched; the typed amount and its unit sit in `budget_frequencies`. Household, income and base for the emergency goal ride in `goal_calculators.inputs_json`.

**Tech Stack:** TypeScript monorepo — `packages/core` (pure), `packages/db` (Drizzle over sqlite-proxy, SQL migrations as `?raw` imports, `better-sqlite3` in tests), `apps/web` (React 19, TanStack Router/Query, Tailwind 4); Vitest; Playwright (`chromium`, `phone`).

**Spec:** `docs/superpowers/specs/2026-09-21-health-ratios-design.md` — §§3–7, 13–15 are this plan's. Part 2 (`2026-09-21-health-ratios-calculators.md`) owns §§8–12 and depends on this plan's migration.

## Global Constraints

- **No new columns on existing tables** (`transactions`, `accounts`, `entries`, `cards`, `budgets`, `goals`, `goal_stages`, `goal_calculators`, `expense_templates`, …). Drizzle names every column it knows on every insert, so a column there breaks any database stopped at an older version. New facts go in the three 0053 tables. Widening one of their CHECKs later needs a full table rebuild.
- **Every read and write of the 0053 tables goes through `healthTablesExist(db)`**, the same shape as `extrasTablesExist` in `packages/db/src/repos/transaction-extras.ts`. Without the tables: no marks (everything essential), every budget monthly, no stage terms — exactly today's behaviour.
- **Migration number 0053, name `health_ratios`, and no other.** 0050–0052 and 0054 belong to other features. `migrate` is set-based (`migrations.ts`), so a gap is fine and a clash is not. Tests say `toContain(53)`, never a literal list of what else was applied — except `database.test.ts`, whose literal list gets `53` in its sorted place beside whatever of 50/51/52/54 has already landed.
- **Money is integer minor units.** IDR exponent 0, USD 2. Conversions use `divRound` (BigInt, half away from zero) once per line; only converted figures are summed. **Sum signed values, then clamp** — never `Math.abs` a term before a sum.
- **Never ×4 and never ×30.** Weekly is ×52/12, daily ×365/12. A test fails on both wrong neighbours.
- **Call the existing readers; never write a second copy.** Named per task: `periodFlows`, `emergencyOutgoingMinor` (one base for card *and* goal), `perMonthMinor`, `needOf`/`resolveNeeds`, `resolvedCategoryNeeds`, `bookOfCategory`, `hasBooks`, `listGoalCalculators`, `fundingOrder`, `parseMajor`, `formatMinor`. Grep before writing a new name.
- **Every screen is built from the native kit** `apps/web/src/ui/native/` (read `/design-kit` and `.superpowers/design-audit/primitives.md`). Corner actions are glyphs at every width. Dark mode: kit tokens (`var(--ph-*)`) only, never a literal colour. **No new visual treatment** — the stacked band from the mockup is not built (spec Open question 3).
- **Desktop is the highest paid tier and is never weakened.** Every control added on a phone exists at desktop width, reachable by keyboard.
- **Country-neutral.** No country, regulator or lender named in UI copy; no locale-specific presets. Figures are read with `parseMajor`, which is separator-agnostic.
- **New entry points inherit refusals.** `saveCategoryNeed` refuses a non-category, an income category, another workspace's row and another book's category — the same refusals `saveBudget` applies. The budget frequency goes *through* `saveBudget`, so it inherits every refusal that function already has.
- Inside `database.transaction((tx) => …)` use `tx` only.
- **The user's workbook is not an authority.** Do not copy its ×4 week, its gold/jewellery sums, its min-of-methods, or its PMT. 18% appears nowhere.
- Tests **discriminate**: each asserts a computed figure that its nearest wrong neighbour (×4, floor, abs-then-sum, interest twice, rank-only order, IDR-only fixture) would get wrong.
- Branch `feat/health-ratios`. Commit per task. Every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Gate before every commit:** from the root `npm run typecheck`, `npm test`, `npm run build`; then the task's targeted Playwright specs (`cd apps/web && npx playwright test <spec>`). The full Playwright suite runs in Task 12.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/db/migrations/0053_health_ratios.sql` | `category_needs`, `budget_frequencies`, `goal_stage_terms` |
| `packages/db/src/migrations.ts` | register `{ version: 53, name: 'health_ratios' }` |
| `packages/db/src/schema-health.ts` | Drizzle `categoryNeeds`, `budgetFrequencies`, `goalStageTerms` |
| `packages/db/src/repos/health-tables.ts` | `healthTablesExist` |
| `packages/core/src/budget/needs.ts` | `CategoryNeed`, `CATEGORY_NEEDS`, `needOf`, `resolveNeeds` |
| `packages/core/src/budget/frequency.ts` | `BudgetFrequency`, `BUDGET_FREQUENCIES`, `perMonthMinor` |
| `packages/core/src/budget/emergency-months.ts` | `Household`, `IncomeStability`, `HOUSEHOLDS`, `INCOME_STABILITIES`, `emergencyMonthsFor` |
| `packages/core/src/goals/classes.ts` | `GoalClass`, `COMPULSORY_KINDS`, `goalClass`, `fundingOrder` |
| `packages/core/src/assets/health.ts` | `EmergencyBase`, `EMERGENCY_BASES`, `DEFAULT_EMERGENCY_BASE`, `emergencyOutgoingMinor`, `PeriodFlows.lifestyleSpendingMinor`, `RatioSettings.emergencyBase`, 30% default |
| `packages/core/src/goals/plan.ts` | `fitByRank` funds in `fundingOrder` |
| `packages/core/src/budget/sheet.ts` | `needs` input; `essentialActualMinor`, `lifestyleActualMinor` |
| `packages/core/src/index.ts` | export the above |
| `packages/db/src/repos/category-needs.ts` | `CategoryNeedError`, `listCategoryNeeds`, `resolvedCategoryNeeds`, `saveCategoryNeed`, `clearCategoryNeed` |
| `packages/db/src/repos/books.ts` | `copyCategoriesTx` copies the marks |
| `packages/db/src/repos/flows.ts` | `lifestyleSpendingMinor` |
| `packages/db/src/repos/goal-calculators.ts` | `EmergencyInputs` gains `household`, `income`, `base` |
| `packages/db/src/repos/goal-funding.ts` | per-goal emergency base through `emergencyOutgoingMinor` |
| `packages/db/src/repos/budgets.ts` | `frequency` on save; `frequency`, `amountAsSetMinor` on read; cleanup on remove |
| `packages/db/src/repos/budget-sheet.ts` | passes resolved needs to `budgetSheet` |
| `packages/db/src/index.ts` | export the two new repos |
| `apps/web/src/features/networth/HealthRatios.tsx` | base picker; 30% default |
| `apps/web/src/features/categories/need-queries.ts` | `useCategoryNeeds` |
| `apps/web/src/features/categories/CategoriesPage.tsx` | the mark, its source, switch and clear |
| `apps/web/src/features/budget/frequency-form.ts` (+ `.test.ts`) | `FREQUENCY_WORDS`, `perMonthPreview` |
| `apps/web/src/features/budget/BudgetPage.tsx` | Every picker, Per month row, line notes, Essential/Lifestyle rows |
| `apps/web/src/features/goals/emergency-form.ts` (+ `.test.ts`) | `EmergencyDraft`, `emergencyDraftFrom`, `withAnswers`, `typedMonths`, `monthsNote`, `emergencyInputsOf` |
| `apps/web/src/features/goals/Calculator.tsx` | rebuilt in the native kit; emergency gains the two answers and the base |
| `apps/web/src/features/goals/GoalsPage.tsx` | Compulsory / Additional sections; moves within a section |
| `apps/web/src/features/calculators/CalculatorsPage.tsx` | emergency section gains the two answers |
| Tests | `packages/core/test/{needs,budget-frequency,emergency-months,goal-classes}.test.ts`, `assets-health.test.ts`, `budget-sheet.test.ts`; `packages/db/test/{health-ratios-migration,category-needs,budget-frequency}.test.ts`, `flows.test.ts`, `goal-funding.test.ts`, `goal-calculators.test.ts`, `database.test.ts`; e2e `health-ratios.spec.ts`, `category-needs.spec.ts`, `phone-category-needs.spec.ts`, `budget-frequency.spec.ts`, `phone-budget-frequency.spec.ts`, `goal-classes.spec.ts`, `emergency-calculator.spec.ts`, `health-ratios-combinations.spec.ts`, `phone-health-ratios-combinations.spec.ts` |

---

### Task 1: Migration 0053 and its guard

**Files:**
- Create: `packages/db/migrations/0053_health_ratios.sql`, `packages/db/src/schema-health.ts`, `packages/db/src/repos/health-tables.ts`, `packages/db/test/health-ratios-migration.test.ts`
- Modify: `packages/db/src/migrations.ts`, `packages/db/src/index.ts`, `packages/db/test/database.test.ts`

**Interfaces:**
- Produces: tables `category_needs`, `budget_frequencies`, `goal_stage_terms`; Drizzle `categoryNeeds`, `budgetFrequencies`, `goalStageTerms`; `healthTablesExist(db: Db): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/health-ratios-migration.test.ts
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, healthTablesExist, migrate, MIGRATIONS } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const TABLES = ['category_needs', 'budget_frequencies', 'goal_stage_terms'];

describe('migration 0053', () => {
  it('is version 53 and named health_ratios', () => {
    expect(MIGRATIONS.find((m) => m.version === 53)).toMatchObject({ name: 'health_ratios' });
  });

  it('adds three empty tables to a database stopped at 49, and the guard only says so afterwards', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    // A "no" is not remembered: migrate may still run on this same handle.
    expect(await healthTablesExist(database.db)).toBe(false);

    expect(await migrate(database)).toContain(53);
    expect(await healthTablesExist(database.db)).toBe(true);
    for (const table of TABLES) {
      const rows = await database.db.values<[number]>(sql.raw(`SELECT count(*) FROM ${table}`));
      expect(Number(rows[0]![0])).toBe(0);
    }
  });

  it('refuses a mark that is neither essential nor lifestyle', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    await expect(
      database.execScript(`INSERT INTO category_needs (category_account_id, workspace_id, need) VALUES ('c', 'w', 'luxury')`),
    ).rejects.toThrow();
  });

  it('has no row for monthly: monthly is the absence of a row', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    await expect(
      database.execScript(`INSERT INTO budget_frequencies (budget_id, workspace_id, frequency, amount_as_set_minor) VALUES ('b', 'w', 'monthly', 100)`),
    ).rejects.toThrow();
    await expect(
      database.execScript(`INSERT INTO budget_frequencies (budget_id, workspace_id, frequency, amount_as_set_minor) VALUES ('b', 'w', 'weekly', 0)`),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd packages/db && npx vitest run test/health-ratios-migration.test.ts`
Expected: FAIL — `healthTablesExist` is not exported; no version 53.

- [ ] **Step 3: Write the migration**

```sql
-- packages/db/migrations/0053_health_ratios.sql
/* Three facts from the health-ratio work, each in a table of its own rather than a column on accounts, budgets or
   goal_stages: the ORM names every column it knows on every insert, so a column there would break any database still
   stopped at an older version (see 0028 and 0048). Nothing is backfilled: an absent row is today's behaviour. */

/* Whether a spending category is a need or a choice. No row: take the nearest marked ancestor's, else essential. */
CREATE TABLE category_needs (
  category_account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  need TEXT NOT NULL CHECK (need IN ('essential', 'lifestyle'))
);
CREATE INDEX category_needs_workspace ON category_needs (workspace_id);

/* A cap typed in another unit than a month. budgets.amount_minor still holds the monthly figure every reader uses;
   this keeps what was typed and in what unit. No row: monthly. */
CREATE TABLE budget_frequencies (
  budget_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'quarterly', 'yearly')),
  amount_as_set_minor INTEGER NOT NULL CHECK (amount_as_set_minor > 0)
);

/* What one goal stage assumes beyond the goal: its own return (an education level's), and the key a calculator gave
   it so a re-worked goal keeps the same stage — and its paid mark. No row: the goal's return, not derived. */
CREATE TABLE goal_stage_terms (
  stage_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  return_bps INTEGER CHECK (return_bps IS NULL OR return_bps >= 0),
  derived_key TEXT
);
CREATE INDEX goal_stage_terms_goal ON goal_stage_terms (workspace_id, goal_id);
```

- [ ] **Step 4: Schema, guard, registration**

```ts
// packages/db/src/schema-health.ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const categoryNeeds = sqliteTable('category_needs', {
  categoryAccountId: text('category_account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  need: text('need', { enum: ['essential', 'lifestyle'] }).notNull(),
});

export const budgetFrequencies = sqliteTable('budget_frequencies', {
  budgetId: text('budget_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  frequency: text('frequency', { enum: ['daily', 'weekly', 'quarterly', 'yearly'] }).notNull(),
  amountAsSetMinor: integer('amount_as_set_minor').notNull(),
});

export const goalStageTerms = sqliteTable('goal_stage_terms', {
  stageId: text('stage_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  goalId: text('goal_id').notNull(),
  returnBps: integer('return_bps'),
  derivedKey: text('derived_key'),
});
```

```ts
// packages/db/src/repos/health-tables.ts
import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/**
 * Whether migration 0053 has run on this database. Every read and write of category_needs, budget_frequencies and
 * goal_stage_terms asks first, so a database stopped at an older version behaves exactly as it does today: nothing
 * marked, every budget monthly, no stage terms. A positive answer is remembered per handle; a negative one is not,
 * since migrate() may run later on the same handle. The three tables arrive in one migration, so one name answers.
 */
const healthTables = new WeakMap<Db, boolean>();

export async function healthTablesExist(db: Db): Promise<boolean> {
  if (healthTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'category_needs'`);
  const exists = rows.length > 0;
  if (exists) healthTables.set(db, true);
  return exists;
}
```

In `packages/db/src/migrations.ts`, add beside the other imports and in `MIGRATIONS` in version order (after whatever of 50–52 has landed, before 54 if it has):

```ts
import healthRatios from '../migrations/0053_health_ratios.sql?raw';
// …
  { version: 53, name: 'health_ratios', sql: healthRatios },
```

In `packages/db/src/index.ts`: `export * from './repos/health-tables';`

In `packages/db/test/database.test.ts`, add `53` in its sorted place in the applied-versions list.

- [ ] **Step 5: Run**

Run: `cd packages/db && npx vitest run test/health-ratios-migration.test.ts test/database.test.ts`, then from the root `npm run typecheck && npm test && npm run build`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0053_health_ratios.sql packages/db/src/schema-health.ts packages/db/src/repos/health-tables.ts packages/db/src/migrations.ts packages/db/src/index.ts packages/db/test/health-ratios-migration.test.ts packages/db/test/database.test.ts
git commit -m "feat(db): 0053 keeps category needs, budget frequencies and stage terms beside the tables they describe

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The pure rules — needs, frequency, emergency months, goal classes

**Files:**
- Create: `packages/core/src/budget/needs.ts`, `packages/core/src/budget/frequency.ts`, `packages/core/src/budget/emergency-months.ts`, `packages/core/src/goals/classes.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/needs.test.ts`, `packages/core/test/budget-frequency.test.ts`, `packages/core/test/emergency-months.test.ts`, `packages/core/test/goal-classes.test.ts`

**Interfaces:**
- Consumes: `divRound` from `packages/core/src/assets/units.ts` (internal import); `GoalKind` from `goals/plan.ts`.
- Produces: `CategoryNeed`, `CATEGORY_NEEDS`, `NeedNode`, `ResolvedNeed`, `needOf(id, nodes, marks)`, `resolveNeeds(nodes, marks)`; `BudgetFrequency`, `BUDGET_FREQUENCIES`, `perMonthMinor(amountMinor, frequency)`; `Household`, `IncomeStability`, `HOUSEHOLDS`, `INCOME_STABILITIES`, `emergencyMonthsFor(household, income)`; `GoalClass`, `COMPULSORY_KINDS`, `goalClass(kind)`, `fundingOrder(goals)`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/budget-frequency.test.ts
import { describe, expect, it } from 'vitest';
import { perMonthMinor } from '../src/index';

describe('a budget line in a month', () => {
  it('turns a week into 52/12 of it — not four of it, and rounded, not floored', () => {
    // 500.000 × 52 ÷ 12 = 2.166.666,67. ×4 would say 2.000.000; a floor would say 2.166.666.
    expect(perMonthMinor(500_000, 'weekly')).toBe(2_166_667);
  });

  it('turns a day into 365/12 of it — not thirty of it', () => {
    // 50.000 × 365 ÷ 12 = 1.520.833,33. ×30 would say 1.500.000.
    expect(perMonthMinor(50_000, 'daily')).toBe(1_520_833);
  });

  it('rounds a half away from zero', () => {
    // 6 × 365 ÷ 12 = 182,5 exactly: a floor says 182.
    expect(perMonthMinor(6, 'daily')).toBe(183);
  });

  it('divides a quarter by three and a year by twelve', () => {
    expect(perMonthMinor(15_386_000, 'quarterly')).toBe(5_128_667);
    expect(perMonthMinor(2_400_000, 'yearly')).toBe(200_000);
    expect(perMonthMinor(900_000, 'monthly')).toBe(900_000);
  });

  it('works in cents: US$10,00 a week is US$43,33 a month', () => {
    expect(perMonthMinor(1_000, 'weekly')).toBe(4_333);
    expect(perMonthMinor(1_250, 'daily')).toBe(38_021);
  });

  it('adds converted figures, never typed ones', () => {
    const lines = [
      perMonthMinor(500_000, 'weekly'),
      perMonthMinor(50_000, 'daily'),
      perMonthMinor(900_000, 'monthly'),
      perMonthMinor(450_000, 'monthly'),
      perMonthMinor(2_400_000, 'yearly'),
      perMonthMinor(15_386_000, 'quarterly'),
    ];
    expect(lines.reduce((total, line) => total + line, 0)).toBe(10_366_167);
  });

  it('comes to nothing for a tiny yearly figure, which the repository then refuses', () => {
    expect(perMonthMinor(5, 'yearly')).toBe(0);
  });

  it('refuses an amount that is not a whole number of minor units', () => {
    expect(() => perMonthMinor(10.5, 'weekly')).toThrow(RangeError);
  });
});
```

```ts
// packages/core/test/needs.test.ts
import { describe, expect, it } from 'vitest';
import { needOf, resolveNeeds } from '../src/index';

const nodes = [
  { id: 'food', parentId: null },
  { id: 'restaurants', parentId: 'food' },
  { id: 'school_catering', parentId: 'food' },
  { id: 'household', parentId: null },
  { id: 'groceries', parentId: 'household' },
];

describe('a category’s need', () => {
  it('is essential, from nowhere, when nothing is marked', () => {
    expect(needOf('restaurants', nodes, {})).toEqual({ need: 'essential', source: null });
  });

  it('comes from the nearest marked ancestor', () => {
    expect(needOf('restaurants', nodes, { food: 'lifestyle' })).toEqual({ need: 'lifestyle', source: 'parent' });
  });

  it('is the category’s own when it has one, whatever the parent says', () => {
    const marks = { food: 'lifestyle', school_catering: 'essential' } as const;
    expect(needOf('school_catering', nodes, marks)).toEqual({ need: 'essential', source: 'yours' });
    expect(needOf('food', nodes, marks)).toEqual({ need: 'lifestyle', source: 'yours' });
  });

  it('resolves every node at once', () => {
    expect(resolveNeeds(nodes, { food: 'lifestyle', school_catering: 'essential' })).toEqual({
      food: 'lifestyle',
      restaurants: 'lifestyle',
      school_catering: 'essential',
      household: 'essential',
      groceries: 'essential',
    });
  });

  it('stops on a cycle rather than looping', () => {
    const loop = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(needOf('a', loop, {})).toEqual({ need: 'essential', source: null });
  });
});
```

```ts
// packages/core/test/emergency-months.test.ts
import { describe, expect, it } from 'vitest';
import { emergencyMonthsFor, HOUSEHOLDS, INCOME_STABILITIES } from '../src/index';

describe('emergency months from two answers', () => {
  it.each([
    ['single', 'salaried', 3],
    ['single', 'irregular', 6],
    ['couple', 'salaried', 6],
    ['couple', 'irregular', 12],
    ['children', 'salaried', 12],
    ['children', 'irregular', 24],
  ] as const)('%s and %s is %i months', (household, income, months) => {
    expect(emergencyMonthsFor(household, income)).toBe(months);
  });

  it('is exactly twice as many for irregular income, in every household', () => {
    for (const household of HOUSEHOLDS) {
      expect(emergencyMonthsFor(household, 'irregular')).toBe(2 * emergencyMonthsFor(household, 'salaried'));
    }
    expect(INCOME_STABILITIES).toEqual(['salaried', 'irregular']);
  });
});
```

```ts
// packages/core/test/goal-classes.test.ts
import { describe, expect, it } from 'vitest';
import { fundingOrder, type Goal, goalClass } from '../src/index';

export const goal = (id: string, kind: Goal['kind'], rank: number): Goal => ({
  id, name: id, kind, rank, growthBps: 0, returnBps: 0, standingMonthlyMinor: 0, standingNote: null, stages: [],
});

describe('compulsory and additional', () => {
  it('names only the emergency fund and retirement compulsory', () => {
    expect(goalClass('emergency')).toBe('compulsory');
    expect(goalClass('retirement')).toBe('compulsory');
    for (const kind of ['education', 'hajj', 'umrah', 'home', 'wedding', 'vehicle', 'holiday', 'other'] as const) {
      expect(goalClass(kind)).toBe('additional');
    }
  });

  it('orders compulsory goals first, each class by its own rank', () => {
    const goals = [goal('holiday', 'holiday', 0), goal('retire', 'retirement', 3), goal('hajj', 'hajj', 1), goal('rainy', 'emergency', 2)];
    expect(fundingOrder(goals).map((row) => row.id)).toEqual(['rainy', 'retire', 'holiday', 'hajj']);
  });
});
```

(The `fitByRank` test that uses `fundingOrder` is Task 7's.)

- [ ] **Step 2: Run them and see them fail**

Run: `cd packages/core && npx vitest run test/needs.test.ts test/budget-frequency.test.ts test/emergency-months.test.ts test/goal-classes.test.ts`
Expected: FAIL — none of the names exist.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/budget/frequency.ts
import { divRound } from '../assets/units';

export type BudgetFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export const BUDGET_FREQUENCIES: readonly BudgetFrequency[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

/** How many of the unit make a month, as a fraction. A year is 52 weeks and 365 days — never 4 weeks or 30 days a month. */
const PER_MONTH: Record<BudgetFrequency, readonly [bigint, bigint]> = {
  daily: [365n, 12n],
  weekly: [52n, 12n],
  monthly: [1n, 1n],
  quarterly: [1n, 3n],
  yearly: [1n, 12n],
};

/** One budget line as a monthly figure, rounded once, half away from zero, in the currency's minor units. */
export function perMonthMinor(amountMinor: number, frequency: BudgetFrequency): number {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError('An amount must be a whole number of minor units');
  const [numerator, denominator] = PER_MONTH[frequency];
  return Number(divRound(BigInt(amountMinor) * numerator, denominator));
}
```

```ts
// packages/core/src/budget/needs.ts
export type CategoryNeed = 'essential' | 'lifestyle';
export const CATEGORY_NEEDS: readonly CategoryNeed[] = ['essential', 'lifestyle'];

export interface NeedNode {
  id: string;
  parentId: string | null;
}

export interface ResolvedNeed {
  need: CategoryNeed;
  /** Its own mark, an ancestor's, or none at all — in which case it counts as essential. */
  source: 'yours' | 'parent' | null;
}

function walk(categoryId: string, parentOf: ReadonlyMap<string, string | null>, marks: Readonly<Record<string, CategoryNeed>>): ResolvedNeed {
  const own = marks[categoryId];
  if (own) return { need: own, source: 'yours' };
  const seen = new Set<string>([categoryId]);
  let parent = parentOf.get(categoryId) ?? null;
  while (parent !== null && !seen.has(parent)) {
    const mark = marks[parent];
    if (mark) return { need: mark, source: 'parent' };
    seen.add(parent);
    parent = parentOf.get(parent) ?? null;
  }
  // Unmarked counts as a need: an emergency fund sized a little large is the safe mistake.
  return { need: 'essential', source: null };
}

/** A category's own mark, else its nearest marked ancestor's, else essential. */
export function needOf(categoryId: string, nodes: readonly NeedNode[], marks: Readonly<Record<string, CategoryNeed>>): ResolvedNeed {
  return walk(categoryId, new Map(nodes.map((node) => [node.id, node.parentId])), marks);
}

/** Every node's need, the tree read once. */
export function resolveNeeds(nodes: readonly NeedNode[], marks: Readonly<Record<string, CategoryNeed>>): Record<string, CategoryNeed> {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  return Object.fromEntries(nodes.map((node) => [node.id, walk(node.id, parentOf, marks).need]));
}
```

```ts
// packages/core/src/budget/emergency-months.ts
export type Household = 'single' | 'couple' | 'children';
export type IncomeStability = 'salaried' | 'irregular';
export const HOUSEHOLDS: readonly Household[] = ['single', 'couple', 'children'];
export const INCOME_STABILITIES: readonly IncomeStability[] = ['salaried', 'irregular'];

/** The user's own matrix (2026-09-19): irregular income is exactly twice salaried. A prefill, never a rule. */
const SALARIED_MONTHS: Record<Household, number> = { single: 3, couple: 6, children: 12 };

export function emergencyMonthsFor(household: Household, income: IncomeStability): number {
  const months = SALARIED_MONTHS[household];
  return income === 'irregular' ? months * 2 : months;
}
```

```ts
// packages/core/src/goals/classes.ts
import type { GoalKind } from './plan';

export type GoalClass = 'compulsory' | 'additional';

/** Every household has these two. Education assumes children and hajj a faith, so both are additional. */
export const COMPULSORY_KINDS: readonly GoalKind[] = ['emergency', 'retirement'];

export function goalClass(kind: GoalKind): GoalClass {
  return COMPULSORY_KINDS.includes(kind) ? 'compulsory' : 'additional';
}

/** The order money reaches goals in: compulsory first, then additional, each in its own rank order. */
export function fundingOrder<T extends { kind: GoalKind; rank: number }>(goals: readonly T[]): T[] {
  const weight = (goal: T) => (goalClass(goal.kind) === 'compulsory' ? 0 : 1);
  return [...goals].sort((a, b) => weight(a) - weight(b) || a.rank - b.rank);
}
```

In `packages/core/src/index.ts`:

```ts
export { BUDGET_FREQUENCIES, type BudgetFrequency, perMonthMinor } from './budget/frequency';
export { CATEGORY_NEEDS, type CategoryNeed, type NeedNode, needOf, type ResolvedNeed, resolveNeeds } from './budget/needs';
export { emergencyMonthsFor, type Household, HOUSEHOLDS, INCOME_STABILITIES, type IncomeStability } from './budget/emergency-months';
export { COMPULSORY_KINDS, type GoalClass, fundingOrder, goalClass } from './goals/classes';
```

- [ ] **Step 4: Run** — the four files, then root `npm run typecheck && npm test && npm run build`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): the rules for needs, budget frequency, emergency months and compulsory goals`, with the trailer.

---

### Task 3: A category's mark — repository and workspace copy

**Files:**
- Create: `packages/db/src/repos/category-needs.ts`, `packages/db/test/category-needs.test.ts`
- Modify: `packages/db/src/repos/books.ts` (`copyCategoriesTx`), `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `healthTablesExist`, `categoryNeeds`, `resolveNeeds`, `CATEGORY_NEEDS`, `bookOfCategory`, `hasBooks` (books.ts), `accounts`.
- Produces: `CategoryNeedError(code, message)`; `listCategoryNeeds(database, ws): Promise<Record<string, CategoryNeed>>` (own marks only); `resolvedCategoryNeeds(db: Db, ws): Promise<Record<string, CategoryNeed>>` (every expense category of the workspace); `saveCategoryNeed(database, ws, categoryAccountId, need)`; `clearCategoryNeed(database, ws, categoryAccountId)`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/category-needs.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import {
  categoryIdsByKey,
  clearCategoryNeed,
  createAccount,
  createBook,
  createDatabase,
  createWorkspace,
  inBook,
  listAccounts,
  listBooks,
  listCategoryNeeds,
  migrate,
  MIGRATIONS,
  resolvedCategoryNeeds,
  saveCategoryNeed,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

describe('marking a category', () => {
  it('passes a parent’s mark to every child that has none of its own', async () => {
    const { database, ws } = await setupDb();
    const keys = await categoryIdsByKey(database, ws);
    await saveCategoryNeed(database, ws, keys['food_beverage']!, 'lifestyle');

    const resolved = await resolvedCategoryNeeds(database.db, ws);
    expect(resolved[keys['food_beverage.restaurants']!]).toBe('lifestyle');
    expect(resolved[keys['household.groceries']!]).toBe('essential');
    expect(await listCategoryNeeds(database, ws)).toEqual({ [keys['food_beverage']!]: 'lifestyle' });
  });

  it('lets a child keep its own mark, and clearing it hands it back to the parent', async () => {
    const { database, ws } = await setupDb();
    const keys = await categoryIdsByKey(database, ws);
    await saveCategoryNeed(database, ws, keys['food_beverage']!, 'lifestyle');
    await saveCategoryNeed(database, ws, keys['food_beverage.school_catering']!, 'essential');
    expect((await resolvedCategoryNeeds(database.db, ws))[keys['food_beverage.school_catering']!]).toBe('essential');

    await clearCategoryNeed(database, ws, keys['food_beverage.school_catering']!);
    expect((await resolvedCategoryNeeds(database.db, ws))[keys['food_beverage.school_catering']!]).toBe('lifestyle');
  });

  it('refuses what is not a spending category', async () => {
    const { database, ws } = await setupDb();
    const keys = await categoryIdsByKey(database, ws);
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await expect(saveCategoryNeed(database, ws, keys['income.salary']!, 'essential')).rejects.toMatchObject({ code: 'NOT_A_CATEGORY' });
    await expect(saveCategoryNeed(database, ws, bank.id, 'essential')).rejects.toMatchObject({ code: 'NOT_A_CATEGORY' });
    await expect(saveCategoryNeed(database, ws, 'nope', 'essential')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(saveCategoryNeed(database, ws, keys['food_beverage']!, 'luxury' as never)).rejects.toMatchObject({ code: 'BAD_NEED' });
  });

  it('refuses a category of another workspace’s book', async () => {
    const { database, ws } = await setupDb();
    const personal = (await listBooks(database, ws)).find((book) => book.kind === 'personal')!;
    const businessId = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const businessRestaurants = (await categoryIdsByKey(database, inBook(ws, businessId)))['food_beverage.restaurants']!;

    await expect(saveCategoryNeed(database, inBook(ws, personal.id), businessRestaurants, 'lifestyle')).rejects.toMatchObject({ code: 'OTHER_BOOK' });
  });

  it('travels with a copied tree, onto the copy’s own ids', async () => {
    const { database, ws } = await setupDb();
    const personal = (await listBooks(database, ws)).find((book) => book.kind === 'personal')!;
    const personalKeys = await categoryIdsByKey(database, inBook(ws, personal.id));
    await saveCategoryNeed(database, inBook(ws, personal.id), personalKeys['food_beverage']!, 'lifestyle');

    const businessId = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const businessKeys = await categoryIdsByKey(database, inBook(ws, businessId));
    expect(businessKeys['food_beverage']).not.toBe(personalKeys['food_beverage']);
    expect((await listCategoryNeeds(database, ws))[businessKeys['food_beverage']!]).toBe('lifestyle');
  });

  it('marks nothing on a database stopped before 0053, and refuses to write', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;

    expect(await listCategoryNeeds(database, ws)).toEqual({});
    expect((await resolvedCategoryNeeds(database.db, ws))[groceries]).toBe('essential');
    await expect(saveCategoryNeed(database, ws, groceries, 'lifestyle')).rejects.toMatchObject({ code: 'NO_TABLES' });
  });
});
```

(`inBook` is defined in `packages/db/src/context.ts`; if `index.ts` does not re-export it — `grep -n "inBook" packages/db/src/index.ts` — add `export { inBook, ownerScope } from './context'` beside the existing context exports.)

- [ ] **Step 2: Run and see it fail** — `cd packages/db && npx vitest run test/category-needs.test.ts`. Expected: FAIL, names missing.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/repos/category-needs.ts
import { CATEGORY_NEEDS, type CategoryNeed, resolveNeeds } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { categoryNeeds } from '../schema-health';
import { bookOfCategory, hasBooks } from './books';
import { healthTablesExist } from './health-tables';

export class CategoryNeedError extends Error {
  constructor(
    readonly code: 'BAD_NEED' | 'NOT_FOUND' | 'NOT_A_CATEGORY' | 'OTHER_BOOK' | 'NO_TABLES',
    message: string,
  ) {
    super(message);
    this.name = 'CategoryNeedError';
  }
}

/** The marks set on categories themselves. Inherited marks are worked out by `needOf` / `resolvedCategoryNeeds`. */
export async function listCategoryNeeds(database: Database, ws: WorkspaceContext): Promise<Record<string, CategoryNeed>> {
  if (!(await healthTablesExist(database.db))) return {};
  const rows = await database.db
    .select({ id: categoryNeeds.categoryAccountId, need: categoryNeeds.need })
    .from(categoryNeeds)
    .where(eq(categoryNeeds.workspaceId, ws.workspaceId));
  return Object.fromEntries(rows.map((row) => [row.id, row.need]));
}

/** Every spending category of the workspace, each with the need it counts under: its own, an ancestor's, or essential. */
export async function resolvedCategoryNeeds(db: Db, ws: WorkspaceContext): Promise<Record<string, CategoryNeed>> {
  const nodes = await db
    .select({ id: accounts.id, parentId: accounts.parentId })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.subtype, 'category'), eq(accounts.kind, 'expense')));
  if (!(await healthTablesExist(db))) return Object.fromEntries(nodes.map((node) => [node.id, 'essential' as const]));
  const rows = await db
    .select({ id: categoryNeeds.categoryAccountId, need: categoryNeeds.need })
    .from(categoryNeeds)
    .where(eq(categoryNeeds.workspaceId, ws.workspaceId));
  return resolveNeeds(nodes, Object.fromEntries(rows.map((row) => [row.id, row.need])));
}

/** The refusals `saveBudget` applies, applied here too: a spending category of this workspace, in the open book. */
async function assertSpendingCategory(tx: Db, ws: WorkspaceContext, categoryAccountId: string): Promise<void> {
  const [account] = await tx
    .select({ kind: accounts.kind, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, categoryAccountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) throw new CategoryNeedError('NOT_FOUND', 'That category does not exist in this workspace');
  if (account.subtype !== 'category' || account.kind !== 'expense') {
    throw new CategoryNeedError('NOT_A_CATEGORY', 'Only a spending category is essential or lifestyle');
  }
  if (ws.bookId && (await hasBooks(tx))) {
    const owner = await bookOfCategory(tx, categoryAccountId);
    if (owner && owner !== ws.bookId) throw new CategoryNeedError('OTHER_BOOK', 'That category belongs to another workspace');
  }
}

export async function saveCategoryNeed(database: Database, ws: WorkspaceContext, categoryAccountId: string, need: CategoryNeed): Promise<void> {
  if (!CATEGORY_NEEDS.includes(need)) throw new CategoryNeedError('BAD_NEED', 'A category is essential or lifestyle');
  await database.transaction(async (tx) => {
    if (!(await healthTablesExist(tx))) throw new CategoryNeedError('NO_TABLES', 'This database is too old to mark categories; reopen the app to update it');
    await assertSpendingCategory(tx, ws, categoryAccountId);
    await tx
      .insert(categoryNeeds)
      .values({ categoryAccountId, workspaceId: ws.workspaceId, need })
      .onConflictDoUpdate({ target: categoryNeeds.categoryAccountId, set: { need } });
  });
}

/** Takes the category's own mark away, so it follows its parent again. */
export async function clearCategoryNeed(database: Database, ws: WorkspaceContext, categoryAccountId: string): Promise<void> {
  await database.transaction(async (tx) => {
    if (!(await healthTablesExist(tx))) return;
    await assertSpendingCategory(tx, ws, categoryAccountId);
    await tx.delete(categoryNeeds).where(and(eq(categoryNeeds.categoryAccountId, categoryAccountId), eq(categoryNeeds.workspaceId, ws.workspaceId)));
  });
}
```

In `packages/db/src/repos/books.ts`, import `categoryNeeds` from `../schema-health` and `healthTablesExist` from `./health-tables`, and append to the end of `copyCategoriesTx`, after the MCC loop (it is already past the `if (sourceIds.size === 0) return;` guard):

```ts
  // Essential or lifestyle is, like the MCC, a property of what the category means — so it travels with the copy.
  if (await healthTablesExist(tx)) {
    const marks = await tx
      .select({ categoryId: categoryNeeds.categoryAccountId, need: categoryNeeds.need })
      .from(categoryNeeds)
      .where(and(eq(categoryNeeds.workspaceId, ws.workspaceId), inArray(categoryNeeds.categoryAccountId, [...sourceIds])));
    for (const row of marks) {
      await tx.insert(categoryNeeds).values({ categoryAccountId: newIds.get(row.categoryId)!, workspaceId: ws.workspaceId, need: row.need });
    }
  }
```

In `packages/db/src/index.ts`: `export * from './repos/category-needs';`

- [ ] **Step 4: Run** — the test file, then the root gate. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(db): a spending category is essential or lifestyle, and a copied workspace keeps the mark`, trailer.

---

### Task 4: Lifestyle spending in the flows; the emergency base; the 30% guide

**Files:**
- Modify: `packages/core/src/assets/health.ts`, `packages/core/src/index.ts`, `packages/db/src/repos/flows.ts`, `apps/web/src/features/networth/HealthRatios.tsx`
- Test: `packages/core/test/assets-health.test.ts`, `packages/db/test/flows.test.ts`; Create `apps/web/e2e/health-ratios.spec.ts`

**Interfaces:**
- Consumes: `resolvedCategoryNeeds` (Task 3).
- Produces: `PeriodFlows.lifestyleSpendingMinor: number`; `EmergencyBase = 'essential' | 'all'`; `EMERGENCY_BASES`; `DEFAULT_EMERGENCY_BASE = 'essential'`; `emergencyOutgoingMinor(flows, base): number` (a **period total** — callers divide); `RatioSettings = { emergencyBase?: EmergencyBase; debtServiceBenchmarkBps?: number }` (`emergencyIncludesDebtPayments` is removed); `DEFAULT_DEBT_SERVICE_BPS = 3000`.

- [ ] **Step 1: Change the tests first**

In `packages/core/test/assets-health.test.ts`, add `lifestyleSpendingMinor: 120_000_000` to the `flows()` fixture (Rp 10 jt a month of the Rp 46,8 jt is lifestyle), and `lifestyleSpendingMinor: 0` to the literal in the "no period" test. Replace the tests "divides cash by spending and loan principal…", "drops loan principal…", "says which denominator…" and the whole `describe('debt servicing')` with:

```ts
  it('divides cash by essential spending plus loan principal by default', () => {
    const ratio = by(healthRatios(flows(), totals()), 'emergency_fund');
    // Rp 46,8 jt spent, Rp 10 jt of it lifestyle, Rp 4,973 jt principal. Adding lifestyle back, or the whole
    // Rp 14,973 jt payment, would each give a different figure.
    expect(ratio.value).toBeCloseTo(200_000_000 / (36_800_000 + 4_973_000), 4);
  });

  it('divides by all spending plus loan principal when asked', () => {
    const all = by(healthRatios(flows(), totals(), { emergencyBase: 'all' }), 'emergency_fund');
    expect(all.value).toBeCloseTo(200_000_000 / (46_800_000 + 4_973_000), 4);
  });

  it('is the same either way while nothing is marked lifestyle', () => {
    const unmarked = flows({ lifestyleSpendingMinor: 0 });
    expect(by(healthRatios(unmarked, totals()), 'emergency_fund').value).toBe(by(healthRatios(unmarked, totals(), { emergencyBase: 'all' }), 'emergency_fund').value);
  });

  it('has nothing to divide by when every outgoing is lifestyle and there is no loan', () => {
    const ratio = by(healthRatios(flows({ lifestyleSpendingMinor: 561_600_000, debtPrincipalMinor: 0 }), totals()), 'emergency_fund');
    expect(ratio.value).toBeNull();
    expect(ratio.status).toBe('unknown');
  });
```

```ts
describe('emergencyOutgoingMinor', () => {
  it('takes lifestyle out only for the essential base, and adds principal to both', () => {
    const period = { spendingMinor: 30_000_000, lifestyleSpendingMinor: 7_000_000, debtPrincipalMinor: 2_000_000 };
    expect(emergencyOutgoingMinor(period, 'essential')).toBe(25_000_000);
    expect(emergencyOutgoingMinor(period, 'all')).toBe(32_000_000);
  });

  it('sums signed: a lifestyle refund larger than lifestyle spending raises the essential base', () => {
    expect(emergencyOutgoingMinor({ spendingMinor: 10_000_000, lifestyleSpendingMinor: -500_000, debtPrincipalMinor: 0 }, 'essential')).toBe(10_500_000);
  });
});

describe('debt servicing', () => {
  it('follows the 30% guide by default', () => {
    // 32% is inside 30%'s watch band (to 36%) and would be "good" under 35%.
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(32) })).toBe('watch');
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(29) })).toBe('good');
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(37) })).toBe('act');
    expect(by(healthRatios(flows(), totals()), 'debt_payments').target).toBe(30);
  });

  it('moves with the looser 35% setting', () => {
    const looser: RatioSettings = { debtServiceBenchmarkBps: 3500 };
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(34) }, {}, looser)).toBe('good');
    expect(statusOf('debt_payments', { debtPaymentsMinor: monthsOf(40) }, {}, looser)).toBe('watch');
  });

  it('holds non-mortgage payments to 15%', () => {
    expect(statusOf('consumer_debt_payments')).toBe('good');
    expect(statusOf('consumer_debt_payments', { nonMortgageDebtPaymentsMinor: monthsOf(17) })).toBe('watch');
    expect(statusOf('consumer_debt_payments', { nonMortgageDebtPaymentsMinor: monthsOf(25) })).toBe('act');
  });
});
```

Keep "counts loan interest once" (it compares two runs on the same base, so it still holds). Re-derive the "grades against three months" figures against the new default denominator of Rp 41,773 jt a month: `good` at `liquidMinor: 126_000_000` (3,02), `watch` at `110_000_000` (2,63), `act` at `100_000_000` (2,39). Import `emergencyOutgoingMinor`.

In `packages/db/test/flows.test.ts`, import `saveCategoryNeed` and add:

```ts
describe('periodFlows lifestyle spending', () => {
  const restaurants = (occurredOn: string, amountMinor: number, excludedFromReport = false) =>
    postTransaction(database, ws, {
      occurredOn,
      description: 'Warung',
      excludedFromReport,
      lines: [
        { accountId: categories['food_beverage.restaurants']!, amountMinor, currency: 'IDR' },
        { accountId: bca.id, amountMinor: -amountMinor, currency: 'IDR' },
      ],
    });

  it('sums signed spending in categories that resolve to lifestyle, leaving out excluded rows', async () => {
    await saveCategoryNeed(database, ws, categories['food_beverage']!, 'lifestyle');
    await groceries('2026-03-02', 3_000_000);
    await restaurants('2026-03-05', 2_000_000);
    await restaurants('2026-03-06', -500_000); // a refund
    await restaurants('2026-03-07', 1_000_000, true); // marked "not my spending"

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.spendingMinor).toBe(4_500_000);
    expect(flows.lifestyleSpendingMinor).toBe(1_500_000);
  });

  it('is nothing while no category is marked', async () => {
    await restaurants('2026-03-05', 2_000_000);
    expect((await periodFlows(database, ws, YEAR)).lifestyleSpendingMinor).toBe(0);
  });
});
```

- [ ] **Step 2: Run and see them fail** — `cd packages/core && npx vitest run test/assets-health.test.ts`; `cd packages/db && npx vitest run test/flows.test.ts`.

- [ ] **Step 3: `health.ts`**

Change the header's first sentence to `The personal financial ratios the planning guides use, with their benchmarks.` (it no longer claims "CFP-aligned"). Then:

```ts
export interface PeriodFlows {
  // …existing fields unchanged…
  /** The part of `spendingMinor` in categories that resolve to lifestyle, summed signed like spending itself. */
  lifestyleSpendingMinor: number;
}

export type EmergencyBase = 'essential' | 'all';
export const EMERGENCY_BASES: readonly EmergencyBase[] = ['essential', 'all'];
export const DEFAULT_EMERGENCY_BASE: EmergencyBase = 'essential';

export interface RatioSettings {
  /**
   * What the emergency fund's months multiply: essential spending (lifestyle categories left out) or all of it.
   * Loan principal is added either way — it keeps arriving when income stops, and it is the only half of a loan
   * payment spending does not already hold. The interest is an expense entry, inside spending already.
   */
  emergencyBase?: EmergencyBase;
  /** 3000 by default; 3500 is the looser guide. */
  debtServiceBenchmarkBps?: number;
}

export const DEFAULT_DEBT_SERVICE_BPS = 3000;

/**
 * What an emergency fund covers over the period, as a total. The ratio card and the emergency goal both size
 * themselves with this and nothing else, so they cannot disagree. Signed: a refund lowers what it refunds.
 */
export function emergencyOutgoingMinor(
  flows: Pick<PeriodFlows, 'spendingMinor' | 'lifestyleSpendingMinor' | 'debtPrincipalMinor'>,
  base: EmergencyBase,
): number {
  const spending = base === 'essential' ? flows.spendingMinor - flows.lifestyleSpendingMinor : flows.spendingMinor;
  return spending + flows.debtPrincipalMinor;
}
```

In `healthRatios`, delete `debtPrincipal`, `countsDebtPayments` and the old `emergencyOutgoing`, and write:

```ts
  const base = settings.emergencyBase ?? DEFAULT_EMERGENCY_BASE;
  const emergencyOutgoing = monthly(emergencyOutgoingMinor(flows, base), flows.months);
```

The emergency row's guide:

```ts
      base === 'essential'
        ? 'Cash & equivalents ÷ monthly essential spending plus loan principal. Lifestyle categories are left out; loan interest is already inside spending. The guide asks 3–6 months, more with dependants or irregular income.'
        : 'Cash & equivalents ÷ monthly spending plus loan principal. Loan interest is already inside spending. The guide asks 3–6 months, more with dependants or irregular income.',
```

Export `DEFAULT_EMERGENCY_BASE`, `EMERGENCY_BASES`, `type EmergencyBase`, `emergencyOutgoingMinor` beside the existing health exports in `packages/core/src/index.ts`.

- [ ] **Step 4: `flows.ts`**

Import `resolvedCategoryNeeds` from `./category-needs`. After `const counts = …`:

```ts
  // Which spending is a choice rather than a need, read for the owner's whole tree as the keys above are.
  const lifestyle = new Set(
    Object.entries(await resolvedCategoryNeeds(database.db, ws))
      .filter(([, need]) => need === 'lifestyle')
      .map(([id]) => id),
  );
  let lifestyleSpendingMinor = 0;
```

Replace the expense branch:

```ts
    } else if (counted && row.kind === 'expense' && !finalTax.has(row.accountId) && counts(row.accountId)) {
      if (bucket) {
        const spent = displayAmount('expense', read);
        bucket.spendingMinor += spent;
        if (lifestyle.has(row.accountId)) lifestyleSpendingMinor += spent;
      }
    }
```

and return `lifestyleSpendingMinor,` after `spendingMinor`.

- [ ] **Step 5: `HealthRatios.tsx`**

```tsx
import { DEFAULT_DEBT_SERVICE_BPS, DEFAULT_EMERGENCY_BASE, type EmergencyBase, healthRatios, type PeriodFlows, type RatioSettings, type RatioStatus, type SheetTotals } from '@expanses/core';
// …
const EMPTY_FLOWS: PeriodFlows = { months: 0, incomeMinor: 0, spendingMinor: 0, lifestyleSpendingMinor: 0, debtPaymentsMinor: 0, nonMortgageDebtPaymentsMinor: 0, debtPrincipalMinor: 0, putAwayMinor: 0 };
// …
  const [settings, setSettings] = useState<RatioSettings>({ emergencyBase: DEFAULT_EMERGENCY_BASE, debtServiceBenchmarkBps: DEFAULT_DEBT_SERVICE_BPS });
```

Replace the `SwitchRow` and the debt `SelectRow` (drop `SwitchRow` from the import):

```tsx
        <SelectRow
          label="Emergency fund counts"
          value={settings.emergencyBase ?? DEFAULT_EMERGENCY_BASE}
          onChange={(e) => setSettings((current) => ({ ...current, emergencyBase: e.target.value as EmergencyBase }))}
        >
          <option value="essential">Essential spending</option>
          <option value="all">All spending</option>
        </SelectRow>
        <SelectRow
          label="Debt servicing guide"
          value={settings.debtServiceBenchmarkBps ?? DEFAULT_DEBT_SERVICE_BPS}
          onChange={(e) => setSettings((current) => ({ ...current, debtServiceBenchmarkBps: Number(e.target.value) }))}
        >
          <option value={3000}>30% · the planning guide</option>
          <option value={3500}>35% · a looser guide</option>
        </SelectRow>
```

The group's footer gains: `Loan principal counts toward the emergency fund either way; the interest is already spending.`

- [ ] **Step 6: E2E**

```ts
// apps/web/e2e/health-ratios.spec.ts
import { expect, test } from '@playwright/test';
import { addTransaction } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('the emergency card divides cash by a month of spending, and the debt guide starts at 30%', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '4000000' });

  await page.goto('/net-worth');
  // Rp 16 jt left in the bank against Rp 4 jt of one month's spending.
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Emergency fund', exact: true }) }).last();
  await expect(card).toContainText('4,0 months');
  await expect(page.getByLabel('Debt servicing guide')).toHaveValue('3000');
  await expect(page.getByLabel('Emergency fund counts')).toHaveValue('essential');
});
```

(If `Panel` does not render a `section`, locate the card through the heading's nearest ancestor that also contains the value; do not assert on the guide text.)

- [ ] **Step 7: Run** — both vitest files, root gate, `cd apps/web && npx playwright test e2e/health-ratios.spec.ts e2e/net-worth.spec.ts`. Fix every `PeriodFlows` literal the compiler names (`grep -rn "debtPrincipalMinor: 0" packages apps`). Expected: PASS.
- [ ] **Step 8: Commit** — `feat(health): the emergency fund counts essential or all spending, and the debt guide starts at 30%`, trailer.

---

### Task 5: The emergency goal remembers household, income and base

**Files:**
- Modify: `packages/db/src/repos/goal-calculators.ts`, `packages/db/src/repos/goal-funding.ts`, `apps/web/src/features/goals/GoalsPage.tsx` (one subtitle)
- Test: `packages/db/test/goal-calculators.test.ts`, `packages/db/test/goal-funding.test.ts`

**Interfaces:**
- Consumes: `emergencyOutgoingMinor`, `DEFAULT_EMERGENCY_BASE`, `EMERGENCY_BASES`, `HOUSEHOLDS`, `INCOME_STABILITIES`, `listGoalCalculators`.
- Produces: `EmergencyInputs = { months: number; household?: Household; income?: IncomeStability; base?: EmergencyBase }`; `goalPlansFor` sizes each months-stage on its goal's base.

- [ ] **Step 1: Tests**

`goal-calculators.test.ts`, inside "a derived target":

```ts
  it('remembers the two answers and the base beside the months', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Emergency fund', 'emergency');
    const inputs = { months: 24, household: 'children', income: 'irregular', base: 'all' } as const;
    await saveGoalCalculator(database, ws, { goalId, kind: 'emergency', inputs, today: TODAY });
    expect(await getGoalCalculator(database, ws, goalId)).toMatchObject({ inputs });
    expect((await stagesOf(database, ws, goalId))[0]).toMatchObject({ targetMonths: 24, targetMinor: null });
  });

  it('refuses an answer it does not know', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Emergency fund', 'emergency');
    await expect(saveGoalCalculator(database, ws, { goalId, kind: 'emergency', inputs: { months: 6, household: 'big' } as never, today: TODAY })).rejects.toThrow(/household/);
    await expect(saveGoalCalculator(database, ws, { goalId, kind: 'emergency', inputs: { months: 6, base: 'some' } as never, today: TODAY })).rejects.toThrow(/essential or all/);
  });
```

`goal-funding.test.ts`, inside `describe('goalPlansFor')` (import `saveCategoryNeed`, `saveGoalCalculator`):

```ts
  /** Rp 5 jt a month at restaurants, on top of the Rp 20 jt of groceries, with Food and beverage marked lifestyle. */
  async function diningOut() {
    const categories = await categoryIdsByKey(database, ws);
    await saveCategoryNeed(database, ws, categories['food_beverage']!, 'lifestyle');
    for (const month of ['06', '07', '08']) {
      await postTransaction(database, ws, {
        occurredOn: `2026-${month}-20`,
        description: 'Dinner',
        lines: [
          { accountId: categories['food_beverage.restaurants']!, amountMinor: 5_000_000, currency: 'IDR' },
          { accountId: bca.id, amountMinor: -5_000_000, currency: 'IDR' },
        ],
      });
    }
  }

  it('sizes an emergency goal on essential spending unless its working says all', async () => {
    await salaryAndSpending();
    await diningOut();
    const emergencyId = await saveGoal(database, ws, {
      name: 'Emergency fund',
      kind: 'emergency',
      growthBps: 0,
      returnBps: 200,
      stages: [{ name: 'Emergency fund', targetMinor: null, targetMonths: 6, dueOn: '2028-12-31' }],
    });
    const todayOf = async () => (await goalPlansFor(database, ws, TODAY)).plans.find((row) => row.goalId === emergencyId)!.stages[0]!.todayMinor;

    // Typed by hand: the default, essential — the Rp 5 jt of dining out left out.
    expect(await todayOf()).toBe(6 * 20_000_000);

    await saveGoalCalculator(database, ws, { goalId: emergencyId, kind: 'emergency', inputs: { months: 6, base: 'all' }, today: TODAY });
    expect(await todayOf()).toBe(6 * 25_000_000);
  });

  it('leaves what you can save alone: lifestyle is still money that left', async () => {
    await salaryAndSpending();
    await diningOut();
    // Rp 30 jt in, Rp 25 jt out.
    expect((await goalPlansFor(database, ws, TODAY)).capacityMonthlyMinor).toBe(5_000_000);
  });
```

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: `goal-calculators.ts`**

Add to the `@expanses/core` import: `EMERGENCY_BASES, type EmergencyBase, HOUSEHOLDS, type Household, INCOME_STABILITIES, type IncomeStability`.

```ts
/**
 * An emergency fund counts months of outgoings, read from the flows when the sheet is built. The two answers are kept
 * so the screen can say which of them produced the months; `base` says what the months multiply.
 */
export interface EmergencyInputs {
  months: number;
  household?: Household;
  income?: IncomeStability;
  base?: EmergencyBase;
}
```

The emergency branch of `stagesFor` begins:

```ts
    const { months, household, income, base } = input.inputs as EmergencyInputs;
    if (!Number.isFinite(months) || months <= 0) throw new GoalDbError('An emergency fund needs a number of months above zero');
    if (household !== undefined && !HOUSEHOLDS.includes(household)) throw new GoalDbError('That household is not one this app knows');
    if (income !== undefined && !INCOME_STABILITIES.includes(income)) throw new GoalDbError('Income is salaried or irregular');
    if (base !== undefined && !EMERGENCY_BASES.includes(base)) throw new GoalDbError('An emergency fund counts essential or all spending');
```

- [ ] **Step 4: `goal-funding.ts`**

Import `DEFAULT_EMERGENCY_BASE`, `emergencyOutgoingMinor`, `type EmergencyBase` from `@expanses/core`, and `type EmergencyInputs`, `listGoalCalculators` from `./goal-calculators`. Replace the `monthlyOutgoingMinor` constant with:

```ts
  // What an emergency goal's months multiply: the function the ratio card divides by, on the base the goal's own
  // working chose — essential unless it said all. Loan principal is inside either way; the interest never twice.
  const baseOf = new Map<string, EmergencyBase>(
    (await listGoalCalculators(database, ws))
      .filter((row) => row.kind === 'emergency')
      .map((row) => [row.goalId, (row.inputs as EmergencyInputs).base ?? DEFAULT_EMERGENCY_BASE]),
  );
  const outgoingFor = (goalId: string) => perMonth(emergencyOutgoingMinor(flows, baseOf.get(goalId) ?? DEFAULT_EMERGENCY_BASE), flows.months);
```

and call `goalPlan(goal, mine, monthlyFromTemplates(goal.id), outgoingFor(goal.id), date)`. Leave `capacityMonthlyMinor` exactly as it is.

In `GoalsPage.tsx`, the "You save each month" subtitle becomes `Take-home pay − spending − loan principal`.

- [ ] **Step 5: Run** — both test files, root gate, `npx playwright test e2e/goals.spec.ts`. PASS.
- [ ] **Step 6: Commit** — `feat(goals): an emergency goal sizes itself on the base its working chose`, trailer.

---

### Task 6: A frequency on every budget line; essential and lifestyle on the sheet

**Files:**
- Modify: `packages/db/src/repos/budgets.ts`, `packages/core/src/budget/sheet.ts`, `packages/db/src/repos/budget-sheet.ts`
- Test: Create `packages/db/test/budget-frequency.test.ts`; add to `packages/core/test/budget-sheet.test.ts` (create it if absent)

**Interfaces:**
- Consumes: `perMonthMinor`, `BUDGET_FREQUENCIES`, `healthTablesExist`, `budgetFrequencies`, `resolvedCategoryNeeds`.
- Produces: `SaveBudgetInput.frequency?: BudgetFrequency` (`amountMinor` is **the amount as typed** in that unit; existing callers pass monthly and are unchanged); `BudgetRow.frequency`, `BudgetRow.amountAsSetMinor`; `BudgetSheetInput.needs?: Readonly<Record<string, CategoryNeed>>`; `BudgetSheet.essentialActualMinor`, `BudgetSheet.lifestyleActualMinor`.

- [ ] **Step 1: Tests**

```ts
// packages/db/test/budget-frequency.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { categoryIdsByKey, createDatabase, createWorkspace, listAccounts, listBudgets, migrate, MIGRATIONS, removeBudget, saveBudget, setBudgetOverride } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const MONTH = '2026-09';
let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

describe('a budget typed in another unit', () => {
  it('keeps the monthly figure for every reader, and what was typed beside it', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 500_000, frequency: 'weekly' });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 2_166_667, amountMinor: 2_166_667, frequency: 'weekly', amountAsSetMinor: 500_000 });
  });

  it('counts cents in a dollar workspace', async () => {
    const { database, ws } = await setupDb('USD');
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 1_000, frequency: 'weekly' });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 4_333, amountAsSetMinor: 1_000 });
  });

  it('drops the unit when set monthly again', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 2_400_000, frequency: 'yearly' });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 200_000, frequency: 'yearly' });

    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 900_000 });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 900_000, frequency: 'monthly', amountAsSetMinor: 900_000 });
  });

  it('refuses a line that comes to nothing a month, or a unit it does not know', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await expect(saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 5, frequency: 'yearly' })).rejects.toMatchObject({ code: 'AMOUNT_RANGE' });
    await expect(saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 5, frequency: 'fortnightly' as never })).rejects.toMatchObject({ code: 'BAD_FREQUENCY' });
  });

  it('still refuses what saveBudget always refused', async () => {
    const { database, ws } = await setupDb();
    const salary = (await categoryIdsByKey(database, ws))['income.salary']!;
    await expect(saveBudget(database, ws, { categoryAccountId: salary, amountMinor: 500_000, frequency: 'weekly' })).rejects.toMatchObject({ code: 'NOT_A_CATEGORY' });
  });

  it('keeps a month override monthly, whatever the plan’s unit', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 500_000, frequency: 'weekly' });
    await setBudgetOverride(database, ws, { categoryAccountId: groceries, month: MONTH, amountMinor: 3_000_000 });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 2_166_667, amountMinor: 3_000_000, overridden: true, frequency: 'weekly' });
  });

  it('forgets the unit with the budget', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await categoryIdsByKey(database, ws))['household.groceries']!;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 500_000, frequency: 'weekly' });
    await removeBudget(database, ws, groceries);
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 900_000 });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ frequency: 'monthly', amountAsSetMinor: 900_000 });
  });

  it('stores the monthly figure alone on a database stopped before 0053', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 500_000, frequency: 'weekly' });
    expect((await listBudgets(database, ws, MONTH))[0]).toMatchObject({ planMinor: 2_166_667, frequency: 'monthly', amountAsSetMinor: 2_166_667 });
  });
});
```

Core sheet test:

```ts
it('splits what was spent into essential and lifestyle, signed, by each category’s resolved need', () => {
  const sheet = budgetSheet({
    month: '2026-09',
    categories: [
      { id: 'food', parentId: null, name: 'Food' },
      { id: 'restaurants', parentId: 'food', name: 'Restaurants' },
      { id: 'groceries', parentId: null, name: 'Groceries' },
    ],
    amounts: [
      { accountId: 'restaurants', amountBaseMinor: 2_000_000 },
      { accountId: 'restaurants', amountBaseMinor: -500_000 },
      { accountId: 'groceries', amountBaseMinor: 3_000_000 },
    ] as never,
    caps: [],
    incomePlanMinor: 0,
    incomeActualMinor: 0,
    debtPaymentsPlanMinor: 0,
    debtPaymentsActualMinor: 0,
    savings: [],
    eventSpendingMinor: 0,
    eventsInCaps: false,
    needs: { food: 'lifestyle', restaurants: 'lifestyle', groceries: 'essential' },
  });
  expect(sheet.lifestyleActualMinor).toBe(1_500_000);
  expect(sheet.essentialActualMinor).toBe(3_000_000);
  expect(sheet.essentialActualMinor + sheet.lifestyleActualMinor).toBe(sheet.spendingActualMinor);
});
```

(Give `amounts` every field `CategoryAmount` requires — read `packages/core/src/reports/spending.ts` — and drop `as never`.)

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: `budgets.ts`**

Imports: `BUDGET_FREQUENCIES, type BudgetFrequency, perMonthMinor` from `@expanses/core`; `budgetFrequencies` from `../schema-health`; `healthTablesExist` from `./health-tables`.

```ts
export interface SaveBudgetInput {
  categoryAccountId: string;
  /** The amount as typed, in the unit `frequency` names. Monthly when no unit is given. */
  amountMinor: number;
  frequency?: BudgetFrequency;
}

export interface BudgetRow {
  id: string;
  categoryAccountId: string;
  /** What the plan says, as a monthly figure. */
  planMinor: number;
  /** What this month asks for: the override when there is one, otherwise the plan. */
  amountMinor: number;
  overridden: boolean;
  /** The unit the plan was typed in, and the amount as typed. Monthly, and the plan itself, when set monthly. */
  frequency: BudgetFrequency;
  amountAsSetMinor: number;
}

export async function saveBudget(database: Database, ws: WorkspaceContext, input: SaveBudgetInput): Promise<string> {
  assertWholeMinor(input.amountMinor);
  if (input.amountMinor <= 0) throw new BudgetError('AMOUNT_RANGE', 'A budget must be above zero; remove it instead');
  const frequency = input.frequency ?? 'monthly';
  if (!BUDGET_FREQUENCIES.includes(frequency)) throw new BudgetError('BAD_FREQUENCY', `${String(frequency)} is not a unit a budget can be set in`);
  // Converted once, here. Every reader of budgets.amount_minor goes on reading a month.
  const monthlyMinor = perMonthMinor(input.amountMinor, frequency);
  if (monthlyMinor <= 0) throw new BudgetError('AMOUNT_RANGE', 'That comes to nothing a month; set it higher or choose a shorter period');
  await assertCategory(database, ws, input.categoryAccountId);

  const now = new Date().toISOString();
  return database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, input.categoryAccountId)));
    const id = existing?.id ?? uuidv7();
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
    return id;
  });
}
```

In `removeBudget`, before deleting the overrides: `if (await healthTablesExist(tx)) await tx.delete(budgetFrequencies).where(eq(budgetFrequencies.budgetId, existing.id));`

In `listBudgets`, after reading the overrides:

```ts
  const units = (await healthTablesExist(database.db))
    ? await database.db
        .select({ budgetId: budgetFrequencies.budgetId, frequency: budgetFrequencies.frequency, amountAsSetMinor: budgetFrequencies.amountAsSetMinor })
        .from(budgetFrequencies)
        .where(eq(budgetFrequencies.workspaceId, ws.workspaceId))
    : [];
  const unitOf = new Map(units.map((row) => [row.budgetId, row]));
```

and each returned row adds:

```ts
      frequency: unitOf.get(row.id)?.frequency ?? 'monthly',
      amountAsSetMinor: unitOf.get(row.id)?.amountAsSetMinor ?? row.amountMinor,
```

- [ ] **Step 4: `sheet.ts` and `budget-sheet.ts`**

`BudgetSheetInput` gains:

```ts
  /** Each category's resolved need. A category missing here counts as essential, as an unmarked one does. */
  needs?: Readonly<Record<string, CategoryNeed>>;
```

`BudgetSheet` gains `essentialActualMinor: number; lifestyleActualMinor: number;`. In `budgetSheet`, after `spendingActualMinor`:

```ts
  // Signed, category by category, over exactly the categories the lines were built from; essential is the rest,
  // so the two always add back to what was spent.
  const lifestyleActualMinor = input.categories.reduce(
    (total, category) => (input.needs?.[category.id] === 'lifestyle' ? total + (own.get(category.id) ?? 0) : total),
    0,
  );
  const essentialActualMinor = spendingActualMinor - lifestyleActualMinor;
```

Return both. Import `type CategoryNeed` from `./needs`.

In `budget-sheet.ts`, add `resolvedCategoryNeeds(database.db, ws)` to the `Promise.all` (as `needs`) and pass `needs` to `budgetSheet`.

- [ ] **Step 5: Run** — both tests, root gate, `npx playwright test e2e/budget.spec.ts e2e/phone-budget-page.spec.ts e2e/events.spec.ts`. PASS.
- [ ] **Step 6: Commit** — `feat(budget): a line is typed in the unit you think in and counted as a month`, trailer.

---

### Task 7: Compulsory goals are funded first

**Files:**
- Modify: `packages/core/src/goals/plan.ts`, `apps/web/src/features/goals/GoalsPage.tsx`
- Test: `packages/core/test/goal-classes.test.ts`, `packages/db/test/goal-funding.test.ts`; Create `apps/web/e2e/goal-classes.spec.ts`

**Interfaces:**
- Consumes: `fundingOrder`, `goalClass`.
- Produces: `fitByRank` fills in `fundingOrder`; the Goals page renders Compulsory and Additional sections.

- [ ] **Step 1: Tests**

Append to `goal-classes.test.ts` (import `fitByRank`, `type GoalPlan`):

```ts
const planOf = (goalId: string, requiredMonthlyMinor: number) => ({ goalId, requiredMonthlyMinor }) as GoalPlan;

describe('fitByRank', () => {
  it('fills an emergency fund before a holiday ranked above it', () => {
    const goals = [goal('holiday', 'holiday', 0), goal('rainy', 'emergency', 1)];
    const fits = fitByRank([planOf('holiday', 3_000_000), planOf('rainy', 4_000_000)], goals, 5_000_000);
    // By rank alone the holiday would take 3 jt and leave the emergency fund 2 jt, only partly funded.
    expect(fits).toEqual([
      { goalId: 'rainy', fundedMonthlyMinor: 4_000_000, fits: 'full' },
      { goalId: 'holiday', fundedMonthlyMinor: 1_000_000, fits: 'partial' },
    ]);
  });
});
```

Append to `goal-funding.test.ts`'s `goalPlansFor` describe:

```ts
  it('fits the emergency fund first, though it was ranked last', async () => {
    await salaryAndSpending();
    const emergencyId = await saveGoal(database, ws, {
      name: 'Emergency fund',
      kind: 'emergency',
      growthBps: 0,
      returnBps: 200,
      stages: [{ name: 'Emergency fund', targetMinor: null, targetMonths: 6, dueOn: '2027-09-12' }],
    });
    expect((await goalPlansFor(database, ws, TODAY)).fits[0]!.goalId).toBe(emergencyId);
  });
```

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: `fitByRank`**

```ts
import { fundingOrder } from './classes';

/** Fills goals from what you can save: compulsory goals first, then additional ones, each in rank order. */
export function fitByRank(plans: GoalPlan[], goals: Goal[], capacityMonthlyMinor: number): RankFit[] {
  const order = fundingOrder(goals).map((goal) => goal.id);
  const position = (goalId: string) => {
    const index = order.indexOf(goalId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const ordered = [...plans].sort((a, b) => position(a.goalId) - position(b.goalId));
  let left = Math.max(0, capacityMonthlyMinor);
  // …the map over `ordered` below is unchanged…
}
```

- [ ] **Step 4: `GoalsPage.tsx`**

Import `fundingOrder, goalClass, type GoalClass` from `@expanses/core`, `type GoalPlanRow` from `@expanses/db`, and `PanelHeader` from the kit. Replace `const cards = plans.map(goalCard);`:

```tsx
  // The page's order is the funding order: compulsory goals first, each section in its own rank order.
  const ordered = fundingOrder(plans.map((plan) => ({ ...plan, kind: plan.goal.kind, rank: plan.goal.rank })));
  const cards = ordered.map(goalCard);
  const SECTIONS: { key: GoalClass; title: string; note: string }[] = [
    { key: 'compulsory', title: 'Compulsory', note: 'The emergency fund and retirement. What you save reaches these first.' },
    { key: 'additional', title: 'Additional', note: 'Everything else, from what is left.' },
  ];
```

`move` works on the page order and never crosses a section:

```tsx
  async function move(goalId: string, by: number) {
    setError(null);
    try {
      const order = ordered.map((plan) => plan.goalId);
      const from = order.indexOf(goalId);
      const to = from + by;
      if (from < 0 || to < 0 || to >= order.length) return;
      if (goalClass(ordered[from]!.goal.kind) !== goalClass(ordered[to]!.goal.kind)) return;
      order.splice(to, 0, ...order.splice(from, 1));
      // Ranks written in page order, so the order on screen and the funding order are one order.
      await reorderGoals(database, ws, order);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }
```

Move the body of today's `cards.map((card, index) => { const plan = plans[index]!; return (<section …>…</section>); })` **verbatim** into `function GoalSection({ card, plan }: { card: GoalCard; plan: GoalPlanRow })`, declared inside `GoalsPage` so it closes over `move`, `archive`, `togglePaid`, `derived` and `ws`. Replace the old grid with:

```tsx
      {SECTIONS.map((section) => {
        const inSection = ordered
          .map((plan, index) => ({ plan, card: cards[index]! }))
          .filter(({ plan }) => goalClass(plan.goal.kind) === section.key);
        if (inSection.length === 0) return null;
        return (
          <div key={section.key} data-testid={`goals-${section.key}`}>
            <PanelHeader title={section.title} />
            <p className="px-[4px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{section.note}</p>
            <div className="grid gap-x-6 lg:grid-cols-2">
              {inSection.map(({ plan, card }) => (
                <GoalSection key={card.goalId} card={card} plan={plan} />
              ))}
            </div>
          </div>
        );
      })}
```

- [ ] **Step 5: E2E**

```ts
// apps/web/e2e/goal-classes.spec.ts
import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addFromTemplate(page: Page, template: string, amount?: string) {
  await page.goto('/goals');
  await page.getByRole('button', { name: template, exact: true }).click();
  if (amount) await page.getByLabel(/Cost in today's money/).first().fill(amount);
  await page.getByRole('button', { name: 'Add goal' }).click();
}

test('an emergency fund added after a holiday is listed first, and cannot be moved below it', async ({ page }) => {
  await addFromTemplate(page, 'Holiday', '15000000');
  await addFromTemplate(page, 'Emergency fund');

  await expect(page.getByTestId('goals-compulsory')).toContainText('Emergency fund');
  await expect(page.getByTestId('goals-additional')).toContainText('Holiday');

  await page.getByRole('button', { name: 'Move Emergency fund down' }).click();
  await expect(page.getByTestId('goals-compulsory')).toContainText('Emergency fund');
  await expect(page.getByTestId('goals-compulsory')).not.toContainText('Holiday');
});
```

- [ ] **Step 6: Run** — vitest files, root gate, `npx playwright test e2e/goal-classes.spec.ts e2e/goals.spec.ts e2e/calculators.spec.ts`. PASS.
- [ ] **Step 7: Commit** — `feat(goals): compulsory goals come first, on the page and in what gets funded`, trailer.

---

### Task 8: The mark on the Categories page

**Files:**
- Create: `apps/web/src/features/categories/need-queries.ts`, `apps/web/e2e/category-needs.spec.ts`, `apps/web/e2e/phone-category-needs.spec.ts`
- Modify: `apps/web/src/features/categories/CategoriesPage.tsx`

**Interfaces:**
- Consumes: `listCategoryNeeds`, `saveCategoryNeed`, `clearCategoryNeed`, `needOf`.
- Produces: `useCategoryNeeds()`.

- [ ] **Step 1: The hook**

```ts
// apps/web/src/features/categories/need-queries.ts
import { listCategoryNeeds } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/** The marks set on categories themselves; `needOf` works out what each line inherits. */
export function useCategoryNeeds() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['category-needs', ws.workspaceId], queryFn: () => listCategoryNeeds(database, ws) });
}
```

- [ ] **Step 2: The page**

Import `needOf, type CategoryNeed` from `@expanses/core`, `saveCategoryNeed, clearCategoryNeed` from `@expanses/db`, `useCategoryNeeds` from `./need-queries`. Beside `MccNote`:

```tsx
/** Essential or lifestyle, and where the answer came from. Quiet ink, like the MCC beside it. */
function NeedNote({ name, need, source }: { name: string; need: CategoryNeed; source: 'yours' | 'parent' | null }) {
  return (
    <span data-testid={`need-${name}`} className="shrink-0 text-[12.5px] leading-[20px] text-[var(--ph-ink-3)]">
      {need === 'lifestyle' ? 'Lifestyle' : 'Essential'}
      {source === 'parent' ? ' (from parent)' : ''}
    </span>
  );
}
```

In `CategoriesPage`: `const needs = useCategoryNeeds();`. In `Row`:

```tsx
    const need = kind === 'expense' ? needOf(c.id, allCategories, needs.data ?? {}) : null;
    const other: CategoryNeed | null = need ? (need.need === 'lifestyle' ? 'essential' : 'lifestyle') : null;
```

`meta` becomes `<>{card && <MccNote mcc={card.mcc} source={card.source} />}{need && <NeedNote name={c.name} need={need.need} source={need.source} />}</>`. Before `+ Sub`:

```tsx
          {need && other && (
            <LineAction label={`Mark ${c.name} ${other}`} onClick={() => void run(() => saveCategoryNeed(database, ws, c.id, other))}>
              {other === 'lifestyle' ? 'Lifestyle' : 'Essential'}
            </LineAction>
          )}
          {need?.source === 'yours' && (
            <LineAction label={`Clear the mark on ${c.name}`} onClick={() => void run(() => clearCategoryNeed(database, ws, c.id))}>
              Clear mark
            </LineAction>
          )}
```

Give the expense "Every category" panel a footer: `Essential or lifestyle decides what an emergency fund covers and how the Budget splits what you spent. A category with no mark follows its parent, and counts as essential at the top.`

- [ ] **Step 3: E2E, both widths**

```ts
// apps/web/e2e/category-needs.spec.ts — phone-category-needs.spec.ts has the same body
import { expect, test } from '@playwright/test';

test('a parent’s mark reaches its children, a child can keep its own, and clearing hands it back', async ({ page }) => {
  await page.goto('/categories');
  await expect(page.getByTestId('need-Restaurants')).toHaveText('Essential');

  await page.getByRole('button', { name: 'Mark Food and beverage lifestyle' }).click();
  await expect(page.getByTestId('need-Restaurants')).toHaveText('Lifestyle (from parent)');

  await page.getByRole('button', { name: 'Mark School catering essential' }).click();
  await expect(page.getByTestId('need-School catering')).toHaveText('Essential');

  await page.getByRole('button', { name: 'Clear the mark on School catering' }).click();
  await expect(page.getByTestId('need-School catering')).toHaveText('Lifestyle (from parent)');
  await expect(page.getByTestId('need-Groceries')).toHaveText('Essential');
});
```

- [ ] **Step 4: Run** — root gate, `npx playwright test e2e/category-needs.spec.ts e2e/phone-category-needs.spec.ts e2e/category-sets.spec.ts e2e/mcc.spec.ts`. PASS.
- [ ] **Step 5: Commit** — `feat(categories): mark a category essential or lifestyle, and see what it inherits`, trailer.

---

### Task 9: The Budget page — Every, Per month, and what was essential

**Files:**
- Create: `apps/web/src/features/budget/frequency-form.ts`, `apps/web/src/features/budget/frequency-form.test.ts`, `apps/web/e2e/budget-frequency.spec.ts`, `apps/web/e2e/phone-budget-frequency.spec.ts`
- Modify: `apps/web/src/features/budget/BudgetPage.tsx`

**Interfaces:**
- Consumes: `perMonthMinor`, `parseMajor`, `formatMinor`, `saveBudget({ frequency })`, `BudgetRow.frequency/amountAsSetMinor`, `BudgetSheet.essentialActualMinor/lifestyleActualMinor`.
- Produces: `FREQUENCY_WORDS`, `perMonthPreview(typed, frequency, currency): number | null`.

- [ ] **Step 1: Test the helper**

```ts
// apps/web/src/features/budget/frequency-form.test.ts
import { describe, expect, it } from 'vitest';
import { perMonthPreview } from './frequency-form';

describe('the Per month row', () => {
  it('reads the typed figure with parseMajor and converts it once', () => {
    expect(perMonthPreview('500.000', 'weekly', 'IDR')).toBe(2_166_667);
    expect(perMonthPreview('10,00', 'weekly', 'USD')).toBe(4_333);
    expect(perMonthPreview('2.400.000', 'yearly', 'IDR')).toBe(200_000);
  });

  it('shows nothing while the figure cannot be read', () => {
    expect(perMonthPreview('', 'weekly', 'IDR')).toBeNull();
    expect(perMonthPreview('abc', 'weekly', 'IDR')).toBeNull();
    expect(perMonthPreview('10,50', 'weekly', 'IDR')).toBeNull();
  });
});
```

- [ ] **Step 2: The helper**

```ts
// apps/web/src/features/budget/frequency-form.ts
import { type BudgetFrequency, parseMajor, perMonthMinor } from '@expanses/core';

/** The words for each unit. "Monthly amount" is the label the page has always had, so existing specs still find it. */
export const FREQUENCY_WORDS: Record<BudgetFrequency, { every: string; amount: string; per: string }> = {
  daily: { every: 'Day', amount: 'Daily amount', per: 'a day' },
  weekly: { every: 'Week', amount: 'Weekly amount', per: 'a week' },
  monthly: { every: 'Month', amount: 'Monthly amount', per: 'a month' },
  quarterly: { every: 'Quarter', amount: 'Quarterly amount', per: 'a quarter' },
  yearly: { every: 'Year', amount: 'Yearly amount', per: 'a year' },
};

/** What a typed figure comes to a month, or null while it cannot be read. `parseMajor` is the one reader. */
export function perMonthPreview(typed: string, frequency: BudgetFrequency, currency: string): number | null {
  if (typed.trim() === '') return null;
  try {
    return perMonthMinor(parseMajor(typed, currency), frequency);
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: The page**

Imports: `BUDGET_FREQUENCIES, type BudgetFrequency, formatMinor` from `@expanses/core`; `ReadOnlyRow` from the kit; `FREQUENCY_WORDS, perMonthPreview` from `./frequency-form`. State and derived values:

```tsx
  const [frequency, setFrequency] = useState<BudgetFrequency>('monthly');
  // …after `budgets`:
  const asSetOf = new Map((budgets.data ?? []).filter((row) => row.frequency !== 'monthly').map((row) => [row.categoryAccountId, row]));
  const unit: BudgetFrequency = thisMonthOnly ? 'monthly' : frequency;
  const preview = perMonthPreview(amount, unit, planCurrency);
```

In `submit`, the plan branch becomes `await saveBudget(database, ws, { categoryAccountId: target, amountMinor: minor, frequency: unit });` (the override branch is unchanged — always monthly).

In "Cap a category", replace the amount `TextRow`:

```tsx
          {!thisMonthOnly && (
            <SelectRow label="Every" value={frequency} onChange={(e) => setFrequency(e.target.value as BudgetFrequency)}>
              {BUDGET_FREQUENCIES.map((key) => (
                <option key={key} value={key}>
                  {FREQUENCY_WORDS[key].every}
                </option>
              ))}
            </SelectRow>
          )}
          <TextRow label={`${FREQUENCY_WORDS[unit].amount} (${planCurrency})`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" />
          {unit !== 'monthly' && <ReadOnlyRow label="Per month" value={preview === null ? null : formatMinor(preview, planCurrency)} />}
```

`Line` takes `asSetOf: Map<string, BudgetRow>` (passed on to children like the other props). Inside the cap subtitle, after `Cap <Money …/>`:

```tsx
              {asSetOf.get(node.id) && (
                <>
                  {' · '}
                  <Money minor={asSetOf.get(node.id)!.amountAsSetMinor} currency={currency} /> {FREQUENCY_WORDS[asSetOf.get(node.id)!.frequency].per}
                </>
              )}
```

In "This month", after "Spent":

```tsx
          <InsetRow
            title="Essential"
            subtitle="Spending in categories marked essential, or not marked"
            value={
              <span data-testid="essential-spent">
                <Money minor={sheet.essentialActualMinor} currency={currency} />
              </span>
            }
            valueTone="ink"
            chevron={false}
          />
          <InsetRow
            title="Lifestyle"
            subtitle="Spending in categories marked lifestyle"
            value={
              <span data-testid="lifestyle-spent">
                <Money minor={sheet.lifestyleActualMinor} currency={currency} />
              </span>
            }
            valueTone="ink"
            chevron={false}
          />
```

- [ ] **Step 4: E2E — typed key by key**

```ts
// apps/web/e2e/budget-frequency.spec.ts
import { expect, test } from '@playwright/test';

test('a weekly line is shown and counted as 52/12 of a week', async ({ page }) => {
  await page.goto('/budget');
  await page.getByLabel('Category', { exact: true }).selectOption({ label: '— Groceries' });
  await page.getByLabel('Every').selectOption('weekly');
  const amount = page.getByLabel('Weekly amount (IDR)');
  await amount.click();
  await amount.pressSequentially('500000', { delay: 30 });
  await expect(page.getByText('Per month')).toBeVisible();
  await expect(page.locator('body')).toContainText('2.166.667');
  await page.getByRole('button', { name: 'Set budget' }).click();

  await expect(page.getByTestId('caps-total')).toContainText('2.166.667');
  await expect(page.getByTestId('line-Groceries')).toContainText('500.000');
  await expect(page.getByTestId('line-Groceries')).toContainText('a week');
});
```

`phone-budget-frequency.spec.ts`: the same flow with `yearly` and `2400000` typed key by key, asserting `caps-total` contains `200.000` and the line `a year`. (Read the category option's label the way `phone-budget-page.spec.ts` does.)

- [ ] **Step 5: Run** — web vitest, root gate, `npx playwright test e2e/budget-frequency.spec.ts e2e/phone-budget-frequency.spec.ts e2e/budget.spec.ts e2e/phone-budget-page.spec.ts e2e/events.spec.ts e2e/add-transaction.spec.ts`. PASS.
- [ ] **Step 6: Commit** — `feat(budget): an Every picker and a Per month row, and the month split into essential and lifestyle`, trailer.

---

### Task 10: The emergency calculator — two answers and a base, in the native kit

**Files:**
- Create: `apps/web/src/features/goals/emergency-form.ts`, `apps/web/src/features/goals/emergency-form.test.ts`, `apps/web/e2e/emergency-calculator.spec.ts`
- Modify: `apps/web/src/features/goals/Calculator.tsx` (rebuilt on the kit), `apps/web/src/features/calculators/CalculatorsPage.tsx`

**Interfaces:**
- Consumes: `emergencyMonthsFor`, `HOUSEHOLDS`, `INCOME_STABILITIES`, `EmergencyInputs`, `useGoalCalculators`, `saveGoalCalculator`, `createGoalFromCalculator`.
- Produces: `HOUSEHOLD_LABELS`, `INCOME_LABELS`, `EmergencyDraft`, `emergencyDraftFrom(inputs?)`, `withAnswers(draft, patch)`, `typedMonths(draft, months)`, `monthsNote(draft)`, `emergencyInputsOf(draft)`.

- [ ] **Step 1: Test the model**

```ts
// apps/web/src/features/goals/emergency-form.test.ts
import { describe, expect, it } from 'vitest';
import { emergencyDraftFrom, emergencyInputsOf, monthsNote, typedMonths, withAnswers } from './emergency-form';

describe('the emergency months box', () => {
  it('opens on single and salaried, three months, essential', () => {
    expect(emergencyInputsOf(emergencyDraftFrom())).toEqual({ months: 3, household: 'single', income: 'salaried', base: 'essential' });
  });

  it('follows the two answers until a figure is typed', () => {
    let draft = withAnswers(emergencyDraftFrom(), { household: 'children' });
    expect(draft.months).toBe('12');
    draft = withAnswers(draft, { income: 'irregular' });
    expect(draft.months).toBe('24');
    expect(monthsNote(draft)).toBe('24 months · with children, freelance or irregular');

    draft = typedMonths(draft, '9');
    draft = withAnswers(draft, { household: 'single' });
    expect(draft.months).toBe('9');
    expect(monthsNote(draft)).toBe('Your own figure · the guide for single, freelance or irregular is 6');
  });

  it('reads a working saved before the answers existed as the user’s own figure', () => {
    const draft = emergencyDraftFrom({ months: 6 });
    expect(draft.months).toBe('6');
    expect(draft.monthsTyped).toBe(true);
  });

  it('refuses months that are not a number above zero', () => {
    expect(() => emergencyInputsOf(typedMonths(emergencyDraftFrom(), '0'))).toThrow();
  });
});
```

- [ ] **Step 2: The model**

```ts
// apps/web/src/features/goals/emergency-form.ts
import { type EmergencyBase, emergencyMonthsFor, type Household, type IncomeStability } from '@expanses/core';
import type { EmergencyInputs } from '@expanses/db';

export const HOUSEHOLD_LABELS: Record<Household, string> = { single: 'Single', couple: 'Married, no children', children: 'With children' };
export const INCOME_LABELS: Record<IncomeStability, string> = { salaried: 'Salaried', irregular: 'Freelance or irregular' };

export interface EmergencyDraft {
  household: Household;
  income: IncomeStability;
  months: string;
  /** True once the months were typed over: the two answers stop moving them. */
  monthsTyped: boolean;
  base: EmergencyBase;
}

export function emergencyDraftFrom(inputs?: EmergencyInputs): EmergencyDraft {
  const household = inputs?.household ?? 'single';
  const income = inputs?.income ?? 'salaried';
  const guide = emergencyMonthsFor(household, income);
  const months = inputs?.months ?? guide;
  return { household, income, months: String(months), monthsTyped: months !== guide, base: inputs?.base ?? 'essential' };
}

export function withAnswers(draft: EmergencyDraft, patch: { household?: Household; income?: IncomeStability }): EmergencyDraft {
  const next = { ...draft, ...patch };
  return next.monthsTyped ? next : { ...next, months: String(emergencyMonthsFor(next.household, next.income)) };
}

export function typedMonths(draft: EmergencyDraft, months: string): EmergencyDraft {
  return { ...draft, months, monthsTyped: true };
}

/** Which two answers produced the number — or that the number is the user's own. Never an argument. */
export function monthsNote(draft: EmergencyDraft): string {
  const guide = emergencyMonthsFor(draft.household, draft.income);
  const answers = `${HOUSEHOLD_LABELS[draft.household].toLowerCase()}, ${INCOME_LABELS[draft.income].toLowerCase()}`;
  return draft.monthsTyped && Number(draft.months) !== guide ? `Your own figure · the guide for ${answers} is ${guide}` : `${guide} months · ${answers}`;
}

export function emergencyInputsOf(draft: EmergencyDraft): EmergencyInputs {
  const months = Number(draft.months.replace(',', '.'));
  if (!Number.isFinite(months) || months <= 0) throw new Error('Months must be a number above zero');
  return { months, household: draft.household, income: draft.income, base: draft.base };
}
```

- [ ] **Step 3: Rebuild `Calculator.tsx` on the kit**

Replace `Card`, `Field`, `Input`, `Button` with the kit's `InsetGroup`, `TextRow`, `SelectRow`, `InsetRow`. The education and retirement rows keep their labels, defaults and parsing exactly as today (Part 2 replaces them). The emergency part:

```tsx
  const saved = (useGoalCalculators().data ?? []).find((row) => row.goalId === goal.id);
  const [emergency, setEmergency] = useState(() => emergencyDraftFrom(saved?.kind === 'emergency' ? (saved.inputs as EmergencyInputs) : undefined));
  const formRef = useRef<HTMLFormElement>(null);
  // …
    <form ref={formRef} onSubmit={submit}>
      <InsetGroup header={`Work out ${goal.name}`} footer={blurb}>
        {kind === 'emergency' && (
          <>
            <SelectRow label="Household" value={emergency.household} onChange={(e) => setEmergency((d) => withAnswers(d, { household: e.target.value as Household }))}>
              {HOUSEHOLDS.map((key) => (
                <option key={key} value={key}>
                  {HOUSEHOLD_LABELS[key]}
                </option>
              ))}
            </SelectRow>
            <SelectRow label="Income" value={emergency.income} onChange={(e) => setEmergency((d) => withAnswers(d, { income: e.target.value as IncomeStability }))}>
              {INCOME_STABILITIES.map((key) => (
                <option key={key} value={key}>
                  {INCOME_LABELS[key]}
                </option>
              ))}
            </SelectRow>
            <TextRow label="Months of outgoings" hint={monthsNote(emergency)} value={emergency.months} onChange={(e) => setEmergency((d) => typedMonths(d, e.target.value))} inputMode="decimal" />
            <SelectRow label="Counts" value={emergency.base} onChange={(e) => setEmergency((d) => ({ ...d, base: e.target.value as EmergencyBase }))}>
              <option value="essential">Essential spending</option>
              <option value="all">All spending</option>
            </SelectRow>
          </>
        )}
        {/* education and retirement: today's fields as TextRows, today's labels and parsing */}
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow title="Use this amount" chevron={false} disabled={busy} onClick={() => formRef.current?.requestSubmit()} />
        <InsetRow title="Cancel" chevron={false} onClick={onDone} />
      </InsetGroup>
    </form>
```

In `submit`, the emergency `inputs` is `emergencyInputsOf(emergency)`. The emergency blurb: `Months of what you spend, with loan principal added. The amount follows your spending, so it moves when your spending does.`

In `CalculatorsPage.tsx`'s emergency section, replace the `months` state with an `EmergencyDraft` (`useState(() => emergencyDraftFrom())`) and add the same Household, Income and Months rows (no Counts row — the monthly figure there is typed by hand). `emergencyTargetMinor(Number(draft.months), …)` stays the reader; the save passes `emergencyInputsOf(draft)`. Its blurb: `Months of what goes out, loan principal included.`

- [ ] **Step 4: E2E**

```ts
// apps/web/e2e/emergency-calculator.spec.ts
import { expect, test } from '@playwright/test';
import { addTransaction } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('two answers prefill the months, say why, and size the goal on a month of spending', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '1000000' });

  await page.goto('/goals');
  await page.getByRole('button', { name: 'Emergency fund', exact: true }).click();
  await page.getByRole('button', { name: 'Add goal' }).click();
  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await page.getByLabel('Household').selectOption('children');
  await page.getByLabel('Income').selectOption('irregular');
  await expect(page.getByLabel('Months of outgoings')).toHaveValue('24');
  await expect(page.getByText('24 months · with children, freelance or irregular')).toBeVisible();
  await page.getByRole('button', { name: 'Use this amount' }).click();

  // 24 months of Rp 1.000.000 at 0% growth: exactly Rp 24.000.000.
  await expect(page.locator('body')).toContainText('24.000.000');
});
```

- [ ] **Step 5: Run** — web vitest, root gate, `npx playwright test e2e/emergency-calculator.spec.ts e2e/calculators.spec.ts e2e/goals.spec.ts`. PASS.
- [ ] **Step 6: Commit** — `feat(goals): the emergency calculator asks two questions and says which answers gave the months`, trailer.

---

### Task 11: Walk the combinations

**Files:**
- Create: `apps/web/e2e/health-ratios-combinations.spec.ts`, `apps/web/e2e/phone-health-ratios-combinations.spec.ts`

Every figure is typed key by key (`pressSequentially(…, { delay: 30 })`), never with `fill()`, and every assertion is a figure. Shared set-up as local functions in each file: a bank at Rp 20.000.000; Groceries Rp 2.000.000; Restaurants Rp 1.000.000 (so Rp 17.000.000 is left and Rp 3.000.000 went out).

- [ ] **Step 1: The chromium walk** — one `test` per row:

| # | Combination | Expected |
|---|---|---|
| 1 | Nothing marked; the card on Essential, then on All | the same figure both ways: `5,7 months` (17 ÷ 3) |
| 2 | Food and beverage marked lifestyle (Restaurants inherits); Essential | `8,5 months` (17 ÷ 2) |
| 3 | The same marks; All | `5,7 months` |
| 4 | Restaurants given its own mark, essential, under a lifestyle parent; Essential | `5,7 months` |
| 5 | An emergency goal typed by hand, 6 months, with row 2's marks | target `12.000.000` |
| 6 | The same goal worked out with Counts = All | target `18.000.000` |
| 7 | Budget: Groceries weekly 500.000, then **Just this month** 3.000.000 | this month's line `3.000.000`, note still `500.000 a week`; next month `2.166.667` |
| 8 | Budget: Groceries daily 50.000, Utilities weekly 500.000, Transport monthly 900.000, Education quarterly 15.386.000, Personal care yearly 2.400.000 | `caps-total` `9.916.167` — the sum of the converted lines `1.520.833 + 2.166.667 + 900.000 + 5.128.667 + 200.000`, never of the typed ones; no parent of these carries a cap |
| 9 | A workspace that reads in USD: Groceries weekly `10,00` | label `Weekly amount (USD)`; caps total shows 43,33 |
| 10 | Row 2's marks on the Budget page | `essential-spent` `2.000.000`, `lifestyle-spent` `1.000.000` |
| 11 | Holiday, then Emergency fund; Move Holiday up; Move Emergency fund down | the Emergency fund stays in `goals-compulsory`, alone |
| 12 | An emergency goal worked out, closed, reopened | Household, Income and Counts reopen as saved; the months note is unchanged |

(Row 8's category names must be real default names — check them in `packages/core/src/categories/defaults.ts` and choose five with no budgeted ancestor.)

- [ ] **Step 2: The phone walk** — rows 2, 7, 9 and 11 at phone width.
- [ ] **Step 3: Run both specs.** Fix a failure in the task that owns the behaviour, never by loosening the spec.
- [ ] **Step 4: Commit** — `test(e2e): walk the health-ratio combinations at both widths`, trailer.

---

### Task 12: Final gate and the spec walk

- [ ] **Step 1:** From the root `npm run typecheck && npm test && npm run build`; then `cd apps/web && npx playwright test --workers=2` (the whole suite).
- [ ] **Step 2:** `grep -rn "1800\|emergencyIncludesDebtPayments" packages apps/web/src apps/web/e2e` — nothing matches. `grep -rn "\* 4\b\|\* 30\b" packages/core/src/budget` — nothing matches.
- [ ] **Step 3:** Walk the spec's Part-1 sections against the table below; each row's behaviour is on screen and under a test.
- [ ] **Step 4:** Commit any fix-ups with the trailer. Do not merge or push.

## Spec → task map (Part 1)

| Spec section | Task |
|---|---|
| §1 change 1 (done on main) | none — `2e49a12` (ratio, goal) and `0c0602e` (what you can save) |
| §2 debt guide 30% | 4 |
| §3.1 months from two answers, the note | 2, 10 |
| §3.2 essential vs all, principal once, one shared function | 4 (card), 5 (goal) |
| §3.3 benchmark unchanged, no income route | 4 (nothing built) |
| §4.1 mark, inheritance, Categories page | 2, 3, 8 |
| §4.2 readers — flows, card, goal, sheet, workspace copy, refusals | 3, 4, 5, 6 |
| §5 frequency — conversion, storage, refusal, labels, Per month, overrides | 2, 6, 9 |
| §6 compulsory first — sections, funding, moves | 2, 7 |
| §7 30%, neutral copy, `emergencyBase`, header wording | 4 |
| §13 migration 0053, guard | 1 |
| §14 tests | every task |
| §15 combinations (Part-1 rows) | 11 |
| §2 retirement growth, §8–§12 | Part 2 (`2026-09-21-health-ratios-calculators.md`) |
