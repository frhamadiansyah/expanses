import { describe, expect, it } from 'vitest';
import { BudgetError, clearIncomeOverride, getBudgetIncome, saveExpectedIncome, setIncomeOverride } from '../src/index';
import { setupDb } from './helpers';

describe('expected income', () => {
  it('starts at nothing, because no one has said yet', async () => {
    const { database, ws } = await setupDb();

    expect(await getBudgetIncome(database, ws, '2026-09')).toMatchObject({ planMinor: 0, amountMinor: 0, overridden: false });
  });

  it('keeps what was typed, and applies it to every month', async () => {
    const { database, ws } = await setupDb();

    await saveExpectedIncome(database, ws, 61_200_000);

    expect(await getBudgetIncome(database, ws, '2026-09')).toMatchObject({ amountMinor: 61_200_000, overridden: false });
    expect(await getBudgetIncome(database, ws, '2027-03')).toMatchObject({ amountMinor: 61_200_000 });
  });

  it('takes a bonus month as that month only', async () => {
    const { database, ws } = await setupDb();
    await saveExpectedIncome(database, ws, 61_200_000);

    await setIncomeOverride(database, ws, { month: '2026-12', amountMinor: 120_000_000 });

    expect(await getBudgetIncome(database, ws, '2026-12')).toMatchObject({ amountMinor: 120_000_000, planMinor: 61_200_000, overridden: true });
    expect(await getBudgetIncome(database, ws, '2027-01')).toMatchObject({ amountMinor: 61_200_000, overridden: false });
  });

  it('brings the plan back when the bonus month is cleared', async () => {
    const { database, ws } = await setupDb();
    await saveExpectedIncome(database, ws, 61_200_000);
    await setIncomeOverride(database, ws, { month: '2026-12', amountMinor: 120_000_000 });

    await clearIncomeOverride(database, ws, '2026-12');

    expect(await getBudgetIncome(database, ws, '2026-12')).toMatchObject({ amountMinor: 61_200_000, overridden: false });
  });

  it('refuses an income below nothing, and a month that is not a month', async () => {
    const { database, ws } = await setupDb();

    await expect(saveExpectedIncome(database, ws, -1)).rejects.toThrow(BudgetError);
    await expect(setIncomeOverride(database, ws, { month: '2026-13', amountMinor: 1 })).rejects.toThrow(BudgetError);
  });
});
