import { expenseLines, isoDate } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { confirmReview, createCardAccount, householdPurchases, paidFromAccount, paidWithItems, postTransaction, sharingDetail } from '../../src/index';
import { itemIdOf } from '../../src/sync/net-worth/summaries';
import { categoryOf, Household, type Device } from './household';

/* The Household purchases the partner's item page reads (joint-net-worth §8.3, task 9). */

async function spend(d: Device, bookId: string, description: string, occurredOn: string, amountMinor: number): Promise<string> {
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return postTransaction(d.database, d.ws, {
    occurredOn,
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

describe('householdPurchases', () => {
  it('lists both members’ Household purchases of the period on either phone, and nothing private', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await spend(fandri, bookId, 'Fandri groceries', '2026-09-10', 50_000);
    await spend(dewi, bookId, 'Dewi groceries', '2026-09-12', 20_000);
    await spend(dewi, bookId, 'Last month', '2026-08-30', 7_000);
    await home.settle();

    for (const device of [fandri, dewi]) {
      const lines = await householdPurchases(device.database, bookId, { start: '2026-09-01', end: '2026-09-30' });
      expect(lines.map((l) => [l.description, l.amountMinor, l.currency, l.occurredOn])).toEqual([
        ['Fandri groceries', 50_000, 'IDR', '2026-09-10'],
        ['Dewi groceries', 20_000, 'IDR', '2026-09-12'],
      ]);
      for (const line of lines) expect(line.recordedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Who paid each: the payer's member on every phone, so an owner's own purchase is never read as waiting.
      const detail = (await sharingDetail(device.database, bookId, device.deviceId))!;
      const nameOf = (id: string) => detail.members.find((m) => m.memberId === id)?.name;
      expect(lines.map((l) => nameOf(l.paidBy))).toEqual(['Fandri', 'Dewi']);
      // No net-worth group here, so no purchase names a shared item.
      for (const line of lines) expect([line.paidFromItemId, line.paidFromOwner]).toEqual([null, null]);
    }
  });

  it('names the shared item each was paid from (Task 7 paidFrom): the partner’s purchase and the owner’s own, each with its payer', async () => {
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
    const today = isoDate();

    // Andi pays from Rina's card, as the add form does; Rina pays from her own shared card.
    const [offered] = (await paidWithItems(andi.database, bookId)).filter((i) => i.itemId === cardItem);
    const placeholder = await paidFromAccount(andi.database, bookId, offered!.owner, offered!.currency);
    const andiGroceries = await categoryOf(andi.database, bookId, 'Groceries');
    const byAndi = await postTransaction(andi.database, andi.ws, {
      occurredOn: today,
      description: 'Andi on Rina’s card',
      lines: expenseLines({ categoryAccountId: andiGroceries, paymentAccountId: placeholder, amountMinor: 300_000, currency: 'IDR' }),
      paidFrom: { owner: offered!.owner, itemId: offered!.itemId },
    });
    const rinaGroceries = await categoryOf(rina.database, bookId, 'Groceries');
    const byRina = await postTransaction(rina.database, rina.ws, {
      occurredOn: today,
      description: 'Rina on her card',
      lines: expenseLines({ categoryAccountId: rinaGroceries, paymentAccountId: card.id, amountMinor: 120_000, currency: 'IDR' }),
    });
    // And one from Andi's own bank, shared too (joint shares every item): it names his bank, not Rina's card.
    await spend(andi, bookId, 'Andi from his bank', today, 5_000);
    for (let i = 0; i < 3; i += 1) await home.settle();

    for (const device of [rina, andi]) {
      const lines = await householdPurchases(device.database, bookId, { start: today, end: today });
      const of = (lineageId: string) => lines.find((l) => l.lineageId === lineageId)!;
      // "Lines you can see" on Rina's card: both purchases paid from it, whoever paid.
      expect(lines.filter((l) => l.paidFromItemId === cardItem).map((l) => l.lineageId).sort()).toEqual([byAndi, byRina].sort());
      expect(of(byAndi)).toMatchObject({ paidFromItemId: cardItem, paidFromOwner: rina.memberId, paidBy: andi.memberId });
      expect(of(byRina)).toMatchObject({ paidFromItemId: cardItem, paidFromOwner: rina.memberId, paidBy: rina.memberId });
      expect(lines.find((l) => l.description === 'Andi from his bank')).toMatchObject({
        paidFromItemId: await itemIdOf(groupBookId, andi.bank),
        paidFromOwner: andi.memberId,
        paidBy: andi.memberId,
      });
    }
  });

  it('reads nothing on a device with no shared book', async () => {
    const home = new Household();
    const alone = await home.device('Alone');
    expect(await householdPurchases(alone.database, 'no-such-book', { start: '2026-09-01', end: '2026-09-30' })).toEqual([]);
  });
});
