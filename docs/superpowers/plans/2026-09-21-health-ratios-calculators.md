# Health ratios, part 2 — horizon returns, calculators in today's money, education levels, life cover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prefill every assumed return from the four horizon bands (≤1y 4%, 1–3y 5%, 3–5y 6%, >5y 8%) and the agreed retirement figures (inflation 3.5%, 10% while saving, 5% while retired); make every calculator write its stages **in today's money** with the inflation it assumed as the goal's growth, so the goal engine inflates once instead of twice; replace the one-fee education calculator with user-named levels, once/yearly fees, ages against a birthday and a return per level; upgrade goals worked out before this; and add a capital-needs life cover calculator.

**Architecture:** No new migration — Part 1's **0053** already made `goal_stage_terms` (a stage's own return and its calculator key). Pure maths in `packages/core`: `goals/assumptions.ts` (bands, defaults), `presentValueOfYearsMinor` (the one real-rate annuity; retirement and life cover both call it), `retirementTodayMinor`, `lifeCoverMinor`, `educationPlanStages`/`educationFromV1`, and `goalPlan` reading `stage.returnBps`. In `packages/db`, `saveGoal` splits into `saveGoalTx` (returns stage ids) and the calculator writes goal, stages, terms and working in **one transaction**, keeping stage ids and paid marks by key. `upgradeCalculatorGoals` runs once on open. The web side is one `EducationEditor` used by both the goal's calculator and the Calculators page, and a Life cover section prefilled from `balanceSheet` through a new `sheetTotals` shared with the net-worth page.

**Tech Stack:** as Part 1 — TypeScript monorepo, Drizzle over sqlite-proxy, React 19, TanStack Query, Tailwind 4, Vitest, Playwright (`chromium`, `phone`).

**Spec:** `docs/superpowers/specs/2026-09-21-health-ratios-design.md` — §§2 (retirement growth), 8–12, and §15's calculator rows. **Depends on Part 1** (`2026-09-21-health-ratios.md`) being merged: migration 0053, `healthTablesExist`, `goalStageTerms`, `emergencyDraftFrom`, the kit-built `Calculator.tsx`.

**Rulings carried:** the emergency template keeps 2% and stays outside the bands (Q4); existing derived goals are re-worked silently **only when the figure changes**, and a goal whose target was typed by hand is never touched (Q6); with no birthday, a level's years fall on 1 January and the level's row subtitle says so (Q7).

**User decisions (2026-09-21), built here:**
- **Part 2 Q1 — yes:** on open, a level whose return was never typed re-reads its band for the months left until it starts (Task 7, `refreshBandReturns` inside `upgradeCalculatorGoals`). A typed return is never touched.
- **Part 2 Q2 — yes:** the life-cover inputs are remembered in `goal_calculators.inputs_json` with **no schema change** (Task 10). Because 0017's `kind` CHECK allows only emergency/education/retirement and its `goal_id` is the key, the row is a reserved one — `goal_id = 'life-cover:' || workspace_id`, `kind = 'retirement'`, `inputs_json = { "calculator": "life_cover", "version": 2, … }` — which every goal reader skips (`isLifeCoverRow`). The clean alternative (widen the CHECK) is a table rebuild in 0055; not taken.
- **Part 2 Q3 — accepted:** `computed_minor` for retirement now holds the pot in today's money, not on the day you stop. Nothing outside the repo reads it (local-first, no server).

## Global Constraints

- **No new migration.** Everything stored here fits 0053's `goal_stage_terms` and `goal_calculators.inputs_json`. If a task finds a schema change unavoidable, it stops and uses **0055** — never 0050–0054.
- **No new columns on existing tables** (`goals`, `goal_stages`, `goal_calculators`, `accounts`, …). Every read and write of `goal_stage_terms` goes through `healthTablesExist(db)`; without it a stage has no own return and paid marks are matched by position.
- **Money is integer minor units.** A stage's target is **today's money** — the contract `GoalStage.targetMinor` already documents — and `goalPlan` alone inflates it, once, by `goal.growthBps`. No calculator writes a future figure into a stage again.
- **One annuity per shape.** Every monthly figure goes through `monthlyNeededMinor` (`r·gap / ((1+r)^n − 1)`); every drawdown pot and income need through `presentValueOfYearsMinor`. Nothing writes its own annuity. The workbook's PMT, with −1 outside the power, is not reproduced anywhere.
- **No float money in the new annuity.** `presentValueOfYearsMinor` is exact: with I = 10000 + inflation bps and R = 10000 + return bps, (1 + real) = R ÷ I is rational, so for whole years n the pot is `A·I·(Rⁿ − Iⁿ) ÷ (Rⁿ·(R − I))` in BigInt, rounded once with `divRound` (half away from zero); `A·n` when R = I. Years must be whole (a `CalculatorError` otherwise). Inflating a figure to a date stays `futureValueMinor` — the goal engine's own reader — so the page and the goal cannot disagree.
- **Sum signed, then clamp.** Life cover is `needs − resources`, clamped at 0 after the sum, with the surplus reported — never a negative cover and never `Math.abs` on a term.
- **18% appears nowhere**, and no prefill is above 10%. A test asserts every constant and band.
- **Call the existing readers:** `goalPlan`, `futureValueMinor`, `monthlyNeededMinor`, `monthsUntil`, `savingPlanFor`, `balanceSheet`, `useSheet`, `useGoalPlans`, `useGoalCalculators`, `parseMajor`, `formatMinor`, `saveGoalTx`, `listGoals`. Grep before writing a new name.
- **Hand edits win.** `saveGoal` without `derived` still breaks the calculator link, and now also clears that goal's `goal_stage_terms`. The upgrade only visits goals that still have a `goal_calculators` row.
- **Every screen from the native kit** (`apps/web/src/ui/native/`, `/design-kit`, `.superpowers/design-audit/primitives.md`); tokens only, dark mode included; no new visual treatment. `GoalForm` stays on its old components — only its return logic changes (spec §16).
- **Desktop never weakened**; every row reachable by keyboard.
- **Country-neutral copy.** Bands name instrument *kinds* ("money market funds, deposits"), never a country's product names; no regulator or benefit named in UI copy. Life cover builds no benefit offset and no rider calculator.
- Inside `database.transaction((tx) => …)` use `tx` only.
- Tests discriminate: a figure that the nearest wrong neighbour (double inflation, drawdown return used for saving, min-of-methods, a once fee spread over years, a floor for a round) gets wrong.
- Branch `feat/health-ratios` (continuing Part 1). Commit per task with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Gate before every commit:** root `npm run typecheck`, `npm test`, `npm run build`; the task's Playwright specs. Full suite in Task 12.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/goals/assumptions.ts` | `DEFAULT_INFLATION_BPS`, `RETIREMENT_RETURN_BPS`, `DRAWDOWN_RETURN_BPS`, `EDUCATION_INFLATION_BPS`, `EMERGENCY_RETURN_BPS`, `RETURN_BANDS`, `returnBandFor`, `assumedReturnBps`, `bandHint` |
| `packages/core/src/budget/calculators.ts` | `presentValueOfYearsMinor`, `retirementTodayMinor`, `RetirementInputs.returnBeforeBps`, `lifeCoverMinor`; `educationStages` removed in Task 10 |
| `packages/core/src/budget/education.ts` | `EducationPlanInputs`, `EducationLevel`, `EducationFee`, `educationPlanStages`, `levelStartsOn`, `educationFromV1`, `OFFERED_LEVELS`, `DEFAULT_FEES` |
| `packages/core/src/goals/plan.ts` | `GoalStage.returnBps`; `goalPlan` uses a stage's own return |
| `packages/core/src/assets/health.ts` | `sheetTotals(sheet)` |
| `packages/db/src/repos/goals.ts` | `saveGoalTx`; stage returns read and cleared |
| `packages/db/src/repos/goal-calculators.ts` | v2 inputs; today's-money stages; growth/return written; ids and paid marks by key; one transaction; `upgradeCalculatorGoals` |
| `apps/web/src/db/bootstrap.ts` | runs `upgradeCalculatorGoals` on open |
| `apps/web/src/features/goals/goal-cards.ts` | templates' returns from the bands; `prefilledReturnBps` |
| `apps/web/src/features/goals/GoalForm.tsx` | the return follows the first stage's date until typed |
| `apps/web/src/features/goals/education-model.ts` (+ `.test.ts`) | drafts ↔ `EducationPlanInputs` |
| `apps/web/src/features/goals/EducationEditor.tsx` | levels, fees, ages or years, a return per level |
| `apps/web/src/features/goals/Calculator.tsx` | education through the editor; retirement's three rates |
| `apps/web/src/features/calculators/CalculatorsPage.tsx` | education through the editor; retirement fix; Life cover |
| `apps/web/src/features/calculators/life-cover-form.ts` (+ `.test.ts`) | prefills and parsing for Life cover |
| `apps/web/src/features/networth/OverviewPage.tsx` | uses `sheetTotals` |
| Tests | core `assumptions.test.ts`, `calculators.test.ts`, `education.test.ts`, `goals-plan.test.ts`; db `goals.test.ts`, `goal-calculators.test.ts`, `calculator-upgrade.test.ts`; web `goal-cards.test.ts`; e2e `education-calculator.spec.ts`, `phone-education-calculator.spec.ts`, `life-cover.spec.ts`, `calculators.spec.ts`, `calculators-combinations.spec.ts`, `phone-calculators-combinations.spec.ts` |

---

### Task 1: The assumptions — bands and defaults

**Files:**
- Create: `packages/core/src/goals/assumptions.ts`, `packages/core/test/assumptions.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `DEFAULT_INFLATION_BPS = 350`, `RETIREMENT_RETURN_BPS = 1000`, `DRAWDOWN_RETURN_BPS = 500`, `EDUCATION_INFLATION_BPS = 1000`, `EMERGENCY_RETURN_BPS = 200`; `ReturnBand`; `RETURN_BANDS`; `returnBandFor(months)`; `assumedReturnBps(months)`; `bandHint(band)`.

- [ ] **Step 1: The failing test**

```ts
// packages/core/test/assumptions.test.ts
import { describe, expect, it } from 'vitest';
import {
  assumedReturnBps, bandHint, DEFAULT_INFLATION_BPS, DRAWDOWN_RETURN_BPS, EDUCATION_INFLATION_BPS, EMERGENCY_RETURN_BPS,
  RETIREMENT_RETURN_BPS, RETURN_BANDS, returnBandFor,
} from '../src/index';

describe('the assumed return by horizon', () => {
  it.each([
    [1, 400], [12, 400], [13, 500], [36, 500], [37, 600], [60, 600], [61, 800], [240, 800],
  ])('%i months away prefills %i bps', (months, bps) => {
    expect(assumedReturnBps(months)).toBe(bps);
  });

  it('names the band and its range in the hint, and says it is a fund figure', () => {
    expect(bandHint(returnBandFor(48))).toBe('6% · 3 to 5 years · typically 5–7%, net of fund fees; a deposit taxed at source earns less');
  });
});

describe('no prefill is a fantasy', () => {
  it('keeps every default and every band at or below 10%, and 18% nowhere', () => {
    const all = [
      DEFAULT_INFLATION_BPS, RETIREMENT_RETURN_BPS, DRAWDOWN_RETURN_BPS, EDUCATION_INFLATION_BPS, EMERGENCY_RETURN_BPS,
      ...RETURN_BANDS.flatMap((band) => [band.returnBps, band.lowBps, band.highBps]),
    ];
    expect(Math.max(...all)).toBeLessThanOrEqual(1000);
    expect(all).not.toContain(1800);
  });

  it('pairs 10% while saving with 3.5% inflation — a real return near 6.3%, not 1.9%', () => {
    const real = (1 + RETIREMENT_RETURN_BPS / 10_000) / (1 + DEFAULT_INFLATION_BPS / 10_000) - 1;
    expect(real).toBeCloseTo(0.0628, 4);
  });
});
```

- [ ] **Step 2: Run, see it fail** — `cd packages/core && npx vitest run test/assumptions.test.ts`.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/goals/assumptions.ts
/**
 * The figures a calculator or a goal opens with. Every one is a prefill the user can overwrite; none is a rule.
 * Sourced in research-returns-by-horizon.md (2026-09-19), never in the user's own workbook — whose 18% is a window
 * that starts at the 1997/98 crisis trough and is nine years stale.
 */
export const DEFAULT_INFLATION_BPS = 350;
/** While saving for retirement: 6.28% real against 3.5% inflation. Never raise it without checking the inflation beside it. */
export const RETIREMENT_RETURN_BPS = 1000;
/** Once drawing down: de-risked, so lower. Also the payout's return in life cover. */
export const DRAWDOWN_RETURN_BPS = 500;
/** Fees rise faster than prices. */
export const EDUCATION_INFLATION_BPS = 1000;
/** An emergency fund sits in savings or a deposit, outside the horizon bands. */
export const EMERGENCY_RETURN_BPS = 200;

export interface ReturnBand {
  /** The band covers horizons up to this many months; null for the last, open-ended one. */
  upToMonths: number | null;
  returnBps: number;
  lowBps: number;
  highBps: number;
  label: string;
}

/** Boundaries at 1, 3 and 5 years. Nominal, net of fund fees, before any tax of the investor's own. */
export const RETURN_BANDS: readonly ReturnBand[] = [
  { upToMonths: 12, returnBps: 400, lowBps: 350, highBps: 500, label: '1 year or less' },
  { upToMonths: 36, returnBps: 500, lowBps: 450, highBps: 600, label: '1 to 3 years' },
  { upToMonths: 60, returnBps: 600, lowBps: 500, highBps: 700, label: '3 to 5 years' },
  { upToMonths: null, returnBps: 800, lowBps: 600, highBps: 1000, label: 'more than 5 years' },
];

export function returnBandFor(months: number): ReturnBand {
  return RETURN_BANDS.find((band) => band.upToMonths === null || months <= band.upToMonths)!;
}

export function assumedReturnBps(months: number): number {
  return returnBandFor(months).returnBps;
}

const pct = (bps: number) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}`;

