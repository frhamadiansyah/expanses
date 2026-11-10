# Shared Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** A per-goal switch that shares one goal with every member of a shared workspace — one target, one set of stages, each person's funding shown by account name — while each person's money stays on their own phone and every other member keeps a private copy when sharing ends.

**Architecture:** The goal and its stages, terms and calculator travel as row entities in the household book's existing log, scoped by a new link table (`goal_shares`); each member's own funding and History reach the others as summaries written only by that member (`goal_member_funding`, `goal_member_moves`). Off, delete and Leave are state rows, never deletes: capture sends no deletes for rows that leave scope with their link, and apply's follow-up turns a non-sharer's copy into a private goal under new ids. Reads add the other members' lines to the plan, history and screens.

**Tech Stack:** TypeScript, SQLite (sqlite-wasm / better-sqlite3 in tests) via drizzle-orm `sql`, vitest, React 19 + TanStack Router/Query, Playwright with the local relay Worker.

**Spec:** `docs/superpowers/specs/2026-11-10-shared-goals-design.md` (binding; v2 with owner decisions D1–D10 and calls C1–C33). Background: `docs/superpowers/specs/2026-09-26-household-sharing-design.md` (§6.4 capture harness, §7 apply, §8.6 stop sharing).

## Global Constraints

- Migration is `packages/db/migrations/0109_shared_goals.sql` (latest today: `0108_card_terms_days_optional.sql`).
- Version gate: `SHARED_GOALS_MIN_APP_VERSION = '0.5.0'`; `apps/web/package.json` goes from `0.4.0` to `0.5.0`.
- UI copy is impersonal: never "you"/"your" in any string a screen shows or a repository throws; people are named.
- No sample numbers in placeholders or hints.
- Test fixtures are invented: no real bank or account names, no real statement figures; currency codes are allowed.
- Features stay country-neutral; nothing here is Indonesia-specific.
- Money logic has tests: every figure that reaches a plan, a bar, a summary or the budget is asserted with exact minor units.
- Never synced: account ids, balances, short-by figures, transaction ids, `transactions.goal_id` (spec §7.1).
- A partner's money never reaches net worth, the tax report, health ratios, idle cash, `setAsideViews` or `goalContributionsFor`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Shared, turned off, turned on again while the partner was offline** — the partner ends with a private copy (new id, own money, History intact) and the re-shared goal beside it; nothing is tombstoned, nothing skipped. Test: Task 8 `goal-share-lifecycle.test.ts` "off and on while Rina is offline".
2. **A device on an older build in the book** — the switch is not offered while any device not removed reports below `0.5.0`; a removed old device does not block it. Test: Task 4 `goal-sharing-targets.test.ts` "an old device hides the switch".
3. **Two edits to one stage at once** — Rina renames a stage while Bima marks it paid: both land everywhere; Bima removes a stage while Rina marks it paid: removed everywhere, no skips; a stage Rina spent against cannot be removed. Tests: Task 14 `goal-sharing-sync.test.ts` "crossing stage edits"; Task 10 `goal-sharing-writes.test.ts` "a stage the partner spent against stays".
4. **The partner's account in another currency** — a USD set-aside on an IDR goal travels as the IDR figure at Rina's rate; with no rate it travels as `null` and both phones leave it out and warn; both totals agree to the unit. Tests: Task 7 `goal-summaries.test.ts` "foreign account"; Task 12 `goal-sharing-reads.test.ts` "no rate on the partner's phone".
5. **A member who joins the workspace later** — reads every shared goal from the log, is named in the label on the others' phones, writes no empty funding summary; a second device of an existing member writes none either. Tests: Task 14 "a member who joins later"; Task 9 `goal-summary-send.test.ts` "a second device writes nothing".

## Waves

Tasks in one wave touch disjoint files and can run in parallel; a wave starts when the previous one is merged.

| Wave | Tasks | Needs |
|---|---|---|
| 1 | Task 1 (migration, schema), Task 2 (core helper) | — |
| 2 | Task 3 (entities, never-synced, seed), Task 4 (authority predicate, version, eligibility), Task 5 (private-copy re-key) | Task 1 |
| 3 | Task 6 (capture and apply plumbing), Task 7 (own funding and moves, computed) | Tasks 3, 4 |
| 4 | Task 8 (share, off, delete, Leave, share end), Task 9 (summaries sent) | Tasks 5, 6, 7 |
| 5 | Task 10 (goal writes captured, sharer rules), Task 11 (calculators), Task 12 (plan reads, budget) | Tasks 8, 9 |
| 6 | Task 13 (history reads), Task 14 (household convergence), Task 15 (web model, queries, switch) | Wave 5 |
| 7 | Task 16 (goal page, list), Task 17 (history page) | Tasks 13, 15 |
| 8 | Task 18 (two-phone E2E) | all |

Disjointness: `packages/db/src/index.ts` is touched only by Task 1 (wave 1), Task 4 (wave 2) and Task 8 (wave 4). `apply.ts`: Task 6 (wave 3), Task 8 (wave 4). `capture.ts`: Task 6 (wave 3), Task 9 (wave 4). `goals.ts`: Task 9 (wave 4, dirty marks only), Task 10 (wave 5). `goal-funding.ts`: Task 9 (wave 4, two dirty marks), Task 12 (wave 5), Task 13 (wave 6). `goal-sharing.ts` (db): Task 4 (wave 2), Task 8 (wave 4), Task 11 (wave 5, one call in `shareGoal`). `apps/web/src/features/goals/goal-sharing.ts`: Task 15 only.

Commands: `cd packages/db && npx vitest run <file>`; `cd packages/core && npx vitest run <file>`; `cd apps/web && npx vitest run <file>`; `npm run test:capture` (repo root, the §6.4 harness over the whole db suite); `npm run typecheck`; `cd apps/web && npx playwright test <file> --project=phone`.

## File map

| File | Responsibility | Task |
|---|---|---|
| Create `packages/db/migrations/0109_shared_goals.sql` | the five tables of spec §7.2 | 1 |
| Modify `packages/db/src/migrations.ts:108`, `:224` | register 0109 | 1 |
| Create `packages/db/src/schema-goal-sharing.ts` | drizzle tables for the five | 1 |
| Create `packages/db/src/repos/goal-sharing-tables.ts` | `goalSharingTablesExist` | 1 |
| Modify `packages/core/src/goals/plan.ts` (after `fitByRank`, line 228) | `ownShareOfNeedMinor` | 2 |
| Modify `packages/db/src/sync/shared-entities.ts:76-545`, `:552-605` | eight entity records, never-synced lists | 3 |
| Modify `packages/db/src/sync/authority.ts:452` | `goal_member_move.memberId` frozen | 3 |
| Modify `packages/db/src/sync/seed.ts:201` | goal entities in `rowsInScopeTx` | 3 |
| Create `packages/db/src/sync/goals/authority.ts` | `goalWriteRefusal` (spec §8.4) | 4 |
| Create `packages/db/src/sync/goals/version.ts` | `SHARED_GOALS_MIN_APP_VERSION` | 4 |
| Create `packages/db/src/repos/goal-sharing.ts` | eligibility (Task 4); share, off, Leave, views (Task 8) | 4, 8 |
| Modify `apps/web/package.json:3` | version `0.5.0` | 4 |
| Create `packages/db/src/repos/goal-private-copy.ts` | `rekeyGoalTx` (C30) | 5 |
| Create `packages/db/src/sync/goals/scope.ts` | link state reads used by capture and apply | 6 |
| Modify `packages/db/src/sync/capture.ts:712-760` | goal predicate at capture; no scope-leave deletes | 6 |
| Modify `packages/db/src/sync/apply.ts:222-233`, `:282-298`, `:1155-1172` | parents, predicate on apply, drops, rank on insert | 6 |
| Create `packages/db/src/sync/goals/summaries.ts` | own funding lines and moves (Task 7); send at flush (Task 9) | 7, 9 |
| Modify `packages/db/src/repos/goal-contributions.ts:33-40`, `:54`, `:75`, `:108`, `:141` | `sourceId` on each event | 7 |
| Create `packages/db/src/sync/goals/follow.ts` | apply-side follow-up of link and leave changes | 8 |
| Modify `packages/db/src/sync/apply.ts` (after `applyRowOp` call, ~1162) | call the follow-up | 8 |
| Modify `packages/db/src/sync/engine.ts:888-930`, `:1057-1064` | share end → `endSharedGoalsTx` | 8 |
| Modify `packages/db/src/sync/capture.ts:292-340` | `markGoalDirty`, send at flush | 9 |
| Modify `packages/db/src/repos/goals.ts:349-438`, `set-aside-tx.ts:97-220,427`, `goal-funding.ts:117,149`, `trade-templates.ts`, `trades.ts` | dirty marks | 9 |
| Modify `apps/web/src/db/bootstrap.ts:115` | daily resend at open | 9 |
| Modify `packages/db/src/repos/goals.ts:162-332`, `:251-283` | captured writes, sharer rules, partner-aware locks | 10 |
| Modify `packages/db/src/repos/set-aside-tx.ts:307-394` | a spend's stage mark captured | 10 |
| Modify `packages/db/src/repos/goal-calculators.ts:32-52`, `:293-500` | frozen outgoing (D8), captured writes, upgrade sharer-only | 11 |
| Modify `packages/db/src/repos/goal-funding.ts:51-77`, `:186-426` | others' lines, planned, frozen outgoing, fit, wholeness | 12 |
| Modify `packages/db/src/repos/budget-sheet.ts:109-114` | savings plan per C20 | 12 |
| Modify `packages/db/src/repos/goal-funding.ts:428-501` | history with `by` and share kinds | 13 |
| Create `apps/web/src/features/goals/goal-sharing.ts` | label, initials, funding groups, hero segments | 15 |
| Modify `apps/web/src/features/goals/queries.ts` | `useGoalShareTargets`, `useGoalShare` | 15 |
| Modify `apps/web/src/features/goals/GoalForm.tsx:187-208`, `:376-392` | switch or picker, Leave, confirms | 15 |
| Modify `apps/web/src/features/goals/goal-cards.ts:106-113`, `:177-200` | own vs others on the card; list total C21 | 16 |
| Modify `apps/web/src/features/goals/GoalPage.tsx:100-298`, `funding.tsx:36-57`, `GoalsPage.tsx:40-72` | hero, Funded by groups, menu, list initials | 16 |
| Create `apps/web/src/features/goals/history-lines.ts`; modify `GoalHistoryPage.tsx:9-45` | titles and person per line | 17 |
| Create `apps/web/e2e/phone-shared-goals.spec.ts` | two phones, the mock-up | 18 |

---

### Task 1: Migration 0109 and schema

Spec §7.2.

