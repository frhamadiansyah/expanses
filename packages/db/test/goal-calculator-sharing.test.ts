import { addMonths, monthOf } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  categoryIdsByKey,
  createGoalFromCalculator,
  getGoalCalculator,
  postTransaction,
  saveGoal,
  saveGoalCalculator,
  shareGoal,
  upgradeCalculatorGoals,
  type Database,
  type WorkspaceContext,
} from '../src/index';
import { goalCalculators } from '../src/schema-budget';
import { localDate } from '../src/sync/net-worth/summaries';
import { Household, skipsOf, type Device } from './sync/household';

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
