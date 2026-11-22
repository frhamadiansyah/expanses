import { expenseLines, refundLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { categoryTotalsIn, confirmReview, createBook, createCardAccount, replaceTransaction, inBook, paidFromAccount, paidWithItems, listTransactions, postTransaction, saveEvent, tagTransaction } from '../../src/index';
import { itemIdOf } from '../../src/sync/net-worth/summaries';
import { categoryOf, Household, skipsOf, type Device } from './household';

async function view(d: Device, bookId: string) {
  const rows = await listTransactions(d.database, inBook(d.ws, bookId), { from: '2026-09-01', to: '2026-09-30' });
  return rows.map((r) => `${r.description}:${r.entries.filter((e) => e.accountKind === 'expense').map((e) => e.amountMinor).join('/')}`).sort();
}

async function setup() {
  const home = new Household();
  const a = await home.device('Fandri');
  const b = await home.device('Dewi');
  const bookId = await home.share(a);
  await home.join(b, a);
  const card = await createCardAccount(a.database, a.ws, { name: 'Fandri Card', subtype: 'credit_card', currency: 'IDR', last4: '1234' });
  const cat = await categoryOf(a.database, bookId, 'Groceries');
  return { home, a, b, bookId, card, cat };
}

describe('refunds in a shared workspace', () => {
  it('a refund back to a credit card reaches the partner like the purchase', async () => {
    const { home, a, b, bookId, card, cat } = await setup();
    await postTransaction(a.database, a.ws, { occurredOn: '2026-09-10', description: 'Buy', lines: expenseLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 500_000, currency: 'IDR' }) });
    await postTransaction(a.database, a.ws, { occurredOn: '2026-09-12', description: 'Refund', lines: refundLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 200_000, currency: 'IDR' }) });
    await home.settle();
    expect(await skipsOf(b.database)).toEqual([]);
    expect(await view(b, bookId)).toEqual(await view(a, bookId));
  });

  it('a foreign refund keeps its original figure and reaches the partner', async () => {
    const { home, a, b, bookId, card, cat } = await setup();
    await postTransaction(a.database, a.ws, { occurredOn: '2026-09-10', description: 'Buy', originalCurrency: 'USD', originalAmountMinor: 3_000, ratesToBase: {}, lines: expenseLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 500_000, currency: 'IDR' }) });
    await postTransaction(a.database, a.ws, { occurredOn: '2026-09-12', description: 'Refund', originalCurrency: 'USD', originalAmountMinor: 1_000, lines: refundLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 200_000, currency: 'IDR' }) });
    await home.settle();
    expect(await skipsOf(b.database)).toEqual([]);
    expect(await view(b, bookId)).toEqual(await view(a, bookId));
  });

  it('a purchase typed in another currency reaches the partner with both figures, and an edit of the foreign figure follows (owner, 22 Nov 2026)', async () => {
    const { home, a, b, bookId, card, cat } = await setup();
    const id = await postTransaction(a.database, a.ws, { occurredOn: '2026-09-14', description: 'Hotel', originalCurrency: 'USD', originalAmountMinor: 12_000, lines: expenseLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 1_944_000, currency: 'IDR' }) });
    await home.settle();
    expect(await skipsOf(b.database)).toEqual([]);
    const figures = async (d: Device) =>
      (await listTransactions(d.database, inBook(d.ws, bookId), { from: '2026-09-01', to: '2026-09-30' }))
        .filter((r) => r.description === 'Hotel')
        .map((r) => [r.originalCurrency, r.originalAmountMinor, r.entries.filter((e) => e.accountKind === 'expense').map((e) => e.amountMinor).join('/')]);
    expect(await figures(b)).toEqual([['USD', 12_000, '1944000']]);
    // The bank's own figure typed over the day's estimate, and the dollar amount corrected.
    await replaceTransaction(a.database, a.ws, id, { occurredOn: '2026-09-14', description: 'Hotel', originalCurrency: 'USD', originalAmountMinor: 12_500, lines: expenseLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 2_010_000, currency: 'IDR' }) });
    await home.settle();
    expect(await skipsOf(b.database)).toEqual([]);
    expect(await figures(b)).toEqual([['USD', 12_500, '2010000']]);
    expect(await figures(a)).toEqual(await figures(b));
  });

  it('a refund in a shared workspace is never tagged to an event (sync gaps D1), and reaches the partner as it is', async () => {
    const { home, a, b, bookId, card, cat } = await setup();
    const eventId = await saveEvent(a.database, a.ws, { name: 'Holiday', startsOn: '2026-09-01', endsOn: '2026-09-30' } as never);
    const buy = expenseLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 500_000, currency: 'IDR' });
    await expect(postTransaction(a.database, a.ws, { occurredOn: '2026-09-10', description: 'Buy', eventId, lines: buy })).rejects.toMatchObject({ code: 'SHARED_EVENT_TAG' });
    await postTransaction(a.database, a.ws, { occurredOn: '2026-09-10', description: 'Buy', lines: buy });
    const refund = await postTransaction(a.database, a.ws, { occurredOn: '2026-09-12', description: 'Refund', lines: refundLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 200_000, currency: 'IDR' }) });
    await expect(tagTransaction(a.database, a.ws, refund, eventId)).rejects.toMatchObject({ code: 'SHARED_WORKSPACE' });
    await home.settle();
    expect(await skipsOf(b.database)).toEqual([]);
    expect(await view(b, bookId)).toEqual(await view(a, bookId));
  });

  it('refunds on a card shared in joint net worth reach both phones, whoever recorded them', async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    const andi = await home.device('Andi');
    const bookId = await home.share(rina);
    await home.join(andi, rina);
    await home.settle();
    const card = await createCardAccount(rina.database, rina.ws, { name: 'Rina Card', subtype: 'credit_card', currency: 'IDR', last4: '1234' });
    const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    for (let i = 0; i < 3; i += 1) await home.settle();
    await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
    for (let i = 0; i < 3; i += 1) await home.settle();
    await confirmReview(rina.database, rina.ws, { [card.id]: 'total' });
    await confirmReview(andi.database, andi.ws, {});
    for (let i = 0; i < 3; i += 1) await home.settle();
    const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
    const cardItem = await itemIdOf(groupBookId, card.id);
    const [offered] = (await paidWithItems(andi.database, bookId)).filter((i) => i.itemId === cardItem);
    const placeholder = await paidFromAccount(andi.database, bookId, offered!.owner, offered!.currency);
    const andiCat = await categoryOf(andi.database, bookId, 'Groceries');
    const rinaCat = await categoryOf(rina.database, bookId, 'Groceries');
    await postTransaction(andi.database, andi.ws, { occurredOn: '2026-09-10', description: 'Andi buys', lines: expenseLines({ categoryAccountId: andiCat, paymentAccountId: placeholder, amountMinor: 300_000, currency: 'IDR' }), paidFrom: { owner: offered!.owner, itemId: offered!.itemId } });
    await postTransaction(rina.database, rina.ws, { occurredOn: '2026-09-11', description: 'Rina buys', lines: expenseLines({ categoryAccountId: rinaCat, paymentAccountId: card.id, amountMinor: 120_000, currency: 'IDR' }) });
    await postTransaction(rina.database, rina.ws, { occurredOn: '2026-09-12', description: 'Rina refund', lines: refundLines({ categoryAccountId: rinaCat, paymentAccountId: card.id, amountMinor: 50_000, currency: 'IDR' }) });
    await postTransaction(andi.database, andi.ws, { occurredOn: '2026-09-13', description: 'Andi refund', lines: refundLines({ categoryAccountId: andiCat, paymentAccountId: placeholder, amountMinor: 70_000, currency: 'IDR' }), paidFrom: { owner: offered!.owner, itemId: offered!.itemId } });
    for (let i = 0; i < 3; i += 1) await home.settle();
    expect(await skipsOf(andi.database)).toEqual([]);
    expect(await skipsOf(rina.database)).toEqual([]);
    expect(await view(andi, bookId)).toEqual(await view(rina, bookId));
    expect((await view(andi, bookId)).length).toBe(4);
  });

  it('a dollar purchase and its dollar refund count the same on both phones', async () => {
    const { home, a, b, bookId, cat } = await setup();
    await postTransaction(a.database, a.ws, { occurredOn: '2026-09-10', description: 'Hotel', ratesToBase: { USD: 16_000 }, lines: expenseLines({ categoryAccountId: cat, paymentAccountId: a.usd, amountMinor: 3_000, currency: 'USD' }) });
    await postTransaction(a.database, a.ws, { occurredOn: '2026-09-12', description: 'Hotel refund', ratesToBase: { USD: 16_100 }, lines: refundLines({ categoryAccountId: cat, paymentAccountId: a.usd, amountMinor: 1_000, currency: 'USD' }) });
    await home.settle();
    expect(await skipsOf(b.database)).toEqual([]);
    expect(await view(b, bookId)).toEqual(await view(a, bookId));
    const total = async (d: Device) => (await categoryTotalsIn(d.database, inBook(d.ws, bookId), 'expense', '2026-09-01', '2026-09-30')).rows.map((r) => [r.amountBaseMinor, r.transactions]);
    expect(await total(b)).toEqual(await total(a));
  });

  it('a refund filed in another workspace stays off the partner’s phone until it is moved, and then it syncs (the repair path)', async () => {
    const { home, a, b, bookId, card, cat } = await setup();
    const privateId = await createBook(a.database, a.ws, { name: 'Private', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: bookId });
    const privateCat = await categoryOf(a.database, privateId, 'Groceries');
    const refund = await postTransaction(a.database, a.ws, { occurredOn: '2026-09-12', description: 'Refund', lines: refundLines({ categoryAccountId: privateCat, paymentAccountId: card.id, amountMinor: 200_000, currency: 'IDR' }) });
    await home.settle();
    expect(await view(b, bookId)).toEqual([]);
    await replaceTransaction(a.database, a.ws, refund, { occurredOn: '2026-09-12', description: 'Refund', lines: refundLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 200_000, currency: 'IDR' }), moveToBook: true, toBookId: bookId });
    await home.settle();
    expect(await skipsOf(b.database)).toEqual([]);
    expect(await view(b, bookId)).toEqual(await view(a, bookId));
    expect((await view(b, bookId)).length).toBe(1);
  });

  it('a full refund of the same amount on the same day reaches the partner as its own transaction', async () => {
    const { home, a, b, bookId, card, cat } = await setup();
    await postTransaction(a.database, a.ws, { occurredOn: '2026-09-10', description: 'Flight', lines: expenseLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 500_000, currency: 'IDR' }) });
    await postTransaction(a.database, a.ws, { occurredOn: '2026-09-10', description: 'Flight', lines: refundLines({ categoryAccountId: cat, paymentAccountId: card.id, amountMinor: 500_000, currency: 'IDR' }) });
    await home.settle();
    expect(await view(b, bookId)).toEqual(await view(a, bookId));
    expect((await view(b, bookId)).length).toBe(2);
  });
});
