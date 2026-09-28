import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { categoryTotalsIn, inBook, postTransaction, replaceTransaction } from '../../src/index';
import { outboxChangeSets } from './sync-helpers';
import { categoryOf, headOf, Household, postedRowsOf, projectBook } from './household';

/*
 * Spec §13 `same-purchase`: two devices correct one purchase offline → one lineage, one posted row, the later `money`;
 * the Cashflow total counts it once (rule 5: two ids are two purchases, one id is one).
 */
describe('two devices correct the same purchase offline', () => {
  it('ends as one lineage with one posted row carrying the later money, counted once', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    const groceries = await categoryOf(fandri.database, bookId, 'Groceries');
    const lineage = await postTransaction(fandri.database, fandri.ws, {
      occurredOn: '2026-09-10',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: fandri.bank, amountMinor: 50_000, currency: 'IDR' }),
    });
    await home.join(dewi, fandri);
    await home.settle();
    expect(await headOf(dewi.database, lineage)).not.toBeNull();

    // Offline, both correct the amount.
    const fandriHead = (await headOf(fandri.database, lineage))!;
    await replaceTransaction(fandri.database, fandri.ws, fandriHead, {
      occurredOn: '2026-09-10',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: fandri.bank, amountMinor: 60_000, currency: 'IDR' }),
    });
    const dewiHead = (await headOf(dewi.database, lineage))!;
    const dewiGroceries = await categoryOf(dewi.database, bookId, 'Groceries');
    expect(dewiGroceries).toBe(groceries);
    const dewiView = await projectBook(dewi.database, bookId);
    const placeholder = (dewiView.purchase![lineage] as { money: { paidBy: string } }).money.paidBy;
    expect(placeholder).toBe(fandri.memberId);
    const dewiEntries = await dewi.database.db.values<[string, number]>(sql`SELECT account_id, amount_minor FROM entries WHERE transaction_id = ${dewiHead}`);
    const moneySide = dewiEntries.find(([accountId]) => accountId !== groceries)![0];
    await replaceTransaction(dewi.database, dewi.ws, dewiHead, {
      occurredOn: '2026-09-10',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: moneySide, amountMinor: 70_000, currency: 'IDR' }),
    });

    const hlcOf = async (d: typeof fandri) => (await outboxChangeSets(d.database)).at(-1)!.hlc;
    const later = (await hlcOf(fandri)) > (await hlcOf(dewi)) ? 60_000 : 70_000;
    await home.settle();

    for (const d of [fandri, dewi]) {
      expect(await postedRowsOf(d.database, bookId, lineage)).toHaveLength(1);
      const view = await projectBook(d.database, bookId);
      expect(Object.keys(view.purchase!)).toEqual([lineage]);
      expect((view.purchase![lineage] as { money: { lines: { amountMinor: number }[] } }).money.lines[0]!.amountMinor).toBe(later);
      const totals = await categoryTotalsIn(d.database, inBook(d.ws, bookId), 'expense', '2026-09-01', '2026-09-30');
      expect(totals.rows.reduce((s, r) => s + r.amountBaseMinor, 0)).toBe(later);
    }
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
  });
});
