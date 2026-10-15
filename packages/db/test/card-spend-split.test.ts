import { describe, expect, it } from 'vitest';
import { cardSpendLines, createAccount, listAccounts, splitBill } from '../src/index';
import { setupDb } from './helpers';

describe('cardSpendLines on a purchase split with someone', () => {
  it('counts the card charge once: the whole figure charged, in its category, and not the own share again', async () => {
    const { database, ws } = await setupDb();
    const card = await createAccount(database, ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const restaurants = (await listAccounts(database, ws)).find((a) => a.systemKey === 'food_beverage.restaurants')!.id;
    await splitBill(database, ws, {
      occurredOn: '2026-10-10',
      description: 'Lunch',
      totalMinor: 80_000,
      moneyAccountId: card.id,
      ownCategoryId: restaurants,
      ownShareMinor: 40_000,
      shares: [{ person: { name: 'Sam', currency: 'IDR' }, amountMinor: 40_000 }],
      spendCategoryId: restaurants,
      mcc: null,
      cardId: null,
      channel: null,
    });

    const lines = await cardSpendLines(database, ws, card.id, '2026-10-01', '2026-10-31');
    expect(lines.map((line) => [line.description, line.categoryId, line.amountMinor])).toEqual([['Lunch', restaurants, 80_000]]);
  });
});
