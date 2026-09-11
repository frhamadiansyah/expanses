import { categoryTree, expenseLines, incomeLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { categoryTotalsBetween, createAccount, listAccounts, postTransaction, voidTransaction } from '../src/index';
import { setupDb } from './helpers';

describe('categoryTotalsBetween', () => {
  it('totals posted spending and income in range with positive signs', async () => {
    const { database, ws } = await setupDb();
    const checking = await createAccount(database, ws, { name: 'Checking', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const visa = await createAccount(database, ws, { name: 'Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const all = await listAccounts(database, ws);
    const id = (name: string) => all.find((a) => a.name === name)!.id;

    const post = (occurredOn: string, category: string, amountMinor: number) =>
      postTransaction(database, ws, {
        occurredOn,
        description: category,
        lines: expenseLines({ categoryAccountId: id(category), paymentAccountId: visa.id, amountMinor, currency: 'IDR' }),
      });
    await post('2026-09-02', 'Groceries', 500_000);
    await post('2026-09-10', 'Dining Out', 300_000);
    const voided = await post('2026-09-12', 'Dining Out', 999_999);
    await post('2026-10-01', 'Groceries', 1);
    await voidTransaction(database, ws, voided);
    await postTransaction(database, ws, {
      occurredOn: '2026-09-25',
      description: 'Salary',
      lines: incomeLines({ incomeAccountId: id('Salary'), depositAccountId: checking.id, amountMinor: 10_000_000, currency: 'IDR' }),
    });

    const spending = await categoryTotalsBetween(database, ws, 'expense', '2026-09-01', '2026-09-30');
    const tree = categoryTree(all, spending);
    expect(tree.map((n) => [n.name, n.totalMinor])).toEqual([['Food & Drink', 800_000]]);

    expect(await categoryTotalsBetween(database, ws, 'income', '2026-09-01', '2026-09-30')).toEqual([
      { accountId: id('Salary'), amountBaseMinor: 10_000_000 },
    ]);
  });
});
