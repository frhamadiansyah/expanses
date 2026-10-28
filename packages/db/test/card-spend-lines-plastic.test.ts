import { purchasesForPlastic } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { addCard, cardSpendLines, categoryIdsByKey, createAccount, listCards, postTransaction } from '../src/index';
import { setupDb } from './helpers';

describe('card spend lines name the plastic that paid', () => {
  it('carry the card id of each purchase, null for one that named no card, and group by plastic without losing money', async () => {
    const { database, ws } = await setupDb();
    const card = await createAccount(database, ws, { name: 'Mandiri Bonvoy', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const food = (await categoryIdsByKey(database, ws))['food_beverage.restaurants']!;
    const buy = (description: string, amountMinor: number, cardId?: string) =>
      postTransaction(database, ws, {
        occurredOn: '2026-10-05',
        description,
        ...(cardId ? { cardId } : {}),
        lines: [
          { accountId: food, amountMinor, currency: 'IDR' },
          { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' },
        ],
      });

    // Made while the account held no card row: names none.
    await buy('Before cards', 75_000);
    const primary = await addCard(database, ws, { accountId: card.id, last4: '1467', isPrimary: true });
    const spouse = await addCard(database, ws, { accountId: card.id, last4: '8802' });
    await buy('Primary dinner', 100_000, primary);
    await buy('Spouse groceries', 450_000, spouse);

    const lines = await cardSpendLines(database, ws, card.id, '2026-10-01', '2026-10-31');
    const byNote = Object.fromEntries(lines.map((line) => [line.description, line.cardId ?? null]));
    expect(byNote).toEqual({ 'Before cards': null, 'Primary dinner': primary, 'Spouse groceries': spouse });

    const plastics = (await listCards(database, ws, card.id)).map((row) => ({ id: row.id, isPrimary: row.isPrimary }));
    const total = (rows: { amountMinor: number }[]) => rows.reduce((sum, row) => sum + row.amountMinor, 0);
    const forPrimary = purchasesForPlastic(lines, plastics, primary);
    const forSpouse = purchasesForPlastic(lines, plastics, spouse);
    expect(forPrimary.map((line) => line.description).sort()).toEqual(['Before cards', 'Primary dinner']);
    expect(forSpouse.map((line) => line.description)).toEqual(['Spouse groceries']);
    expect(total(forPrimary) + total(forSpouse)).toBe(total(lines));
  });
});