export function bandHint(band: ReturnBand): string {
  return `${pct(band.returnBps)}% · ${band.label} · typically ${pct(band.lowBps)}–${pct(band.highBps)}%, net of fund fees; a deposit taxed at source earns less`;
}
```

Export all of it from `packages/core/src/index.ts`.

- [ ] **Step 4: Run** — test file, root gate. PASS.
- [ ] **Step 5: Commit** — `feat(core): the assumed return by horizon, and the retirement figures, as prefills`, trailer.

---

### Task 2: One annuity; retirement in today's money; life cover

**Files:**
- Modify: `packages/core/src/budget/calculators.ts`, `packages/core/src/index.ts`, `packages/core/test/calculators.test.ts`

**Interfaces:**
- Consumes: `divRound` (`../assets/units`, internal), `futureValueMinor`.
- Produces: `presentValueOfYearsMinor(annualTodayMinor, years, inflationBps, returnBps): number`; `RetirementInputs` gains `returnBeforeBps?: number` and `version?: 2`; `retirementTodayMinor(inputs): number`; `retirementTargetMinor` (unchanged values); `LifeCoverInputs`, `LifeCover`, `lifeCoverMinor(inputs)`.

- [ ] **Step 1: Tests** (append to `calculators.test.ts`; the existing retirement tests stay and must still pass unchanged)

```ts
describe('the one real-rate annuity', () => {
  it('discounts at the real rate: 120 jt a year for 10 years at 3.5% inflation and 5% return', () => {
    expect(presentValueOfYearsMinor(120_000_000, 10, 350, 500)).toBe(1_109_641_927);
  });

  it('is plain years times the amount when the return only keeps pace', () => {
    expect(presentValueOfYearsMinor(120_000_000, 10, 500, 500)).toBe(1_200_000_000);
  });

  it('is nothing for no years', () => {
    expect(presentValueOfYearsMinor(120_000_000, 0, 350, 500)).toBe(0);
  });

  it('refuses part of a year: the exact method is for whole years', () => {
    expect(() => presentValueOfYearsMinor(120_000_000, 10.5, 350, 500)).toThrow(CalculatorError);
  });

  it('discounts at the real rate, not the nominal one or the plain difference', () => {
    // Discounting at the nominal 5% gives 926.608.192; at the plain 1,5% difference, 1.106.662.146 — both wrong.
    expect(presentValueOfYearsMinor(120_000_000, 10, 350, 500)).toBe(1_109_641_927);
    expect(presentValueOfYearsMinor(3_000_000, 5, 350, 500)).toBe(14_369_257);
  });
});

describe('retirement in today’s money', () => {
  const inputs = { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnInRetirementBps: 500 };

  it('is the drawdown annuity of today’s spending', () => {
    expect(retirementTodayMinor(inputs)).toBe(2_070_575_495);
  });

  it('inflated by the goal engine to the day you stop, is the pot the old figure named', () => {
    expect(retirementTargetMinor(inputs)).toBe(4_120_008_061);
    expect(futureValueMinor(retirementTodayMinor(inputs), 350, 240)).toBe(4_120_008_061);
  });

  it('is the figure the goal engine will show, to the minor unit', () => {
    // The old one-step float said 4.800.099.137. The pot is now rounded once in today's money and inflated by
    // futureValueMinor — exactly what goalPlan does to the stored stage — so page and goal agree: 4.800.099.136.
    const other = { ...inputs, inflationBps: 500, returnInRetirementBps: 800 };
    expect(retirementTargetMinor(other)).toBe(4_800_099_136);
    expect(retirementTargetMinor(other)).toBe(futureValueMinor(retirementTodayMinor(other), 500, 240));
  });
});

describe('life cover — capital needs', () => {
  const base = {
    annualNeedTodayMinor: 120_000_000, yearsOfSupport: 10, inflationBps: 350, returnBps: 500,
    debtsMinor: 300_000_000, educationMinor: 150_000_000, finalExpensesMinor: 25_000_000,
    liquidAssetsMinor: 200_000_000, inForceCoverMinor: 500_000_000,
  };

  it('adds every need once and takes every resource off once', () => {
    const cover = lifeCoverMinor(base);
    expect(cover.incomeNeedMinor).toBe(1_109_641_927);
    expect(cover.needsMinor).toBe(1_584_641_927);
    expect(cover.resourcesMinor).toBe(700_000_000);
    // Adding the debts again after the fact, as the workbook did, would say 1_184_641_927.
    expect(cover.coverMinor).toBe(884_641_927);
    expect(cover.surplusMinor).toBe(0);
  });

  it('says no further cover is needed, and by how much, when resources exceed needs', () => {
    const cover = lifeCoverMinor({ ...base, liquidAssetsMinor: 2_000_000_000 });
    expect(cover.coverMinor).toBe(0);
    expect(cover.surplusMinor).toBe(915_358_073);
  });

  it('works in cents', () => {
    expect(lifeCoverMinor({ ...base, annualNeedTodayMinor: 3_000_000, yearsOfSupport: 5, debtsMinor: 0, educationMinor: 0, finalExpensesMinor: 0, liquidAssetsMinor: 0, inForceCoverMinor: 0 }).coverMinor).toBe(14_369_257);
  });

  it('refuses an amount below nothing', () => {
    expect(() => lifeCoverMinor({ ...base, debtsMinor: -1 })).toThrow(CalculatorError);
  });
});
```

Import `futureValueMinor`, `lifeCoverMinor`, `presentValueOfYearsMinor`, `retirementTodayMinor` in the test.

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement** in `calculators.ts`:

```ts
/**
 * The annuity of a yearly amount in today's money, at the real rate: what a pot must hold to pay it for `years`.
 *
 * Exact, not floating point. The real growth factor is R ÷ I (R = 10000 + return bps, I = 10000 + inflation bps), so
 * Σ_{k=1}^{n} (I/R)^k = I·(Rⁿ − Iⁿ) ÷ (Rⁿ·(R − I)); multiplied by the amount and divided once, in BigInt, with
 * `divRound` (half away from zero). Each year is drawn at its end, as the old retirementTargetMinor assumed.
 */
export function presentValueOfYearsMinor(annualTodayMinor: number, years: number, inflationBps: number, returnBps: number): number {
  if (!Number.isSafeInteger(annualTodayMinor)) throw new CalculatorError('An amount is a whole number of minor units');
  if (!Number.isInteger(years) || years < 0) throw new CalculatorError('Years are whole years, not below nothing');
  if (!Number.isInteger(inflationBps) || !Number.isInteger(returnBps)) throw new CalculatorError('Rates are whole basis points');
  if (years === 0) return 0;
  const i = 10_000n + BigInt(inflationBps);
  const r = 10_000n + BigInt(returnBps);
  const amount = BigInt(annualTodayMinor);
  // Earning exactly what prices do: every year has to be there in full.
  if (i === r) return Number(amount * BigInt(years));
  const n = BigInt(years);
  return Number(divRound(amount * i * (r ** n - i ** n), r ** n * (r - i)));
}

export interface RetirementInputs {
  version?: 2;
  annualSpendTodayMinor: number;
  yearsToRetirement: number;
  yearsInRetirement: number;
  inflationBps: number;
  /** What the pot earns while it is being drawn down. */
  returnInRetirementBps: number;
  /** What the money earns while you are still saving it. Written as the goal's return. */
  returnBeforeBps?: number;
}

function checkRetirement(inputs: RetirementInputs): void {
  assertAbove(inputs.annualSpendTodayMinor, 0, 'Annual spending');
  assertAbove(inputs.yearsInRetirement, 0, 'The number of years in retirement');
  if (inputs.yearsToRetirement < 0) throw new CalculatorError('Retirement cannot be in the past');
}

/** The pot needed on the day you stop, in today's money. The goal engine inflates it to that day. */
export function retirementTodayMinor(inputs: RetirementInputs): number {
  checkRetirement(inputs);
  return presentValueOfYearsMinor(inputs.annualSpendTodayMinor, inputs.yearsInRetirement, inputs.inflationBps, inputs.returnInRetirementBps);
}

/**
 * The same pot in the money of the day you stop — for showing, never for storing in a stage. Inflated by the goal
 * engine's own reader, so the Calculators page shows exactly what the goal will.
 */
export function retirementTargetMinor(inputs: RetirementInputs): number {
  return futureValueMinor(retirementTodayMinor(inputs), inputs.inflationBps, Math.round(inputs.yearsToRetirement * 12));
}

export interface LifeCoverInputs {
  /** What the family would need each year, at today's prices. */
  annualNeedTodayMinor: number;
  yearsOfSupport: number;
  inflationBps: number;
  /** What the payout earns while it is spent down. */
  returnBps: number;
  debtsMinor: number;
  educationMinor: number;
  finalExpensesMinor: number;
  liquidAssetsMinor: number;
  inForceCoverMinor: number;
}

export interface LifeCover {
  incomeNeedMinor: number;
  needsMinor: number;
  resourcesMinor: number;
  coverMinor: number;
  surplusMinor: number;
}

/**
 * Capital needs analysis: every need at death, minus what is already there. Debts are added and assets taken off
 * inside the method, once — never again afterwards, and never the lowest of several methods.
 */
export function lifeCoverMinor(inputs: LifeCoverInputs): LifeCover {
  const amounts = [inputs.annualNeedTodayMinor, inputs.debtsMinor, inputs.educationMinor, inputs.finalExpensesMinor, inputs.liquidAssetsMinor, inputs.inForceCoverMinor];
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) throw new CalculatorError('Amounts are whole minor units, not below nothing');
  if (!Number.isFinite(inputs.yearsOfSupport) || inputs.yearsOfSupport < 0) throw new CalculatorError('Years of support cannot be below nothing');
  const incomeNeedMinor = presentValueOfYearsMinor(inputs.annualNeedTodayMinor, inputs.yearsOfSupport, inputs.inflationBps, inputs.returnBps);
  const needsMinor = incomeNeedMinor + inputs.debtsMinor + inputs.educationMinor + inputs.finalExpensesMinor;
  const resourcesMinor = inputs.liquidAssetsMinor + inputs.inForceCoverMinor;
  const gap = needsMinor - resourcesMinor;
  return { incomeNeedMinor, needsMinor, resourcesMinor, coverMinor: Math.max(0, gap), surplusMinor: Math.max(0, -gap) };
}
```

Delete the old body of `retirementTargetMinor` (it is replaced above). Export the new names. The existing retirement tests keep their figures: `yearsToRetirement: 0` inflates by nothing, and `Math.round(2_400_000_000 * 1.05 ** 20)` is `futureValueMinor(2_400_000_000, 500, 240)` (both 6.367.914.492 — verified). `CalculatorsPage`/`Calculator` must pass whole years (`Math.round` of what was typed is not allowed — a fractional year shows the refusal).

- [ ] **Step 4: Run** — test file, root gate. PASS.
- [ ] **Step 5: Commit** — `feat(core): one real-rate annuity for retirement and life cover, and retirement in today's money`, trailer.

---

### Task 3: A stage's own return in the goal engine

**Files:**
- Modify: `packages/core/src/goals/plan.ts`, `packages/core/test/goals-plan.test.ts`

**Interfaces:**
- Produces: `GoalStage.returnBps?: number | null`; `goalPlan` uses `stage.returnBps ?? goal.returnBps` for that stage's growth of what is held, its carry, and its monthly figure.

- [ ] **Step 1: Tests** (append; build goals the way the file already does)

```ts
describe('a stage with a return of its own', () => {
  const TODAY = '2026-09-21';
  const base: Goal = { id: 'g', name: 'School', kind: 'education', rank: 0, growthBps: 0, returnBps: 800, standingMonthlyMinor: 0, standingNote: null, stages: [] };
  const link = (baseMinor: number): GoalLink => ({ accountId: 'a', name: 'Savings', kind: 'earmark', unitsMicro: null, valueMinor: baseMinor, currency: 'IDR', baseMinor, risk: null });

  it('saves for that stage at its own return, not the goal’s', () => {
    const stage = { id: 's1', name: 'Preschool', targetMinor: 12_000_000, targetMonths: null, dueOn: '2027-09-21', paidOn: null };
    expect(goalPlan({ ...base, stages: [{ ...stage, returnBps: 400 }] }, [], 0, 0, TODAY).requiredMonthlyMinor).toBe(981_799);
    expect(goalPlan({ ...base, stages: [stage] }, [], 0, 0, TODAY).requiredMonthlyMinor).toBe(963_861);
  });

  it('carries what is left after a covered stage at that stage’s return', () => {
    const plan = goalPlan(
      {
        ...base,
        stages: [
          { id: 's1', name: 'Preschool', targetMinor: 5_000_000, targetMonths: null, dueOn: '2027-09-21', paidOn: null, returnBps: 400 },
          { id: 's2', name: 'Primary', targetMinor: 20_000_000, targetMonths: null, dueOn: '2028-09-21', paidOn: null },
        ],
      },
      [link(10_000_000)],
      0,
      0,
      TODAY,
    );
    // 10 jt at 4% is 10,4 jt; 5,4 jt left, 5.192.308 in today's money, then grown at the goal's 8%.
    // Carrying at 8% instead would leave 5.370.370 and ask 529.669.
    expect(plan.stages[0]!.state).toBe('covered');
    expect(plan.requiredMonthlyMinor).toBe(537_677);
  });
});
```

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement**

In `GoalStage` add:

```ts
  /** What money for this stage is expected to earn, when it differs from the goal's (an education level's). */
  returnBps?: number | null;
```

In `goalPlan`'s loop, after `row` is built:

