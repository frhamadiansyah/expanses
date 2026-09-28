import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { postTransaction, renameAccount, saveBudget, skipBill, saveExpenseTemplate, unskipBill, voidTransaction } from '../../src/index';
import { applyChangeSet } from '../../src/sync/apply';
import type { ChangeLogEntry } from '../../src/sync/seal';
import { categoryOf, Household, projectBook } from './household';

/* Spec §13 `idempotent` (rule 6): any entry twice ≡ once. */
describe('applying is idempotent', () => {
  it('every change-set applied twice, and the whole log pulled again from 0, leave the book as applying once did', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    const groceries = await categoryOf(fandri.database, bookId, 'Groceries');
    const first = await postTransaction(fandri.database, fandri.ws, {
      occurredOn: '2026-09-10',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: fandri.bank, amountMinor: 50_000, currency: 'IDR' }),
    });
    await saveBudget(fandri.database, fandri.ws, { categoryAccountId: groceries, amountMinor: 1_000_000 });
    const bill = await saveExpenseTemplate(fandri.database, fandri.ws, { name: 'Internet', categoryAccountId: groceries, moneyAccountId: fandri.bank, amountMinor: 400_000, dayOfMonth: 5 });
    await skipBill(fandri.database, fandri.ws, bill, '2026-10');
    await unskipBill(fandri.database, fandri.ws, bill, '2026-10');
    await renameAccount(fandri.database, fandri.ws, groceries, 'Market');
    await voidTransaction(fandri.database, fandri.ws, first);
    await home.join(dewi, fandri);
    await home.settle();
    const once = await projectBook(dewi.database, bookId);
    expect(once).toEqual(await projectBook(fandri.database, bookId));

    // Every change-set again, straight into apply.
    const { entries } = await dewi.transport.pull(home.relayBookId, 0);
    const opener = dewi.engine.sealer;
    for (const entry of entries) {
      if (entry.kind !== 'change' || entry.deviceId === dewi.deviceId) continue;
      await applyChangeSet(dewi.database, bookId, await opener.open(bookId, entry as ChangeLogEntry));
    }
    expect(await projectBook(dewi.database, bookId)).toEqual(once);

    // The cursor rewound to 0: the whole log again.
    await dewi.database.db.run(sql`UPDATE sync_cursor SET applied_seq = 0 WHERE book_id = ${bookId}`);
    await dewi.engine.syncOnce(bookId);
    expect(await projectBook(dewi.database, bookId)).toEqual(once);
    const posted = await dewi.database.db.values<[number]>(sql`SELECT count(*) FROM transactions WHERE status = 'posted' AND id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId})`);
    expect(posted[0]![0]).toBe(0);
  });
});
