import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  createAccount,
  goalContributionsFor,
  recordTaggedTransfer,
  recordTrade,
  removeEarmark,
  saveAssetProfile,
  saveEarmark,
  saveGoal,
  budgetSchema,
  type Database,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const MONTH = '2026-09';
const IN_MONTH = '2026-09-09';
const g = (grams: number) => grams * 1_000_000;

async function workspace() {
  const { database, ws } = await setupDb();
  const bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const pot = await createAccount(database, ws, { name: 'Savings pot', kind: 'asset', subtype: 'savings', currency: 'IDR' });
  const goalId = await saveGoal(database, ws, {
    name: 'Emergency fund',
    kind: 'emergency',
    growthBps: 0,
    returnBps: 200,
    stages: [{ name: 'Emergency fund', targetMinor: 60_000_000, targetMonths: null, dueOn: '2027-09-30' }],
  });
  return { database, ws, bca, pot, goalId };
}

async function goldAccount(database: Database, ws: WorkspaceContext) {
  const gold = await createAccount(database, ws, { name: 'Antam gold', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  return gold;
}

describe('what a set-aside records', () => {
  it('writes a dated contribution for what actually moved', async () => {
    const { database, ws, pot, goalId } = await workspace();

    await saveEarmark(database, ws, { goalId, accountId: pot.id, amountMinor: 2_000_000 });

    const rows = await database.db
      .select({ deltaMinor: budgetSchema.goalContributions.deltaMinor, source: budgetSchema.goalContributions.source })
      .from(budgetSchema.goalContributions)
      .where(and(eq(budgetSchema.goalContributions.workspaceId, ws.workspaceId), eq(budgetSchema.goalContributions.goalId, goalId)));
    expect(rows).toEqual([{ deltaMinor: 2_000_000, source: 'earmark' }]);
  });

  it('records only the difference when the amount is raised', async () => {
    const { database, ws, pot, goalId } = await workspace();

    await saveEarmark(database, ws, { goalId, accountId: pot.id, amountMinor: 2_000_000 });
    await saveEarmark(database, ws, { goalId, accountId: pot.id, amountMinor: 3_000_000 });

    expect(await goalContributionsFor(database, ws, MONTH)).toMatchObject({ [goalId]: 3_000_000 });
  });

  it('writes nothing when the amount has not changed', async () => {
    const { database, ws, pot, goalId } = await workspace();

    await saveEarmark(database, ws, { goalId, accountId: pot.id, amountMinor: 2_000_000 });
    await saveEarmark(database, ws, { goalId, accountId: pot.id, amountMinor: 2_000_000 });

    const rows = await database.db.select({ id: budgetSchema.goalContributions.id }).from(budgetSchema.goalContributions);
    expect(rows).toHaveLength(1);
  });

  it('takes money back out when the set-aside is removed', async () => {
    const { database, ws, pot, goalId } = await workspace();
    await saveEarmark(database, ws, { goalId, accountId: pot.id, amountMinor: 2_000_000 });

    await removeEarmark(database, ws, goalId, pot.id);

    expect(await goalContributionsFor(database, ws, MONTH)).toMatchObject({ [goalId]: 0 });
  });
});

describe('what the ledger already knows', () => {
  it('counts a tagged transfer in the month it was made', async () => {
    const { database, ws, bca, pot, goalId } = await workspace();

    await recordTaggedTransfer(database, ws, {
      occurredOn: IN_MONTH,
      description: 'Into the pot',
      fromAccountId: bca.id,
      toAccountId: pot.id,
      amountMinor: 1_500_000,
      goalId,
    });

    // The transfer parks the money and moves the set-aside; it must be counted once, not twice.
    expect(await goalContributionsFor(database, ws, MONTH)).toMatchObject({ [goalId]: 1_500_000 });
  });

  it('counts a tagged buy paid from everyday money', async () => {
    const { database, ws, bca, goalId } = await workspace();
    const gold = await goldAccount(database, ws);

    await recordTrade(database, ws, {
      accountId: gold.id,
      kind: 'buy',
      occurredOn: IN_MONTH,
      unitsMicro: g(1),
      grossMinor: 1_800_000,
      feeMinor: 0,
      taxMinor: 0,
      cashAccountId: bca.id,
      goalId,
    });

    expect(await goalContributionsFor(database, ws, MONTH)).toMatchObject({ [goalId]: 1_800_000 });
  });

  it('does not count a buy funded from money already parked for the goal', async () => {
    const { database, ws, bca, pot, goalId } = await workspace();
    const gold = await goldAccount(database, ws);

    await recordTaggedTransfer(database, ws, {
      occurredOn: '2026-09-02',
      description: 'Park it',
      fromAccountId: bca.id,
      toAccountId: pot.id,
      amountMinor: 1_800_000,
      goalId,
    });
    await recordTrade(database, ws, {
      accountId: gold.id,
      kind: 'buy',
      occurredOn: IN_MONTH,
      unitsMicro: g(1),
      grossMinor: 1_800_000,
      feeMinor: 0,
      taxMinor: 0,
      cashAccountId: pot.id,
      goalId,
    });

    // Parking it was the saving. Turning it into gold is the same rupiah a second time.
    expect(await goalContributionsFor(database, ws, MONTH)).toMatchObject({ [goalId]: 1_800_000 });
  });

  it('leaves another month alone', async () => {
    const { database, ws, bca, pot, goalId } = await workspace();
    await recordTaggedTransfer(database, ws, {
      occurredOn: '2026-08-09',
      description: 'Last month',
      fromAccountId: bca.id,
      toAccountId: pot.id,
      amountMinor: 1_500_000,
      goalId,
    });

    expect((await goalContributionsFor(database, ws, MONTH))[goalId]).toBeUndefined();
  });
});

describe('the sheet', () => {
  it('shows what actually reached the goal this month', async () => {
    const { database, ws, bca, pot, goalId } = await workspace();
    await recordTaggedTransfer(database, ws, {
      occurredOn: IN_MONTH,
      description: 'Into the pot',
      fromAccountId: bca.id,
      toAccountId: pot.id,
      amountMinor: 1_500_000,
      goalId,
    });

    const sheet = await budgetSheetFor(database, ws, MONTH);

    expect(sheet.savings[0]).toMatchObject({ goalId, actualMinor: 1_500_000 });
    expect(sheet.savingsActualMinor).toBe(1_500_000);
  });
});
