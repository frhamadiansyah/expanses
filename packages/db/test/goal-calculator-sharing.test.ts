import { addMonths, monthOf } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  categoryIdsByKey,
  clearGoalCalculator,
  createGoalFromCalculator,
  getGoalCalculator,
  postTransaction,
  saveGoal,
  saveGoalCalculator,
  setEmergencyOwnTarget,
  shareGoal,
  upgradeCalculatorGoals,
  type Database,
  type WorkspaceContext,
} from '../src/index';
import { goalCalculators } from '../src/schema-budget';
import { localDate } from '../src/sync/net-worth/summaries';
import { Household, skipsOf, type Device } from './sync/household';
import { clearOutbox, outboxOps } from './sync/sync-helpers';

/*
 * A shared calculator goal (shared goals D8, C23, C25): its saved workings sync, and an emergency fund's monthly
 * outgoing is frozen in them, so both phones show one target. Whoever shares or recalculates freezes their own figure.
 */

const today = () => localDate(Date.now());

/** Three months of groceries at `monthlyMinor`, ending this month, so the last twelve months average exactly that. */
async function spend(database: Database, ws: WorkspaceContext, accountId: string, monthlyMinor: number): Promise<void> {
  const categories = await categoryIdsByKey(database, ws);
  for (const back of [0, 1, 2]) {
    await postTransaction(database, ws, {
      occurredOn: `${addMonths(monthOf(today()), -back)}-01`,
      description: 'Living',
      lines: [
        { accountId: categories['household.groceries']!, amountMinor: monthlyMinor, currency: 'IDR' },
        { accountId, amountMinor: -monthlyMinor, currency: 'IDR' },
      ],
    });
  }
}

async function world() {
  const h = new Household();
  const bima = await h.device('Bima', 'member-Bima', 'IDR', '0.5.0');
  const rina = await h.device('Rina', 'member-Rina', 'IDR', '0.5.0');
  const bookId = await h.share(bima);
  await h.join(rina, bima);
  await h.settle();
  await spend(bima.database, bima.ws, bima.bank, 5_000_000);
  await spend(rina.database, rina.ws, rina.bank, 4_000_000);
  const goalId = await createGoalFromCalculator(bima.database, bima.ws, { name: 'Safety net', kind: 'emergency', inputs: { months: 6 }, today: today() });
  return { h, bima, rina, bookId, goalId };
}

const inputsOf = async (device: Device, goalId: string) => (await getGoalCalculator(device.database, device.ws, goalId))!.inputs;

describe('a shared emergency fund', () => {
  it("sharing freezes the sharer's outgoing", async () => {
    const { h, bima, rina, bookId, goalId } = await world();
    expect(await inputsOf(bima, goalId)).not.toHaveProperty('sharedOutgoingMinor');
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    expect(await inputsOf(bima, goalId)).toMatchObject({ months: 6, sharedOutgoingMinor: 5_000_000, sharedOutgoingOn: today() });
    await h.settle();
    expect(await inputsOf(rina, goalId)).toMatchObject({ sharedOutgoingMinor: 5_000_000, sharedOutgoingOn: today() });
    expect(await skipsOf(rina.database)).toEqual([]);
  });

  it('a typed monthly outgoing is what is frozen', async () => {
    const { bima, bookId, goalId } = await world();
    await saveGoalCalculator(bima.database, bima.ws, { goalId, kind: 'emergency', inputs: { months: 6, monthlyOutgoingMinor: 7_500_000 }, today: today() });
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    expect(await inputsOf(bima, goalId)).toMatchObject({ monthlyOutgoingMinor: 7_500_000, sharedOutgoingMinor: 7_500_000 });
  });

  it('Rina recalculates: her outgoing is frozen and travels', async () => {
    const { h, bima, rina, bookId, goalId } = await world();
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    await h.settle();
    // Typed, because the household's purchases already reached Rina's ledger: her read of the records is 9_000_000 too.
    await saveGoalCalculator(rina.database, rina.ws, { goalId, kind: 'emergency', inputs: { months: 6, monthlyOutgoingMinor: 4_000_000 }, today: today() });
    await h.settle();
    expect(await inputsOf(rina, goalId)).toMatchObject({ monthlyOutgoingMinor: 4_000_000, sharedOutgoingMinor: 4_000_000, sharedOutgoingOn: today() });
    expect(await inputsOf(bima, goalId)).toMatchObject({ monthlyOutgoingMinor: 4_000_000, sharedOutgoingMinor: 4_000_000, sharedOutgoingOn: today() });
    expect(await skipsOf(bima.database)).toEqual([]);
  });

  it('a goal that is not shared keeps no frozen outgoing', async () => {
    const { bima, goalId } = await world();
    await saveGoalCalculator(bima.database, bima.ws, { goalId, kind: 'emergency', inputs: { months: 6, sharedOutgoingMinor: 1, sharedOutgoingOn: '2026-01-01' }, today: today() });
    const inputs = await inputsOf(bima, goalId);
    expect(inputs).not.toHaveProperty('sharedOutgoingMinor');
    expect(inputs).not.toHaveProperty('sharedOutgoingOn');
  });
});

