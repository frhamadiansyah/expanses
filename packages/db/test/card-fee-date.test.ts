import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { FeeWaiver } from '@expanses/core';
import {
  annualFeeCharges,
  categoryIdsByKey,
  createAccount,
  feeWaivedStatus,
  getCardTerms,
  getFeeWaiver,
  listFeeRefunds,
  nativeBalances,
  postTransaction,
  REFUND_DESCRIPTION,
  saveCardTerms,
  saveFeeWaived,
  saveFeeWaiver,
  undoFeeWaived,
  WAIVED_DESCRIPTION,
} from '../src/index';
import { setupDb } from './helpers';

async function card() {
  const t = await setupDb();
  const acc = await createAccount(t.database, t.ws, { name: 'Fee card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  return { ...t, id: acc.id };
}
const terms = { statementDay: 25, dueDay: 12, creditLimitMinor: null, annualFeeMinor: 500_000 };

describe('card annual fee date', () => {
  it('saves and loads the date, and clears it', async () => {
    const t = await card();
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2025-03-12' });
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeOn).toBe('2025-03-12');
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: null });
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeOn).toBeNull();
  });
  it('leaves the date alone when a save does not mention it', async () => {
    const t = await card();
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2025-03-12' });
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, statementDay: 20 });
    const row = await getCardTerms(t.database, t.ws, t.id);
    expect(row?.annualFeeOn).toBe('2025-03-12');
    expect(row?.statementDay).toBe(20);
  });
  it('refuses a date that is not whole', async () => {
    const t = await card();
    await expect(saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2025-03' })).rejects.toThrow();
  });
});

/*
 * Fee waived, the one way (2026-11-12, option A): Back on the card with a recorded charge refunds that charge; with no
 * charge recorded it records the money back alone (the owner's case: charged and paid before the app was used); off,
 * it only marks the year. Undo takes back exactly what was written. Invented figures throughout.
 */