**Files:**
- Create: `packages/db/migrations/0109_shared_goals.sql`
- Modify: `packages/db/src/migrations.ts:108` (import), `:224` (entry `{ version: 109, name: 'shared_goals', sql: sharedGoals }`)
- Create: `packages/db/src/schema-goal-sharing.ts`
- Create: `packages/db/src/repos/goal-sharing-tables.ts`
- Modify: `packages/db/src/index.ts:65` (add `export * as goalSharingSchema from './schema-goal-sharing';`)
- Test: `packages/db/test/goal-sharing-migration.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: tables `goal_shares`, `goal_share_leaves`, `goal_member_funding`, `goal_member_moves`, `goal_share_log` exactly as spec §7.2 (with `goal_share_log.copied_from`); drizzle `goalShares`, `goalShareLeaves`, `goalMemberFunding`, `goalMemberMoves`, `goalShareLog`; `goalSharingTablesExist(db: Db): Promise<boolean>` (positive answer cached per handle, as `goalCurrencyExists`, `goals.ts:22-28`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/goal-sharing-migration.test.ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LATEST_VERSION } from '../src/migrations';
import { goalSharingTablesExist } from '../src/repos/goal-sharing-tables';
import { setupDb } from './helpers';

describe('migration 0109', () => {
  it('is the latest and makes the five tables', async () => {
    const { database } = await setupDb();
    expect(LATEST_VERSION).toBe(109);
    expect(await goalSharingTablesExist(database.db)).toBe(true);
    const names = (await database.db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'goal_share%' OR name LIKE 'goal_member%') ORDER BY name`)).map(([n]) => n);
    expect(names).toEqual(['goal_member_funding', 'goal_member_moves', 'goal_share_leaves', 'goal_share_log', 'goal_shares']);
  });
  it('a link starts at round 1 and has no left state', async () => {
    const { database } = await setupDb();
    await database.db.run(sql`INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on) VALUES ('g1', 'b1', 'w1', 'member-a', 'on', '2026-11-10')`);
    expect(await database.db.values(sql`SELECT round FROM goal_shares`)).toEqual([[1]]);
    await expect(database.db.run(sql`UPDATE goal_shares SET state = 'left'`)).rejects.toThrow(/CHECK/);
  });
  it('a move kind outside the five is refused', async () => {
    const { database } = await setupDb();
    await expect(database.db.run(sql`INSERT INTO goal_member_moves (id, goal_id, workspace_id, member_id, kind, occurred_on, amount_minor, currency, text) VALUES ('m1','g1','w1','member-a','bought','2026-11-10',1,'IDR','x')`)).rejects.toThrow(/CHECK/);
  });
});
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/goal-sharing-migration.test.ts` — expected FAIL (`LATEST_VERSION` is 108; module not found).
- [ ] **Step 3: Implement** the SQL of spec §7.2 verbatim (header comment in the repo's voice; depends on no other migration's tables, as 0050), the registry entry, the drizzle tables, `goalSharingTablesExist`.
- [ ] **Step 4: Run** the test — expected PASS. Run `npx vitest run test/migrations*.test.ts` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/migrations/0109_shared_goals.sql packages/db/src/migrations.ts packages/db/src/schema-goal-sharing.ts packages/db/src/repos/goal-sharing-tables.ts packages/db/src/index.ts packages/db/test/goal-sharing-migration.test.ts && git commit -m "Migration 0109: the tables a shared goal needs"`

### Task 2: Core — this phone's part of a shared need

Spec C20.

**Files:**
- Modify: `packages/core/src/goals/plan.ts` (append after `fitByRank`, line 228); export from `packages/core/src/index.ts` beside `goalPlan`
- Test: `packages/core/test/goal-shared-need.test.ts`

**Interfaces:**
- Produces: `ownShareOfNeedMinor(neededMonthlyMinor: number, othersPlannedMonthlyMinor: number): number` — `max(0, needed − othersPlanned)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { goalPlan, ownShareOfNeedMinor } from '../src';

describe('a shared goal', () => {
  it('leaves this phone the need less what the others have set up, never below nought', () => {
    expect(ownShareOfNeedMinor(3_000_000, 1_000_000)).toBe(2_000_000);
    expect(ownShareOfNeedMinor(1_000_000, 3_000_000)).toBe(0);
    expect(ownShareOfNeedMinor(0, 0)).toBe(0);
  });
  it('a partner line counts in what is held like any link', () => {
    const goal = { id: 'g', name: 'Trip', kind: 'other' as const, rank: 0, growthBps: 0, returnBps: 0, standingMonthlyMinor: 0, standingNote: null, stages: [{ id: 's', name: 'All', targetMinor: 180_000_000, targetMonths: null, dueOn: '2030-06-01', paidOn: null }] };
    const own = { accountId: 'a', name: 'Main Savings', kind: 'earmark' as const, unitsMicro: null, valueMinor: 28_000_000, currency: 'IDR', baseMinor: 28_000_000, risk: null };
    const theirs = { ...own, accountId: 'line-1', name: 'Partner Savings', valueMinor: 14_000_000, baseMinor: 14_000_000 };
    const plan = goalPlan(goal, [own, theirs], 0, 0, '2026-11-10');
    expect(plan.currentMinor).toBe(42_000_000);
    expect(plan.allTargetMinor).toBe(180_000_000);
  });
});
```

- [ ] **Step 2: Run** `cd packages/core && npx vitest run test/goal-shared-need.test.ts` — expected FAIL (`ownShareOfNeedMinor` not exported).
- [ ] **Step 3: Implement** the function with a why-comment citing C20.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `git add packages/core/src/goals/plan.ts packages/core/src/index.ts packages/core/test/goal-shared-need.test.ts && git commit -m "Core: the part of a shared goal's monthly need left to this phone"`

### Task 3: Entities, never-synced columns, seed order

Spec §7.1, §8.1, §8.6.

**Files:**
- Modify: `packages/db/src/sync/shared-entities.ts` (eight records appended before the `purchase` record at line 490; `NEVER_SYNCED_COLUMNS` at 552-605)
- Modify: `packages/db/src/sync/authority.ts:452` (`goal_member_move: ['memberId']`)
- Modify: `packages/db/src/sync/seed.ts:201` (after `book_transfer`)
- Test: `packages/db/test/sync/goal-entities.test.ts`; the existing `packages/db/test/sync/shared-entities.test.ts` must stay green

