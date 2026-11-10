import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAccount,
  createGoalFromCalculator,
  goalPlansFor,
  goalShareTargets,
  listGoals,
  postTransaction,
  removeEarmark,
  saveEarmark,
  saveGoal,
  saveGoalCalculator,
  setStagePaid,
  shareGoal,
  type GoalSummary,
  type SaveGoalStageInput,
} from '../../src/index';
import type { Op } from '../../src/sync/types';
import { Household, skipsOf, type Device } from './household';
import { clearOutbox, outboxOps } from './sync-helpers';

/*
 * A household's shared goal over the real engine (shared goals §11, §12; Review Focus 3 and 5): every phone ends with
 * the same goal, crossing stage edits settle alike everywhere, a member who joins later reads the goal and sends no line
 * of their own, and nothing private ever leaves a phone. Bima shares 'Home Fund'; Rina puts money of her own toward
 * it; Adi joins later.
 */

const DAY = '2026-11-10';

/**
 * Every change-set this device ever wrote to its outbox, kept by a trigger: the engine empties the outbox as it drains
 * (a join drains inside `joinBook`), so reading it before each settle would miss what went out in between.
 */
async function watchSent(device: Device): Promise<void> {
  await device.database.execScript(`
    CREATE TEMP TABLE IF NOT EXISTS sent_entries (entry_json TEXT NOT NULL);
    CREATE TEMP TRIGGER IF NOT EXISTS sent_entries_kept AFTER INSERT ON sync_outbox BEGIN INSERT INTO sent_entries (entry_json) VALUES (NEW.entry_json); END;
  `);
}

async function sentOps(device: Device): Promise<Op[]> {
  const rows = await device.database.db.values<[string]>(sql`SELECT entry_json FROM temp.sent_entries ORDER BY rowid`);
  return rows.flatMap(([json]) => (JSON.parse(json) as { ops: Op[] }).ops);
}

async function newDevice(h: Household, name: string): Promise<Device> {
  const device = await h.device(name, `member-${name}`, 'IDR', '0.5.0');
  await watchSent(device);
  return device;
}

const savings = (device: Device, name: string, openingBalanceMinor: number) =>
  createAccount(device.database, device.ws, { name, kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor, openedOn: '2026-01-01' }).then((a) => a.id);

/** Bima and Rina, Bima's 'Home Fund' shared; Bima holds 20_000_000 + 8_000_000 toward it, Rina 10_000_000 + 4_000_000. */
async function world() {
  const h = new Household();
  const bima = await newDevice(h, 'Bima');
  const rina = await newDevice(h, 'Rina');
  const bookId = await h.share(bima);
  await h.join(rina, bima);
  await h.settle();
  const accounts = {
    bimaMain: await savings(bima, 'Bima Savings', 30_000_000),
    bimaSpare: await savings(bima, 'Bima Reserve', 9_000_000),
    rinaMain: await savings(rina, 'Rina Savings', 15_000_000),
    rinaSpare: await savings(rina, 'Rina Reserve', 5_000_000),
  };
  const goalId = await saveGoal(bima.database, bima.ws, {
    name: 'Home Fund',
    kind: 'home',
    growthBps: 0,
    returnBps: 0,
    stages: [
      { name: 'Deposit', targetMinor: 60_000_000, targetMonths: null, dueOn: '2028-06-01' },
      { name: 'Balance', targetMinor: 95_000_000, targetMonths: null, dueOn: '2030-06-01' },
    ],
  });
  await shareGoal(bima.database, bima.ws, goalId, bookId);
  await h.settle();
  await saveEarmark(bima.database, bima.ws, { goalId, accountId: accounts.bimaMain, amountMinor: 20_000_000 });
  await saveEarmark(bima.database, bima.ws, { goalId, accountId: accounts.bimaSpare, amountMinor: 8_000_000 });
  await saveEarmark(rina.database, rina.ws, { goalId, accountId: accounts.rinaMain, amountMinor: 10_000_000 });
  await saveEarmark(rina.database, rina.ws, { goalId, accountId: accounts.rinaSpare, amountMinor: 4_000_000 });
  await h.settle();
  const stageIds = Object.fromEntries((await listGoals(bima.database, bima.ws))[0]!.stages.map((s) => [s.name, s.id]));
  return { h, bima, rina, bookId, goalId, accounts, depositId: stageIds.Deposit!, balanceId: stageIds.Balance! };
}