```ts
    const rate = stage.returnBps ?? goal.returnBps;
```

and replace the three uses of `goal.returnBps` inside the loop with `rate` (`futureValueMinor(carryMinor, rate, months)`, `yearlyFactor(rate, months)`, `monthlyNeededMinor(…, rate, months)`).

- [ ] **Step 4: Run** — file, root gate. PASS.
- [ ] **Step 5: Commit** — `feat(goals): a stage can carry a return of its own`, trailer.

---

### Task 4: Education levels — the pure model

**Files:**
- Create: `packages/core/src/budget/education.ts`, `packages/core/test/education.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `assumedReturnBps`, `monthsUntil`, `CalculatorError`, `EducationInputs` (v1, from `calculators.ts`).
- Produces: `FeeCharge`, `EducationFee`, `EducationLevel`, `EducationPlanInputs`, `EducationStage`, `OFFERED_LEVELS`, `DEFAULT_FEES`, `levelStartsOn(level, birthday)`, `educationPlanStages(inputs, today)`, `educationFromV1(v1, computedOn)`.

- [ ] **Step 1: Tests**

```ts
// packages/core/test/education.test.ts
import { describe, expect, it } from 'vitest';
import { CalculatorError, educationFromV1, type EducationPlanInputs, educationPlanStages, type Goal, goalPlan } from '../src/index';

const fee = (id: string, amountTodayMinor: number, charged: 'once' | 'yearly') => ({ id, name: id, amountTodayMinor, charged });
const primary = (overrides = {}) => ({
  id: 'primary', name: 'Primary School', startAge: null, untilAge: null, startYear: 2032, untilYear: 2038,
  fees: [fee('Enrollment', 45_000_000, 'once'), fee('Academic', 20_000_000, 'yearly')], returnBps: null, ...overrides,
});
const plan = (levels: EducationPlanInputs['levels'], birthday: string | null = null): EducationPlanInputs => ({ version: 2, birthday, feeInflationBps: 1200, levels });

describe('a level’s years', () => {
  it('puts a once fee in the first year only and a yearly fee in every year, in today’s money', () => {
    const stages = educationPlanStages(plan([primary()]), '2026-01-01');
    expect(stages.map((stage) => stage.targetTodayMinor)).toEqual([65_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000]);
    expect(stages.map((stage) => stage.dueOn)).toEqual(['2032-01-01', '2033-01-01', '2034-01-01', '2035-01-01', '2036-01-01', '2037-01-01']);
    expect(stages[0]).toMatchObject({ key: 'primary:0', name: 'Primary School · year 1' });
  });

  it('comes to the mockup’s figure once the goal engine inflates each year to its own date', () => {
    const stages = educationPlanStages(plan([primary()]), '2026-01-01');
    const goal: Goal = {
      id: 'g', name: 'Aisha', kind: 'education', rank: 0, growthBps: 1200, returnBps: 800, standingMonthlyMinor: 0, standingNote: null,
      stages: stages.map((stage) => ({ id: stage.key, name: stage.name, targetMinor: stage.targetTodayMinor, targetMonths: null, dueOn: stage.dueOn, paidOn: null })),
    };
    // 88.822.021 for the once fee plus 320.358.885 for six yearly fees. Pricing all six at the first year's
    // price, as the workbook does, gives 325.680.745.
    expect(goalPlan(goal, [], 0, 0, '2026-01-01').totalTargetMinor).toBe(409_180_906);
  });

  it('dates years by the child’s birthday when there is one', () => {
    const stages = educationPlanStages(plan([primary({ startAge: 6, untilAge: 8, startYear: null, untilYear: null })], '2020-07-15'), '2026-01-01');
    expect(stages.map((stage) => stage.dueOn)).toEqual(['2026-07-15', '2027-07-15']);
  });

  it('prefills a level’s return from the band for the months until it starts, unless one was chosen', () => {
    expect(educationPlanStages(plan([primary()]), '2026-01-01')[0]!.returnBps).toBe(800); // 72 months
    expect(educationPlanStages(plan([primary({ startYear: 2028, untilYear: 2029 })]), '2026-01-01')[0]!.returnBps).toBe(500); // 24 months
    expect(educationPlanStages(plan([primary({ returnBps: 450 })]), '2026-01-01')[0]!.returnBps).toBe(450);
  });

  it('raises the total when a level is added, leaving the first level’s stages and keys as they were', () => {
    const one = educationPlanStages(plan([primary()]), '2026-01-01');
    const two = educationPlanStages(plan([primary(), { ...primary(), id: 'middle', name: 'Middle School', startYear: 2038, untilYear: 2041 }]), '2026-01-01');
    expect(two.slice(0, one.length)).toEqual(one);
    expect(two.length).toBe(one.length + 3);
  });

  it('refuses a level that ends before it starts, or has nothing to pay', () => {
    expect(() => educationPlanStages(plan([primary({ untilYear: 2032 })]), '2026-01-01')).toThrow(CalculatorError);
    expect(() => educationPlanStages(plan([primary({ fees: [] })]), '2026-01-01')).toThrow(CalculatorError);
    expect(() => educationPlanStages(plan([primary({ startAge: 6, untilAge: 12, startYear: null, untilYear: null })], null), '2026-01-01')).toThrow(/birthday/);
  });
});

describe('a working from before levels', () => {
  it('becomes one yearly-fee level in calendar years from the day it was worked out', () => {
    expect(educationFromV1({ feeTodayMinor: 100_000_000, startsInYears: 10, yearsOfStudy: 4, feeInflationBps: 1000 }, '2026-09-13')).toEqual({
      version: 2,
      birthday: null,
      feeInflationBps: 1000,
      levels: [{ id: 'course', name: 'Course', startAge: null, untilAge: null, startYear: 2036, untilYear: 2040, returnBps: null, fees: [{ id: 'fee', name: 'Fee', amountTodayMinor: 100_000_000, charged: 'yearly' }] }],
    });
  });
});
```

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement**

```ts
// packages/core/src/budget/education.ts
import { assumedReturnBps } from '../goals/assumptions';
import { monthsUntil } from '../goals/plan';
import { CalculatorError, type EducationInputs } from './calculators';

export type FeeCharge = 'once' | 'yearly';

export interface EducationFee {
  id: string;
  name: string;
  amountTodayMinor: number;
  /** Load-bearing: a once fee is paid in the level's first year only; a yearly fee in every year of it. */
  charged: FeeCharge;
}

export interface EducationLevel {
  id: string;
  name: string;
  /** Ages against the goal's birthday — or, with no birthday, calendar years. Never "in N years", which goes stale. */
  startAge: number | null;
  untilAge: number | null;
  startYear: number | null;
  untilYear: number | null;
  fees: EducationFee[];
  /** Chosen for this level; null follows the band for the months until it starts. */
  returnBps: number | null;
}

export interface EducationPlanInputs {
  version: 2;
  birthday: string | null;
  feeInflationBps: number;
  levels: EducationLevel[];
}

export interface EducationStage {
  /** `${levelId}:${year}` — how a re-worked goal finds the same stage, and its paid mark, again. */
  key: string;
  levelId: string;
  name: string;
  dueOn: string;
  /** In today's money: the goal engine inflates it to `dueOn` at the goal's growth. */
  targetTodayMinor: number;
  returnBps: number;
}

export const OFFERED_LEVELS = ['Preschool', 'Primary School', 'Middle School', 'High School', 'University'] as const;
export const DEFAULT_FEES: readonly { name: string; charged: FeeCharge }[] = [
  { name: 'Enrollment', charged: 'once' },
  { name: 'Academic', charged: 'yearly' },
  { name: 'Other', charged: 'once' },
];

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

function span(level: EducationLevel, birthday: string | null): { first: string; years: number; dueOf: (i: number) => string } {
  if (level.startAge !== null && level.untilAge !== null) {
    if (!birthday) throw new CalculatorError(`${level.name} is set by age, which needs the child's birthday`);
    const [y, m, d] = birthday.split('-').map(Number);
    const years = level.untilAge - level.startAge;
    if (!(years >= 1)) throw new CalculatorError(`${level.name} has to end after it starts`);
    const dueOf = (i: number) => iso(y! + level.startAge! + i, m!, d!);
    return { first: dueOf(0), years, dueOf };
  }
  if (level.startYear === null || level.untilYear === null) throw new CalculatorError(`${level.name} needs a start and an end`);
  const years = level.untilYear - level.startYear;
  if (!(years >= 1)) throw new CalculatorError(`${level.name} has to end after it starts`);
  // With no birthday, a level's year falls on 1 January — the level's row says so.
  const dueOf = (i: number) => iso(level.startYear! + i, 1, 1);
  return { first: dueOf(0), years, dueOf };
}

export function levelStartsOn(level: EducationLevel, birthday: string | null): string {
  return span(level, birthday).first;
}

/** One stage per year of each level, in today's money; a year with nothing to pay is not a stage. */
export function educationPlanStages(inputs: EducationPlanInputs, today: string): EducationStage[] {
  if (inputs.feeInflationBps < 0) throw new CalculatorError('Fees cannot inflate by less than nothing');
  if (inputs.levels.length === 0) throw new CalculatorError('Add a level to work out');
  return inputs.levels.flatMap((level) => {
    if (level.fees.some((fee) => !Number.isSafeInteger(fee.amountTodayMinor) || fee.amountTodayMinor < 0)) {
      throw new CalculatorError(`A fee of ${level.name} is not an amount`);
    }
    const once = level.fees.filter((fee) => fee.charged === 'once').reduce((total, fee) => total + fee.amountTodayMinor, 0);
    const yearly = level.fees.filter((fee) => fee.charged === 'yearly').reduce((total, fee) => total + fee.amountTodayMinor, 0);
    if (once + yearly <= 0) throw new CalculatorError(`${level.name} has nothing to pay`);
    const { first, years, dueOf } = span(level, inputs.birthday);
    const returnBps = level.returnBps ?? assumedReturnBps(monthsUntil(today, first));
    return Array.from({ length: years }, (_, i) => ({
      key: `${level.id}:${i}`,
      levelId: level.id,
      name: years > 1 ? `${level.name} · year ${i + 1}` : level.name,
      dueOn: dueOf(i),
      targetTodayMinor: yearly + (i === 0 ? once : 0),
      returnBps,
    })).filter((stage) => stage.targetTodayMinor > 0);
  });
}

/** A working from before levels existed: one course, in calendar years counted from the day it was worked out. */
export function educationFromV1(v1: EducationInputs, computedOn: string): EducationPlanInputs {
  const startYear = Number(computedOn.slice(0, 4)) + Math.round(v1.startsInYears);
  return {
    version: 2,
    birthday: null,
    feeInflationBps: v1.feeInflationBps,
    levels: [
      {
        id: 'course', name: 'Course', startAge: null, untilAge: null, startYear, untilYear: startYear + Math.round(v1.yearsOfStudy), returnBps: null,
        fees: [{ id: 'fee', name: 'Fee', amountTodayMinor: v1.feeTodayMinor, charged: 'yearly' }],
      },
    ],
  };
}
```

Export everything from `index.ts`.

- [ ] **Step 4: Run** — file, root gate. PASS.
- [ ] **Step 5: Commit** — `feat(core): education levels, fees once or every year, in today's money`, trailer.

---

### Task 5: Stage terms in the goal repository

**Files:**
- Modify: `packages/db/src/repos/goals.ts`, `packages/db/test/goals.test.ts`

**Interfaces:**
- Consumes: `healthTablesExist`, `goalStageTerms`.
- Produces: `saveGoalTx(tx: Db, ws, input: SaveGoalInput): Promise<{ goalId: string; stageIds: string[] }>` (stage ids in input order); `saveGoal` wraps it unchanged in signature; `listGoals` fills `stage.returnBps`; a non-derived save clears the goal's terms; a removed stage loses its term.

- [ ] **Step 1: Tests** (append to `goals.test.ts`; import `goalStageTerms` from `../src/schema-health` and `saveGoalTx`)

```ts
describe('a stage’s own return', () => {
  it('is read back with the goal, and forgotten when the goal is typed by hand', async () => {
    const { database, ws } = await setupDb();
    const { goalId, stageIds } = await database.transaction((tx) =>
      saveGoalTx(tx, ws, {
        name: 'School', kind: 'education', growthBps: 1000, returnBps: 800, derived: true,
        stages: [{ name: 'Preschool', targetMinor: 8_000_000, targetMonths: null, dueOn: '2027-07-01' }],
      }),
    );
    await database.db.insert(goalStageTerms).values({ stageId: stageIds[0]!, workspaceId: ws.workspaceId, goalId, returnBps: 400, derivedKey: 'pre:0' });
    expect((await listGoals(database, ws))[0]!.stages[0]!.returnBps).toBe(400);

    const stage = (await listGoals(database, ws))[0]!.stages[0]!;
    await saveGoal(database, ws, { id: goalId, name: 'School', kind: 'education', growthBps: 1000, returnBps: 800, stages: [{ ...stage, targetMinor: 9_000_000 }] });
    expect((await listGoals(database, ws))[0]!.stages[0]!.returnBps).toBeNull();
  });
});
```

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement**

Move `saveGoal`'s transaction body into:

