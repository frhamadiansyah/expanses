import { expenseLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { createCardAccount, inBook, listTransactions, nativeBalances, pastMarkFor, postTransaction, setSettledBeforeApp } from '../../src/index';
import { categoryOf, Household, skipsOf, type Device } from './household';

/*
 * A card purchase dated before the card was added, posted paid off by the date rule (owner, 22 Nov 2026), in a shared
 * workspace: the partner gets what a hand-ticked Paid off gives them — the spending, once, and no settlement row (the
 * settlement touches no category, so it stays on the card holder's phone, as the card does). Invented names and figures.
 */
async function rows(d: Device, bookId: string) {
  const posted = await listTransactions(d.database, inBook(d.ws, bookId), { from: '2026-09-01', to: '2026-09-30' });
  return posted.map((r) => `${r.description}:${r.entries.filter((e) => e.accountKind === 'expense').map((e) => e.amountMinor).join('/')}`).sort();
}

async function setup() {
  const home = new Household();
  const a = await home.device('Fandri');
  const b = await home.device('Dewi');
  const bookId = await home.share(a);
  await home.join(b, a);
  const card = await createCardAccount(a.database, a.ws, { name: 'Kartu Contoh', subtype: 'credit_card', currency: 'IDR', last4: '4417', openingBalanceMinor: 1_500_000, openedOn: '2026-09-20' });
  const cat = await categoryOf(a.database, bookId, 'Groceries');
  const owed = async () => -((await nativeBalances(a.database, a.ws))[card.id] ?? 0);
  return { home, a, b, bookId, card, cat, owed };
}

describe('a card purchase paid off by the date rule, in a shared workspace', () => {
  it('reaches the partner as the spending it was, the same as one ticked Paid off by hand', async () => {
    const { home, a, b, bookId, card, cat, owed } = await setup();
    const mark = await pastMarkFor(a.database, a.ws, card.id, '2026-09-10');
    expect(mark).toEqual({ settledBeforeApp: true });
    await postTransaction(a.database, a.ws, { occurredOn: '2026-09-10', description: 'Old groceries', lines: expenseLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 210_000, currency: 'IDR' }), ...mark });
    // Ticked by hand on the statement after it was saved: the other way the same mark is made.
    const byHand = await postTransaction(a.database, a.ws, { occurredOn: '2026-09-12', description: 'Ticked groceries', lines: expenseLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 90_000, currency: 'IDR' }) });
    await setSettledBeforeApp(a.database, a.ws, byHand, true);
    expect(await owed()).toBe(1_500_000);
    await home.settle();
    expect(await skipsOf(b.database)).toEqual([]);
    expect(await rows(b, bookId)).toEqual(['Old groceries:210000', 'Ticked groceries:90000']);
    // The card holder's phone keeps the settlements beside the spending (and the card's opening), the same two for
    // either way the mark was made; the card still owes what it did when it was added.
    expect(await rows(a, bookId)).toEqual(['Old groceries:210000', 'Opening balance: Kartu Contoh:', 'Paid off:', 'Paid off:', 'Ticked groceries:90000']);
    expect(await owed()).toBe(1_500_000);
  });
});