**Interfaces:**
- Produces: entities `goal_share`, `goal_share_leave`, `goal`, `goal_stage`, `goal_stage_term`, `goal_calculator`, `goal_member_funding`, `goal_member_move` with keys, scopes, fields and writers exactly as spec §8.1 (`goal_share` / `goal_share_leave` / goal-family writers other than funding and moves come from Task 4's predicate, so they have no `writer` here). Field names: `goal_share {sharedBy, state, stateOn, round}`, `goal_share_leave {round, leftOn}`, `goal {name, kind, growthBps, returnBps, currency, status}`, `goal_stage {goalId, name, targetMinor, targetMonths, dueOn, sort, paidOn}`, `goal_stage_term {goalId, returnBps, derivedKey}`, `goal_calculator {kind, inputs, computedMinor, computedAt}`, `goal_member_funding {lines, plannedMonthlyMinor, asOf}`, `goal_member_move {goalId, memberId, kind, occurredOn, amountMinor, currency, text, stageId}`. `localOnInsert`: `goal_share: ['book_id']`, `goal: ['created_at']`, others `[]`. Never synced: `goals: ['workspace_id','rank','standing_monthly_minor','standing_note','created_at']`, `goal_stages`/`goal_stage_terms`/`goal_calculators`/`goal_share_leaves`/`goal_member_funding`/`goal_member_moves: ['workspace_id']`, `goal_shares: ['book_id','workspace_id']`.
- Exported constant `GOAL_FAMILY: ReadonlySet<string>` (the six entities scoped by "on links") from `shared-entities.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/sync/goal-entities.test.ts
describe('goal entities', () => {
  it('a goal is in the book only while its link is on', async () => {
    // setupDb; saveGoal 'Trip Fund' (one stage Rp 180.000.000 due 2030-06-01); insert goal_shares(goal, book, 'on')
    // SELECT through entityOf('goal').scope(bookId) finds the goal; UPDATE state = 'off' → finds nothing
    expect(onIds).toEqual([goalId]);
    expect(offIds).toEqual([]);
  });
  it('a member summary is keyed by goal and member', () => {
    expect(buildOpId(entityOf('goal_member_funding'), { goal_id: 'g1', member_id: 'member-rina' })).toBe('g1|member-rina');
  });
  it('a member summary and a move are their member\'s alone', () => {
    const funding = entityOf('goal_member_funding') as RowEntity;
    expect(funding.writer!({}, { goal_id: 'g1', member_id: 'member-rina' })).toBe('member-rina');
    const move = entityOf('goal_member_move') as RowEntity;
    expect(move.writer!({ memberId: 'member-rina' }, { id: 'm1' })).toBe('member-rina');
  });
  it('the seed sends the link before the goal before its stages', async () => {
    const ops = await rowsInScopeTx(tx, book, () => true);
    const order = ops.map((op) => op.entity).filter((e) => e.startsWith('goal'));
    expect(order.slice(0, 3)).toEqual(['goal_share', 'goal', 'goal_stage']);
  });
  it('rank, standing amount and note never travel', () => {
    expect(NEVER_SYNCED_COLUMNS.goals).toEqual(expect.arrayContaining(['rank', 'standing_monthly_minor', 'standing_note']));
  });
});
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/sync/goal-entities.test.ts test/sync/shared-entities.test.ts` — expected FAIL (`Unknown shared entity "goal"`).
- [ ] **Step 3: Implement** the records (comment block in the style of the events block at `shared-entities.ts:383-389`), the lists, the frozen field, the seed line `ops.push(...(await rows('goal_share')), ...(await rows('goal_share_leave')), ...(await rows('goal')), ...(await rows('goal_stage')), ...(await rows('goal_stage_term')), ...(await rows('goal_calculator')), ...(await rows('goal_member_funding')), ...(await rows('goal_member_move')))`.
- [ ] **Step 4: Run** — expected PASS. `npm run test:capture` — expected PASS (no goal write is in a shared book yet: no goal is linked).
- [ ] **Step 5: Commit** `git add packages/db/src/sync/shared-entities.ts packages/db/src/sync/authority.ts packages/db/src/sync/seed.ts packages/db/test/sync/goal-entities.test.ts && git commit -m "Sync: a shared goal's eight entities, what never travels, and their seed order"`

### Task 4: Who may write what, the version, who can be shared with

Spec §8.4, §8.6, C3, C31, D6, D10.

**Files:**
- Create: `packages/db/src/sync/goals/authority.ts`, `packages/db/src/sync/goals/version.ts`
- Create: `packages/db/src/repos/goal-sharing.ts` (eligibility only in this task)
- Modify: `packages/db/src/index.ts` (export `goalShareTargets`, `type GoalShareTarget`, `SHARED_GOALS_MIN_APP_VERSION`)
- Modify: `apps/web/package.json:3` → `"version": "0.5.0"`
- Test: `packages/db/test/sync/goal-authority.test.ts`, `packages/db/test/goal-sharing-targets.test.ts`

**Interfaces:**
- Consumes: `meetsVersion(have, want)` (`sync/events/version.ts`), `listSharedBooks` (`repos/sharing.ts:78`).
- Produces:
  - `interface GoalLinkView { sharedBy: string; state: 'on' | 'off' | 'deleted'; round: number }`
  - `GOAL_SHARE_ENTITIES: ReadonlySet<string>` (`goal_share`, `goal_share_leave`, `goal`, `goal_stage`, `goal_stage_term`, `goal_calculator`)
  - `goalWriteRefusal(entity: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, key: Record<string, string>, member: string | null, link: GoalLinkView | null): string | null` — the text after `AUTHORITY: `, or null. Pure; `link` is the stored link as applied in log order.
  - `SHARED_GOALS_MIN_APP_VERSION = '0.5.0'`
  - `interface GoalShareTarget { bookId: string; bookName: string; me: string; others: { memberId: string; name: string }[] }`
  - `goalShareTargets(database: Database): Promise<GoalShareTarget[]>` — active workspace books (not event books, not group logs) with at least one other member, where every device with `removed_at IS NULL` has `app_version` meeting the gate; others ordered by `joined_at`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/sync/goal-authority.test.ts
const on: GoalLinkView = { sharedBy: 'member-f', state: 'on', round: 1 };
it.each([
  ['a new link by its sharer', 'goal_share', null, { sharedBy: 'member-f', state: 'on', round: 1 }, { goal_id: 'g' }, 'member-f', null, null],
  ['a new link naming someone else', 'goal_share', null, { sharedBy: 'member-r', state: 'on', round: 1 }, { goal_id: 'g' }, 'member-f', null, 'a goal is shared by its sharer'],
  ['off by the sharer', 'goal_share', { sharedBy: 'member-f', state: 'on', round: 1 }, { sharedBy: 'member-f', state: 'off', round: 1 }, { goal_id: 'g' }, 'member-f', on, null],
  ['off by another member', 'goal_share', { sharedBy: 'member-f', state: 'on', round: 1 }, { sharedBy: 'member-f', state: 'off', round: 1 }, { goal_id: 'g' }, 'member-r', on, 'only the sharer changes the share'],
  ['on again without a new round', 'goal_share', { sharedBy: 'member-f', state: 'off', round: 1 }, { sharedBy: 'member-f', state: 'on', round: 1 }, { goal_id: 'g' }, 'member-f', { ...on, state: 'off' }, 'turning it on again starts a new round'],
  ['back from deleted', 'goal_share', { sharedBy: 'member-f', state: 'deleted', round: 1 }, { sharedBy: 'member-f', state: 'on', round: 2 }, { goal_id: 'g' }, 'member-f', { ...on, state: 'deleted' }, 'a deleted goal stays deleted'],
  ['a leave by its member, this round', 'goal_share_leave', null, { round: 1, leftOn: '2026-11-10' }, { goal_id: 'g', member_id: 'member-r' }, 'member-r', on, null],
  ['a leave by the sharer', 'goal_share_leave', null, { round: 1, leftOn: '2026-11-10' }, { goal_id: 'g', member_id: 'member-f' }, 'member-f', on, 'the sharer turns it off instead'],
  ['a leave for someone else', 'goal_share_leave', null, { round: 1, leftOn: '2026-11-10' }, { goal_id: 'g', member_id: 'member-r' }, 'member-a', on, 'each member leaves only for themselves'],
  ['a leave for an old round', 'goal_share_leave', null, { round: 1, leftOn: '2026-11-10' }, { goal_id: 'g', member_id: 'member-r' }, 'member-r', { ...on, round: 2 }, 'a leave names the current round'],
  ['archive by another member', 'goal', { status: 'active', name: 'Trip' }, { status: 'archived', name: 'Trip' }, { id: 'g' }, 'member-r', on, 'only the sharer archives'],
  ['a rename by another member', 'goal', { status: 'active', name: 'Trip' }, { status: 'active', name: 'Trip 2030' }, { id: 'g' }, 'member-r', on, null],
  ['a goal deleted by op', 'goal', { status: 'active', name: 'Trip' }, null, { id: 'g' }, 'member-f', on, 'a shared goal ends by its link'],
  ['a stage removed by anyone', 'goal_stage', { name: 'Deposit' }, null, { id: 's' }, 'member-r', on, null],
])('%s', (_label, entity, before, after, key, member, link, refusal) => {
  expect(goalWriteRefusal(entity, before, after, key, member, link)).toBe(refusal);
});
```

```ts
// packages/db/test/goal-sharing-targets.test.ts  (Household from test/sync/household.ts; devices at appVersion '0.5.0' unless said)
it('no shared workspace, no target', async () => { expect(await goalShareTargets(fandri.database)).toEqual([]); });
it('one other member', async () => {
  expect(await goalShareTargets(fandri.database)).toEqual([{ bookId: h.bookId, bookName: 'Personal', me: 'member-Bima', others: [{ memberId: 'member-Rina', name: 'Rina' }] }]);
});
it('an old device hides the switch', async () => { /* Rina's device at '0.4.0' */ expect(await goalShareTargets(fandri.database)).toEqual([]); });
it('a removed old device does not', async () => { /* Rina's old device removed (engine.removeDevice), new one at 0.5.0 */ expect((await goalShareTargets(fandri.database)).length).toBe(1); });
it('a book no longer shared is no target', async () => { /* Bima stopSharing */ expect(await goalShareTargets(rina.database)).toEqual([]); });
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/sync/goal-authority.test.ts test/goal-sharing-targets.test.ts` — expected FAIL (modules not found).
- [ ] **Step 3: Implement** the predicate (a header comment in the shape of `events/authority.ts:1-16`, listing each rule with its D/C number), the constant, `goalShareTargets`, the version bump.
- [ ] **Step 4: Run** — expected PASS; `npm run typecheck` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/goals packages/db/src/repos/goal-sharing.ts packages/db/src/index.ts apps/web/package.json packages/db/test/sync/goal-authority.test.ts packages/db/test/goal-sharing-targets.test.ts && git commit -m "Shared goals: who may write what, the 0.5.0 gate, and who a goal can be shared with"`

### Task 5: A private copy under new ids

Spec C30, D7.

**Files:**
- Create: `packages/db/src/repos/goal-private-copy.ts`
- Test: `packages/db/test/goal-private-copy.test.ts`

**Interfaces:**
- Consumes: `goalSharingTablesExist` (Task 1), `goalPartsTableExists`, `setAsideTablesExist`, `healthTablesExist`.
- Produces: `rekeyGoalTx(tx: Db, ws: WorkspaceContext, goalId: string, opts?: { copiedFrom?: string; logLine?: { kind: 'unshared' | 'ended'; memberName: string; occurredOn: string } }): Promise<{ goalId: string; stageIds: Record<string, string> }>` — new uuidv7 ids for the goal and each stage; every local row naming them follows (`goal_earmarks`, `goal_contributions`, `goal_draws` (goal_id and stage_id), `goal_calculators`, `goal_stage_terms`, `trade_goal_parts`, `investment_trades`, `trade_templates`, `asset_sales`, `transactions`, `events`, `goal_share_log`); the old goal and stage rows are gone; `goal_member_funding` and `goal_member_moves` of the old id are deleted (the others' lines go); writes one `goal_share_log` line with `copied_from` when `logLine` is given. The caller runs it with capture suspended or paused (it must emit nothing).

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/goal-private-copy.test.ts — setupDb; account 'Main Savings' (savings, IDR) with an opening 30_000_000;
// goal 'Trip Fund', stages 'Deposit' 25_000_000 due 2027-01-10 and 'Balance' 155_000_000 due 2030-06-01;
// saveEarmark 10_000_000; a spend draw against 'Deposit' of 2_000_000; a tagged buy; a monthly template on the goal.
it('moves everything to new ids and changes no figure', async () => {
  const before = { plan: planOf(await goalPlansFor(database, ws, '2026-11-10'), goalId), put: await goalContributionsFor(database, ws, '2026-11'), history: (await goalHistory(database, ws, '2026-11-10', { limit: null }))[goalId] };
  const { goalId: copy, stageIds } = await database.transaction((tx) => rekeyGoalTx(tx, ws, goalId, { copiedFrom: goalId, logLine: { kind: 'unshared', memberName: 'Bima', occurredOn: '2026-11-10' } }));
  expect(copy).not.toBe(goalId);
  expect((await listGoals(database, ws)).map((g) => g.id)).toEqual([copy]);
  expect(await listEarmarks(database, ws)).toEqual([{ goalId: copy, accountId: savings, amountMinor: 10_000_000 }]);
  expect((await goalContributionsFor(database, ws, '2026-11'))[copy]).toBe(before.put[goalId]);
  expect((await listDraws(database, ws))[0]).toMatchObject({ goalId: copy, stageId: stageIds[depositId] });
  expect(planOf(await goalPlansFor(database, ws, '2026-11-10'), copy).currentMinor).toBe(before.plan.currentMinor);
  expect((await goalHistory(database, ws, '2026-11-10', { limit: null }))[copy]!.map((e) => [e.kind, e.amountMinor])).toEqual(before.history!.map((e) => [e.kind, e.amountMinor]));
  expect(await database.db.values(sql`SELECT kind, copied_from FROM goal_share_log WHERE goal_id = ${copy}`)).toEqual([['unshared', goalId]]);
});
it('drops the other members\' lines of the old id', async () => {
  // a goal_member_funding row for member-rina and a goal_member_moves row on goalId
  expect(await database.db.values(sql`SELECT count(*) FROM goal_member_funding`)).toEqual([[0]]);
  expect(await database.db.values(sql`SELECT count(*) FROM goal_member_moves`)).toEqual([[0]]);
});
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/goal-private-copy.test.ts` — expected FAIL (module not found).
- [ ] **Step 3: Implement** `rekeyGoalTx` (insert copies, re-point, delete old, in one pass; plain SQL so a missing older table reads as none, as `goalHasFunding`, `goals.ts:251-267`).
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/repos/goal-private-copy.ts packages/db/test/goal-private-copy.test.ts && git commit -m "A goal's private copy: new ids, every record kept"`

### Task 6: Capture and apply plumbing

Spec §8.3 (option b), §8.4, C29.

**Files:**
- Create: `packages/db/src/sync/goals/scope.ts`
- Modify: `packages/db/src/sync/capture.ts:712-731` (a `GOAL_SHARE_ENTITIES` branch beside the events branch), `:740-760` (no delete for a row that left with its link)
- Modify: `packages/db/src/sync/apply.ts:222-233` (`PARENTS`), `:282-298` (`insertRow`: `goals.rank` = next rank), `:1155-1172` (predicate on apply; drops)
- Test: `packages/db/test/sync/goal-capture.test.ts`

**Interfaces:**
- Consumes: `goalWriteRefusal`, `GoalLinkView` (Task 4); `GOAL_FAMILY` (Task 3).
- Produces:
  - `goalLinkOfTx(tx: Db, goalId: string): Promise<(GoalLinkView & { bookId: string }) | null>`
  - `goalOfRowTx(tx: Db, entity: string, key: Record<string, string>, fields: Record<string, unknown>): Promise<string | null>` — the goal a goal-family row belongs to
  - `leftWithLinkTx(tx: Db, entity: string, key: Record<string, string>, values: Record<string, unknown>): Promise<boolean>` — true when the row's goal link is no longer `'on'` (or this member left this round)
  - `memberLeftTx(tx: Db, goalId: string, memberId: string): Promise<boolean>` — a leave for the link's current round
  - Apply behaviour: an op for a goal-family row whose link is not `'on'` returns without writing and without a `sync_skipped` row; on a device whose member left this round, the same; a refusal from `goalWriteRefusal` is an `AuthorityError` (recorded skip).

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/sync/goal-capture.test.ts — shareBookForTest(database, bookId, 'member-f'); goal 'Trip Fund' with two stages
it('a link and its goal go out in order, in one change-set', async () => {
  await database.transaction((tx) => withCapture(tx, [{ entity: 'goal_share', id: goalId }, { entity: 'goal', id: goalId }, { entity: 'goal_stage' }], () => insertLinkTx(tx, goalId, bookId, 'member-f')));
  expect((await outboxOps(database)).map((op) => [op.entity, op.op])).toEqual([['goal_share', 'upsert'], ['goal', 'upsert'], ['goal_stage', 'upsert'], ['goal_stage', 'upsert']]);
});
it('off sends only the link, even with a partner\'s summary here', async () => {
  // a goal_member_funding row for member-r inserted with capture paused; clearOutbox
  await database.transaction((tx) => withCapture(tx, [{ entity: 'goal_share', id: goalId }, { entity: 'goal_member_funding' }, { entity: 'goal' }, { entity: 'goal_stage' }], () => tx.run(sql`UPDATE goal_shares SET state = 'off' WHERE goal_id = ${goalId}`)));
  expect((await outboxOps(database)).map((op) => [op.entity, op.op, op.op === 'upsert' ? op.fields.state : null])).toEqual([['goal_share', 'upsert', 'off']]);
});
it('another member cannot archive on this phone', async () => {
  // this device's member is member-r; link sharedBy member-f
  await expect(database.transaction((tx) => withCapture(tx, { entity: 'goal', id: goalId }, () => tx.run(sql`UPDATE goals SET status = 'archived' WHERE id = ${goalId}`)))).rejects.toThrow(/only the sharer archives/);
});
it('an op for a goal no longer shared is dropped, not skipped', async () => {
  // link state 'off' here; apply a change-set with a goal_stage upsert for that goal
  expect(await database.db.values(sql`SELECT count(*) FROM goal_stages WHERE goal_id = ${goalId} AND name = 'From afar'`)).toEqual([[0]]);
  expect(await skipsOf(database)).toEqual([]);
});
it('a forged off from another member is a recorded skip', async () => {
  expect((await skipsOf(database))[0]).toMatchObject({ entity: 'goal_share', error: expect.stringMatching(/^AUTHORITY: only the sharer changes the share/) });
});
it('a goal arriving on a phone goes to the end of its list', async () => {
  // two local goals ranked 0 and 1; apply link + goal upserts for a third
  expect((await listGoals(database, ws)).map((g) => g.name)).toEqual(['First', 'Second', 'Trip Fund']);
});
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/sync/goal-capture.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** `scope.ts`; the capture branch (judge with the same predicate on the pre-image, as `capture.ts:712-731`); in the delete loop (`capture.ts:755-760`) skip a row when `GOAL_FAMILY` has its entity and `leftWithLinkTx` is true; `PARENTS` gains `goal_stage: { table: 'goals', from: 'field', name: 'goalId' }`, `goal_stage_term` and `goal_member_move` the same, `goal_calculator` and `goal_member_funding: { table: 'goals', from: 'key', name: 'goal_id' }` (and `PARENT_ENTITY.goals = 'goal'`); a goal's own link is not a `PARENTS` entry, since `parentMissing` reads an `id` column (`apply.ts:314`) and `goal_shares` is keyed by `goal_id` — the not-on drop in `scope.ts` covers it; apply calls `goalWriteRefusal` with `goalLinkOfTx` inside `guarded` and returns early for the drops.
- [ ] **Step 4: Run** — expected PASS; `npx vitest run test/sync` — expected PASS; `npm run test:capture` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/goals/scope.ts packages/db/src/sync/capture.ts packages/db/src/sync/apply.ts packages/db/test/sync/goal-capture.test.ts && git commit -m "Sync: a shared goal's writes judged alike everywhere, and off sends no deletes"`

### Task 7: This member's funding lines and moves, worked out

Spec C5, C6, C9, C16, C17, §7.2 (`goal_member_funding`, `goal_member_moves`).

**Files:**
- Create: `packages/db/src/sync/goals/summaries.ts`
- Modify: `packages/db/src/repos/goal-contributions.ts:33-40` (`ContributionEvent.sourceId: string`), `:54` (contribution id), `:75` (transaction id), `:108` (draw id), `:141` (trade id)
- Test: `packages/db/test/sync/goal-summaries.test.ts`

**Interfaces:**
- Consumes: `goalLinksFor` (`goal-funding.ts:165`), `goalHistory` (`goal-funding.ts:445`), `listTradeTemplates`, `uuidv5` (`sync/uuidv5.ts:30`).
- Produces:
  - `interface GoalFundingLine { ref: string; name: string; kind: 'earmark' | 'tagged'; amountMinor: number | null; risk: Risk | null }`
  - `interface OwnGoalFunding { lines: GoalFundingLine[]; plannedMonthlyMinor: number }`
  - `ownGoalFunding(database: Database, ws: WorkspaceContext, goalId: string, date: string): Promise<OwnGoalFunding>` — this phone's own links only (`owner` absent); `amountMinor` = the link's `goalMinor` (the counted figure, null with no rate); `ref = uuidv5(GOAL_LINE_NS, goalId + '|' + kind + '|' + accountId)`; planned = `standingMonthlyMinor` + monthly buys tagged to the goal, in the goal's currency.
  - `interface GoalMoveRow { id: string; goalId: string; memberId: string; kind: 'set-aside' | 'taken-back' | 'borrowed' | 'spent' | 'moved'; occurredOn: string; amountMinor: number; currency: string; text: string; stageId: string | null }`
  - `ownGoalMoves(database: Database, ws: WorkspaceContext, goalId: string, memberId: string, date: string): Promise<GoalMoveRow[]>` — this phone's History entries of the goal (no `reached`), id `uuidv5(GOAL_MOVE_NS, goalId + '|' + sourceId)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/sync/goal-summaries.test.ts — IDR workspace; 'Main Savings' 30_000_000; 'Daily Account' 5_000_000;
// 'Travel Dollars' (USD) US$100.00; goal 'Trip Fund' IDR; standing 500_000; a monthly buy template of 1_000_000 on the goal.
it('names each account and the amount it counts', async () => {
  await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
  expect((await ownGoalFunding(database, ws, goalId, '2026-11-10')).lines).toEqual([{ ref: expect.any(String), name: 'Main Savings', kind: 'earmark', amountMinor: 20_000_000, risk: null }]);
});
it('a promise above the balance travels as what is counted', async () => {
  await saveEarmark(database, ws, { goalId, accountId: daily, amountMinor: 8_000_000 });
  expect((await ownGoalFunding(database, ws, goalId, '2026-11-10')).lines[0]!.amountMinor).toBe(5_000_000);
});
it('foreign account: in the goal\'s money at this phone\'s rate, or null without one', async () => {
  await saveEarmark(database, ws, { goalId, accountId: dollars, amountMinor: 10_000 });
  await storeRate(database, 'USD', '2026-11-10', 16_000);
  expect((await ownGoalFunding(database, ws, goalId, '2026-11-10')).lines[0]!.amountMinor).toBe(1_600_000);
  // a second database without the rate
  expect((await ownGoalFunding(noRate.database, noRate.ws, goalId2, '2026-11-10')).lines[0]!.amountMinor).toBeNull();
});
it('carries no account id, balance or short-by', async () => {
  const text = JSON.stringify(await ownGoalFunding(database, ws, goalId, '2026-11-10'));
  for (const id of [main, daily, dollars]) expect(text).not.toContain(id);
  expect(text).not.toMatch(/short|balance|promised/i);
});
it('planned monthly is the standing amount plus monthly buys', async () => {
  expect((await ownGoalFunding(database, ws, goalId, '2026-11-10')).plannedMonthlyMinor).toBe(1_500_000);
});
it('moves have ids that do not change between reads', async () => {
  const a = await ownGoalMoves(database, ws, goalId, 'member-f', '2026-11-10');
  const b = await ownGoalMoves(database, ws, goalId, 'member-f', '2026-11-10');
  expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  expect(a[0]).toMatchObject({ kind: 'set-aside', amountMinor: 20_000_000, currency: 'IDR', text: 'Main Savings', memberId: 'member-f' });
});
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/sync/goal-summaries.test.ts test/goal-contributions.test.ts` — expected FAIL (module not found).
- [ ] **Step 3: Implement**; `sourceId` is additive, so existing `goal-contributions.test.ts` stays green.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/goals/summaries.ts packages/db/src/repos/goal-contributions.ts packages/db/test/sync/goal-summaries.test.ts && git commit -m "Shared goals: what a member's own money does for a goal, by name and counted amount"`

### Task 8: Share, off, delete, Leave, and the end of a household share

Spec §8.2, §8.3 table, C13–C15, C30, D7, D10.

**Files:**
- Modify: `packages/db/src/repos/goal-sharing.ts` (writes and views)
- Create: `packages/db/src/sync/goals/follow.ts`
- Modify: `packages/db/src/sync/apply.ts` (after the row op in `applyChangeSetTx`, ~line 1162: call the follow-up for `goal_share` and `goal_share_leave`)
- Modify: `packages/db/src/sync/engine.ts:888-930` (`stopSharing`, `forgetSharing`), `:1057-1064` (`endShared`) — call `endSharedGoalsTx`
- Modify: `packages/db/src/index.ts` (exports below)
- Test: `packages/db/test/sync/goal-share-lifecycle.test.ts`

**Interfaces:**
- Consumes: `rekeyGoalTx` (Task 5); `goalLinkOfTx`, `memberLeftTx` (Task 6); `ownGoalFunding`, `ownGoalMoves` (Task 7); `withCapture`, `withCaptureSuspended` (`capture.ts:591`, `:656`).
- Produces:
  - `shareGoal(database: Database, ws: WorkspaceContext, goalId: string, bookId: string): Promise<void>` — refused (`GoalDbError`) unless `bookId` is in `goalShareTargets`; inserts or re-opens the link (round + 1), emits per §8.2 including this member's summary and moves; log `'shared'`.
  - `stopSharingGoal(database: Database, ws: WorkspaceContext, goalId: string): Promise<void>` — sharer only; link → `'off'`; drops others' rows locally; log `'stopped'`.
  - `markGoalDeletedTx(tx: Db, goalId: string): Promise<boolean>` — for `deleteGoal` (Task 10): link → `'deleted'` when this member is the sharer; true when the goal was shared.
  - `leaveSharedGoal(database: Database, ws: WorkspaceContext, goalId: string): Promise<{ copyGoalId: string }>` — non-sharer only; writes the leave row for the current round (captured), then `rekeyGoalTx` under `withCaptureSuspended` with log `'unshared'`.
  - `interface GoalShareView { goalId: string; bookId: string; bookName: string; sharedBy: string; sharedByName: string; state: 'on' | 'off' | 'deleted'; round: number; me: string; isSharer: boolean; members: { memberId: string; name: string }[]; left: string[] }`
  - `goalShareOf(database: Database, goalId: string): Promise<GoalShareView | null>`, `goalSharesOf(database: Database): Promise<Record<string, GoalShareView>>` (on links only, for the list)
  - `privateCopyOf(database: Database, sharedGoalId: string): Promise<string | null>` (from `goal_share_log.copied_from`)
  - `followGoalShareTx(tx: Db, ctx: BookContext, goalId: string, before: GoalLinkView | null): Promise<void>`, `followGoalLeaveTx(tx: Db, ctx: BookContext, goalId: string, memberId: string): Promise<void>` — the follow-ups of the §8.3 table; the log line for a leave carries the leaver's last counted total (sum of their `lines[].amountMinor`, nulls left out).
  - `endSharedGoalsTx(tx: Db, ws: WorkspaceContext, bookId: string): Promise<void>` — C15: every goal linked to `bookId` handled as off, locally, nothing emitted, before the book turns read-only.

- [ ] **Step 1: Write the failing test** (Household with Bima (sharer) and Rina, both at `0.5.0`; goal 'Trip Fund', one stage 180_000_000 due 2030-06-01; Rina's account 'Partner Savings' 20_000_000)

```ts
it('shared: Rina sees one goal, Bima sees her line', async () => {
  await shareGoal(fandri.database, fandri.ws, goalId, h.bookId); await h.settle();
  expect((await listGoals(rina.database, rina.ws)).map((g) => [g.id, g.name])).toEqual([[goalId, 'Trip Fund']]);
  await saveEarmark(rina.database, rina.ws, { goalId, accountId: rinaSavings, amountMinor: 10_000_000 }); await h.settle();
  expect(JSON.parse((await rowOf(fandri.database, 'goal_member_funding', goalId, 'member-Rina')).lines_json)).toEqual([expect.objectContaining({ name: 'Partner Savings', amountMinor: 10_000_000 })]);
});
it('off: Bima keeps the goal, Rina keeps a private copy with her money', async () => {
  await stopSharingGoal(fandri.database, fandri.ws, goalId); await h.settle();
  expect((await listGoals(fandri.database, fandri.ws)).map((g) => g.id)).toEqual([goalId]);
  expect(await rowsOf(fandri.database, 'goal_member_funding')).toEqual([]);
  const [copy] = await listGoals(rina.database, rina.ws);
  expect(copy!.id).not.toBe(goalId);
  expect(await listEarmarks(rina.database, rina.ws)).toEqual([{ goalId: copy!.id, accountId: rinaSavings, amountMinor: 10_000_000 }]);
  expect((await goalContributionsFor(rina.database, rina.ws, '2026-11'))[copy!.id]).toBe(10_000_000);
  expect(await privateCopyOf(rina.database, goalId)).toBe(copy!.id);
  expect(await skipsOf(rina.database)).toEqual([]);
});
it('off and on while Rina is offline', async () => {
  await stopSharingGoal(fandri.database, fandri.ws, goalId);
  await shareGoal(fandri.database, fandri.ws, goalId, h.bookId);
  await h.settle();
  const goals = await listGoals(rina.database, rina.ws);
  expect(goals.map((g) => g.name)).toEqual(['Trip Fund', 'Trip Fund']);
  expect(new Set(goals.map((g) => g.id)).has(goalId)).toBe(true);
  expect((await listEarmarks(rina.database, rina.ws)).map((e) => e.goalId)).not.toContain(goalId);
  expect(await skipsOf(rina.database)).toEqual([]);
  expect(await skipsOf(fandri.database)).toEqual([]);
});
it('Rina leaves: still shared for Bima, her line gone, a History line with her total', async () => {
  await leaveSharedGoal(rina.database, rina.ws, goalId); await h.settle();
  expect((await goalShareOf(fandri.database, goalId))!.state).toBe('on');
  expect(await rowsOf(fandri.database, 'goal_member_funding')).toEqual([]);
  expect(await logOf(fandri.database, goalId)).toEqual([expect.objectContaining({ kind: 'left', member_name: 'Rina', amount_minor: 10_000_000 })]);
  // Bima renames the shared goal; Rina's copy keeps its own name
  expect((await listGoals(rina.database, rina.ws))[0]!.name).toBe('Trip Fund');
});
it('Bima deletes it: Rina keeps a copy', async () => { /* deleteGoal via markGoalDeletedTx path: Bima has no goal; Rina has one with her earmark */ });
it('Bima stops sharing the workspace: both keep private goals', async () => {
  await fandri.engine.stopSharing(h.bookId); await h.settle();
  expect((await listGoals(fandri.database, fandri.ws)).map((g) => g.id)).toEqual([goalId]);
  expect((await listGoals(rina.database, rina.ws))[0]!.id).not.toBe(goalId);
  await expect(saveEarmark(rina.database, rina.ws, { goalId: (await listGoals(rina.database, rina.ws))[0]!.id, accountId: rinaSavings, amountMinor: 11_000_000 })).resolves.toBeUndefined();
});
it('only the sharer turns it off, only another member leaves', async () => {
  await expect(stopSharingGoal(rina.database, rina.ws, goalId)).rejects.toThrow(GoalDbError);
  await expect(leaveSharedGoal(fandri.database, fandri.ws, goalId)).rejects.toThrow(GoalDbError);
});
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/sync/goal-share-lifecycle.test.ts` — expected FAIL.
- [ ] **Step 3: Implement**. Error copy, impersonal: `'Only Bima can stop sharing this goal'`, `'Bima shared this goal, so it is turned off rather than left'`.
- [ ] **Step 4: Run** — expected PASS; `npx vitest run test/sync` and `npm run test:capture` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/repos/goal-sharing.ts packages/db/src/sync/goals/follow.ts packages/db/src/sync/apply.ts packages/db/src/sync/engine.ts packages/db/src/index.ts packages/db/test/sync/goal-share-lifecycle.test.ts && git commit -m "Shared goals: share, off, delete and Leave; each other member keeps a private copy"`

### Task 9: Summaries sent when money changes

Spec §8.5, §11 (second device).

**Files:**
- Modify: `packages/db/src/sync/goals/summaries.ts` (send)
- Modify: `packages/db/src/sync/capture.ts:292-340` (`markGoalDirty`, flush beside `sendDirtySummaries`; dirty accounts → shared goals with an earmark on them)
- Modify (one `markGoalDirtyTx` call each): `packages/db/src/repos/goals.ts` `saveEarmark` (349), `removeEarmark` (378), `setStandingMonthly` (397), `moveSetAside` (408); `set-aside-tx.ts` `adjustSetAsideTx` (97), `lowerSetAsideTx` (124), `parkForGoalTx` (176), `undoSetAsideTx` (427); `goal-funding.ts` `resplitTrade` (117), `retagTrade` (149); `trade-templates.ts` save/delete; `trades.ts` record/void of a trade with a goal
- Modify: `apps/web/src/db/bootstrap.ts:115` (call `resendGoalSummaries` once a day)
- Test: `packages/db/test/sync/goal-summary-send.test.ts`

**Interfaces:**
- Consumes: `ownGoalFunding`, `ownGoalMoves` (Task 7); `goalLinkOfTx`, `memberLeftTx` (Task 6).
- Produces: `markGoalDirtyTx(tx: Db, goalId: string): void`; `sendGoalSummariesTx(tx: Db, goalIds: readonly string[], date: string): Promise<void>` — for each goal linked `'on'` where this member has not left: writes this member's `goal_member_funding` row and upserts/deletes its `goal_member_moves` under `withCapture`, emitting only what changed; a device writes a summary only when its own lines are non-empty or it wrote one before (settings key `goal.summary.<goalId>`); during apply, kept as pending and sent by the next own transaction (as `addPendingSummaryAccountsTx`, `capture.ts:330-335`). `resendGoalSummaries(database: Database, date: string): Promise<number>` — the count of goals whose summary changed.

- [ ] **Step 1: Write the failing test**

```ts
it('a set-aside on a shared goal sends this member\'s line', async () => {
  await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
  const op = (await outboxOps(database)).find((o) => o.entity === 'goal_member_funding');
  expect(op).toMatchObject({ id: `${goalId}|member-f`, op: 'upsert' });
  expect(JSON.parse(String(op!.op === 'upsert' && op!.fields.lines))).toEqual([expect.objectContaining({ name: 'Main Savings', amountMinor: 20_000_000 })]);
});
it('spending from the account below the promise sends the lower figure', async () => {
  // post an expense of 25_000_000 from 'Main Savings' (balance 30_000_000 → 5_000_000)
  expect(linesOfLastOp()[0].amountMinor).toBe(5_000_000);
});
it('a goal not shared sends nothing', async () => { expect((await outboxOps(database)).filter((o) => o.entity.startsWith('goal'))).toEqual([]); });
it('a second device writes nothing', async () => {
  // Household: Bima's second device (same member, no accounts of his) applies the goal and Bima's summary
  await h.settle();
  expect((await outboxOps(fandriTablet.database)).filter((o) => o.entity === 'goal_member_funding')).toEqual([]);
  expect(JSON.parse((await rowOf(fandriTablet.database, 'goal_member_funding', goalId, 'member-Bima')).lines_json)[0].amountMinor).toBe(20_000_000);
});
it('the daily resend sends only a change', async () => {
  expect(await resendGoalSummaries(database, '2026-11-10')).toBe(0);
  await storeRate(database, 'USD', '2026-11-11', 16_500);
  expect(await resendGoalSummaries(database, '2026-11-11')).toBe(1);
});
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/sync/goal-summary-send.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS; `npm run test:capture` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/goals/summaries.ts packages/db/src/sync/capture.ts packages/db/src/repos/goals.ts packages/db/src/repos/set-aside-tx.ts packages/db/src/repos/goal-funding.ts packages/db/src/repos/trade-templates.ts packages/db/src/repos/trades.ts apps/web/src/db/bootstrap.ts packages/db/test/sync/goal-summary-send.test.ts && git commit -m "Shared goals: each member's lines go out when their money changes"`

### Task 10: Goal writes captured, the sharer's rules, partner-aware locks

Spec §8.5, §9.4, C10, C12/D10, §9.1 (`goalHasFunding`).

**Files:**
- Modify: `packages/db/src/repos/goals.ts:162-245` (`saveGoalTx` under `withCapture`), `:251-267` (`goalHasFunding` reads `goal_member_funding` of other members with a non-empty line, and `goal_member_moves`), `:278-283` (`drawnStageIds` reads `goal_member_moves.stage_id`), `:290-292` (`archiveGoal`: sharer only), `:299-318` (`deleteGoal`: sharer → `markGoalDeletedTx` first; non-sharer refused), `:329-332` (`setStagePaid` captured)
- Modify: `packages/db/src/repos/set-aside-tx.ts:307-394` (the stage mark a spend writes, captured)
- Test: `packages/db/test/goal-sharing-writes.test.ts`

**Interfaces:**
- Consumes: `markGoalDeletedTx`, `goalShareOf` (Task 8); `withCapture`.
- Produces: unchanged signatures; new `GoalDbError` texts: `'Only Bima can archive this shared goal'`, `'Bima shared this goal; leave it instead'`.

- [ ] **Step 1: Write the failing test**

```ts
it('marking a payment paid goes out', async () => {
  await setStagePaid(database, ws, stageId, '2026-11-10');
  expect((await outboxOps(database)).find((o) => o.entity === 'goal_stage')).toMatchObject({ id: stageId, op: 'upsert', fields: expect.objectContaining({ paidOn: '2026-11-10' }) });
});
it('a rename goes out; standing amount and order do not', async () => {
  await saveGoal(database, ws, { ...inputOf(goal), name: 'Trip Fund 2030' });
  await setStandingMonthly(database, ws, goalId, 700_000);
  await reorderGoals(database, ws, [otherId, goalId]);
  expect((await outboxOps(database)).filter((o) => o.entity === 'goal').map((o) => o.op === 'upsert' && Object.keys(o.fields))).toEqual([['name']]);
});
it('another member can neither archive nor delete', async () => {
  await expect(archiveGoal(rina.database, rina.ws, goalId)).rejects.toThrow('Only Bima can archive this shared goal');
  await expect(deleteGoal(rina.database, rina.ws, goalId)).rejects.toThrow('Bima shared this goal; leave it instead');
});
it('the sharer\'s delete sends the link and no delete', async () => {
  await deleteGoal(database, ws, goalId);
  expect((await outboxOps(database)).map((o) => [o.entity, o.op])).toEqual([['goal_share', 'upsert']]);
});
it('a stage the partner spent against stays', async () => {
  // a goal_member_moves row from member-r, kind 'spent', stage_id = stageId
  await expect(saveGoal(database, ws, { ...inputOf(goal), stages: otherStagesOnly })).rejects.toThrow(/Money was drawn against "Deposit"/);
});
it('the currency is fixed once only the partner has money in it', async () => {
  // a goal_member_funding row from member-r with one line of 10_000_000
  await expect(saveGoal(database, ws, { ...inputOf(goal), currency: 'USD' })).rejects.toThrow(/currency cannot change/);
});
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/goal-sharing-writes.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS; `npx vitest run test/goals.test.ts test/goal-delete.test.ts test/goal-currency.test.ts` — expected PASS (unshared goals unchanged); `npm run test:capture` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/repos/goals.ts packages/db/src/repos/set-aside-tx.ts packages/db/test/goal-sharing-writes.test.ts && git commit -m "Shared goals: edits travel, only the sharer archives or deletes, partner money locks currency and stages"`

### Task 11: Calculators — the frozen outgoing, captured writes, upgrade on the sharer's phone

Spec D8, C23, C25.

**Files:**
- Modify: `packages/db/src/repos/goal-calculators.ts:32-52` (`EmergencyInputs.sharedOutgoingMinor?: number`, `sharedOutgoingOn?: string`), `:293-400` (writes under `withCapture`; a save on a shared emergency goal freezes this phone's outgoing), `:457-500` (`upgradeCalculatorGoals` skips a shared goal this member did not share)
- Modify: `packages/db/src/repos/goal-sharing.ts` (`shareGoal`: one call to `freezeEmergencyOutgoingTx` before the link is written, for an emergency goal with a working; no other task touches this file in wave 5)
- Test: `packages/db/test/goal-calculator-sharing.test.ts`

**Interfaces:**
- Consumes: `periodFlows`, `emergencyOutgoingMinor` (as `goal-funding.ts:326-338`), `goalShareOf`.
- Produces: `freezeEmergencyOutgoingTx(tx: Db, ws: WorkspaceContext, goalId: string, date: string): Promise<number>` — writes `sharedOutgoingMinor` (base currency, from this phone's last twelve months, or the typed `monthlyOutgoingMinor` when set) and `sharedOutgoingOn = date`; returns the figure.

- [ ] **Step 1: Write the failing test**

```ts
it('sharing an emergency fund freezes the sharer\'s outgoing', async () => {
  // Bima's flows: 12 months of spending averaging 5_000_000; emergency goal, 6 months; shareGoal
  expect((await getGoalCalculator(fandri.database, fandri.ws, goalId))!.inputs).toMatchObject({ sharedOutgoingMinor: 5_000_000, sharedOutgoingOn: '2026-11-10' });
});
it('Rina recalculates: her outgoing is frozen and travels', async () => {
  // Rina's flows average 4_000_000; saveGoalCalculator on Rina's phone with the same months
  await h.settle();
  expect((await getGoalCalculator(fandri.database, fandri.ws, goalId))!.inputs).toMatchObject({ sharedOutgoingMinor: 4_000_000 });
});
it('the silent re-working runs only on the sharer\'s phone', async () => {
  // a shared v2 education goal whose band moved
  expect(await upgradeCalculatorGoals(rina.database, rina.ws, '2026-11-10')).toEqual([]);
  expect(await upgradeCalculatorGoals(fandri.database, fandri.ws, '2026-11-10')).toEqual([goalId]);
});
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/goal-calculator-sharing.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS; `npx vitest run test/goal-calculators.test.ts test/calculator-upgrade.test.ts test/calculator-inputs.test.ts` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/repos/goal-calculators.ts packages/db/test/goal-calculator-sharing.test.ts && git commit -m "Shared goals: an emergency fund's outgoing is frozen in its working, re-read by whoever recalculates"`

### Task 12: Plan reads — others' lines, planned, frozen outgoing, fit, budget, wholeness

Spec §9.1, §9.3, C16, C19–C22, D8.

**Files:**
- Modify: `packages/db/src/repos/goal-funding.ts:51-61` (`GoalLinkRow.owner?: string`), `:63-77` (`GoalPlanRow.othersPlannedMonthlyMinor: number`, `ownNeededMonthlyMinor: number`), `:186-284` (others' lines), `:319-395` (planned, outgoing, fit), `:404-426` (`since: null` when shared)
- Modify: `packages/db/src/repos/budget-sheet.ts:112` (`planMinor` from `ownNeededMonthlyMinor` in base)
- Test: `packages/db/test/goal-sharing-reads.test.ts`

**Interfaces:**
- Consumes: `ownShareOfNeedMinor` (Task 2); `goalSharesOf`, `memberLeftTx` (Tasks 6, 8); `sharedOutgoingMinor` (Task 11).
- Produces: `GoalLinkRow.owner` = the member id of another member's line (absent for own); for such a link `valueMinor = goalMinor = amountMinor`, `currency` = goal's, `baseMinor` = converted with this phone's rate (or null), `shortMinor 0`, `overBalance false`, `promisedMinor null`, `accountId` = the line's `ref`. `GoalPlanRow.othersPlannedMonthlyMinor`, `GoalPlanRow.ownNeededMonthlyMinor` (= `ownShareOfNeedMinor(requiredMonthlyMinor, othersPlannedMonthlyMinor)`; equal to `requiredMonthlyMinor` for a private goal). `fits` read `ownNeededMonthlyMinor`.

- [ ] **Step 1: Write the failing test** (the mock-up, with invented account names)

```ts
// Bima's phone: 'Main Savings' 20_000_000 and 'Daily Account' 8_000_000 set aside; standing 2_000_000.
// Rina's row (member-r): lines [{name:'Partner Savings', kind:'earmark', amountMinor:10_000_000}, {name:'Cash Fund', kind:'tagged', amountMinor:4_000_000, risk:'low'}], planned 1_000_000.
it('counts both people', async () => {
  const plan = planOf(await goalPlansFor(database, ws, '2026-11-10'), goalId);
  expect(plan.currentMinor).toBe(42_000_000);
  expect(plan.allTargetMinor).toBe(180_000_000);
  expect(plan.links.filter((l) => l.owner === 'member-r').map((l) => [l.name, l.valueMinor, l.shortMinor])).toEqual([['Partner Savings', 10_000_000, 0], ['Cash Fund', 4_000_000, 0]]);
  expect(plan.plannedMonthlyMinor).toBe(3_000_000);
  expect(plan.othersPlannedMonthlyMinor).toBe(1_000_000);
  expect(plan.ownNeededMonthlyMinor).toBe(Math.max(0, plan.requiredMonthlyMinor - 1_000_000));
});
it('the budget plans this phone\'s part', async () => {
  const sheet = await budgetSheet(database, ws, '2026-11');
  expect(sheet.savings.find((s) => s.goalId === goalId)!.planMinor).toBe(planOf(await goalPlansFor(database, ws, '2026-11-30'), goalId).ownNeededMonthlyMinor);
});
it('no rate on the partner\'s phone', async () => {
  // Rina's second line amountMinor null
  const plan = planOf(await goalPlansFor(database, ws, '2026-11-10'), goalId);
  expect(plan.currentMinor).toBe(38_000_000);
  expect(plan.unconvertedWarning).not.toBeNull();
});
it('a SAR goal adds the partner\'s SAR figure as it is', async () => { /* goal currency SAR; Rina line 3_000_00 SAR minor */ expect(planOf(…).currentMinor).toBe(ownSarMinor + 300_000); });
it('a member who left is not counted', async () => { /* goal_share_leaves row for member-r, current round */ expect(planOf(…).currentMinor).toBe(28_000_000); });
it('shared goals have no funded-since day', async () => { expect((await goalWholeness(database, ws, '2026-11-10'))[goalId]!.since).toBeNull(); });
it('the partner\'s money reaches no other reader', async () => {
  const before = { nw: await netWorthAt(database, ws, '2026-11-10'), views: await setAsideViews(database, ws), put: await goalContributionsFor(database, ws, '2026-11') };
  // insert Rina's row
  expect({ nw: await netWorthAt(database, ws, '2026-11-10'), views: await setAsideViews(database, ws), put: await goalContributionsFor(database, ws, '2026-11') }).toEqual(before);
});
it('a private goal reads exactly as before', async () => { /* the existing goal-funding.test.ts stays green; ownNeededMonthlyMinor === requiredMonthlyMinor */ });
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/goal-sharing-reads.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.** `outgoingFor` (`goal-funding.ts:334-338`) reads `sharedOutgoingMinor` first for a shared goal.
- [ ] **Step 4: Run** — expected PASS; `npx vitest run test/goal-funding.test.ts test/budget-sheet.test.ts test/fund-goals.test.ts test/goal-split.test.ts` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/repos/goal-funding.ts packages/db/src/repos/budget-sheet.ts packages/db/test/goal-sharing-reads.test.ts && git commit -m "Shared goals: the plan counts every member's money; each phone plans its own part"`

### Task 13: History reads

Spec §9.2, C27.

**Files:**
- Modify: `packages/db/src/repos/goal-funding.ts:428-501`
- Test: `packages/db/test/goal-sharing-history.test.ts`

**Interfaces:**
- Produces: `GoalHistoryEntry.by: string | null` (member id of another member; null = this phone's); `GoalHistoryEntry.kind` gains `'shared' | 'stopped' | 'left' | 'unshared' | 'ended'`; `GoalHistoryEntry.memberName?: string` for the share kinds.

- [ ] **Step 1: Write the failing test**

```ts
it('lists the partner\'s moves with who', async () => {
  // Rina's move: set-aside 10_000_000 IDR 'Partner Savings' on 2026-11-03; own set-aside 20_000_000 on 2026-11-02
  expect((await goalHistory(database, ws, '2026-11-10', { limit: null }))[goalId]!.map((e) => [e.kind, e.by, e.amountMinor, e.text])).toEqual([
    ['set-aside', 'member-r', 10_000_000, 'Partner Savings'],
    ['set-aside', null, 20_000_000, 'Main Savings'],
  ]);
});
it('a spent line carries its description', async () => { /* Rina's 'spent' move text 'Flight tickets' */ expect(entry).toMatchObject({ kind: 'spent', by: 'member-r', amountMinor: -3_000_000, text: 'Flight tickets' }); });
it('share lines', async () => { /* goal_share_log 'left' Rina 10_000_000 */ expect(entry).toMatchObject({ kind: 'left', memberName: 'Rina', amountMinor: 10_000_000 }); });
it('a private goal\'s history is unchanged', async () => { expect(all.every((e) => e.by === null)).toBe(true); });
it('a member who left has no lines', async () => { /* leave row for member-r this round */ expect(entries.some((e) => e.by === 'member-r')).toBe(false); });
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/goal-sharing-history.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS; `npx vitest run test/goal-funding.test.ts` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/repos/goal-funding.ts packages/db/test/goal-sharing-history.test.ts && git commit -m "Shared goals: History names each member's moves and the share's own events"`

### Task 14: Household convergence and the review-focus cases

Spec §11, §12; Review Focus 3 and 5. Test-only task.

**Files:**
- Create: `packages/db/test/sync/goal-sharing-sync.test.ts`

**Interfaces:** consumes everything above; produces nothing.

- [ ] **Step 1: Write the tests** (Household: Bima, Rina; Adi joins later)

```ts
it('every phone reads the same target, Saved per member, To go and stages', async () => {
  const read = async (d: Device) => { const p = planOf(await goalPlansFor(d.database, d.ws, '2026-11-10'), goalId); return { target: p.allTargetMinor, current: p.currentMinor, paid: p.stages.map((s) => s.state) }; };
  expect(await read(rina)).toEqual(await read(fandri));
  expect((await read(fandri)).current).toBe(42_000_000);
});
it('crossing stage edits', async () => {
  // offline: Rina renames 'Deposit' → 'First payment'; Bima marks it paid 2026-11-10; settle
  for (const d of [fandri, rina]) expect(stageOf(d, depositId)).toMatchObject({ name: 'First payment', paidOn: '2026-11-10' });
  // offline: Bima removes 'Balance'; Rina marks it paid; settle
  for (const d of [fandri, rina]) expect(await stageExists(d, balanceId)).toBe(false);
  expect([...(await skipsOf(fandri.database)), ...(await skipsOf(rina.database))]).toEqual([]);
});
it('a member who joins later', async () => {
  const adi = await h.device('Adi', 'member-Adi', 'IDR', '0.5.0'); await h.join(adi, fandri); await h.settle();
  expect((await listGoals(adi.database, adi.ws)).map((g) => g.id)).toContain(goalId);
  expect((await goalShareTargets(fandri.database))[0]!.others.map((o) => o.name)).toEqual(['Rina', 'Adi']);
  expect((await outboxOps(adi.database)).filter((o) => o.entity === 'goal_member_funding')).toEqual([]);
});
it('nothing private leaves a phone', async () => {
  const ids = [fandri.bank, fandri.cash, fandri.usd, rina.bank, rina.cash, rina.usd, ...transactionIdsOf(fandri), ...transactionIdsOf(rina)];
  const text = JSON.stringify(sentOps); // every outbox op of every device, collected with outboxOps() before each settle in this test
  for (const id of ids) expect(text).not.toContain(id);
  expect(text).not.toMatch(/"(balance|shortMinor|promisedMinor)"/);
});
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/sync/goal-sharing-sync.test.ts` — expected PASS if Tasks 1–13 hold; any FAIL is a bug in the owning task, fixed there (with its own test) before this commit.
- [ ] **Step 3: Commit** `git add packages/db/test/sync/goal-sharing-sync.test.ts && git commit -m "Shared goals: convergence, crossing edits, a later member, nothing private sent"`

### Task 15: Web model, queries, the switch and Leave

Spec D1, D6, C3, C26, C31, C33, §10 (Add/Edit goal).

**Files:**
- Create: `apps/web/src/features/goals/goal-sharing.ts`
- Modify: `apps/web/src/features/goals/queries.ts` (two hooks)
- Modify: `apps/web/src/features/goals/GoalForm.tsx:187-208` (archive/delete/leave), `:376-392` (the row; Leave row in place of Archive and Delete on a non-sharer's phone)
- Test: `apps/web/src/features/goals/goal-sharing.test.ts`

**Interfaces:**
- Consumes: `goalShareTargets`, `GoalShareTarget`, `goalShareOf`, `GoalShareView`, `shareGoal`, `stopSharingGoal`, `leaveSharedGoal`, `GoalLinkRow` (db).
- Produces:
  - `sharedWithLabel(others: readonly { name: string }[], bookName: string): string`
  - `initialsOf(name: string): string`; `initialsLine(names: readonly string[]): string[]` (at most three, then `'+N'`)
  - `interface FundingGroup { memberId: string | null; label: string; subtotalMinor: number; links: GoalLinkRow[] }`; `fundingGroups(links: readonly GoalLinkRow[], members: readonly { memberId: string; name: string }[]): FundingGroup[]` — Me first, then members in the order given, a member with no link left out; subtotal = sum of `goalMinor ?? 0`
  - `interface HeroSegment { key: string; label: string; minor: number }`; `heroSegments(paidMinor: number, groups: readonly FundingGroup[], targetMinor: number): HeroSegment[]` — Paid (when > 0), each group, To go (when > 0)
  - `shareRowState(targets: readonly GoalShareTarget[], share: GoalShareView | null): { kind: 'hidden' } | { kind: 'switch'; label: string; bookId: string } | { kind: 'picker'; options: { bookId: string; label: string }[] } | { kind: 'locked'; label: string; footer: string }`
  - `useGoalShareTargets()`, `useGoalShare(goalId: string)` (TanStack Query, keys `['goal-share-targets']`, `['goal-share', goalId]`)

- [ ] **Step 1: Write the failing test**

```ts
it('names who sees it', () => {
  expect(sharedWithLabel([{ name: 'Rina' }], 'Family')).toBe('Shared with Rina');
  expect(sharedWithLabel([{ name: 'Rina' }, { name: 'Adi' }], 'Family')).toBe('Shared with Rina and Adi');
  expect(sharedWithLabel([{ name: 'Rina' }, { name: 'Adi' }, { name: 'Sari' }], 'Family')).toBe('Shared with Rina, Adi and Sari');
  expect(sharedWithLabel([{ name: 'Rina' }, { name: 'Adi' }, { name: 'Sari' }, { name: 'Tono' }], 'Family')).toBe('Shared with Family · 5 people');
});
it('initials', () => {
  expect(initialsOf('Rina')).toBe('R'); expect(initialsOf('Adi Putra')).toBe('AP');
  expect(initialsLine(['Bima', 'Rina', 'Adi', 'Sari', 'Tono'])).toEqual(['F', 'R', 'A', '+2']);
});
it('the mock-up\'s groups and bar', () => {
  const groups = fundingGroups(mockLinks /* own 20_000_000 + 8_000_000; member-r 10_000_000 + 4_000_000 */, [{ memberId: 'member-r', name: 'Rina' }, { memberId: 'member-a', name: 'Adi' }]);
  expect(groups.map((g) => [g.memberId, g.label, g.subtotalMinor, g.links.length])).toEqual([[null, 'Me', 28_000_000, 2], ['member-r', 'Rina', 14_000_000, 2]]);
  expect(heroSegments(0, groups, 180_000_000)).toEqual([{ key: 'me', label: 'Me', minor: 28_000_000 }, { key: 'member-r', label: 'Rina', minor: 14_000_000 }, { key: 'to-go', label: 'To go', minor: 138_000_000 }]);
});
it('the row', () => {
  expect(shareRowState([], null)).toEqual({ kind: 'hidden' });
  expect(shareRowState([target('b1', 'Family', ['Rina'])], null)).toEqual({ kind: 'switch', label: 'Shared with Rina', bookId: 'b1' });
  expect(shareRowState([target('b1', 'Family', ['Rina']), target('b2', 'Business', ['Adi'])], null)).toMatchObject({ kind: 'picker', options: [{ bookId: 'b1', label: 'Family · Rina' }, { bookId: 'b2', label: 'Business · Adi' }] });
  expect(shareRowState([], viewSharedBy('Bima', { isSharer: false }))).toEqual({ kind: 'locked', label: 'Shared with Bima', footer: 'Shared by Bima' });
});
it('no new string speaks to the reader', () => {
  for (const text of Object.values(GOAL_SHARING_COPY)) expect(text).not.toMatch(/\byou(r)?\b/i);
});
```

- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/features/goals/goal-sharing.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** the model (all copy in one `GOAL_SHARING_COPY` record, with the confirms of spec §10), the hooks, and the form: a `SwitchRow` (or `SelectRow` picker) with the info line, saved after `saveGoal` returns the id on Add; Stop confirm "Stop sharing Trip Fund? Rina keeps a copy with Rina's own money in it."; Leave confirm "Leave Trip Fund? A copy with the money set aside from this phone stays here."
- [ ] **Step 4: Run** — expected PASS; `npm run typecheck` — expected PASS.
- [ ] **Step 5: Commit** `git add apps/web/src/features/goals/goal-sharing.ts apps/web/src/features/goals/goal-sharing.test.ts apps/web/src/features/goals/queries.ts apps/web/src/features/goals/GoalForm.tsx && git commit -m "Goals: the Shared with switch, Leave, and the model behind the shared screens"`

### Task 16: Goal page and Goals list

Spec D2, D3, C18, C21, C28, C33, §10.

**Files:**
- Modify: `apps/web/src/features/goals/goal-cards.ts:106-113` (`goalsTotals` counts own money only), `:177-200` (`GoalCard.ownMinor`, `othersMinor`)
- Modify: `apps/web/src/features/goals/GoalPage.tsx:100-110` ("Goal not here" with the private copy), `:122-135` (menu: Leave on a non-sharer's phone), `:176-220` (title line, initials, segments, legend), `:252-264` (Each month combined), `:266-284` (groups, "＋ Set aside" row)
- Modify: `apps/web/src/features/goals/funding.tsx:36-57` (`FundingRow` with `caption` and no `to` for another member's line)
- Modify: `apps/web/src/features/goals/GoalsPage.tsx:40-72` (initials on a shared row)
- Test: `apps/web/src/features/goals/goal-cards.test.ts` (new cases)

**Interfaces:**
- Consumes: `fundingGroups`, `heroSegments`, `sharedWithLabel`, `initialsLine`, `useGoalShare` (Task 15); `privateCopyOf` (Task 8).
- Produces: `GoalCard.ownMinor: number`, `GoalCard.othersMinor: number`; `goalsTotals` reads `ownBaseMinor` for a shared card.

- [ ] **Step 1: Write the failing test**

```ts
it('a shared card splits own and others', () => {
  const card = goalCard(planWith(ownLinks(28_000_000), rinaLinks(14_000_000)));
  expect([card.currentMinor, card.ownMinor, card.othersMinor]).toEqual([42_000_000, 28_000_000, 14_000_000]);
});
it('the list total counts only this person\'s money', () => {
  expect(goalsTotals([{ currentMinor: 42_000_000, ownMinor: 28_000_000, done: false, statusLabel: 'On track' }]).savedMinor).toBe(28_000_000);
});
```

- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/features/goals/goal-cards.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** the card fields and the screens per spec §10 (partner rows: `caption="Rina's account"`, no `to`; the Me group ends with `＋ Set aside`, which opens `SetAsideSheet`).
- [ ] **Step 4: Run** — expected PASS; `npx vitest run src/features/goals` and `npm run typecheck` — expected PASS; `npx playwright test e2e/goals.spec.ts e2e/phone-goal-funding.spec.ts --project=phone` — expected PASS (private goals unchanged).
- [ ] **Step 5: Commit** `git add apps/web/src/features/goals/goal-cards.ts apps/web/src/features/goals/goal-cards.test.ts apps/web/src/features/goals/GoalPage.tsx apps/web/src/features/goals/funding.tsx apps/web/src/features/goals/GoalsPage.tsx && git commit -m "Goals: a shared goal's page and row, each member's money by name"`

### Task 17: History page

Spec §9.2, C27.

**Files:**
- Create: `apps/web/src/features/goals/history-lines.ts`
- Modify: `apps/web/src/features/goals/GoalHistoryPage.tsx:9-45`
- Test: `apps/web/src/features/goals/history-lines.test.ts`

**Interfaces:**
- Consumes: `GoalHistoryEntry` with `by`, `memberName` (Task 13).
- Produces: `historyTitle(entry: GoalHistoryEntry): string`; `historySubtitle(entry: GoalHistoryEntry, today: string, nameOf: (memberId: string) => string, shared: boolean): string`.

- [ ] **Step 1: Write the failing test**

```ts
it('titles the share\'s own lines', () => {
  expect(historyTitle(entry({ kind: 'left', memberName: 'Rina' }))).toBe('Rina left');
  expect(historyTitle(entry({ kind: 'stopped', memberName: 'Rina' }))).toBe('Stopped sharing with Rina');
  expect(historyTitle(entry({ kind: 'unshared', memberName: 'Bima' }))).toBe('No longer shared by Bima');
  expect(historyTitle(entry({ kind: 'set-aside' }))).toBe('Set aside');
});
it('ends each line of a shared goal with its person', () => {
  expect(historySubtitle(entry({ kind: 'set-aside', by: 'member-r', occurredOn: '2026-11-03', text: 'Partner Savings' }), '2026-11-10', () => 'Rina', true)).toBe('3 Nov · Partner Savings · Rina');
  expect(historySubtitle(entry({ kind: 'set-aside', by: null, occurredOn: '2026-11-02', text: 'Main Savings' }), '2026-11-10', () => 'Rina', true)).toBe('2 Nov · Main Savings · Me');
  expect(historySubtitle(entry({ kind: 'set-aside', by: null, occurredOn: '2026-11-02', text: 'Main Savings' }), '2026-11-10', () => 'Rina', false)).toBe('2 Nov · Main Savings');
});
```

- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/features/goals/history-lines.test.ts` — expected FAIL.
- [ ] **Step 3: Implement**; `GoalHistoryPage` uses both functions.
- [ ] **Step 4: Run** — expected PASS; `npm run typecheck` — expected PASS.
- [ ] **Step 5: Commit** `git add apps/web/src/features/goals/history-lines.ts apps/web/src/features/goals/history-lines.test.ts apps/web/src/features/goals/GoalHistoryPage.tsx && git commit -m "Goals: History says who moved the money on a shared goal"`

### Task 18: Two phones, end to end

Spec §12 E2E.

**Files:**
- Create: `apps/web/e2e/phone-shared-goals.spec.ts` (helpers from `e2e/goals.ts`, `e2e/goal-funding.ts`, `e2e/workspace-page.ts`, `secondPhone` as `e2e/phone-shared-events.spec.ts:24-28`)

- [ ] **Step 1: Write the test** — Bima and Rina share the Personal workspace; Bima adds goal "Trip Fund", Rp 180.000.000 due June 2030, switch "Shared with Rina" on; sets aside 20.000.000 from "Main Savings" and 8.000.000 from "Daily Account"; Rina sets aside 10.000.000 from "Partner Savings" and tags a buy of "Cash Fund" worth 4.000.000. Assert on both phones: legend Me 28.000.000 / Rina 14.000.000 / To go 138.000.000 (Rina's phone: Me 14.000.000 / Bima 28.000.000); Rina's rows on Bima's phone read "Rina's account" and are not links; Rina marks the payment paid → Bima's reads paid; Bima turns sharing off → Rina's Goals list has one "Trip Fund" with Partner Savings 10.000.000 set aside and no initials; Bima's page shows only his own group. Every figure invented.
- [ ] **Step 2: Run** `cd apps/web && npx playwright test e2e/phone-shared-goals.spec.ts --project=phone` — expected PASS.
- [ ] **Step 3: Commit** `git add apps/web/e2e/phone-shared-goals.spec.ts && git commit -m "E2E: a goal shared by two phones, funded by both, turned off"`

## Self-review

- **Spec coverage.** D1 → Tasks 4, 15. D2 → Tasks 7, 12, 16. D3 → Tasks 15, 16. D4 → Tasks 6, 10, 12, 13. D5/D7 → Tasks 5, 8. D6 → Tasks 4, 14, 15. D8 → Tasks 11, 12. D9 → Task 7 (counted figure), Task 13 (spent text). D10 → Tasks 4, 10. C4 → Task 1. C5/C6/C9/C16/C17 → Task 7. C10/C11 → Tasks 6, 10. C13–C15/C30/C32 → Tasks 5, 8. C18/C19 → Tasks 12, 16. C20 → Tasks 2, 12. C21 → Task 16. C22 → Task 12. C23/C25 → Task 11. C26/C31/C33 → Tasks 15, 16. C27 → Tasks 13, 17. C28 → Task 16. C29 → Task 6. §8.5 capture points → Tasks 9, 10, 11 (with `npm run test:capture` in each). §8.6 version and joiners → Tasks 4, 14. §9.3 reader isolation → Task 12. §9.4 → Task 10. §11 edge cases → Tasks 8 (off/on, partner sets aside during off, share ends), 9 (second device), 12 (no rate), 14 (later member, crossing edits). Privacy test → Task 14.
- **Names agree.** `GoalLinkView` (Task 4) is read by Tasks 6, 8; `GoalFundingLine`/`ownGoalFunding`/`ownGoalMoves` (Task 7) by Tasks 8, 9; `rekeyGoalTx` (Task 5) by Task 8; `GoalShareView`/`goalShareOf`/`goalSharesOf`/`privateCopyOf` (Task 8) by Tasks 10, 12, 15, 16; `GoalLinkRow.owner` and `GoalPlanRow.ownNeededMonthlyMinor` (Task 12) by Tasks 15, 16; `GoalHistoryEntry.by`/`memberName` (Task 13) by Task 17.
- **Review Focus tests placed:** 1 → Task 8; 2 → Task 4; 3 → Tasks 14, 10; 4 → Tasks 7, 12; 5 → Tasks 14, 9.