```ts
/** The body of `saveGoal`, for a caller already inside a transaction. Stage ids come back in the order given. */
export async function saveGoalTx(tx: Db, ws: WorkspaceContext, input: SaveGoalInput): Promise<{ goalId: string; stageIds: string[] }> {
  // …today's body, with `input.name.trim()` / growth / `checkStages` checks at the top…
  const stageIds: string[] = [];
  for (const [index, stage] of input.stages.entries()) {
    const stageRow = { /* …as today… */ };
    stageIds.push(stageRow.id);
    // …upsert as today…
  }
  if (await healthTablesExist(tx)) {
    // A stage that went away takes its terms with it; a hand-typed save drops them all, like the calculator link.
    const removed = current.map((row) => row.id).filter((stageId) => !keptIds.includes(stageId));
    for (const stageId of removed) await tx.delete(goalStageTerms).where(eq(goalStageTerms.stageId, stageId));
    if (!input.derived) await tx.delete(goalStageTerms).where(and(eq(goalStageTerms.goalId, id), eq(goalStageTerms.workspaceId, ws.workspaceId)));
  }
  // …the goalCalculators delete as today…
  return { goalId: id, stageIds };
}

export async function saveGoal(database: Database, ws: WorkspaceContext, input: SaveGoalInput): Promise<string> {
  return (await database.transaction((tx) => saveGoalTx(tx, ws, input))).goalId;
}
```

