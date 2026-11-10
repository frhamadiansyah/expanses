import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AccountRow,
  createAccount,
  type Database,
  type GoalSummary,
  goalContributionsFor,
  goalHistory,
  goalPlansFor,
  listDraws,
  listEarmarks,
  listGoals,
  postTransaction,
  recordTrade,
  saveAssetProfile,
  saveEarmark,
  saveGoal,
  saveTradeTemplate,
  upsertPrice,
  type WorkspaceContext,
} from '../src/index';
import { rekeyGoalTx } from '../src/repos/goal-private-copy';
import { setupDb } from './helpers';

const TODAY = '2026-11-10';

let database: Database;
let ws: WorkspaceContext;
let savings: string;
let gold: AccountRow;
let goalId: string;
let depositId: string;
let balanceId: string;
let spendId: string;

const planOf = (summary: GoalSummary, id: string) => summary.plans.find((plan) => plan.goalId === id)!;
const count = async (table: string, column: string, id: string) =>
  (await database.db.values<[number]>(sql.raw(`SELECT count(*) FROM ${table} WHERE ${column} = '${id}'`)))[0]![0];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T09:00:00Z'));
  ({ database, ws } = await setupDb());
  savings = (await createAccount(database, ws, { name: 'Main Savings', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 30_000_000, openedOn: '2026-01-01' })).id;
  const travel = await createAccount(database, ws, { name: 'Travel', kind: 'expense', subtype: 'category', currency: null });
  gold = await createAccount(database, ws, { name: 'Gold Savings', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-11-09', priceMicro: 1_500_000_000_000 });
  goalId = await saveGoal(database, ws, {
    name: 'Trip Fund',
    kind: 'holiday',
    growthBps: 0,
    returnBps: 0,
    stages: [
      { name: 'Deposit', targetMinor: 25_000_000, targetMonths: null, dueOn: '2027-01-10' },
      { name: 'Balance', targetMinor: 155_000_000, targetMonths: null, dueOn: '2030-06-01' },
    ],
  });
  const stages = await database.db.values<[string, string]>(sql`SELECT name, id FROM goal_stages WHERE goal_id = ${goalId}`);
  depositId = stages.find(([name]) => name === 'Deposit')![1];
  balanceId = stages.find(([name]) => name === 'Balance')![1];
  await saveEarmark(database, ws, { goalId, accountId: savings, amountMinor: 10_000_000 });
  spendId = await postTransaction(database, ws, {
    occurredOn: TODAY,
    description: 'Flight deposit',
    lines: expenseLines({ categoryAccountId: travel.id, paymentAccountId: savings, amountMinor: 2_000_000, currency: 'IDR' }),
    setAside: { accountId: savings, goalId, intent: 'spend', overMinor: 2_000_000 },
  });
  await recordTrade(database, ws, {
    accountId: gold.id,
    kind: 'buy',
    occurredOn: TODAY,
    unitsMicro: 2_000_000,
    grossMinor: 3_000_000,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId: savings,
    goalId,
  });
  await saveTradeTemplate(database, ws, { accountId: gold.id, cashAccountId: savings, amountMinor: 1_500_000, unitsMicro: null, dayOfMonth: 9, active: true, goalId });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rekeyGoalTx', () => {
  it('moves everything to new ids and changes no figure', async () => {
    const before = {
      plan: planOf(await goalPlansFor(database, ws, TODAY), goalId),
      put: await goalContributionsFor(database, ws, '2026-11'),
      history: (await goalHistory(database, ws, TODAY, { limit: null }))[goalId],
    };
    // The figures the copy must keep. 10.000.000 was put away; the spend took 2.000.000 of the promise and the gold,
    // bought from the same account, took 3.000.000 more into the holding: 5.000.000 promised plus 3.000.000 of gold.
    expect(before.plan.currentMinor).toBe(8_000_000);
    expect(before.put[goalId]).toBe(10_000_000);

    const { goalId: copy, stageIds } = await database.transaction((tx) =>
      rekeyGoalTx(tx, ws, goalId, { copiedFrom: goalId, logLine: { kind: 'unshared', memberName: 'Bima', occurredOn: TODAY } }),
    );
    expect(copy).not.toBe(goalId);
    expect(Object.keys(stageIds).sort()).toEqual([depositId, balanceId].sort());
    expect(stageIds[depositId]).not.toBe(depositId);
    expect(stageIds[balanceId]).not.toBe(balanceId);
    expect((await listGoals(database, ws)).map((g) => g.id)).toEqual([copy]);
    // The spend and the buy lowered the promise from 10.000.000 to 5.000.000; the copy keeps the lowered one.
    expect(await listEarmarks(database, ws)).toEqual([{ goalId: copy, accountId: savings, amountMinor: 5_000_000 }]);
    expect((await goalContributionsFor(database, ws, '2026-11'))[copy]).toBe(before.put[goalId]);
    expect((await goalContributionsFor(database, ws, '2026-11'))[goalId]).toBeUndefined();
    expect((await listDraws(database, ws))[0]).toMatchObject({ goalId: copy, stageId: stageIds[depositId], amountMinor: 2_000_000 });
    expect(planOf(await goalPlansFor(database, ws, TODAY), copy).currentMinor).toBe(before.plan.currentMinor);
    // The copy's own 'unshared' line is the share's record, not a move.
    expect((await goalHistory(database, ws, TODAY, { limit: null }))[copy]!.filter((e) => e.kind !== 'unshared').map((e) => [e.kind, e.amountMinor])).toEqual(
      before.history!.map((e) => [e.kind, e.amountMinor]),
    );
    expect(await database.db.values(sql`SELECT kind, member_name, copied_from, occurred_on FROM goal_share_log WHERE goal_id = ${copy}`)).toEqual([
      ['unshared', 'Bima', goalId, TODAY],
    ]);
  });

  it('keeps the goal and its stages as they were, under the new ids', async () => {
    const goalCols = `name, kind, rank, growth_bps, return_bps, standing_monthly_minor, standing_note, status, created_at, currency, workspace_id`;
    const stageCols = `name, target_minor, target_months, due_on, sort, paid_on, workspace_id`;
    const goalBefore = await database.db.values(sql.raw(`SELECT ${goalCols} FROM goals WHERE id = '${goalId}'`));
    const stagesBefore = await database.db.values(sql.raw(`SELECT ${stageCols} FROM goal_stages WHERE goal_id = '${goalId}' ORDER BY sort`));
    // The spend paid the earliest stage; the copy's Deposit stays paid.
    expect(stagesBefore.map((row) => [row[0], row[5]])).toEqual([
      ['Deposit', TODAY],
      ['Balance', null],
    ]);
    const { goalId: copy, stageIds } = await database.transaction((tx) => rekeyGoalTx(tx, ws, goalId));
    expect(await database.db.values(sql.raw(`SELECT ${goalCols} FROM goals WHERE id = '${copy}'`))).toEqual(goalBefore);
    expect(await database.db.values(sql.raw(`SELECT ${stageCols} FROM goal_stages WHERE goal_id = '${copy}' ORDER BY sort`))).toEqual(stagesBefore);
    expect((await database.db.values<[string]>(sql`SELECT id FROM goal_stages WHERE goal_id = ${copy} ORDER BY sort`)).map((row) => row[0])).toEqual([
      stageIds[depositId],
      stageIds[balanceId],
    ]);
    expect(await count('goal_stages', 'goal_id', goalId)).toBe(0);
    // No log line asked for, none written.
    expect(await database.db.values(sql`SELECT count(*) FROM goal_share_log`)).toEqual([[0]]);
  });

  it('re-points every table that names the goal or a stage, and leaves another goal alone', async () => {
    const otherId = await saveGoal(database, ws, {
      name: 'Car Fund',
      kind: 'vehicle',
      growthBps: 0,
      returnBps: 0,
      stages: [{ name: 'Car', targetMinor: 90_000_000, targetMonths: null, dueOn: '2028-03-01' }],
    });
    await saveEarmark(database, ws, { goalId: otherId, accountId: savings, amountMinor: 4_000_000 });
    const split = await recordTrade(database, ws, {
      accountId: gold.id,
      kind: 'buy',
      occurredOn: TODAY,
      unitsMicro: 3_000_000,
      grossMinor: 4_500_000,
      feeMinor: 0,
      taxMinor: 0,
      cashAccountId: savings,
      goalParts: [
        { goalId, unitsMicro: 1_000_000, moneyMinor: 0 },
        { goalId: otherId, unitsMicro: 2_000_000, moneyMinor: 0 },
      ],
    });
    expect(split).toBeTruthy();
    const w = ws.workspaceId;
    await database.db.run(sql`UPDATE transactions SET goal_id = ${goalId} WHERE id = ${spendId}`);
    await database.db.run(sql`INSERT INTO events (id, workspace_id, name, starts_on, ends_on, goal_id, created_at) VALUES ('event-trip', ${w}, 'Trip', '2027-01-10', '2027-01-20', ${goalId}, ${TODAY})`);
    await database.db.run(
      sql`INSERT INTO asset_sales (id, workspace_id, account_id, sold_on, sold_for_minor, cash_account_id, transaction_id, goal_id, created_at) VALUES ('sale-1', ${w}, ${gold.id}, ${TODAY}, 1000000, ${savings}, ${spendId}, ${goalId}, ${TODAY})`,
    );
    await database.db.run(sql`INSERT INTO goal_calculators (goal_id, workspace_id, kind, inputs_json, computed_minor, computed_at) VALUES (${goalId}, ${w}, 'education', '{}', 180000000, ${TODAY})`);
    await database.db.run(sql`INSERT INTO goal_stage_terms (stage_id, workspace_id, goal_id, return_bps, derived_key) VALUES (${balanceId}, ${w}, ${goalId}, 700, 'balance')`);
    await database.db.run(sql`INSERT INTO goal_share_log (id, workspace_id, goal_id, kind, member_name, occurred_on) VALUES ('log-1', ${w}, ${goalId}, 'shared', 'Rina', '2026-10-01')`);
    await database.db.run(sql`INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on) VALUES (${goalId}, 'book-family', ${w}, 'member-rina', 'off', ${TODAY})`);

    const tables: [string, string][] = [
      ['goal_earmarks', 'goal_id'],
      ['goal_contributions', 'goal_id'],
      ['goal_draws', 'goal_id'],
      ['goal_calculators', 'goal_id'],
      ['goal_stage_terms', 'goal_id'],
      ['trade_goal_parts', 'goal_id'],
      ['investment_trades', 'goal_id'],
      ['trade_templates', 'goal_id'],
      ['asset_sales', 'goal_id'],
      ['transactions', 'goal_id'],
      ['events', 'goal_id'],
      ['goal_share_log', 'goal_id'],
    ];
    const before = new Map<string, number>();
    for (const [table, column] of tables) before.set(table, await count(table, column, goalId));
    for (const [table] of tables) expect(before.get(table), table).toBeGreaterThan(0);
    const otherBefore = await database.db.values(sql`SELECT goal_id, units_micro FROM trade_goal_parts WHERE goal_id = ${otherId}`);
    const otherEarmark = await database.db.values(sql`SELECT amount_minor FROM goal_earmarks WHERE goal_id = ${otherId}`);

    const { goalId: copy, stageIds } = await database.transaction((tx) => rekeyGoalTx(tx, ws, goalId));
    for (const [table, column] of tables) {
      expect(await count(table, column, goalId), table).toBe(0);
      expect(await count(table, column, copy), table).toBe(before.get(table));
    }
    expect(await count('goal_draws', 'stage_id', stageIds[depositId]!)).toBe(1);
    expect(await count('goal_draws', 'stage_id', depositId)).toBe(0);
    expect(await database.db.values(sql`SELECT stage_id, return_bps, derived_key FROM goal_stage_terms`)).toEqual([[stageIds[balanceId], 700, 'balance']]);
    expect(await database.db.values(sql`SELECT units_micro FROM trade_goal_parts WHERE goal_id = ${copy}`)).toEqual([[1_000_000]]);
    // The other goal's share of the split and its promise are as they were.
    expect(await database.db.values(sql`SELECT goal_id, units_micro FROM trade_goal_parts WHERE goal_id = ${otherId}`)).toEqual(otherBefore);
    expect(await database.db.values(sql`SELECT amount_minor FROM goal_earmarks WHERE goal_id = ${otherId}`)).toEqual(otherEarmark);
    // The share row describes the sharer's goal, which keeps its id: it stays as it was.
    expect(await count('goal_shares', 'goal_id', goalId)).toBe(1);
  });

  it('drops the other members\' lines of the old id', async () => {
    const w = ws.workspaceId;
    await database.db.run(
      sql`INSERT INTO goal_member_funding (goal_id, member_id, workspace_id, lines_json, planned_monthly_minor, as_of) VALUES (${goalId}, 'member-rina', ${w}, '[]', 1500000, ${TODAY})`,
    );
    await database.db.run(
      sql`INSERT INTO goal_member_moves (id, goal_id, workspace_id, member_id, kind, occurred_on, amount_minor, currency, text, stage_id) VALUES ('move-1', ${goalId}, ${w}, 'member-rina', 'set-aside', ${TODAY}, 5000000, 'IDR', 'Joint Savings', ${depositId})`,
    );
    await database.transaction((tx) => rekeyGoalTx(tx, ws, goalId));
    expect(await database.db.values(sql`SELECT count(*) FROM goal_member_funding`)).toEqual([[0]]);
    expect(await database.db.values(sql`SELECT count(*) FROM goal_member_moves`)).toEqual([[0]]);
  });

  it('refuses a goal that is not in the workspace, and changes nothing', async () => {
    await expect(database.transaction((tx) => rekeyGoalTx(tx, ws, 'goal-elsewhere'))).rejects.toThrow('Goal not found in this workspace');
    expect((await listGoals(database, ws)).map((g) => g.id)).toEqual([goalId]);
  });
});