const planOf = (summary: GoalSummary, goalId: string) => summary.plans.find((p) => p.goalId === goalId)!;

/** The goal as one phone reads it, with each member's Saved under their member id (a phone's own lines carry none). */
async function read(device: Device, goalId: string) {
  const plan = planOf(await goalPlansFor(device.database, device.ws, DAY), goalId);
  const savedBy: Record<string, number> = {};
  for (const link of plan.links) {
    const who = link.owner ?? device.memberId;
    savedBy[who] = (savedBy[who] ?? 0) + ((link.goalMinor === undefined ? link.baseMinor : link.goalMinor) ?? 0);
  }
  return {
    target: plan.allTargetMinor,
    current: plan.currentMinor,
    toGo: plan.totalTargetMinor - plan.currentMinor,
    savedBy,
    stages: plan.stages.map((s) => [s.name, s.targetMinor, s.state]),
  };
}

async function stageOf(device: Device, stageId: string) {
  const [row] = await device.database.db.values<[string, string | null]>(sql`SELECT name, paid_on FROM goal_stages WHERE id = ${stageId}`);
  return row ? { name: row[0], paidOn: row[1] } : null;
}

type StageEdit = SaveGoalStageInput & { id: string };

/** Edit goal on one phone: the goal as listed there, its stages changed by `change`. */
async function editStages(device: Device, goalId: string, change: (stages: StageEdit[]) => StageEdit[]) {
  const goal = (await listGoals(device.database, device.ws)).find((g) => g.id === goalId)!;
  const stages = goal.stages.map((s): StageEdit => ({ id: s.id, name: s.name, targetMinor: s.targetMinor, targetMonths: s.targetMonths, dueOn: s.dueOn, paidOn: s.paidOn ?? null }));
  await saveGoal(device.database, device.ws, { id: goalId, name: goal.name, kind: goal.kind, growthBps: goal.growthBps, returnBps: goal.returnBps, standingMonthlyMinor: goal.standingMonthlyMinor, stages: change(stages) });
}