(`current` and `keptIds` are the names today's body already uses for the existing stage rows and the ids passed back.) `SaveGoalStageInput` gains nothing — terms are written by the calculator (Task 6).

In `listGoals`, after reading `stageRows`:

```ts
  const terms = (await healthTablesExist(database.db))
    ? await database.db
        .select({ stageId: goalStageTerms.stageId, returnBps: goalStageTerms.returnBps })
        .from(goalStageTerms)
        .where(eq(goalStageTerms.workspaceId, ws.workspaceId))
    : [];
  const returnOf = new Map(terms.map((row) => [row.stageId, row.returnBps]));
```

and each mapped stage adds `returnBps: returnOf.get(stage.id) ?? null`.

- [ ] **Step 4: Run** — `goals.test.ts`, `goal-funding.test.ts`, root gate. PASS.
- [ ] **Step 5: Commit** — `feat(goals): a stage's own return is stored beside it and read with the goal`, trailer.

---

### Task 6: Calculators write today's money, in one transaction, keeping stages and paid marks

**Files:**
- Modify: `packages/db/src/repos/goal-calculators.ts`, `packages/db/test/goal-calculators.test.ts`

**Interfaces:**
- Consumes: `saveGoalTx`, `educationPlanStages`, `educationFromV1`, `retirementTodayMinor`, `assumedReturnBps`, `monthsUntil`, `EMERGENCY_RETURN_BPS`, `RETIREMENT_RETURN_BPS`, `healthTablesExist`, `goalStageTerms`.
- Produces: `CalculatorInputs = EmergencyInputs | EducationPlanInputs | EducationInputs | RetirementInputs` (v1 education accepted on the way in, always stored as v2); `saveGoalCalculator` and `createGoalFromCalculator` keep their signatures; the stored `inputs` always carry `version: 2`; `computedMinor` is the sum of the stages in today's money.

- [ ] **Step 1: Tests** (replace "gives education one stage a year…" and add; `TODAY` stays `'2026-09-13'` in the file, the new tests use their own)

```ts
const levels = (extra: object[] = []) => ({
  version: 2 as const, birthday: null, feeInflationBps: 1200,
  levels: [
    { id: 'primary', name: 'Primary School', startAge: null, untilAge: null, startYear: 2032, untilYear: 2038, returnBps: null,
      fees: [{ id: 'e', name: 'Enrollment', amountTodayMinor: 45_000_000, charged: 'once' as const }, { id: 'a', name: 'Academic', amountTodayMinor: 20_000_000, charged: 'yearly' as const }] },
    ...extra,
  ],
});

describe('today’s money', () => {
  it('stores education years at today’s prices and the fee inflation as the goal’s growth, so the plan inflates once', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Aisha', 'education');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: levels(), today: '2026-01-01' });

    const row = (await listGoals(database, ws)).find((g) => g.id === goalId)!;
    expect(row.growthBps).toBe(1200);
    expect(row.stages.map((stage) => stage.targetMinor)).toEqual([65_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000]);
    // Inflated once: 409.180.906. Stored inflated and inflated again, it would be over 1,2 milyar.
    expect((await goalPlansFor(database, ws, '2026-01-01')).plans.find((p) => p.goalId === goalId)!.totalTargetMinor).toBe(409_180_906);
  });

  it('stores retirement as today’s pot, with inflation as growth and 10% while saving', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, {
      name: 'Retirement', kind: 'retirement', today: '2026-09-21',
      inputs: { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnInRetirementBps: 500 },
    });
    const row = (await listGoals(database, ws)).find((g) => g.id === goalId)!;
    expect(row).toMatchObject({ growthBps: 350, returnBps: 1000 });
    expect(row.stages[0]).toMatchObject({ targetMinor: 2_070_575_495, dueOn: '2046-09-21' });
    expect((await goalPlansFor(database, ws, '2026-09-21')).plans[0]!.totalTargetMinor).toBe(4_120_008_061);
  });

  it('gives an emergency fund no growth: it follows spending instead', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, { name: 'Emergency fund', kind: 'emergency', inputs: { months: 6 }, today: TODAY });
    expect((await listGoals(database, ws)).find((g) => g.id === goalId)).toMatchObject({ growthBps: 0, returnBps: 200 });
  });

  it('stores each level’s return on its stages', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Aisha', 'education');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: levels([{ ...levels().levels[0]!, id: 'pre', name: 'Preschool', startYear: 2027, untilYear: 2028, returnBps: 450 }]), today: '2026-01-01' });
    const stages = (await listGoals(database, ws)).find((g) => g.id === goalId)!.stages;
    expect(stages.find((stage) => stage.name === 'Preschool')!.returnBps).toBe(450);
    expect(stages.find((stage) => stage.name === 'Primary School · year 1')!.returnBps).toBe(800);
  });
});

describe('adding a level', () => {
  it('raises the target and keeps what is set aside, the stages already there and their paid marks', async () => {
    const { database, ws } = await setupDb();
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
    const goalId = await goal(database, ws, 'Aisha', 'education');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: levels(), today: '2026-01-01' });
    await saveEarmark(database, ws, { goalId, accountId: bank.id, amountMinor: 10_000_000 });
    const before = (await listGoals(database, ws)).find((g) => g.id === goalId)!.stages;
    await setStagePaid(database, ws, before[0]!.id, '2026-01-02');

    await saveGoalCalculator(database, ws, {
      goalId, kind: 'education', today: '2026-01-01',
      inputs: levels([{ ...levels().levels[0]!, id: 'middle', name: 'Middle School', startYear: 2038, untilYear: 2041, fees: [{ id: 'a', name: 'Academic', amountTodayMinor: 30_000_000, charged: 'yearly' }] }]),
    });

    const after = (await listGoals(database, ws)).find((g) => g.id === goalId)!.stages;
    expect(after.slice(0, before.length).map((stage) => stage.id)).toEqual(before.map((stage) => stage.id));
    expect(after[0]!.paidOn).toBe('2026-01-02');
    expect(after.reduce((total, stage) => total + stage.targetMinor!, 0)).toBe(165_000_000 + 90_000_000);
    expect((await goalPlansFor(database, ws, '2026-01-01')).plans.find((p) => p.goalId === goalId)!.currentMinor).toBe(10_000_000);
  });
});
```

Import `createAccount`, `goalPlansFor`, `saveEarmark`, `setStagePaid` into the test file. Update the existing "works the figure out again when an assumption changes" and "remembers the inputs" retirement tests: the stored `inputs` now equal the given ones plus `version: 2`.

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement**

```ts
import {
  assumedReturnBps, EMERGENCY_BASES, EMERGENCY_RETURN_BPS, type EducationInputs, educationFromV1, type EducationPlanInputs,
  educationPlanStages, HOUSEHOLDS, INCOME_STABILITIES, monthsUntil, RETIREMENT_RETURN_BPS, type RetirementInputs, retirementTodayMinor,
} from '@expanses/core';
import { goalStageTerms } from '../schema-health';
import { healthTablesExist } from './health-tables';
import { GoalDbError, saveGoalTx, type SaveGoalStageInput } from './goals';

export type CalculatorInputs = EmergencyInputs | EducationPlanInputs | EducationInputs | RetirementInputs;

interface DerivedStage extends SaveGoalStageInput {
  key: string;
  returnBps: number | null;
}

interface Derived {
  inputs: CalculatorInputs;
  stages: DerivedStage[];
  growthBps: number;
  /** Written as the goal's return only when the working names one (retirement's return while saving). */
  returnBps: number | null;
  computedMinor: number;
}

const isV1Education = (inputs: CalculatorInputs): inputs is EducationInputs => 'feeTodayMinor' in inputs;

/** What a calculator's inputs imply, in today's money — the goal engine inflates once, at the growth given here. */
function derive(kind: CalculatorKind, raw: CalculatorInputs, today: string, goalName: string): Derived {
  if (kind === 'emergency') {
    const inputs = raw as EmergencyInputs;
    // …Part 1's checks on months, household, income and base, unchanged…
    return {
      inputs: { ...inputs, version: 2 },
      stages: [{ name: goalName, targetMinor: null, targetMonths: Math.round(inputs.months), dueOn: yearsFrom(today, 2), key: 'emergency', returnBps: null }],
      growthBps: 0,
      returnBps: null,
      computedMinor: 0,
    };
  }
  if (kind === 'education') {
    const inputs = isV1Education(raw) ? educationFromV1(raw, today) : (raw as EducationPlanInputs);
    const stages = educationPlanStages(inputs, today);
    return {
      inputs,
      stages: stages.map((stage) => ({ name: stage.name, targetMinor: stage.targetTodayMinor, targetMonths: null, dueOn: stage.dueOn, key: stage.key, returnBps: stage.returnBps })),
      growthBps: inputs.feeInflationBps,
      returnBps: null,
      computedMinor: stages.reduce((total, stage) => total + stage.targetTodayMinor, 0),
    };
  }
  const inputs = { ...(raw as RetirementInputs), version: 2 as const };
  const targetMinor = retirementTodayMinor(inputs);
  return {
    inputs,
    stages: [{ name: 'Retirement fund', targetMinor, targetMonths: null, dueOn: yearsFrom(today, inputs.yearsToRetirement), key: 'retirement', returnBps: null }],
    growthBps: inputs.inflationBps,
    returnBps: inputs.returnBeforeBps ?? RETIREMENT_RETURN_BPS,
    computedMinor: targetMinor,
  };
}

/**
 * Writes the working onto the goal inside one transaction: the goal's growth (and return, where the working names one),
 * its stages — keeping each stage that was already there, and its paid mark, by the key the working gave it — the
 * stages' own returns, and the inputs. Name, rank, standing amount, set-asides and tags are left alone.
 */
async function writeCalculatorTx(tx: Db, ws: WorkspaceContext, goal: typeof goalsTable.$inferSelect, kind: CalculatorKind, derived: Derived, computedAt = new Date().toISOString()): Promise<void> {
  const current = await tx.select().from(goalStages).where(and(eq(goalStages.goalId, goal.id), eq(goalStages.workspaceId, ws.workspaceId))).orderBy(asc(goalStages.dueOn), asc(goalStages.sort));
  const withTerms = await healthTablesExist(tx);
  const keyOf = new Map<string, string>(
    withTerms
      ? (await tx.select({ stageId: goalStageTerms.stageId, key: goalStageTerms.derivedKey }).from(goalStageTerms).where(eq(goalStageTerms.goalId, goal.id)))
          .filter((row) => row.key !== null)
          .map((row) => [row.key!, row.stageId])
      : [],
  );
  const byId = new Map(current.map((stage) => [stage.id, stage]));
  // A goal worked out before keys existed: match by position when the count is the same, so paid marks survive.
  const byPosition = keyOf.size === 0 && current.length === derived.stages.length;
  const stages = derived.stages.map((stage, index) => {
    const keep = byPosition ? current[index] : byId.get(keyOf.get(stage.key) ?? '');
    return { name: stage.name, targetMinor: stage.targetMinor, targetMonths: stage.targetMonths, dueOn: stage.dueOn, id: keep?.id, paidOn: keep?.paidOn ?? null };
  });

  const { stageIds } = await saveGoalTx(tx, ws, {
    id: goal.id, name: goal.name, kind: goal.kind, rank: goal.rank,
    growthBps: derived.growthBps, returnBps: derived.returnBps ?? goal.returnBps,
    standingMonthlyMinor: goal.standingMonthlyMinor, standingNote: goal.standingNote,
    stages, derived: true,
  });

  if (withTerms) {
    await tx.delete(goalStageTerms).where(and(eq(goalStageTerms.goalId, goal.id), eq(goalStageTerms.workspaceId, ws.workspaceId)));
    for (const [index, stage] of derived.stages.entries()) {
      await tx.insert(goalStageTerms).values({ stageId: stageIds[index]!, workspaceId: ws.workspaceId, goalId: goal.id, returnBps: stage.returnBps, derivedKey: stage.key });
    }
  }

  const row = { goalId: goal.id, workspaceId: ws.workspaceId, kind, inputsJson: JSON.stringify(derived.inputs), computedMinor: derived.computedMinor, computedAt };
  const { goalId: _goalId, workspaceId: _workspaceId, ...changes } = row;
  await tx.insert(goalCalculators).values(row).onConflictDoUpdate({ target: goalCalculators.goalId, set: changes });
}

export async function saveGoalCalculator(database: Database, ws: WorkspaceContext, input: SaveGoalCalculatorInput): Promise<number> {
  return database.transaction(async (tx) => {
    const [goal] = await tx.select().from(goalsTable).where(and(eq(goalsTable.id, input.goalId), eq(goalsTable.workspaceId, ws.workspaceId)));
    if (!goal) throw new GoalDbError('Goal not found in this workspace');
    const derived = derive(input.kind, input.inputs, input.today, goal.name);
    await writeCalculatorTx(tx, ws, goal, input.kind, derived);
    return derived.computedMinor;
  });
}

export async function createGoalFromCalculator(database: Database, ws: WorkspaceContext, input: CreateGoalFromCalculatorInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new GoalDbError('Give this goal a name');
  // Worked out before anything is written, so refused figures leave no half-made goal.
  const derived = derive(input.kind, input.inputs, input.today, name);
  const firstDue = derived.stages[0]!.dueOn;
  const returnBps =
    input.returnBps ?? derived.returnBps ?? (input.kind === 'emergency' ? EMERGENCY_RETURN_BPS : assumedReturnBps(monthsUntil(input.today, firstDue)));
  return database.transaction(async (tx) => {
    const { goalId } = await saveGoalTx(tx, ws, {
      name, kind: input.kind, growthBps: derived.growthBps, returnBps,
      stages: derived.stages.map(({ key: _key, returnBps: _r, ...stage }) => stage), derived: true,
    });
    const [goal] = await tx.select().from(goalsTable).where(eq(goalsTable.id, goalId));
    await writeCalculatorTx(tx, ws, goal!, input.kind, derived);
    return goalId;
  });
}
```

`EmergencyInputs` (Part 1) gains `version?: 2`, so the stamped inputs need no cast. Delete the old `stagesFor`. `CreateGoalFromCalculatorInput` drops `growthBps` (the working decides it). Import `asc`, `goalStages`, `type Db`. `getGoalCalculator`/`listGoalCalculators` are unchanged.

- [ ] **Step 4: Run** — `goal-calculators.test.ts`, `goal-funding.test.ts`, `goals.test.ts`, root gate, `npx playwright test -c playwright.hr.config.ts '(^|/)calculators\.spec\.ts$' '(^|/)goals\.spec\.ts$'`. PASS.
- [ ] **Step 5: Commit** — `fix(goals): a worked-out goal is stored in today's money and inflated once, and keeps its stages when re-worked`, trailer.

---

### Task 7: Upgrade goals worked out before this

**Files:**
- Modify: `packages/db/src/repos/goal-calculators.ts`, `apps/web/src/db/bootstrap.ts`
- Create: `packages/db/test/calculator-upgrade.test.ts`

**Interfaces:**
- Produces: `upgradeCalculatorGoals(database, ws, today: string): Promise<string[]>` — ids of goals whose figures changed: v1 workings re-stated in today's money (dated from their own `computed_at`), and (**user decision Part 2 Q1**) v2 education workings whose un-typed level returns now fall in another band for the months left from `today`.

- [ ] **Step 1: Tests**

```ts
// packages/db/test/calculator-upgrade.test.ts
import { describe, expect, it } from 'vitest';
import { goalCalculators } from '../src/schema-budget';
import { getGoalCalculator, listGoals, saveGoal, saveGoalCalculator, setStagePaid, upgradeCalculatorGoals } from '../src/index';
import { setupDb } from './helpers';

/** A goal as the old calculator left it: stages already inflated, growth still applied on top. */
async function oldEducationGoal(database: Awaited<ReturnType<typeof setupDb>>['database'], ws: Awaited<ReturnType<typeof setupDb>>['ws']) {
  const goalId = await saveGoal(database, ws, {
    name: 'University', kind: 'education', growthBps: 1000, returnBps: 1000, derived: true,
    stages: [0, 1, 2, 3].map((i) => ({ name: `Year ${i + 1}`, targetMinor: Math.round(100_000_000 * 1.1 ** (10 + i)), targetMonths: null, dueOn: `${2036 + i}-09-13` })),
  });
  await database.db.insert(goalCalculators).values({
    goalId, workspaceId: ws.workspaceId, kind: 'education', computedMinor: 0, computedAt: '2026-09-13T08:00:00.000Z',
    inputsJson: JSON.stringify({ feeTodayMinor: 100_000_000, startsInYears: 10, yearsOfStudy: 4, feeInflationBps: 1000 }),
  });
  return goalId;
}

describe('upgrading an old working', () => {
  it('re-states the stages in today’s money, keeps their ids and paid marks, and is done once', async () => {
    const { database, ws } = await setupDb();
    const goalId = await oldEducationGoal(database, ws);
    const before = (await listGoals(database, ws))[0]!.stages;
    await setStagePaid(database, ws, before[0]!.id, '2026-09-14');

    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([goalId]);
    const after = (await listGoals(database, ws))[0]!;
    expect(after.growthBps).toBe(1000);
    expect(after.stages.map((stage) => stage.targetMinor)).toEqual([100_000_000, 100_000_000, 100_000_000, 100_000_000]);
    expect(after.stages.map((stage) => stage.id)).toEqual(before.map((stage) => stage.id));
    expect(after.stages[0]!.paidOn).toBe('2026-09-14');
    // A v1 course becomes calendar years, so its years fall on 1 January (Q7) — the only date that moves, and
    // it moves because v2 cannot say "13 September" without a birthday. Needs-human item in the ledger.
    expect(after.stages.map((stage) => stage.dueOn)).toEqual(['2036-01-01', '2037-01-01', '2038-01-01', '2039-01-01']);
    // Its working keeps the day it was first worked out.
    expect((await getGoalCalculator(database, ws, goalId))!.computedAt).toBe('2026-09-13T08:00:00.000Z');
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toMatchObject({ version: 2 });

    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([]);
  });

  it('keeps a retirement goal’s own return as the return while saving', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, {
      name: 'Retirement', kind: 'retirement', growthBps: 400, returnBps: 900, derived: true,
      stages: [{ name: 'Retirement fund', targetMinor: 4_120_008_061, targetMonths: null, dueOn: '2046-09-21' }],
    });
    await database.db.insert(goalCalculators).values({
      goalId, workspaceId: ws.workspaceId, kind: 'retirement', computedMinor: 4_120_008_061, computedAt: '2026-09-21T00:00:00.000Z',
      inputsJson: JSON.stringify({ annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnInRetirementBps: 500 }),
    });
    await upgradeCalculatorGoals(database, ws, '2026-09-21');
    expect((await listGoals(database, ws))[0]).toMatchObject({ growthBps: 350, returnBps: 900, stages: [{ targetMinor: 2_070_575_495, dueOn: '2046-09-21' }] });
  });

  it('only stamps a working whose figures come out the same', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, {
      name: 'Emergency fund', kind: 'emergency', growthBps: 0, returnBps: 200, derived: true,
      stages: [{ name: 'Emergency fund', targetMinor: null, targetMonths: 6, dueOn: '2028-09-13' }],
    });
    await database.db.insert(goalCalculators).values({ goalId, workspaceId: ws.workspaceId, kind: 'emergency', computedMinor: 0, computedAt: '2026-09-13T00:00:00.000Z', inputsJson: JSON.stringify({ months: 6 }) });
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([]);
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toMatchObject({ version: 2 });
  });

  it('re-reads the band for a level whose return was never typed, and leaves a typed one alone (Part 2 Q1)', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, {
      name: 'Aisha', kind: 'education', growthBps: 1000, returnBps: 800,
      stages: [{ name: 'x', targetMinor: 1, targetMonths: null, dueOn: '2032-01-01' }],
    });
    const fee = [{ id: 'a', name: 'Academic', amountTodayMinor: 20_000_000, charged: 'yearly' as const }];
    await saveGoalCalculator(database, ws, {
      goalId, kind: 'education', today: '2026-01-01',
      inputs: { version: 2, birthday: null, feeInflationBps: 1000, levels: [
        { id: 'primary', name: 'Primary', startAge: null, untilAge: null, startYear: 2032, untilYear: 2033, returnBps: null, fees: fee },
        { id: 'middle', name: 'Middle', startAge: null, untilAge: null, startYear: 2032, untilYear: 2033, returnBps: 450, fees: fee },
      ] },
    });
    const returns = async () => Object.fromEntries((await listGoals(database, ws))[0]!.stages.map((stage) => [stage.name, stage.returnBps]));
    expect(await returns()).toEqual({ Primary: 800, Middle: 450 }); // 72 months away: the > 5 years band

    // Two years on, 48 months away: 3–5 years, 6%. The typed 4,5% stays.
    expect(await upgradeCalculatorGoals(database, ws, '2028-01-01')).toEqual([goalId]);
    expect(await returns()).toEqual({ Primary: 600, Middle: 450 });
    // Same band on the next open: nothing to do.
    expect(await upgradeCalculatorGoals(database, ws, '2028-02-01')).toEqual([]);
  });

  it('never touches a goal whose target was typed by hand', async () => {
    const { database, ws } = await setupDb();
    const goalId = await oldEducationGoal(database, ws);
    const stages = (await listGoals(database, ws))[0]!.stages;
    // Typing by hand breaks the link: saveGoal without `derived` removes the calculator row.
    await saveGoal(database, ws, { id: goalId, name: 'University', kind: 'education', growthBps: 1000, returnBps: 1000, stages: stages.map((stage) => ({ ...stage, targetMinor: 300_000_000 })) });
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([]);
    expect((await listGoals(database, ws))[0]!.stages.every((stage) => stage.targetMinor === 300_000_000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement**

```ts
/**
 * Same growth, return, stages and stage returns. Stages are compared as a set of figures, never by position: the
 * goal lists them by date and sort, the working by level, and two levels can start on the same day.
 */
const stageFigure = (stage: { targetMinor: number | null; targetMonths: number | null; dueOn: string; returnBps?: number | null }) =>
  `${stage.dueOn}|${stage.targetMinor}|${stage.targetMonths}|${stage.returnBps ?? null}`;
const sameFigures = (goal: GoalRow, derived: Derived) =>
  goal.growthBps === derived.growthBps &&
  (derived.returnBps === null || goal.returnBps === derived.returnBps) &&
  JSON.stringify(goal.stages.map(stageFigure).sort()) === JSON.stringify(derived.stages.map(stageFigure).sort());

/**
 * Works every goal worked out before today's-money stages out again — dated from its own computed_at, so no due date
 * moves — silently, and only when the figure changes. A goal typed by hand has no calculator row, so is never visited.
 * Returns the goals whose figures changed.
 */
export async function upgradeCalculatorGoals(database: Database, ws: WorkspaceContext, today: string): Promise<string[]> {
  const isV2 = (row: GoalCalculatorRow) => (row.inputs as { version?: number }).version === 2;
  // v1 workings, dated from their own day; and (Part 2 Q1) v2 education workings, re-read from today so a level whose
  // return was never typed follows its band as its start draws near. Its dates are years or ages, so `today` moves
  // only those returns. Retirement and emergency v2 are left alone: their dates are relative to the day worked out.
  const rows = (await listGoalCalculators(database, ws)).filter((row) => !isV2(row) || row.kind === 'education');
  const goals = await listGoals(database, ws, { includeArchived: true });
  const changed: string[] = [];
  for (const row of rows) {
    const goal = goals.find((candidate) => candidate.id === row.goalId);
    if (!goal) continue;
    const workedOn = isV2(row) ? today : row.computedAt.slice(0, 10);
    // A retirement worked out before kept the goal's own return; it stays the return while saving.
    const inputs = row.kind === 'retirement' ? { ...(row.inputs as RetirementInputs), returnBeforeBps: goal.returnBps } : row.inputs;
    let derived: Derived;
    try {
      derived = derive(row.kind, inputs, workedOn, goal.name);
    } catch {
      continue; // A working the rules now refuse is left exactly as it is, not half-rewritten.
    }
    await database.transaction(async (tx) => {
      if (sameFigures(goal, derived)) {
        if (!isV2(row)) await tx.update(goalCalculators).set({ inputsJson: JSON.stringify(derived.inputs) }).where(eq(goalCalculators.goalId, goal.id));
        return;
      }
      const [goalRow] = await tx.select().from(goalsTable).where(eq(goalsTable.id, goal.id));
      // Keeps its computed_at: the working is re-stated, not redone on a new day.
      await writeCalculatorTx(tx, ws, goalRow!, row.kind, derived, row.computedAt);
      changed.push(goal.id);
    });
  }
  return changed;
}
```

Import `listGoals`, `type GoalRow` from `./goals`. In `apps/web/src/db/bootstrap.ts`, after `ensureDefaultCategorySets`:

```ts
  // Goals worked out before stages were kept in today's money are stated again once; a failure must not stop the app.
  try {
    await upgradeCalculatorGoals(database, ws, isoDate());
  } catch (error) {
    console.warn('Upgrading worked-out goals failed', error);
  }
```

- [ ] **Step 4: Run** — new test, `goal-calculators.test.ts`, web `bootstrap` tests, root gate. PASS.
- [ ] **Step 5: Commit** — `fix(goals): goals worked out before are stated in today's money once, and only when the figure changes`, trailer.

---

### Task 8: Prefilled returns on the templates and the goal form

**Files:**
- Modify: `apps/web/src/features/goals/goal-cards.ts`, `apps/web/src/features/goals/goal-cards.test.ts`, `apps/web/src/features/goals/GoalForm.tsx`

**Interfaces:**
- Consumes: `assumedReturnBps`, `bandHint`, `returnBandFor`, `monthsUntil`, `DEFAULT_INFLATION_BPS`, `RETIREMENT_RETURN_BPS`, `EMERGENCY_RETURN_BPS`.
- Produces: `prefilledReturnBps(kind, dueOn, today): number`; `GOAL_TEMPLATES` returns derived.

- [ ] **Step 1: Tests** (append to `goal-cards.test.ts`)

```ts
describe('the return a goal opens with', () => {
  it('comes from the band for the template’s first stage, except the two with figures of their own', () => {
    const returnOf = (kind: string) => GOAL_TEMPLATES.find((template) => template.kind === kind)!.returnBps;
    expect(returnOf('holiday')).toBe(400); // 9 months
    expect(returnOf('vehicle')).toBe(500); // 36 months
    expect(returnOf('education')).toBe(800); // 120 months — was 10%
    expect(returnOf('retirement')).toBe(1000);
    expect(returnOf('emergency')).toBe(200);
    expect(GOAL_TEMPLATES.find((template) => template.kind === 'retirement')!.growthBps).toBe(350);
    expect(Math.max(...GOAL_TEMPLATES.map((template) => template.returnBps))).toBeLessThanOrEqual(1000);
  });

  it('follows a stage’s date', () => {
    expect(prefilledReturnBps('holiday', '2027-09-21', '2026-09-21')).toBe(400);
    expect(prefilledReturnBps('holiday', '2030-09-21', '2026-09-21')).toBe(600);
    expect(prefilledReturnBps('retirement', '2027-09-21', '2026-09-21')).toBe(1000);
    expect(prefilledReturnBps('emergency', '2040-09-21', '2026-09-21')).toBe(200);
  });
});
```

- [ ] **Step 2: Run, see it fail.**

- [ ] **Step 3: Implement**

```ts
/** The return a goal opens with: the horizon band for when it is needed, except the two that have figures of their own. */
export function prefilledReturnBps(kind: GoalKind, dueOn: string, today: string): number {
  if (kind === 'emergency') return EMERGENCY_RETURN_BPS;
  if (kind === 'retirement') return RETIREMENT_RETURN_BPS;
  return assumedReturnBps(monthsUntil(today, dueOn));
}

const bandReturn = (monthsAway: number) => assumedReturnBps(monthsAway);
```

Each template's `returnBps` becomes `bandReturn(<its stage.monthsAway>)` (hajj 12, education 120, home 36, wedding 24, vehicle 36, holiday 9); emergency `EMERGENCY_RETURN_BPS`; retirement `returnBps: RETIREMENT_RETURN_BPS, growthBps: DEFAULT_INFLATION_BPS`. The education hint gains ` The return follows how far away it is.`

In `GoalForm.tsx`: add `const [returnTyped, setReturnTyped] = useState(!!goal);`. The return field's `onChange` sets `setReturnTyped(true)`. `setStage` becomes:

```tsx
  const setStage = (index: number, patch: Partial<StageDraft>) => {
    setStages((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    // A new goal's return follows its first stage's date until the user types one.
    if (index === 0 && patch.dueOn && !returnTyped) setExpectedReturn(String(prefilledReturnBps(kind, patch.dueOn, today) / 100));
  };
```

`pickKind` sets `setReturnTyped(false)` along with the template's figures. The return field's hint becomes `bandHint(returnBandFor(monthsUntil(today, stages[0]?.dueOn ?? today)))` for kinds other than emergency and retirement, and today's hint for those two.

- [ ] **Step 4: Run** — web vitest, root gate, `npx playwright test -c playwright.hr.config.ts '(^|/)goals\.spec\.ts$' '(^|/)goal-classes\.spec\.ts$'`. PASS.
- [ ] **Step 5: Commit** — `feat(goals): a new goal's return follows how far away it is`, trailer.

---

### Task 9: The education editor, and the goal's calculator

**Files:**
- Create: `apps/web/src/features/goals/education-model.ts`, `apps/web/src/features/goals/education-model.test.ts`, `apps/web/src/features/goals/EducationEditor.tsx`, `apps/web/e2e/education-calculator.spec.ts`, `apps/web/e2e/phone-education-calculator.spec.ts`
- Modify: `apps/web/src/features/goals/Calculator.tsx`

**Interfaces:**
- Consumes: `OFFERED_LEVELS`, `DEFAULT_FEES`, `educationFromV1`, `levelStartsOn`, `returnBandFor`, `bandHint`, `monthsUntil`, `parseMajor`, `minorToMajorString`, `EDUCATION_INFLATION_BPS`, `DEFAULT_INFLATION_BPS`, `RETIREMENT_RETURN_BPS`, `DRAWDOWN_RETURN_BPS`.
- Produces: `FeeDraft`, `LevelDraft`, `EducationDraft`, `educationDraftFrom(inputs?, currency)`, `addLevel(draft)`, `addFee(level)`, `educationInputsOf(draft, currency)`, `levelWhen(level, birthday)`; `EducationEditor({ value, onChange, currency, today })`.

- [ ] **Step 1: Test the model**

```ts
// apps/web/src/features/goals/education-model.test.ts
import { describe, expect, it } from 'vitest';
import { addLevel, educationDraftFrom, educationInputsOf, levelWhen } from './education-model';

describe('the education draft', () => {
  it('offers the next unused level name, and three default fees', () => {
    let draft = addLevel(educationDraftFrom(undefined, 'IDR'));
    draft = addLevel(draft);
    expect(draft.levels.map((level) => level.name)).toEqual(['Preschool', 'Primary School']);
    expect(draft.levels[0]!.fees.map((fee) => [fee.name, fee.charged])).toEqual([['Enrollment', 'once'], ['Academic', 'yearly'], ['Other', 'once']]);
  });

  it('reads amounts with parseMajor, drops empty fees, and leaves the return to the band unless it was typed', () => {
    let draft = addLevel(educationDraftFrom(undefined, 'IDR'));
    draft.levels[0] = { ...draft.levels[0]!, start: '2032', until: '2038', fees: [
      { ...draft.levels[0]!.fees[0]!, amount: '45.000.000' },
      { ...draft.levels[0]!.fees[1]!, amount: '20.000.000' },
      { ...draft.levels[0]!.fees[2]!, amount: '' },
    ] };
    const inputs = educationInputsOf(draft, 'IDR');
    expect(inputs.levels[0]).toMatchObject({ startYear: 2032, untilYear: 2038, startAge: null, returnBps: null });
    expect(inputs.levels[0]!.fees.map((fee) => fee.amountTodayMinor)).toEqual([45_000_000, 20_000_000]);
    expect(inputs.feeInflationBps).toBe(1000);

    draft.levels[0] = { ...draft.levels[0]!, returnPercent: '4,5', returnTyped: true };
    expect(educationInputsOf(draft, 'IDR').levels[0]!.returnBps).toBe(450);
  });

  it('reads the start and end as ages once a birthday is given', () => {
    let draft = addLevel({ ...educationDraftFrom(undefined, 'IDR'), birthday: '2026-03-15' });
    draft.levels[0] = { ...draft.levels[0]!, start: '6', until: '12', fees: [{ ...draft.levels[0]!.fees[1]!, amount: '20000000' }] };
    expect(educationInputsOf(draft, 'IDR').levels[0]).toMatchObject({ startAge: 6, untilAge: 12, startYear: null, untilYear: null });
  });

  it('says when a level runs, and on what day with no birthday', () => {
    const level = { start: '6', until: '12' } as never;
    expect(levelWhen(level, '2026-03-15')).toBe('Ages 6 to 12 · 2032 to 2038');
    expect(levelWhen({ start: '2032', until: '2038' } as never, '')).toBe('2032 to 2038 · due 1 January each year');
  });
});
```

- [ ] **Step 2: The model**

```ts
// apps/web/src/features/goals/education-model.ts
import { DEFAULT_FEES, EDUCATION_INFLATION_BPS, type EducationPlanInputs, type FeeCharge, minorToMajorString, OFFERED_LEVELS, parseMajor, uuidv7 } from '@expanses/core';

export interface FeeDraft { id: string; name: string; amount: string; charged: FeeCharge }
export interface LevelDraft { id: string; name: string; start: string; until: string; fees: FeeDraft[]; returnPercent: string; returnTyped: boolean }
export interface EducationDraft { birthday: string; feeInflation: string; levels: LevelDraft[] }

const percent = (bps: number) => String(bps / 100);

export function educationDraftFrom(inputs: EducationPlanInputs | undefined, currency: string): EducationDraft {
  if (!inputs) return { birthday: '', feeInflation: percent(EDUCATION_INFLATION_BPS), levels: [] };
  const byAge = inputs.birthday !== null;
  return {
    birthday: inputs.birthday ?? '',
    feeInflation: percent(inputs.feeInflationBps),
    levels: inputs.levels.map((level) => ({
      id: level.id,
      name: level.name,
      start: String(byAge ? level.startAge : level.startYear),
      until: String(byAge ? level.untilAge : level.untilYear),
      fees: level.fees.map((fee) => ({ id: fee.id, name: fee.name, amount: minorToMajorString(fee.amountTodayMinor, currency), charged: fee.charged })),
      returnPercent: level.returnBps === null ? '' : percent(level.returnBps),
      returnTyped: level.returnBps !== null,
    })),
  };
}

export function addLevel(draft: EducationDraft): EducationDraft {
  const used = new Set(draft.levels.map((level) => level.name));
  const name = OFFERED_LEVELS.find((offered) => !used.has(offered)) ?? 'Another level';
  const level: LevelDraft = { id: uuidv7(), name, start: '', until: '', returnPercent: '', returnTyped: false, fees: DEFAULT_FEES.map((fee) => ({ id: uuidv7(), name: fee.name, amount: '', charged: fee.charged })) };
  return { ...draft, levels: [...draft.levels, level] };
}

export function addFee(level: LevelDraft): LevelDraft {
  return { ...level, fees: [...level.fees, { id: uuidv7(), name: '', amount: '', charged: 'once' }] };
}

const whole = (value: string, what: string) => {
  const number = Number(value.trim());
  if (!Number.isInteger(number)) throw new Error(`${what} must be a whole number`);
  return number;
};

/** Every typed figure read once, by `parseMajor`; a fee left empty is not a fee. */
export function educationInputsOf(draft: EducationDraft, currency: string): EducationPlanInputs {
  const byAge = draft.birthday.trim() !== '';
  return {
    version: 2,
    birthday: byAge ? draft.birthday : null,
    feeInflationBps: Math.round(Number(draft.feeInflation.replace(',', '.')) * 100),
    levels: draft.levels.map((level) => {
      const start = whole(level.start, `${level.name}'s start`);
      const until = whole(level.until, `${level.name}'s end`);
      return {
        id: level.id,
        name: level.name.trim() || 'Level',
        startAge: byAge ? start : null,
        untilAge: byAge ? until : null,
        startYear: byAge ? null : start,
        untilYear: byAge ? null : until,
        returnBps: level.returnTyped ? Math.round(Number(level.returnPercent.replace(',', '.')) * 100) : null,
        fees: level.fees
          .filter((fee) => fee.amount.trim() !== '')
          .map((fee) => ({ id: fee.id, name: fee.name.trim() || 'Fee', amountTodayMinor: parseMajor(fee.amount, currency), charged: fee.charged })),
      };
    }),
  };
}