describe('the silent re-working', () => {
  it("runs only on the sharer's phone", async () => {
    const { h, bima, rina, bookId } = await world();
    const goalId = await saveGoal(bima.database, bima.ws, {
      name: 'University', kind: 'education', growthBps: 1000, returnBps: 1000, derived: true,
      stages: [0, 1, 2, 3].map((i) => ({ name: `Year ${i + 1}`, targetMinor: Math.round(100_000_000 * 1.1 ** (10 + i)), targetMonths: null, dueOn: `${2036 + i}-09-13` })),
    });
    await bima.database.db.insert(goalCalculators).values({
      goalId, workspaceId: bima.ws.workspaceId, kind: 'education', computedMinor: 0, computedAt: '2026-09-13T08:00:00.000Z',
      inputsJson: JSON.stringify({ feeTodayMinor: 100_000_000, startsInYears: 10, yearsOfStudy: 4, feeInflationBps: 1000 }),
    });
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    await h.settle();
    expect(await upgradeCalculatorGoals(rina.database, rina.ws, '2026-11-10')).toEqual([]);
    expect(await inputsOf(rina, goalId)).not.toHaveProperty('version');
    expect(await upgradeCalculatorGoals(bima.database, bima.ws, '2026-11-10')).toEqual([goalId]);
    await h.settle();
    // What the sharer re-worked reaches Rina as saved.
    expect(await inputsOf(rina, goalId)).toMatchObject({ version: 2 });
    expect(await skipsOf(rina.database)).toEqual([]);
  });
});

/** An emergency goal as the old calculator left it (v1 working, no version), whose figures come out the same today. */
async function oldEmergencyGoal(device: Device): Promise<string> {
  const goalId = await saveGoal(device.database, device.ws, {
    name: 'Rainy Day', kind: 'emergency', growthBps: 0, returnBps: 200, derived: true,
    stages: [{ name: 'Rainy Day', targetMinor: null, targetMonths: 6, dueOn: '2028-09-13' }],
  });
  await device.database.db.insert(goalCalculators).values({
    goalId, workspaceId: device.ws.workspaceId, kind: 'emergency', computedMinor: 0, computedAt: '2026-09-13T00:00:00.000Z', inputsJson: JSON.stringify({ months: 6 }),
  });
  return goalId;
}

/** The goal ops waiting in a phone's outbox, one string each. */
const goalOpsOf = async (device: Device) =>
  (await outboxOps(device.database)).filter((op) => op.entity.startsWith('goal')).map((op) => `${op.entity}|${op.id}|${op.op}`);

describe("edits to a shared goal's working reach the other phones (§8.5)", () => {
  it("an own target set on Edit goal reaches Bima's phone", async () => {
    const { h, bima, rina, bookId, goalId } = await world();
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    await h.settle();
    await clearOutbox(rina.database);
    await setEmergencyOwnTarget(rina.database, rina.ws, goalId, { targetMinor: 45_000_000, months: 8 });
    expect(await goalOpsOf(rina)).toEqual([`goal_calculator|${goalId}|upsert`]);
    await h.settle();
    expect(await getGoalCalculator(bima.database, bima.ws, goalId)).toMatchObject({ inputs: { months: 8, targetMinor: 45_000_000 }, computedMinor: 45_000_000 });
    // And cleared again: the working follows the months once more.
    await setEmergencyOwnTarget(rina.database, rina.ws, goalId, {});
    await h.settle();
    expect(await getGoalCalculator(bima.database, bima.ws, goalId)).toMatchObject({ computedMinor: 0 });
    expect(await inputsOf(bima, goalId)).not.toHaveProperty('targetMinor');
    for (const d of [bima, rina]) expect(await skipsOf(d.database)).toEqual([]);
  });

  it("breaking the calculator link reaches Rina's phone", async () => {
    const { h, bima, rina, bookId, goalId } = await world();
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    await h.settle();
    expect(await getGoalCalculator(rina.database, rina.ws, goalId)).not.toBeNull();
    await clearOutbox(bima.database);
    await clearGoalCalculator(bima.database, bima.ws, goalId);
    expect(await goalOpsOf(bima)).toEqual([`goal_calculator|${goalId}|delete`]);
    await h.settle();
    expect(await getGoalCalculator(rina.database, rina.ws, goalId)).toBeNull();
    for (const d of [bima, rina]) expect(await skipsOf(d.database)).toEqual([]);
  });

  it("the silent re-working's stamp reaches Rina's phone", async () => {
    const { h, bima, rina, bookId } = await world();
    const goalId = await oldEmergencyGoal(bima);
    await shareGoal(bima.database, bima.ws, goalId, bookId);
    await h.settle();
    expect(await inputsOf(rina, goalId)).not.toHaveProperty('version');
    await clearOutbox(bima.database);
    // The figures come out the same, so only the working is stamped as read in today's money.
    expect(await upgradeCalculatorGoals(bima.database, bima.ws, '2026-11-10')).toEqual([]);
    expect(await goalOpsOf(bima)).toEqual([`goal_calculator|${goalId}|upsert`]);
    await h.settle();
    expect(await inputsOf(rina, goalId)).toMatchObject({ version: 2, months: 6 });
    for (const d of [bima, rina]) expect(await skipsOf(d.database)).toEqual([]);
  });

  it('a private goal sends none of the three', async () => {
    const { bima, goalId } = await world();
    const old = await oldEmergencyGoal(bima);
    await clearOutbox(bima.database);
    await setEmergencyOwnTarget(bima.database, bima.ws, goalId, { targetMinor: 45_000_000 });
    expect(await getGoalCalculator(bima.database, bima.ws, goalId)).toMatchObject({ inputs: { months: 6, targetMinor: 45_000_000 }, computedMinor: 45_000_000 });
    expect(await upgradeCalculatorGoals(bima.database, bima.ws, '2026-11-10')).toEqual([]);
    expect(await inputsOf(bima, old)).toMatchObject({ version: 2 });
    await clearGoalCalculator(bima.database, bima.ws, goalId);
    expect(await getGoalCalculator(bima.database, bima.ws, goalId)).toBeNull();
    expect(await goalOpsOf(bima)).toEqual([]);
  });
});
