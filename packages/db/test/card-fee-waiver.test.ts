import type { FeeWaiver } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  categoryIdsByKey,
  clearFeeWaiver,
  createAccount,
  getFeeWaiver,
  listFeeRefunds,
  nativeBalances,
  postTransaction,
  refundFeeChallenge,
  saveCardTerms,
  saveFeeWaiver,
  spendByPlastic,
  undoFeeRefund,
} from '../src/index';
import { setupDb } from './helpers';

async function card() {
  const t = await setupDb();
  const acc = await createAccount(t.database, t.ws, { name: 'Challenge card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(t.database, t.ws, { accountId: acc.id, statementDay: 20, dueDay: 12, creditLimitMinor: null, annualFeeMinor: 800_000, annualFeeOn: '2026-10-14' });
  return { ...t, id: acc.id };
}
const challenge: FeeWaiver = { kind: 'challenge', amountMinor: 1_500_000, countedFrom: '2026-10-14', spendBy: '2026-10-31', categoryIds: [] };

describe('fee waiver', () => {
  it('saves, replaces and clears one waiver per card', async () => {
    const t = await card();
    expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toBeNull();
    await saveFeeWaiver(t.database, t.ws, t.id, challenge);
    expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toEqual(challenge);
    const auto: FeeWaiver = { kind: 'automatic', amountMinor: 150_000_000, countedFrom: null, spendBy: null, categoryIds: ['x'] };
    await saveFeeWaiver(t.database, t.ws, t.id, { ...auto, countedFrom: '2026-01-01' });
    expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toEqual(auto);
    await clearFeeWaiver(t.database, t.ws, t.id);
    expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toBeNull();
  });
  it('refuses a challenge with no amount, no days, or days the wrong way round', async () => {
    const t = await card();
    await expect(saveFeeWaiver(t.database, t.ws, t.id, { ...challenge, amountMinor: 0 })).rejects.toThrow();
    await expect(saveFeeWaiver(t.database, t.ws, t.id, { ...challenge, spendBy: null })).rejects.toThrow();
    await expect(saveFeeWaiver(t.database, t.ws, t.id, { ...challenge, spendBy: '2026-10-01' })).rejects.toThrow();
  });
});

describe('fee refunded', () => {
  const setup = async () => {
    const t = await card();
    const category = (await categoryIdsByKey(t.database, t.ws))['miscellaneous.membership_fee']!;
    await postTransaction(t.database, t.ws, {
      occurredOn: '2026-10-14',
      description: 'Annual fee',
      lines: [
        { accountId: category, amountMinor: 800_000, currency: 'IDR' },
        { accountId: t.id, amountMinor: -800_000, currency: 'IDR' },
      ],
    });
    await saveFeeWaiver(t.database, t.ws, t.id, challenge);
    return { ...t, category };
  };

  it('posts the refund on the card, nets the category, clears the challenge, and remembers the year', async () => {
    const t = await setup();
    const { transactionId } = await refundFeeChallenge(t.database, t.ws, { cardId: t.id, amountMinor: 800_000, receivedOn: '2026-11-03', intoAccountId: t.id, today: '2026-11-03' });
    const balances = await nativeBalances(t.database, t.ws);
    expect(balances[t.id]).toBe(0);
    expect(balances[t.category]).toBe(0);
    expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toBeNull();
    expect(await listFeeRefunds(t.database.db, t.ws, t.id)).toEqual([{ transactionId, accountId: t.id, feeYear: 2026 }]);
  });

  it('Undo deletes the receipt and puts the challenge back', async () => {
    const t = await setup();
    const { transactionId } = await refundFeeChallenge(t.database, t.ws, { cardId: t.id, amountMinor: 800_000, receivedOn: '2026-11-03', intoAccountId: t.id, today: '2026-11-03' });
    await undoFeeRefund(t.database, t.ws, transactionId);
    expect((await nativeBalances(t.database, t.ws))[t.id]).toBe(-800_000);
    expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toEqual(challenge);
    expect(await listFeeRefunds(t.database.db, t.ws, t.id)).toEqual([]);
  });

  it('needs a challenge and an amount', async () => {
    const t = await setup();
    await expect(refundFeeChallenge(t.database, t.ws, { cardId: t.id, amountMinor: 0, receivedOn: '2026-11-03', intoAccountId: t.id, today: '2026-11-03' })).rejects.toThrow();
    await clearFeeWaiver(t.database, t.ws, t.id);
    await expect(refundFeeChallenge(t.database, t.ws, { cardId: t.id, amountMinor: 800_000, receivedOn: '2026-11-03', intoAccountId: t.id, today: '2026-11-03' })).rejects.toThrow();
  });
});

describe('spend by plastic', () => {
  it('sums a statement window by the card each purchase names', async () => {
    const t = await card();
    const category = (await categoryIdsByKey(t.database, t.ws))['food.restaurants'] ?? Object.values(await categoryIdsByKey(t.database, t.ws))[0]!;
    const buy = (amount: number, on: string) =>
      postTransaction(t.database, t.ws, {
        occurredOn: on,
        description: 'Lunch',
        lines: [
          { accountId: category, amountMinor: amount, currency: 'IDR' },
          { accountId: t.id, amountMinor: -amount, currency: 'IDR' },
        ],
      });
    await buy(100_000, '2026-10-05');
    await buy(250_000, '2026-10-06');
    await buy(999_000, '2026-09-01');
    const out = await spendByPlastic(t.database, t.ws, t.id, '2026-10-01', '2026-10-31');
    expect(out['']).toBe(350_000);
  });
});