/** "Ages 6 to 12 · 2032 to 2038", or "2032 to 2038 · due 1 January each year" with no birthday. */
export function levelWhen(level: Pick<LevelDraft, 'start' | 'until'>, birthday: string): string {
  if (birthday.trim()) {
    const born = Number(birthday.slice(0, 4));
    return `Ages ${level.start} to ${level.until} · ${born + Number(level.start)} to ${born + Number(level.until)}`;
  }
  return `${level.start} to ${level.until} · due 1 January each year`;
}
```

(If `uuidv7` or `minorToMajorString` are not exported from `@expanses/core`, check `index.ts` — both are used elsewhere in web.)

- [ ] **Step 3: The editor** — one controlled component, native kit only:

```tsx
// apps/web/src/features/goals/EducationEditor.tsx
import { bandHint, levelStartsOn, monthsUntil, returnBandFor } from '@expanses/core';
import { DestructiveRow, InsetGroup, InsetRow, SelectRow, TextRow } from '../../ui/native';
import { addFee, addLevel, type EducationDraft, educationInputsOf, type LevelDraft, levelWhen } from './education-model';

export function EducationEditor({ value, onChange, currency, today }: { value: EducationDraft; onChange: (next: EducationDraft) => void; currency: string; today: string }) {
  const byAge = value.birthday.trim() !== '';
  const setLevel = (id: string, next: LevelDraft) => onChange({ ...value, levels: value.levels.map((level) => (level.id === id ? next : level)) });
  const bandFor = (level: LevelDraft) => {
    try {
      const inputs = educationInputsOf({ ...value, levels: [level] }, currency);
      return returnBandFor(monthsUntil(today, levelStartsOn(inputs.levels[0]!, inputs.birthday)));
    } catch {
      return null;
    }
  };
  return (
    <>
      <InsetGroup header="The child" footer="Levels are set by age once a birthday is given; without one, by calendar year.">
        <TextRow label="Birthday" type="date" value={value.birthday} onChange={(e) => onChange({ ...value, birthday: e.target.value })} />
        <TextRow label="Fee inflation a year (%)" value={value.feeInflation} onChange={(e) => onChange({ ...value, feeInflation: e.target.value })} inputMode="decimal" />
      </InsetGroup>
      {value.levels.map((level) => {
        const band = bandFor(level);
        return (
          <InsetGroup key={level.id} header={level.name || 'Level'} footer={level.start && level.until ? levelWhen(level, value.birthday) : undefined}>
            <TextRow label="Name" value={level.name} onChange={(e) => setLevel(level.id, { ...level, name: e.target.value })} />
            <TextRow label={byAge ? 'Starts at age' : 'Starts in year'} value={level.start} onChange={(e) => setLevel(level.id, { ...level, start: e.target.value })} inputMode="numeric" />
            <TextRow label={byAge ? 'Until age' : 'Until year'} value={level.until} onChange={(e) => setLevel(level.id, { ...level, until: e.target.value })} inputMode="numeric" />
            {level.fees.map((fee) => (
              <div key={fee.id}>
                <TextRow label="Cost name" value={fee.name} onChange={(e) => setLevel(level.id, { ...level, fees: level.fees.map((f) => (f.id === fee.id ? { ...f, name: e.target.value } : f)) })} />
                <TextRow label={`${fee.name || 'Cost'} today (${currency})`} value={fee.amount} onChange={(e) => setLevel(level.id, { ...level, fees: level.fees.map((f) => (f.id === fee.id ? { ...f, amount: e.target.value } : f)) })} inputMode="numeric" />
                <SelectRow label={`${fee.name || 'Cost'} is paid`} value={fee.charged} onChange={(e) => setLevel(level.id, { ...level, fees: level.fees.map((f) => (f.id === fee.id ? { ...f, charged: e.target.value as 'once' | 'yearly' } : f)) })}>
                  <option value="once">Once, at entry</option>
                  <option value="yearly">Every year</option>
                </SelectRow>
              </div>
            ))}
            <InsetRow title="Add a cost" onClick={() => setLevel(level.id, addFee(level))} />
            <TextRow
              label="Assumed return (%)"
              hint={band ? bandHint(band) : 'Set when it starts to see the band.'}
              value={level.returnTyped ? level.returnPercent : band ? String(band.returnBps / 100) : ''}
              onChange={(e) => setLevel(level.id, { ...level, returnPercent: e.target.value, returnTyped: true })}
              inputMode="decimal"
            />
            <DestructiveRow label={`Remove ${level.name || 'this level'}`} onClick={() => onChange({ ...value, levels: value.levels.filter((l) => l.id !== level.id) })} />
          </InsetGroup>
        );
      })}
      <InsetGroup footer="Monthly fees belong in the budget beside groceries; only the lumpy charges belong here.">
        <InsetRow title="Add a level" onClick={() => onChange(addLevel(value))} />
      </InsetGroup>
    </>
  );
}
```

- [ ] **Step 4: The goal's calculator**

In `Calculator.tsx` (Part 1 put it on the kit), replace the education fields with:

```tsx
  const [education, setEducation] = useState(() =>
    educationDraftFrom(
      saved?.kind === 'education'
        ? 'feeTodayMinor' in saved.inputs
          ? educationFromV1(saved.inputs as EducationInputs, saved.computedAt.slice(0, 10))
          : (saved.inputs as EducationPlanInputs)
        : undefined,
      ws.baseCurrency,
    ),
  );
  // …inside the form, for kind === 'education':
  <EducationEditor value={education} onChange={setEducation} currency={ws.baseCurrency} today={isoDate()} />
