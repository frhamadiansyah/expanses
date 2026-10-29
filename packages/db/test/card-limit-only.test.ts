import { describe, expect, it } from 'vitest';
import { createAccount, getCardLimit, getCardTerms, listCardTerms, saveCardTerms } from '../src/index';
import { setupDb } from './helpers';

/** A credit limit typed on the New card form with no billing and due dates (0108): kept, but not yet terms. */
describe('a card with a credit limit and no dates', () => {
  async function newCard() {
    const t = await setupDb();
    const card = await createAccount(t.database, t.ws, { name: 'Kartu Baru', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    return { ...t, card };
  }

  it('keeps the limit with no days, and reads it as no terms yet', async () => {
    const t = await newCard();
    await saveCardTerms(t.database, t.ws, { accountId: t.card.id, statementDay: null, dueDay: null, creditLimitMinor: 20_000_000, annualFeeMinor: null });
    expect(await getCardLimit(t.database, t.ws, t.card.id)).toBe(20_000_000);
    expect(await getCardTerms(t.database, t.ws, t.card.id)).toBeUndefined();
    expect(await listCardTerms(t.database, t.ws)).toEqual([]);
  });

  it('becomes terms, limit kept, once the days are given', async () => {
    const t = await newCard();
    await saveCardTerms(t.database, t.ws, { accountId: t.card.id, statementDay: null, dueDay: null, creditLimitMinor: 20_000_000, annualFeeMinor: null });
    await saveCardTerms(t.database, t.ws, { accountId: t.card.id, statementDay: 25, dueDay: 12, creditLimitMinor: 20_000_000, annualFeeMinor: null });
    expect(await getCardTerms(t.database, t.ws, t.card.id)).toMatchObject({ statementDay: 25, dueDay: 12, creditLimitMinor: 20_000_000 });
  });

  it('refuses one day without the other, and a card with no limit has none', async () => {
    const t = await newCard();
    await expect(saveCardTerms(t.database, t.ws, { accountId: t.card.id, statementDay: 25, dueDay: null, creditLimitMinor: 1, annualFeeMinor: null })).rejects.toThrow('both');
    expect(await getCardLimit(t.database, t.ws, t.card.id)).toBeNull();
  });
});
