import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  createAccount,
  type Database,
  goalContributionsFor,
  goalPlansFor,
  goalWholeness,
  netWorthAt,
  saveEarmark,
  saveGoal,
  setAsideViews,
  upsertRate,
  type GoalSummary,
  type WorkspaceContext,
} from '../src/index';
import { ownGoalFunding } from '../src/sync/goals/summaries';
import { setupDb } from './helpers';

/* Shared goals §9.1, §9.3, C16, C19-C22: the plan counts both people's money, this phone plans its own part, and a
   partner's money reaches no reader that is about this person's own. Bima's phone throughout; Rina is the partner. */

const TODAY = '2026-11-10';
const BOOK = 'book-home';

let database: Database;
let ws: WorkspaceContext;
let goalId: string;
let privateId: string;

const planOf = (summary: GoalSummary, id: string) => summary.plans.find((plan) => plan.goalId === id)!;
const plans = (date = TODAY) => goalPlansFor(database, ws, date);

interface Line {
  ref: string;
  name: string;
  kind: 'earmark' | 'tagged';
  amountMinor: number | null;
  risk: 'low' | 'medium' | 'high' | null;
}
const RINA_LINES: Line[] = [
  { ref: 'ref-1', name: 'Partner Savings', kind: 'earmark', amountMinor: 10_000_000, risk: null },
  { ref: 'ref-2', name: 'Cash Fund', kind: 'tagged', amountMinor: 4_000_000, risk: 'low' },
];

async function giveRina(lines: Line[], plannedMonthlyMinor: number, member = 'member-r', goal = goalId) {
  await database.db.run(sql`
    INSERT INTO goal_member_funding (goal_id, member_id, workspace_id, lines_json, planned_monthly_minor, as_of)
    VALUES (${goal}, ${member}, ${ws.workspaceId}, ${JSON.stringify(lines)}, ${plannedMonthlyMinor}, ${TODAY})
    ON CONFLICT (goal_id, member_id) DO UPDATE SET lines_json = excluded.lines_json, planned_monthly_minor = excluded.planned_monthly_minor`);
}

/** Bima's own line as his other device sent it: this phone is member-b too. */
const BIMA_LINES: Line[] = [
  { ref: 'ref-b1', name: 'Home Savings', kind: 'earmark', amountMinor: 20_000_000, risk: null },
  { ref: 'ref-b2', name: 'Spare Account', kind: 'earmark', amountMinor: 8_000_000, risk: null },
];

async function shareGoalRaw(id: string) {
  await database.db.run(sql`INSERT OR IGNORE INTO books (id, workspace_id, name, kind, base_currency, count_events_in_budget, sort_order, created_at)
    VALUES (${BOOK}, ${ws.workspaceId}, 'Home', 'shared', 'IDR', 0, 5, '2026-10-01T00:00:00Z')`);
  await database.db.run(sql`INSERT OR IGNORE INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${BOOK}, 'relay-1', 1, 'member-b', 'active', '2026-10-01T00:00:00Z')`);
  await database.db.run(sql`INSERT OR IGNORE INTO book_members VALUES (${BOOK}, 'member-b', 'Bima', 'owner', '2026-10-01T00:00:00Z')`);
  await database.db.run(sql`INSERT OR IGNORE INTO book_members VALUES (${BOOK}, 'member-r', 'Rina', 'member', '2026-10-02T00:00:00Z')`);
  await database.db.run(sql`INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on, round) VALUES (${id}, ${BOOK}, ${ws.workspaceId}, 'member-b', 'on', '2026-10-05', 1)`);
}

