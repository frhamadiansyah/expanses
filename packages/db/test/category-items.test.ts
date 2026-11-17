import { expenseLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { budgetSheetFor, categoryItemsIn, createAccount, inBook, listAccounts, personalBook, postTransaction } from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * What a Budget line's Spent is made of (Mac Budget's side peek): the items add up to the sheet's own figure. Figures
 * in rupiah, invented.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function household() {
  current = await setupDb();
  const { database } = current;
  const book = await personalBook(database, current.ws);
  const ws = inBook(current.ws, book.id);
  const bank = await createAccount(database, ws, { name: 'Bank Sentosa', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const groceries = all.find((a) => a.systemKey === 'household.groceries')!;
  const household = all.find((a) => a.id === groceries.parentId)!;
  const spend = (occurredOn: string, description: string, amountMinor: number, categoryAccountId = groceries.id, extra: { excludedFromReport?: boolean } = {}) =>
    postTransaction(database, ws, { occurredOn, description, ...extra, lines: expenseLines({ categoryAccountId, paymentAccountId: bank.id, amountMinor, currency: 'IDR' }) });
  return { database, ws, bank, groceries: groceries.id, household: household.id, spend };
}

const lineTotal = (sheet: Awaited<ReturnType<typeof budgetSheetFor>>, id: string): number => {
  const walk = (lines: typeof sheet.lines): number | undefined => {
    for (const line of lines) {
      if (line.id === id) return line.totalMinor;
      const found = walk(line.children);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(sheet.lines) ?? 0;
};

describe('categoryItemsIn', () => {
  it('lists the month’s transactions in the categories, newest first, adding up to the budget line', async () => {
    const h = await household();
    await h.spend('2026-11-03', 'Pasar pagi', 340_000);
    await h.spend('2026-11-12', 'Toko sabun', 85_000, h.household);
    await h.spend('2026-10-30', 'Last month', 90_000);
    await h.spend('2026-11-14', 'Not mine', 70_000, h.groceries, { excludedFromReport: true });

    const { items, currency } = await categoryItemsIn(h.database, h.ws, 'expense', [h.household, h.groceries], '2026-11-01', '2026-11-30', { billMonths: true, excludeEvents: true });
    expect(currency).toBe('IDR');
    expect(items.map((item) => [item.onDate, item.description, item.amountMinor])).toEqual([
      ['2026-11-12', 'Toko sabun', 85_000],
      ['2026-11-03', 'Pasar pagi', 340_000],
    ]);
    const sheet = await budgetSheetFor(h.database, h.ws, '2026-11');
    expect(items.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(lineTotal(sheet, h.household));
  });

  it('reads only the categories asked for, and nothing for none', async () => {
    const h = await household();
    await h.spend('2026-11-03', 'Pasar pagi', 340_000);
    await h.spend('2026-11-12', 'Toko sabun', 85_000, h.household);
    const own = await categoryItemsIn(h.database, h.ws, 'expense', [h.groceries], '2026-11-01', '2026-11-30');
    expect(own.items.map((item) => item.description)).toEqual(['Pasar pagi']);
    expect((await categoryItemsIn(h.database, h.ws, 'expense', [], '2026-11-01', '2026-11-30')).items).toEqual([]);
  });
});
