import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { addCard, createCardAccount, postTransaction, purchasePayers, setTransactionsCard } from '../../src/index';
import { categoryOf, type Device, headOf, Household } from './household';

/* Which card paid a shared purchase is in its Paid with label (the card's digits), so setting it in place sends it again. */

describe('the card set on a shared purchase', () => {
  it('reaches the partner as the new Paid with label, with nothing reposted', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    const card = await createCardAccount(fandri.database, fandri.ws, { name: 'Fandri Card', subtype: 'credit_card', currency: 'IDR', last4: '3051' });
    const supplementary = await addCard(fandri.database, fandri.ws, { accountId: card.id, last4: '7726' });
    const groceries = await categoryOf(fandri.database, bookId, 'Groceries');
    const lineage = await shop(fandri, groceries, card.id);
    await home.settle();

    const dewiHead = (await headOf(dewi.database, lineage))!;
    // Two cards on the account and none said: the label is the account alone.
    expect((await purchasePayers(dewi.database, [dewiHead]))[dewiHead]?.paidLabel).toBe('Fandri Card');

    await setTransactionsCard(fandri.database, fandri.ws, [lineage], supplementary);
    await home.settle();

    expect((await purchasePayers(fandri.database, [lineage]))[lineage]?.paidLabel).toBe('Fandri Card ···· 7726');
    // Dewi's phone takes it as a change to the purchase's money, which it re-records under the same lineage.
    const dewiNow = (await headOf(dewi.database, lineage))!;
    expect((await purchasePayers(dewi.database, [dewiNow]))[dewiNow]?.paidLabel).toBe('Fandri Card ···· 7726');
    // In place on Fandri's phone: the same row is the head.
    expect(await headOf(fandri.database, lineage)).toBe(lineage);
    const [posted] = await fandri.database.db.values<[number]>(sql`SELECT COUNT(*) FROM transactions WHERE status = 'posted' AND description = 'Weekly shop'`);
    expect(Number(posted![0])).toBe(1);
  });
});

function shop(d: Device, categoryAccountId: string, paymentAccountId: string): Promise<string> {
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-10-14',
    description: 'Weekly shop',
    lines: expenseLines({ categoryAccountId, paymentAccountId, amountMinor: 250_000, currency: 'IDR' }),
  });
}