const oneStage = (name: string, targetMinor: number) => ({ name, kind: 'holiday' as const, growthBps: 0, returnBps: 0, stages: [{ name: 'All', targetMinor, targetMonths: null, dueOn: '2030-11-10' }] });

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  const main = (await createAccount(database, ws, { name: 'Main Savings', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 30_000_000, openedOn: '2026-01-01' })).id;
  const daily = (await createAccount(database, ws, { name: 'Daily Account', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' })).id;
  goalId = await saveGoal(database, ws, { ...oneStage('Family Trip', 180_000_000), standingMonthlyMinor: 2_000_000 });
  privateId = await saveGoal(database, ws, oneStage('Laptop', 24_000_000));
  await saveEarmark(database, ws, { goalId, accountId: main, amountMinor: 20_000_000 });
  await saveEarmark(database, ws, { goalId, accountId: daily, amountMinor: 8_000_000 });
  await saveEarmark(database, ws, { goalId: privateId, accountId: daily, amountMinor: 1_000_000 });
  await shareGoalRaw(goalId);
});

describe('plan reads on a shared goal', () => {
  it('own figures alone before the partner sends anything', async () => {
    const plan = planOf(await plans(), goalId);
    expect(plan.currentMinor).toBe(28_000_000);
    expect(plan.othersPlannedMonthlyMinor).toBe(0);
    expect(plan.ownNeededMonthlyMinor).toBe(plan.requiredMonthlyMinor);
  });

  it('counts both people', async () => {
    await giveRina(RINA_LINES, 1_000_000);
    const plan = planOf(await plans(), goalId);
    expect(plan.currentMinor).toBe(42_000_000);
    expect(plan.allTargetMinor).toBe(180_000_000);
    expect(plan.links.filter((l) => l.owner === 'member-r').map((l) => [l.name, l.valueMinor, l.shortMinor])).toEqual([
      ['Partner Savings', 10_000_000, 0],
      ['Cash Fund', 4_000_000, 0],
    ]);
    const cash = plan.links.find((l) => l.name === 'Cash Fund')!;
    expect([cash.kind, cash.goalMinor, cash.baseMinor, cash.currency, cash.overBalance, cash.promisedMinor, cash.risk, cash.accountId]).toEqual(['tagged', 4_000_000, 4_000_000, 'IDR', false, null, 'low', 'ref-2']);
    expect(plan.links.filter((l) => !l.owner)).toHaveLength(2);
    expect(plan.plannedMonthlyMinor).toBe(3_000_000);
    expect(plan.othersPlannedMonthlyMinor).toBe(1_000_000);
    // (180.000.000 - 42.000.000) over 48 months
    expect(plan.requiredMonthlyMinor).toBe(2_875_000);
    expect(plan.ownNeededMonthlyMinor).toBe(1_875_000);
    expect(plan.ownNeededMonthlyBaseMinor).toBe(1_875_000);
  });

  it('a partner who plans more than the need leaves nothing for this phone', async () => {
    await giveRina(RINA_LINES, 5_000_000);
    expect(planOf(await plans(), goalId).ownNeededMonthlyMinor).toBe(0);
  });

  it('the fit and the totals ask this phone for its part', async () => {
    await giveRina(RINA_LINES, 1_000_000);
    const summary = await plans();
    expect(summary.neededMonthlyMinor).toBe(1_875_000 + planOf(summary, privateId).requiredMonthlyMinor);
    const fit = summary.fits.find((f) => f.goalId === goalId)!;
    expect(fit.fundedMonthlyMinor).toBeLessThanOrEqual(1_875_000);
  });

  it('the budget plans this phone\'s part', async () => {
    await giveRina(RINA_LINES, 1_000_000);
    const sheet = await budgetSheetFor(database, ws, '2026-11');
    // read at the month's end: 47 months left, (180.000.000 - 42.000.000) / 47 = 2.936.170, less the partner's 1.000.000
    expect(planOf(await plans('2026-11-30'), goalId).ownNeededMonthlyMinor).toBe(1_936_170);
    expect(sheet.savings.find((s) => s.goalId === goalId)!.planMinor).toBe(1_936_170);
    expect(sheet.savings.find((s) => s.goalId === privateId)!.planMinor).toBe(planOf(await plans('2026-11-30'), privateId).requiredMonthlyMinor);
  });

  it('no rate on the partner\'s phone', async () => {
    await giveRina([RINA_LINES[0]!, { ...RINA_LINES[1]!, amountMinor: null }], 1_000_000);
    const plan = planOf(await plans(), goalId);
    expect(plan.currentMinor).toBe(38_000_000);
    expect(plan.unconvertedWarning).toContain('Cash Fund');
    expect(plan.links.find((l) => l.name === 'Cash Fund')!.goalMinor).toBeNull();
  });

  it('a member who left is not counted', async () => {
    await giveRina(RINA_LINES, 1_000_000);
    await database.db.run(sql`INSERT INTO goal_share_leaves (goal_id, member_id, workspace_id, round, left_on) VALUES (${goalId}, 'member-r', ${ws.workspaceId}, 1, '2026-11-01')`);
    const plan = planOf(await plans(), goalId);
    expect(plan.currentMinor).toBe(28_000_000);
    expect(plan.othersPlannedMonthlyMinor).toBe(0);
  });

  it('a leave from an earlier round does not hide the member', async () => {
    await database.db.run(sql`UPDATE goal_shares SET round = 2 WHERE goal_id = ${goalId}`);
    await giveRina(RINA_LINES, 1_000_000);
    await database.db.run(sql`INSERT INTO goal_share_leaves (goal_id, member_id, workspace_id, round, left_on) VALUES (${goalId}, 'member-r', ${ws.workspaceId}, 1, '2026-10-20')`);
    expect(planOf(await plans(), goalId).currentMinor).toBe(42_000_000);
  });

  it('a goal turned off counts only this phone', async () => {
    await giveRina(RINA_LINES, 1_000_000);
    await database.db.run(sql`UPDATE goal_shares SET state = 'off' WHERE goal_id = ${goalId}`);
    expect(planOf(await plans(), goalId).currentMinor).toBe(28_000_000);
  });

  it('a SAR goal adds the partner\'s SAR figure as it is', async () => {
    await upsertRate(database, { fromCurrency: 'SAR', toCurrency: 'IDR', onDate: TODAY, rate: 4_000, source: 'manual', sourceDate: TODAY });
    await database.db.run(sql`UPDATE goals SET currency = 'SAR' WHERE id = ${goalId}`);
    const before = planOf(await plans(), goalId);
    await giveRina([{ ref: 'ref-1', name: 'Partner Savings', kind: 'earmark', amountMinor: 300_000, risk: null }], 0);
    const after = planOf(await plans(), goalId);
    expect(after.currentMinor).toBe(before.currentMinor + 300_000);
    const rina = after.links.find((l) => l.owner === 'member-r')!;
    expect([rina.goalMinor, rina.currency]).toEqual([300_000, 'SAR']);
    // this phone's rate: 4.000 IDR a riyal; 3.000 riyals
    expect(rina.baseMinor).toBe(12_000_000);
  });

  it('shared goals have no funded-since day', async () => {
    const wholeness = await goalWholeness(database, ws, TODAY);
    expect(wholeness[goalId]!.since).toBeNull();
  });

  it('the partner\'s money reaches no other reader', async () => {
    const read = async () => ({
      nw: await netWorthAt(database, ws, TODAY, {}),
      views: await setAsideViews(database, ws),
      put: await goalContributionsFor(database, ws, '2026-11'),
    });
    const before = await read();
    await giveRina(RINA_LINES, 1_000_000);
    expect(await read()).toEqual(before);
  });

  it('a private goal reads exactly as before', async () => {
    await giveRina(RINA_LINES, 1_000_000);
    const plan = planOf(await plans(), privateId);
    expect(plan.ownNeededMonthlyMinor).toBe(plan.requiredMonthlyMinor);
    expect(plan.othersPlannedMonthlyMinor).toBe(0);
    expect(plan.currentMinor).toBe(1_000_000);
  });

  it('a shared emergency goal uses the frozen outgoing, an unshared one its own spending', async () => {
    // Task 11 writes sharedOutgoingMinor into the working; this phone reads it first, not its own spending.
    const make = async (name: string) => {
      const id = await saveGoal(database, ws, { name, kind: 'emergency', growthBps: 0, returnBps: 0, stages: [{ name: 'Fund', targetMinor: null, targetMonths: 6, dueOn: '2028-11-10' }] });
      await database.db.run(sql`INSERT INTO goal_calculators (goal_id, workspace_id, kind, inputs_json, computed_minor, computed_at) VALUES (${id}, ${ws.workspaceId}, 'emergency', ${JSON.stringify({ months: 6, sharedOutgoingMinor: 5_000_000, sharedOutgoingOn: TODAY })}, 0, ${TODAY})`);
      return id;
    };
    const shared = await make('Safety Net');
    const alone = await make('Own Net');
    await shareGoalRaw(shared);
    const summary = await plans();
    expect(planOf(summary, shared).allTargetMinor).toBe(6 * 5_000_000);
    expect(planOf(summary, alone).allTargetMinor).toBe(0);
  });
});

describe('a second device of the same member (§11)', () => {
  /** A goal shared here with none of Bima's money on this device: his tablet. */
  async function onTablet() {
    const id = await saveGoal(database, ws, { ...oneStage('Home Fund', 162_000_000), standingMonthlyMinor: 500_000 });
    await shareGoalRaw(id);
    await giveRina(BIMA_LINES, 1_500_000, 'member-b', id);
    await giveRina(RINA_LINES, 1_000_000, 'member-r', id);
    return id;
  }

  it("counts the member's synced line once, as that member's", async () => {
    const id = await onTablet();
    const plan = planOf(await plans(), id);
    expect(plan.currentMinor).toBe(42_000_000);
    expect(plan.links.map((l) => [l.owner, l.name, l.goalMinor])).toEqual([
      ['member-b', 'Home Savings', 20_000_000],
      ['member-b', 'Spare Account', 8_000_000],
      ['member-r', 'Partner Savings', 10_000_000],
      ['member-r', 'Cash Fund', 4_000_000],
    ]);
    // This device's standing 500.000, Bima's other device's 1.500.000, Rina's 1.000.000
    expect(plan.plannedMonthlyMinor).toBe(3_000_000);
    // Bima's own plan is not another member's: only Rina's comes off his need.
    expect(plan.othersPlannedMonthlyMinor).toBe(1_000_000);
    // (162.000.000 - 42.000.000) over 48 months, less Rina's 1.000.000
    expect(plan.requiredMonthlyMinor).toBe(2_500_000);
    expect(plan.ownNeededMonthlyMinor).toBe(1_500_000);
  });

  it('sends nothing of the line back: its own part is only what it holds', async () => {
    const id = await onTablet();
    expect(await ownGoalFunding(database, ws, id, TODAY)).toEqual({ lines: [], plannedMonthlyMinor: 500_000 });
  });

  it("the member's synced line on this device reaches no other reader", async () => {
    const id = await saveGoal(database, ws, oneStage('Home Fund', 162_000_000));
    await shareGoalRaw(id);
    const read = async () => ({
      nw: await netWorthAt(database, ws, TODAY, {}),
      views: await setAsideViews(database, ws),
      put: await goalContributionsFor(database, ws, '2026-11'),
    });
    const before = await read();
    await giveRina(BIMA_LINES, 1_500_000, 'member-b', id);
    expect(await read()).toEqual(before);
  });

  it('the device that sent the line counts its own records, not the line as well', async () => {
    await database.db.run(sql`INSERT INTO settings (key, value) VALUES (${`goal.summary.${goalId}`}, '1')`);
    await giveRina(BIMA_LINES, 2_000_000, 'member-b');
    await giveRina(RINA_LINES, 1_000_000);
    const plan = planOf(await plans(), goalId);
    expect(plan.currentMinor).toBe(42_000_000);
    expect(plan.links.filter((l) => l.owner === 'member-b')).toEqual([]);
    expect(plan.plannedMonthlyMinor).toBe(3_000_000);
    expect(plan.othersPlannedMonthlyMinor).toBe(1_000_000);
  });

  it('a device holding money of its own counts that, even before it sends', async () => {
    // No summary written here yet; this device's 28.000.000 is the member's money it knows, not 28.000.000 more.
    await giveRina(BIMA_LINES, 2_000_000, 'member-b');
    await giveRina(RINA_LINES, 1_000_000);
    const plan = planOf(await plans(), goalId);
    expect(plan.currentMinor).toBe(42_000_000);
    expect(plan.links.filter((l) => l.owner === 'member-b')).toEqual([]);
    expect(plan.plannedMonthlyMinor).toBe(3_000_000);
  });
});