```

and in `submit`: `kind === 'education' ? educationInputsOf(education, ws.baseCurrency) : …`. The retirement fields become six rows — yearly spending, years until retirement, years in retirement, **Inflation a year (%)** opening at `DEFAULT_INFLATION_BPS / 100`, **Return while saving (%)** at `RETIREMENT_RETURN_BPS / 100`, **Return while retired (%)** at `DRAWDOWN_RETURN_BPS / 100` — and the inputs gain `returnBeforeBps: bps(returnBefore)`. Blurbs: education `Each year at today's prices; the goal raises each one to the year it is paid.`; retirement `What the pot must hold the day you stop, drawn down while it keeps earning.`

- [ ] **Step 5: E2E** (key by key)

```ts
// apps/web/e2e/education-calculator.spec.ts — phone-education-calculator.spec.ts runs the same test at phone width
import { expect, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const type = async (page: import('@playwright/test').Page, label: string, text: string) => {
  const box = page.getByLabel(label, { exact: true }).last();
  await box.click();
  await box.pressSequentially(text, { delay: 30 });
};

test('two levels, a once fee and a yearly one, and a level added later raises the target', async ({ page }) => {
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Education', exact: true }).click();
  await page.getByRole('button', { name: 'Add goal' }).click();
  await page.getByRole('button', { name: 'Work out the amount' }).click();

  await page.getByRole('button', { name: 'Add a level' }).click();
  await type(page, 'Starts in year', '2032');
  await type(page, 'Until year', '2038');
  await type(page, 'Enrollment today (IDR)', '45000000');
  await type(page, 'Academic today (IDR)', '20000000');
  await expect(page.getByText('2032 to 2038 · due 1 January each year')).toBeVisible();
  await page.getByRole('button', { name: 'Use this amount' }).click();
  // Today's money: 45 jt once and six years of 20 jt.
  await expect(page.locator('body')).toContainText('165.000.000');

  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await page.getByRole('button', { name: 'Add a level' }).click();
  await type(page, 'Starts in year', '2038');
  await type(page, 'Until year', '2041');
  await type(page, 'Academic today (IDR)', '30000000');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  await expect(page.locator('body')).toContainText('255.000.000');
});
```

(The goal card's "of Rp …" is the plan's future total; assert the stage lines' "today" figures, which is where these today's-money totals appear — adjust the locator to the stage group, not the whole body, if the body also shows the future total.)

- [ ] **Step 6: Run** — web vitest, root gate, the two specs, `e2e/goals.spec.ts`. PASS.
- [ ] **Step 7: Commit** — `feat(goals): education levels you name, fees once or every year, and a return per level`, trailer.

---

### Task 10: The Calculators page — education, retirement's three rates, and life cover

**Files:**
- Create: `apps/web/src/features/calculators/life-cover-form.ts`, `apps/web/src/features/calculators/life-cover-form.test.ts`, `apps/web/e2e/life-cover.spec.ts`
- Modify: `packages/db/src/repos/goal-calculators.ts` (life-cover inputs remembered), `packages/db/test/goal-calculators.test.ts`, `apps/web/src/features/calculators/CalculatorsPage.tsx`, `apps/web/e2e/calculators.spec.ts`, `packages/core/src/assets/health.ts`, `apps/web/src/features/networth/OverviewPage.tsx`, `packages/core/src/budget/calculators.ts` (delete `educationStages`), `packages/core/test/calculators.test.ts` (delete its tests), `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `lifeCoverMinor`, `goalPlan`, `educationPlanStages`, `retirementTargetMinor`, `savingPlanFor`, `balanceSheet`, `useSheet`, `useGoalPlans`, `EducationEditor`, `DRAWDOWN_RETURN_BPS`, `DEFAULT_INFLATION_BPS`.
- Produces: `sheetTotals(sheet: BalanceSheet): SheetTotals` in core; `lifeCoverPrefill(totals, plans)`; `lifeCoverInputsOf(draft, prefill, currency)`; `LifeCoverDraft`; (db) `LIFE_COVER_ROW`, `saveLifeCoverDraft(database, ws, draft)`, `getLifeCoverDraft(database, ws): Promise<LifeCoverSaved | null>`; `listGoalCalculators`/`getGoalCalculator`/`upgradeCalculatorGoals` skip that row.

- [ ] **Step 1: `sheetTotals` — one reader for both pages**

```ts
// packages/core/src/assets/health.ts
import type { BalanceSheet } from './balance-sheet';

/** The five totals the ratios read, from a balance sheet. The net-worth page and the life cover prefill both call this. */
export function sheetTotals(sheet: BalanceSheet): SheetTotals {
  const groupTotal = (key: string) => sheet.assetGroups.find((group) => group.key === key)?.totalMinor ?? 0;
  return {
    liquidMinor: groupTotal('liquid'),
    investMinor: groupTotal('invest'),
    assetsMinor: sheet.assetsTotalMinor,
    liabilitiesMinor: sheet.liabilitiesTotalMinor,
    netWorthMinor: sheet.netWorthMinor,
  };
}
```

`OverviewPage.tsx` replaces its inline `groupTotal`/`totals` block with `const totals = sheetTotals(periodSheet);`. Export `sheetTotals`.

- [ ] **Step 2: Test the form helpers**

```ts
// apps/web/src/features/calculators/life-cover-form.test.ts
import { describe, expect, it } from 'vitest';
import { lifeCoverMinor } from '@expanses/core';
import { lifeCoverInputsOf, lifeCoverPrefill } from './life-cover-form';

const totals = { liquidMinor: 200_000_000, investMinor: 0, assetsMinor: 900_000_000, liabilitiesMinor: 300_000_000, netWorthMinor: 600_000_000 };
const plan = (kind: string, stages: { state: string; todayMinor: number }[]) => ({ goal: { kind }, stages }) as never;

describe('life cover prefills', () => {
  it('takes debts and liquid assets from the sheet, and education still to fund in today’s money', () => {
    const prefill = lifeCoverPrefill(totals, [
      plan('education', [{ state: 'paid', todayMinor: 50_000_000 }, { state: 'saving', todayMinor: 100_000_000 }, { state: 'later', todayMinor: 50_000_000 }]),
      plan('holiday', [{ state: 'saving', todayMinor: 30_000_000 }]),
    ]);
    expect(prefill).toEqual({ debtsMinor: 300_000_000, liquidAssetsMinor: 200_000_000, educationMinor: 150_000_000 });
  });

  it('uses what was typed over a prefill, and the prefill where nothing was', () => {
    const inputs = lifeCoverInputsOf(
      { annualNeed: '120.000.000', years: '10', inflation: '3,5', returnPercent: '5', debts: undefined, education: '0', finalExpenses: '25.000.000', liquidAssets: undefined, inForce: '500.000.000' },
      { debtsMinor: 300_000_000, liquidAssetsMinor: 200_000_000, educationMinor: 150_000_000 },
      'IDR',
    );
    expect(inputs).toEqual({
      annualNeedTodayMinor: 120_000_000, yearsOfSupport: 10, inflationBps: 350, returnBps: 500,
      debtsMinor: 300_000_000, educationMinor: 0, finalExpensesMinor: 25_000_000, liquidAssetsMinor: 200_000_000, inForceCoverMinor: 500_000_000,
    });
  });

  it('reads a dollar workspace in cents', () => {
    // parseMajor in USD: "1.200,50" is 120.050 cents; an IDR-style read would make it 120.050 dollars.
    const inputs = lifeCoverInputsOf(
      { annualNeed: '30.000,00', years: '5', inflation: '3,5', returnPercent: '5', debts: '1.200,50', education: undefined, finalExpenses: '', liquidAssets: undefined, inForce: '' },
      { debtsMinor: 0, liquidAssetsMinor: 0, educationMinor: 0 },
      'USD',
    );
    expect(inputs).toMatchObject({ annualNeedTodayMinor: 3_000_000, debtsMinor: 120_050 });
    expect(lifeCoverMinor(inputs).coverMinor).toBe(14_369_257 + 120_050);
  });
});
```

- [ ] **Step 3: The helpers**

```ts
// apps/web/src/features/calculators/life-cover-form.ts
import { type LifeCoverInputs, parseMajor, type SheetTotals } from '@expanses/core';
import type { GoalPlanRow } from '@expanses/db';

export interface LifeCoverPrefill { debtsMinor: number; liquidAssetsMinor: number; educationMinor: number }

/** Debts and liquid assets from the balance sheet; education from the stages of education goals not yet paid, in today's money. */
export function lifeCoverPrefill(totals: SheetTotals, plans: readonly Pick<GoalPlanRow, 'goal' | 'stages'>[]): LifeCoverPrefill {
  const educationMinor = plans
    .filter((plan) => plan.goal.kind === 'education')
    .flatMap((plan) => plan.stages)
    .filter((stage) => stage.state !== 'paid')
    .reduce((total, stage) => total + stage.todayMinor, 0);
  return { debtsMinor: totals.liabilitiesMinor, liquidAssetsMinor: totals.liquidMinor, educationMinor };
}

/** Typed boxes; `undefined` means "not touched", so the prefill stands. */
export interface LifeCoverDraft {
  annualNeed: string; years: string; inflation: string; returnPercent: string; finalExpenses: string; inForce: string;
  debts: string | undefined; education: string | undefined; liquidAssets: string | undefined;
}

const money = (typed: string, currency: string) => (typed.trim() === '' ? 0 : parseMajor(typed, currency));
const bps = (typed: string) => Math.round(Number(typed.replace(',', '.')) * 100);

export function lifeCoverInputsOf(draft: LifeCoverDraft, prefill: LifeCoverPrefill, currency: string): LifeCoverInputs {
  return {
    annualNeedTodayMinor: money(draft.annualNeed, currency),
    yearsOfSupport: Number(draft.years.replace(',', '.')),
    inflationBps: bps(draft.inflation),
    returnBps: bps(draft.returnPercent),
    debtsMinor: draft.debts === undefined ? prefill.debtsMinor : money(draft.debts, currency),
    educationMinor: draft.education === undefined ? prefill.educationMinor : money(draft.education, currency),
    finalExpensesMinor: money(draft.finalExpenses, currency),
    liquidAssetsMinor: draft.liquidAssets === undefined ? prefill.liquidAssetsMinor : money(draft.liquidAssets, currency),
    inForceCoverMinor: money(draft.inForce, currency),
  };
}
```

- [ ] **Step 3b: Remember the life-cover figures (user decision Part 2 Q2) — no schema change**

Test first, in `goal-calculators.test.ts`:

```ts
describe('the life-cover figures', () => {
  it('are remembered per workspace as typed, and no goal reader ever sees them', async () => {
    const { database, ws } = await setupDb();
    expect(await getLifeCoverDraft(database, ws)).toBeNull();
    const draft = { annualNeed: '120.000.000', years: '10', inflation: '3,5', returnPercent: '5', finalExpenses: '', inForce: '500.000.000', debts: undefined, education: '0', liquidAssets: undefined };
    await saveLifeCoverDraft(database, ws, draft);
    await saveLifeCoverDraft(database, ws, { ...draft, years: '15' });
    // Untouched prefilled boxes stay untouched (undefined), so they keep following the balance sheet.
    expect(await getLifeCoverDraft(database, ws)).toEqual({ ...draft, years: '15', debts: undefined, liquidAssets: undefined });
    expect(await listGoalCalculators(database, ws)).toEqual([]);
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([]);
  });
});
```

In `goal-calculators.ts`:

```ts
/**
 * The Calculators page's life-cover figures, kept in goal_calculators with no schema change (0017's kind CHECK allows
 * only the three goal calculators, and goal_id is the key): one reserved row per workspace. `kind` says retirement only
 * because the CHECK demands one of three; `calculator: 'life_cover'` in the JSON is what the row is, and every goal
 * reader skips it by its id.
 */
export const LIFE_COVER_ROW = 'life-cover:';
const lifeCoverId = (ws: WorkspaceContext) => `${LIFE_COVER_ROW}${ws.workspaceId}`;
const isLifeCoverRow = (goalId: string) => goalId.startsWith(LIFE_COVER_ROW);