describe('fee waived', () => {
  // The fee is charged on 5 Oct; today is 12 Nov, so the charge covered is this year's, already past.
  const TODAY = '2026-11-12';
  const setup = async () => {
    const t = await card();
    await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeMinor: 450_000, annualFeeOn: '2025-10-05' });
    const keys = await categoryIdsByKey(t.database, t.ws);
    const charge = (description: string, key: string, amountMinor: number, occurredOn: string) =>
      postTransaction(t.database, t.ws, {
        occurredOn,
        description,
        lines: [
          { accountId: keys[key]!, amountMinor, currency: 'IDR' },
          { accountId: t.id, amountMinor: -amountMinor, currency: 'IDR' },
        ],
      });
    const balance = async (id: string) => (await nativeBalances(t.database, t.ws))[id] ?? 0;
    const status = () => feeWaivedStatus(t.database.db, t.ws, { cardId: t.id, today: TODAY });
    const year = async () => (await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear ?? null;
    return { ...t, keys, charge, balance, status, year };
  };
  const occurredOn = async (t: Awaited<ReturnType<typeof setup>>, id: string | null) => (await t.database.db.values<[string]>(sql`SELECT occurred_on FROM transactions WHERE id = ${id}`))[0]![0];

  describe('finding the fee charge', () => {
    /*
     * The owner's report (build 118): Settings → This year's fee → Waived, and "nothing happens". No charge had been
     * recorded, so the old Waived wrote the year and refunded nothing without a word. A fee recorded in words it did
     * not know ("BIAYA KARTU"), or posted on the next statement (past its 20 days), was passed over the same way.
     */
    it('says when no charge is recorded at all', async () => {
      const t = await setup();
      expect(await annualFeeCharges(t.database, t.ws, { cardId: t.id, today: TODAY })).toEqual({ covered: '2026-10-05', matched: null, nearby: [] });
    });

    it.each(['BIAYA KARTU TAHUNAN', 'IURAN KARTU UTAMA', 'Annual Fee Member'])('knows "%s" as the fee whatever its category', async (description) => {
      const t = await setup();
      const id = await t.charge(description, 'shopping.clothing', 450_000, '2026-10-06');
      expect((await annualFeeCharges(t.database, t.ws, { cardId: t.id, today: TODAY }))?.matched?.transactionId).toBe(id);
    });

    it('finds a fee posted on the next statement, over a month after the date', async () => {
      const t = await setup();
      const id = await t.charge('Biaya keanggotaan', 'miscellaneous.fees_charges', 450_000, '2026-11-08');
      expect((await annualFeeCharges(t.database, t.ws, { cardId: t.id, today: TODAY }))?.matched?.transactionId).toBe(id);
    });

    it('passes over a stamp duty under Fees & charges nearer the date for the charge of the fee’s amount', async () => {
      const t = await setup();
      await t.charge('Bea meterai', 'miscellaneous.fees_charges', 10_000, '2026-10-05');
      const fee = await t.charge('Fee', 'miscellaneous.fees_charges', 450_000, '2026-10-20');
      expect((await annualFeeCharges(t.database, t.ws, { cardId: t.id, today: TODAY }))?.matched?.transactionId).toBe(fee);
    });

    it('lists the charges near the date when none looks like the fee, nearest first, and never takes one for it', async () => {
      const t = await setup();
      const lunch = await t.charge('Warung Contoh', 'food_beverage.restaurants', 85_000, '2026-10-04');
      const plain = await t.charge('KARTU 1234', 'shopping.clothing', 450_000, '2026-10-09');
      await t.charge('Too early', 'shopping.clothing', 20_000, '2026-09-01');
      const found = await annualFeeCharges(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(found?.matched).toBeNull();
      expect(found?.nearby.map((c) => [c.transactionId, c.amountMinor, c.looksLikeFee])).toEqual([
        [lunch, 85_000, false],
        [plain, 450_000, false],
      ]);
    });
  });

  describe('back on the card, the fee charge recorded', () => {
    it('refunds that charge in its own category, dated the day it came back, and marks the year', async () => {
      const t = await setup();
      const fee = await t.charge('BIAYA KARTU TAHUNAN', 'miscellaneous.membership_fee', 450_000, '2026-10-06');
      expect(await t.balance(t.id)).toBe(-450_000);
      const { year, transactionId } = await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: true, cameBackOn: '2026-11-10', chargeId: fee });
      expect(year).toBe(2026);
      expect(await t.balance(t.id)).toBe(0);
      expect(await t.balance(t.keys['miscellaneous.membership_fee']!)).toBe(0);
      expect(await occurredOn(t, transactionId)).toBe('2026-11-10');
      expect(await t.year()).toBe(2026);
      expect(await t.status()).toEqual({ year: 2026, covered: '2026-10-05', waived: true, back: { transactionId, amountMinor: 450_000, on: '2026-11-10', cancelsCharge: true } });
      // Once is enough: a second save says so rather than doing nothing.
      await expect(saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: false })).rejects.toThrow(/already marked waived/);
    });

    it('refunds a charge picked from the card’s charges near the date, and refuses one that is not', async () => {
      const t = await setup();
      await t.charge('Warung Contoh', 'food_beverage.restaurants', 85_000, '2026-10-04');
      const plain = await t.charge('KARTU 1234', 'shopping.clothing', 450_000, '2026-10-09');
      await expect(saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: true, cameBackOn: TODAY, chargeId: 'not-a-charge' })).rejects.toThrow(/not one of this card/);
      expect(await t.year()).toBeNull();
      await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: true, cameBackOn: TODAY, chargeId: plain });
      expect(await t.balance(t.id)).toBe(-85_000);
      expect(await t.balance(t.keys['shopping.clothing']!)).toBe(0);
    });

    it('never dates the refund before the charge it cancels', async () => {
      const t = await setup();
      const fee = await t.charge('Iuran kartu', 'miscellaneous.fees_charges', 450_000, '2026-11-08');
      const { transactionId } = await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: true, cameBackOn: '2026-10-10', chargeId: fee });
      expect(await occurredOn(t, transactionId)).toBe('2026-11-08');
    });

    it('Undo voids the refund and clears the year', async () => {
      const t = await setup();
      const fee = await t.charge('Annual fee', 'miscellaneous.membership_fee', 450_000, '2026-10-05');
      await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: true, cameBackOn: TODAY, chargeId: fee });
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await t.balance(t.id)).toBe(-450_000);
      expect(await t.year()).toBeNull();
      expect(await t.status()).toMatchObject({ waived: false, back: null });
      expect(await listFeeRefunds(t.database.db, t.ws, t.id)).toEqual([]);
      // Waived again after the Undo, as if fresh.
      await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: true, cameBackOn: TODAY, chargeId: fee });
      expect(await t.balance(t.id)).toBe(0);
    });
  });

  describe('back on the card, no fee charge recorded', () => {
    it('records the money coming back on the card, so a card at nothing goes into credit', async () => {
      const t = await setup();
      expect(await t.balance(t.id)).toBe(0);
      const { transactionId } = await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: true, cameBackOn: '2026-11-11', chargeId: null, amountMinor: 450_000 });
      // In credit: the card holds money back, filed against Membership fee.
      expect(await t.balance(t.id)).toBe(450_000);
      expect(await t.balance(t.keys['miscellaneous.membership_fee']!)).toBe(-450_000);
      expect(await occurredOn(t, transactionId)).toBe('2026-11-11');
      expect(await t.year()).toBe(2026);
      expect(await listFeeRefunds(t.database.db, t.ws, t.id)).toEqual([{ transactionId, accountId: t.id, feeYear: 2026 }]);
      expect(await t.status()).toMatchObject({ waived: true, back: { transactionId, amountMinor: 450_000, on: '2026-11-11', cancelsCharge: false } });
    });

    it('needs an amount and a day that is neither ahead of today nor before the charge, and marks nothing when refused', async () => {
      const t = await setup();
      const save = (cameBackOn: string, amountMinor = 450_000) => saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: true, cameBackOn, chargeId: null, amountMinor });
      await expect(save(TODAY, 0)).rejects.toThrow(/amount/);
      await expect(save('2026-11-13')).rejects.toThrow(/future/);
      await expect(save('2026-10-04')).rejects.toThrow(/before/);
      expect(await t.year()).toBeNull();
      expect(await t.balance(t.id)).toBe(0);
    });

    it('leaves a fee challenge on the card, and Undo leaves it there too', async () => {
      const t = await setup();
      const challenge: FeeWaiver = { kind: 'challenge', amountMinor: 3_000_000, countedFrom: '2026-10-01', spendBy: '2026-11-01', categoryIds: [] };
      await saveFeeWaiver(t.database, t.ws, t.id, challenge);
      await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: true, cameBackOn: TODAY, chargeId: null, amountMinor: 450_000 });
      expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toEqual(challenge);
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toEqual(challenge);
      expect(await t.balance(t.id)).toBe(0);
      expect(await t.year()).toBeNull();
    });
  });

  describe('not back on the card', () => {
    it('only marks the year: nothing is posted, and Undo clears the mark', async () => {
      const t = await setup();
      await t.charge('Annual fee', 'miscellaneous.membership_fee', 450_000, '2026-10-05');
      expect(await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: false })).toEqual({ year: 2026, transactionId: null });
      expect(await t.balance(t.id)).toBe(-450_000);
      expect(await t.status()).toMatchObject({ waived: true, back: null });
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await t.year()).toBeNull();
      expect(await t.balance(t.id)).toBe(-450_000);
    });

    it('covers the coming charge when it is within 30 days, waived before it is charged', async () => {
      const t = await card();
      await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2020-11-20' });
      expect((await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: false })).year).toBe(2026);
      expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2026);
    });

    it('covers the last charge when the next is over 30 days away', async () => {
      const t = await card();
      await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2024-03-12' });
      await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: false });
      expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2026);
    });

    it('keeps the mark through a later save of the terms', async () => {
      const t = await setup();
      await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: false });
      await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeMinor: 450_000, annualFeeOn: '2025-10-05' });
      expect(await t.year()).toBe(2026);
    });
  });

  describe('a year recorded before the one way', () => {
    it('the old Fee refunded (a refund kept for the year, the challenge cleared, no mark) reads waived, and Undo puts the challenge back', async () => {
      const t = await setup();
      const challenge: FeeWaiver = { kind: 'challenge', amountMinor: 3_000_000, countedFrom: '2026-10-01', spendBy: '2026-11-01', categoryIds: [] };
      const transactionId = await postTransaction(t.database, t.ws, {
        occurredOn: '2026-11-03',
        description: REFUND_DESCRIPTION,
        lines: [
          { accountId: t.id, amountMinor: 450_000, currency: 'IDR' },
          { accountId: t.keys['miscellaneous.membership_fee']!, amountMinor: -450_000, currency: 'IDR' },
        ],
      });
      await t.database.db.run(sql`INSERT INTO card_fee_refunds (transaction_id, workspace_id, account_id, fee_year, challenge_json, created_at)
        VALUES (${transactionId}, ${t.ws.workspaceId}, ${t.id}, 2026, ${JSON.stringify(challenge)}, '2026-11-03T00:00:00.000Z')`);
      expect(await t.year()).toBeNull();
      expect(await t.status()).toEqual({ year: 2026, covered: '2026-10-05', waived: true, back: { transactionId, amountMinor: 450_000, on: '2026-11-03', cancelsCharge: false } });
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await t.status()).toMatchObject({ waived: false, back: null });
      expect(await t.balance(t.id)).toBe(0);
      expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toEqual(challenge);
    });

    it('the old Waived (a mark, and a refund kept nowhere) reads waived with what came back, and Undo voids it', async () => {
      const t = await setup();
      await t.charge('Annual fee', 'miscellaneous.membership_fee', 450_000, '2026-10-05');
      await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, back: false });
      const transactionId = await postTransaction(t.database, t.ws, {
        occurredOn: '2026-10-20',
        description: WAIVED_DESCRIPTION,
        lines: [
          { accountId: t.id, amountMinor: 450_000, currency: 'IDR' },
          { accountId: t.keys['miscellaneous.membership_fee']!, amountMinor: -450_000, currency: 'IDR' },
        ],
      });
      expect(await t.status()).toMatchObject({ waived: true, back: { transactionId, amountMinor: 450_000, on: '2026-10-20', cancelsCharge: true } });
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await t.year()).toBeNull();
      expect(await t.balance(t.id)).toBe(-450_000);
    });
  });
});