describe('a shared goal across the household', () => {
  it('every phone reads the same target, Saved per member, To go and stages', async () => {
    const { bima, rina, goalId } = await world();
    const onBima = await read(bima, goalId);
    expect(await read(rina, goalId)).toEqual(onBima);
    expect(onBima).toEqual({
      target: 155_000_000,
      current: 42_000_000,
      toGo: 113_000_000,
      savedBy: { 'member-Bima': 28_000_000, 'member-Rina': 14_000_000 },
      stages: [
        ['Deposit', 60_000_000, 'saving'],
        ['Balance', 95_000_000, 'later'],
      ],
    });
    for (const d of [bima, rina]) expect(await skipsOf(d.database)).toEqual([]);
  });

  it('crossing stage edits (Review Focus 3)', async () => {
    const { h, bima, rina, goalId, depositId, balanceId } = await world();
    // Offline: Rina renames 'Deposit' to 'First payment' while Bima marks it paid. Each field lands everywhere.
    await editStages(rina, goalId, (stages) => stages.map((s) => (s.id === depositId ? { ...s, name: 'First payment' } : s)));
    await setStagePaid(bima.database, bima.ws, depositId, DAY);
    await h.settle();
    for (const d of [bima, rina]) expect(await stageOf(d, depositId)).toEqual({ name: 'First payment', paidOn: DAY });

    // Offline: Bima removes 'Balance' while Rina marks it paid. The removal wins on both phones.
    await editStages(bima, goalId, (stages) => stages.filter((s) => s.id !== balanceId));
    await setStagePaid(rina.database, rina.ws, balanceId, DAY);
    await h.settle();
    for (const d of [bima, rina]) expect(await stageOf(d, balanceId)).toBeNull();
    expect([...(await skipsOf(bima.database)), ...(await skipsOf(rina.database))]).toEqual([]);

    // And both phones read the goal alike after it: one paid stage, nothing left to plan for.
    expect(await read(rina, goalId)).toEqual(await read(bima, goalId));
    expect((await read(bima, goalId)).stages).toEqual([['First payment', 60_000_000, 'paid']]);
  });

  it('a member who joins later (Review Focus 5)', async () => {
    const { h, bima, rina, goalId } = await world();
    const adi = await newDevice(h, 'Adi');
    await h.join(adi, bima);
    await h.settle();
    expect((await listGoals(adi.database, adi.ws)).map((g) => g.id)).toContain(goalId);
    // Adi reads every member's money in it, as the others do.
    expect(await read(adi, goalId)).toEqual(await read(bima, goalId));
    expect((await read(adi, goalId)).savedBy).toEqual({ 'member-Bima': 28_000_000, 'member-Rina': 14_000_000 });
    // The switch's label names Adi on the others' phones.
    expect((await goalShareTargets(bima.database))[0]!.others.map((o) => o.name)).toEqual(['Rina', 'Adi']);
    expect((await goalShareTargets(rina.database))[0]!.others.map((o) => o.name)).toEqual(['Bima', 'Adi']);
    // With no money of Adi's in it, Adi's phone never wrote a line (an empty one would read as "nothing" to the others).
    expect((await sentOps(adi)).filter((o) => o.entity.startsWith('goal'))).toEqual([]);
    expect((await outboxOps(adi.database)).filter((o) => o.entity === 'goal_member_funding')).toEqual([]);
    for (const d of [bima, rina, adi]) expect(await skipsOf(d.database)).toEqual([]);
  });

  /** The world with a tablet of Bima's joined later, as Bima (S§8.3): it holds the goal but none of his accounts. */
  async function withTablet() {
    const w = await world();
    const tablet = await w.h.device('BimaTablet', w.bima.memberId, 'IDR', '0.5.0');
    await watchSent(tablet);
    const { code } = await w.bima.engine.createInvite(w.bookId, { inviterName: 'Bima', sameMember: true, memberId: w.bima.memberId });
    await tablet.engine.joinBook(code, { ws: tablet.ws, memberName: 'Bima', deviceName: "Bima's tablet", memberId: w.bima.memberId });
    await w.h.settle();
    return { ...w, tablet };
  }

  it("Bima's second phone joins later: the goal, and no line over his own (Review Focus 5)", async () => {
    const { bima, rina, tablet, goalId } = await withTablet();
    expect((await listGoals(tablet.database, tablet.ws)).map((g) => g.id)).toContain(goalId);
    expect((await sentOps(tablet)).filter((o) => o.entity.startsWith('goal'))).toEqual([]);
    expect(await read(rina, goalId)).toEqual(await read(bima, goalId));
    for (const d of [bima, rina, tablet]) expect(await skipsOf(d.database)).toEqual([]);
  });

  // Known gap, found here (§11 "Its Me group shows the member's synced row"): the plan read takes only the *other*
  // members' synced lines, so the tablet counts Rina's 14_000_000 and none of Bima's 28_000_000. The fix is one line in
  // goal-funding.ts `otherFundingByGoal` (busy in another task); this turns red once it lands, then becomes an `it`.
  it.fails("Bima's second phone reads his money from his synced line", async () => {
    const { bima, tablet, goalId } = await withTablet();
    expect(await read(tablet, goalId)).toEqual(await read(bima, goalId));
  });

  it('nothing private leaves a phone', async () => {
    const { h, bima, rina, goalId, depositId, accounts } = await world();
    // A month of goal activity on both phones: money taken back and set aside again, a spend out of a promise, a stage
    // paid, an edit.
    await removeEarmark(rina.database, rina.ws, goalId, accounts.rinaSpare);
    const fixtures = (await createAccount(rina.database, rina.ws, { name: 'Fixtures', kind: 'expense', subtype: 'category', currency: null })).id;
    await postTransaction(rina.database, rina.ws, {
      occurredOn: DAY,
      description: 'Lamps',
      lines: expenseLines({ categoryAccountId: fixtures, paymentAccountId: accounts.rinaMain, amountMinor: 7_000_000, currency: 'IDR' }),
      setAside: { accountId: accounts.rinaMain, goalId, intent: 'spend', overMinor: 2_000_000 },
    });
    await saveEarmark(rina.database, rina.ws, { goalId, accountId: accounts.rinaSpare, amountMinor: 3_000_000 });
    await setStagePaid(rina.database, rina.ws, depositId, DAY);
    await editStages(bima, goalId, (stages) => stages.map((s) => (s.id === depositId ? { ...s, targetMinor: 62_000_000 } : s)));
    await saveEarmark(bima.database, bima.ws, { goalId, accountId: accounts.bimaMain, amountMinor: 25_000_000 });
    await h.settle();

    const devices = [bima, rina];
    const accountIds: string[] = [];
    const transactionIds: string[] = [];
    for (const d of devices) {
      accountIds.push(d.bank, d.cash, d.usd);
      accountIds.push(...(await d.database.db.values<[string]>(sql`SELECT id FROM accounts WHERE kind IN ('asset', 'liability')`)).map((r) => r[0]));
      transactionIds.push(...(await d.database.db.values<[string]>(sql`SELECT id FROM transactions`)).map((r) => r[0]));
    }
    expect(accountIds).toEqual(expect.arrayContaining(Object.values(accounts)));
    const sent = (await Promise.all(devices.map(sentOps))).flat();
    const goalOps = sent.filter((o) => o.entity.startsWith('goal'));
    expect(new Set(goalOps.map((o) => o.entity))).toEqual(new Set(['goal_share', 'goal', 'goal_stage', 'goal_member_funding', 'goal_member_move']));
    expect(goalOps.filter((o) => o.op === 'upsert' && o.fields.kind === 'spent')).toHaveLength(1);
    // No op of any kind names an account of money or a transaction.
    const text = JSON.stringify(sent);
    expect(transactionIds.length).toBeGreaterThan(0);
    for (const id of new Set([...accountIds, ...transactionIds])) expect(text).not.toContain(id);
    // The lines travel as JSON text inside the op, so a key there is quoted with escapes.
    expect(text).not.toMatch(/\\*"(balance|shortMinor|promisedMinor)\\*"/);
    const goalKeys = keysIn(goalOps);
    for (const key of ['balance', 'balanceMinor', 'shortMinor', 'promisedMinor', 'overBalance', 'accountId', 'transactionId']) expect(goalKeys).not.toContain(key);
    // transactions.goal_id never travels: no purchase op names a goal.
    expect(sent.filter((o) => o.entity === 'purchase' && JSON.stringify(o).includes(goalId))).toEqual([]);
  });
});