/** What was typed, as typed; a prefilled box never touched is absent, so it keeps following the balance sheet. */
export interface LifeCoverSaved {
  annualNeed: string; years: string; inflation: string; returnPercent: string; finalExpenses: string; inForce: string;
  debts: string | undefined; education: string | undefined; liquidAssets: string | undefined;
}

export async function saveLifeCoverDraft(database: Database, ws: WorkspaceContext, draft: LifeCoverSaved): Promise<void> {
  const row = { goalId: lifeCoverId(ws), workspaceId: ws.workspaceId, kind: 'retirement' as const, inputsJson: JSON.stringify({ calculator: 'life_cover', version: 2, draft }), computedMinor: 0, computedAt: new Date().toISOString() };
  const { goalId: _goalId, workspaceId: _workspaceId, ...changes } = row;
  await database.db.insert(goalCalculators).values(row).onConflictDoUpdate({ target: goalCalculators.goalId, set: changes });
}

export async function getLifeCoverDraft(database: Database, ws: WorkspaceContext): Promise<LifeCoverSaved | null> {
  const [row] = await database.db.select().from(goalCalculators).where(and(eq(goalCalculators.goalId, lifeCoverId(ws)), eq(goalCalculators.workspaceId, ws.workspaceId)));
  if (!row) return null;
  const { draft } = JSON.parse(row.inputsJson) as { draft: LifeCoverSaved };
  // JSON drops undefined keys; put them back so "never touched" survives the round trip.
  return { ...draft, debts: draft.debts ?? undefined, education: draft.education ?? undefined, liquidAssets: draft.liquidAssets ?? undefined };
}
```

`listGoalCalculators` filters `!isLifeCoverRow(row.goalId)`; `getGoalCalculator` returns null for such an id. (`upgradeCalculatorGoals` reads through `listGoalCalculators`, so it never sees the row.) `LifeCoverDraft` in `life-cover-form.ts` is `LifeCoverSaved` re-exported, one shape.

- [ ] **Step 4: The page**

- **Education** section: `EducationEditor` with a draft opened by `addLevel(educationDraftFrom(undefined, ws.baseCurrency))`. The answer runs the existing readers: `educationPlanStages(inputs, today)` → a synthetic `Goal` (growth = `inputs.feeInflationBps`, return = first stage's return, stages with `returnBps`) → `goalPlan(goal, [], 0, 0, today)`; "You need" is `plan.totalTargetMinor`, "Save each month" is `plan.requiredMonthlyMinor`. Save passes `educationInputsOf(draft, ws.baseCurrency)`.
- **Retirement** section: inflation opens at 3.5, a new **Return while saving (%)** at 10, **Return while retired (%)** at 5. The `Answer` passes `returnBps={bps(returnBefore)}` — the saving-phase return, fixing today's use of the drawdown return — and the target stays `retirementTargetMinor(…)` (the day-you-stop figure, for showing). Save includes `returnBeforeBps`.
- **Life cover** section (after retirement; no save row):

```tsx
  const sheetInputs = useSheet();
  const goalPlans = useGoalPlans();
  const prefill = lifeCoverPrefill(
    sheetTotals(balanceSheet(sheetInputs.data?.assets ?? [], sheetInputs.data?.liabilities ?? [])),
    goalPlans.data?.plans ?? [],
  );
  const [cover, setCover] = useState<LifeCoverDraft>({
    annualNeed: '', years: '10', inflation: String(DEFAULT_INFLATION_BPS / 100), returnPercent: String(DRAWDOWN_RETURN_BPS / 100),
    finalExpenses: '', inForce: '', debts: undefined, education: undefined, liquidAssets: undefined,
  });
  // Part 2 Q2: the figures come back as they were left. Loaded once; typing after that is the user's.
  const remembered = useQuery({ queryKey: ['life-cover', ws.workspaceId], queryFn: () => getLifeCoverDraft(database, ws) });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded && remembered.isSuccess) {
      if (remembered.data) setCover(remembered.data);
      setLoaded(true);
    }
  }, [loaded, remembered.isSuccess, remembered.data]);
  const shown = (typed: string | undefined, prefilled: number) => typed ?? minorToMajorString(prefilled, ws.baseCurrency);
  let result: LifeCover | null = null;
  try {
    const inputs = lifeCoverInputsOf(cover, prefill, ws.baseCurrency);
    if (inputs.annualNeedTodayMinor > 0) result = lifeCoverMinor(inputs);
  } catch {
    result = null;
  }
  // …
      <InsetGroup
        header="Life cover"
        footer="Capital needs analysis: what your family would need, minus what is already there. CFP Board lists it first among the methods; the Insurance Information Institute recommends it and rejects income multiples for assuming no inflation. No figure here is rounded, and no lowest-of-several is taken."
      >
        <TextRow label={`Yearly amount your family needs (${ws.baseCurrency})`} hint="At today's prices." value={cover.annualNeed} onChange={(e) => setCover({ ...cover, annualNeed: e.target.value })} inputMode="numeric" />
        <TextRow label="Years of support" value={cover.years} onChange={(e) => setCover({ ...cover, years: e.target.value })} inputMode="numeric" />
        <TextRow label="Inflation a year (%)" value={cover.inflation} onChange={(e) => setCover({ ...cover, inflation: e.target.value })} inputMode="decimal" />
        <TextRow label="Return on the payout (%)" hint="The money is spent down, so a cautious figure." value={cover.returnPercent} onChange={(e) => setCover({ ...cover, returnPercent: e.target.value })} inputMode="decimal" />
        <TextRow label={`Debts to clear (${ws.baseCurrency})`} hint="From your balance sheet." value={shown(cover.debts, prefill.debtsMinor)} onChange={(e) => setCover({ ...cover, debts: e.target.value })} inputMode="numeric" />
        <TextRow label={`Education still to fund (${ws.baseCurrency})`} hint="From your education goals, at today's prices." value={shown(cover.education, prefill.educationMinor)} onChange={(e) => setCover({ ...cover, education: e.target.value })} inputMode="numeric" />
        <TextRow label={`Final expenses (${ws.baseCurrency})`} value={cover.finalExpenses} onChange={(e) => setCover({ ...cover, finalExpenses: e.target.value })} inputMode="numeric" />
        <TextRow label={`Liquid assets (${ws.baseCurrency})`} hint="From your balance sheet." value={shown(cover.liquidAssets, prefill.liquidAssetsMinor)} onChange={(e) => setCover({ ...cover, liquidAssets: e.target.value })} inputMode="numeric" />
        <TextRow label={`Cover already in force (${ws.baseCurrency})`} hint="Policies you hold, employer group cover included." value={cover.inForce} onChange={(e) => setCover({ ...cover, inForce: e.target.value })} inputMode="numeric" />
      </InsetGroup>
      <InsetGroup>
        <InsetRow title="Keep these figures" chevron={false} onClick={() => void saveLifeCoverDraft(database, ws, cover).then(() => setSaved('Life cover figures'))} />
      </InsetGroup>
      {result && (
        <Panel wide testId="answer-life-cover">
          <div className="grid gap-3 sm:grid-cols-2">
            <Figure caption="Income replacement, today" minor={result.incomeNeedMinor} />
            <Figure caption="Everything needed" minor={result.needsMinor} />
            <Figure caption="Already there" minor={result.resourcesMinor} />
            {result.coverMinor > 0 ? (
              <Figure caption="Cover to hold" minor={result.coverMinor} />
            ) : (
              <Figure caption="No further cover needed · to spare" minor={result.surplusMinor} />
            )}
          </div>
        </Panel>
      )}
```

Then delete `educationStages`, `EducationInputs`' use there (keep the `EducationInputs` type — `educationFromV1` reads it), its tests in `calculators.test.ts`, and its export.

- [ ] **Step 5: E2E**

```ts
// apps/web/e2e/life-cover.spec.ts
import { expect, test } from '@playwright/test';

test('life cover adds every need once and takes off what is already there', async ({ page }) => {
  await page.goto('/calculators');
  const type = async (label: string, text: string) => {
    const box = page.getByLabel(label, { exact: true });
    await box.click();
    await box.press('ControlOrMeta+a');
    await box.pressSequentially(text, { delay: 30 });
  };
  await type('Yearly amount your family needs (IDR)', '120000000');
  await type('Debts to clear (IDR)', '300000000');
  await type('Education still to fund (IDR)', '150000000');
  await type('Final expenses (IDR)', '25000000');
  await type('Liquid assets (IDR)', '200000000');
  await type('Cover already in force (IDR)', '500000000');
  await expect(page.getByTestId('answer-life-cover')).toContainText('884.641.927');

  await type('Liquid assets (IDR)', '2000000000');
  await expect(page.getByTestId('answer-life-cover')).toContainText('No further cover needed');
  await expect(page.getByTestId('answer-life-cover')).toContainText('915.358.073');

  // Part 2 Q2: kept, and back after a reload.
  await page.getByRole('button', { name: 'Keep these figures' }).click();
  await page.reload();
  await expect(page.getByLabel('Liquid assets (IDR)', { exact: true })).toHaveValue('2000000000');
  await expect(page.getByTestId('answer-life-cover')).toContainText('915.358.073');
});
```

In `calculators.spec.ts`, the education tests drive the editor (Add a level, Starts in year, Until year, Academic today) instead of "Fee a year today"; add: the retirement answer's monthly figure with Return while saving 10% differs from the same inputs with it set to 5% (type both, compare the two figures) — the discriminator for the fixed defect.

- [ ] **Step 6: Run** — core and web vitest, root gate, `npx playwright test -c playwright.hr.config.ts '(^|/)life-cover\.spec\.ts$' '(^|/)calculators\.spec\.ts$' '(^|/)net-worth\.spec\.ts$' '(^|/)health-ratios\.spec\.ts$'`. PASS.
- [ ] **Step 7: Commit** — `feat(calculators): life cover by capital needs, education by levels, and retirement saved at its saving return`, trailer.

---

### Task 11: Walk the calculator combinations

**Files:**
- Create: `apps/web/e2e/calculators-combinations.spec.ts`, `apps/web/e2e/phone-calculators-combinations.spec.ts`

Figures typed key by key (`pressSequentially(…, { delay: 30 })`), every assertion a figure.

- [ ] **Step 1: The chromium walk** — one test per row:

| # | Combination | Expected |
|---|---|---|
| 1 | Education goal, **no birthday**, 2032–2038, once 45 jt + yearly 20 jt | stage "today" figures 65.000.000 then 20.000.000 ×5; level subtitle `due 1 January each year` |
| 2 | The same with **birthday** 2026-03-15, ages 6 to 12 | subtitle `Ages 6 to 12 · 2032 to 2038`; first stage dated 15 Mar 2032 |
| 3 | The 45 jt fee switched to **Every year** | first stage 65.000.000, every later one 65.000.000 (the flag moves money) |
| 4 | A level's return left to the band, then typed as 4,5 | "Needed a month" changes when 4,5 is typed |
| 5 | A stage marked paid, then a level added | the paid stage still reads Paid; target rose by exactly the new level's today total |
| 6 | Money set aside (10.000.000) before adding a level | "of Rp …" rises; the 10.000.000 held does not move |
| 7 | Retirement created on the Calculators page | the goal card's growth reads 3,5%, return 10%; the target equals the page's "You need" |
| 8 | Life cover with resources above needs | `No further cover needed` and the surplus |
| 9 | Life cover prefill after adding a loan and an education goal | Debts and Education boxes open at those figures |
| 10 | A holiday goal: change the first stage date from 9 months to 4 years without typing a return | return box reads 6; then type 7 and move the date back — it stays 7 |

- [ ] **Step 2: The phone walk** — rows 1, 5, 8 at phone width.
- [ ] **Step 3: Run both.** Fix failures in the owning task, never by loosening a spec.
- [ ] **Step 4: Commit** — `test(e2e): walk the calculator combinations at both widths`, trailer.

---

### Task 12: Final gate and the spec walk

- [ ] **Step 1:** Root `npm run typecheck && npm test && npm run build`; `cd apps/web && npx playwright test -c playwright.hr.config.ts --workers=2`.
- [ ] **Step 2:** `grep -rn "1800\|0\.18\|18%" packages apps/web/src` — nothing. `grep -rn "educationStages\|stagesFor" packages apps/web/src` — nothing. `grep -rn "Math.min(" packages/core/src/budget/calculators.ts` — nothing (no lowest-of-methods).
- [ ] **Step 3:** Walk the table below; every row on screen and under a test.
- [ ] **Step 4:** Commit fix-ups with the trailer. Do not merge or push.

## Spec → task map (Part 2)

| Spec section | Task |
|---|---|
| §2 inflation 3.5%, 10% saving, 5% retired, bands, retirement growth 3.5%, no 18% | 1, 8 |
| §8 bands prefill new goals, education levels; emergency 2% outside; nothing existing rewritten | 1, 4, 8 |
| §9.1 today's money, growth written, inflate once | 2, 6 |
| §9.2 retirement three rates; Calculators page uses the saving return | 2, 9, 10 |
| §9.3 emergency growth 0% | 6 |
| §9.4 upgrade: silently, only on change, never a hand-typed target, due dates kept | 7 |
| §10 birthday, named levels, ages/years, once/yearly, per-level return, adding keeps progress and paid marks, monthly fees out, 1 January subtitle | 3, 4, 5, 6, 9 |
| §11 life cover: capital needs, prefills, signed-then-clamped, sources named, no rider / min / rounding | 2, 10 |
| §12 workbook bugs: totals through `sheetTotals`, one annuity | 2, 10, 12 |
| §13 `goal_stage_terms` (0053, Part 1) | 5, 6 |
| §15 combinations (calculator rows) | 11 |