/** Every object key in the ops, including those inside fields that carry JSON text (a line list, a working's inputs). */
function keysIn(value: unknown, out = new Set<string>()): string[] {
  if (typeof value === 'string') {
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        keysIn(JSON.parse(value), out);
      } catch {
        // Not JSON: plain text.
      }
    }
  } else if (Array.isArray(value)) for (const item of value) keysIn(item, out);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.add(key);
      keysIn(item, out);
    }
  }
  return [...out];
}

describe('a calculator save on a shared goal', () => {
  it('sends each row once', async () => {
    const { h, bima, rina, bookId } = await world();
    const goalId = await createGoalFromCalculator(bima.database, bima.ws, { name: 'Safety net', kind: 'emergency', inputs: { months: 6, monthlyOutgoingMinor: 5_000_000 }, today: DAY });
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    await h.settle();
    await clearOutbox(bima.database);
    await saveGoalCalculator(bima.database, bima.ws, { goalId, kind: 'emergency', inputs: { months: 9, monthlyOutgoingMinor: 5_000_000 }, today: DAY });
    const ops = (await outboxOps(bima.database)).filter((o) => o.entity.startsWith('goal'));
    const keys = ops.map((o) => `${o.entity}|${o.id}|${o.op}`);
    expect(keys).toEqual([...new Set(keys)]);
    expect(new Set(ops.map((o) => o.entity))).toEqual(new Set(['goal_stage', 'goal_calculator']));
    await h.settle();
    const target = async (d: Device) => (await listGoals(d.database, d.ws)).find((g) => g.id === goalId)!.stages.map((s) => [s.targetMinor, s.targetMonths]);
    expect(await target(rina)).toEqual(await target(bima));
    // An emergency fund's stage asks a number of months, worked out on each phone from its own spending.
    expect(await target(bima)).toEqual([[null, 9]]);
    for (const d of [bima, rina]) expect(await skipsOf(d.database)).toEqual([]);
  });
});
