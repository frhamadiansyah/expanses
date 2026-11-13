import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { type FeeWaiver, refundLines } from '@expanses/core';
import {
  addFeeCharge,
  addFeeReversal,
  cardFeeYears,
  categoryIdsByKey,
  challengeYearOf,
  createAccount,
  feeWaivedStatus,
  getCardTerms,
  clearFeeWaiver,
  getFeeWaiver,
  listFeeRefunds,
  nativeBalances,
  postTransaction,
  REFUND_DESCRIPTION,
  replaceTransaction,
  saveCardTerms,
  saveFeeWaived,
  saveFeeWaiver,
  undoFeeWaived,
  FEE_REVERSAL_DESCRIPTION,
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
    const current = async () => (await cardFeeYears(t.database.db, t.ws, { cardId: t.id, today: TODAY }))!.current;
    const reverse = (amountMinor: number, on: string) => addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor, on });
    return { ...t, keys, charge, balance, status, year, current, reverse };
  };
  describe('finding the fee charge', () => {
    /*
     * The owner's report (build 118): a fee recorded in words the app did not know ("BIAYA KARTU"), or posted on the
     * next statement (past its 20 days), was passed over. The fee year reads each of these as Charged.
     */
    it('reads Pending when no charge is recorded at all', async () => {
      const t = await setup();
      expect(await t.current()).toMatchObject({ covered: '2026-10-05', charge: null, lines: ['pending'] });
    });

    it.each(['BIAYA KARTU TAHUNAN', 'IURAN KARTU UTAMA', 'Annual Fee Member'])('knows "%s" as the fee whatever its category', async (description) => {
      const t = await setup();
      const id = await t.charge(description, 'shopping.clothing', 450_000, '2026-10-06');
      expect((await t.current()).charge?.transactionId).toBe(id);
    });

    it('finds a fee posted on the next statement, over a month after the date', async () => {
      const t = await setup();
      const id = await t.charge('Biaya keanggotaan', 'miscellaneous.fees_charges', 450_000, '2026-11-08');
      expect((await t.current()).charge?.transactionId).toBe(id);
    });

    it('passes over a stamp duty under Fees & charges nearer the date for the charge of the fee’s amount', async () => {
      const t = await setup();
      await t.charge('Bea meterai', 'miscellaneous.fees_charges', 10_000, '2026-10-05');
      const fee = await t.charge('Fee', 'miscellaneous.fees_charges', 450_000, '2026-10-20');
      expect((await t.current()).charge?.transactionId).toBe(fee);
    });

    it('never takes a charge that does not look like the fee', async () => {
      const t = await setup();
      await t.charge('Warung Contoh', 'food_beverage.restaurants', 85_000, '2026-10-04');
      await t.charge('KARTU 1234', 'shopping.clothing', 450_000, '2026-10-09');
      expect((await t.current()).charge).toBeNull();
    });

    // M4: a Fees & charges line that is not the fee is never picked.
    it('never picks a late fee under Fees & charges, but picks one at the card’s fee amount', async () => {
      const t = await setup();
      await t.charge('Biaya keterlambatan', 'miscellaneous.fees_charges', 150_000, '2026-10-08');
      expect((await t.current()).charge).toBeNull();
      const fee = await t.charge('Fee', 'miscellaneous.fees_charges', 450_000, '2026-10-30');
      expect((await t.current()).charge?.transactionId).toBe(fee);
    });

    // L1: a split charge is read by its fee line, and its reversal nets that line alone.
    it('reads a split charge by its fee line, and reverses that amount alone', async () => {
      const t = await setup();
      const id = await postTransaction(t.database, t.ws, {
        occurredOn: '2026-10-05',
        description: 'Statement charges',
        lines: [
          { accountId: t.keys['miscellaneous.membership_fee']!, amountMinor: 450_000, currency: 'IDR' },
          { accountId: t.keys['shopping.clothing']!, amountMinor: 1_000_000, currency: 'IDR' },
          { accountId: t.id, amountMinor: -1_450_000, currency: 'IDR' },
        ],
      });
      expect((await t.current()).charge).toMatchObject({ transactionId: id, amountMinor: 450_000 });
      await t.reverse(450_000, TODAY);
      expect(await t.balance(t.id)).toBe(-1_000_000);
      expect(await t.balance(t.keys['shopping.clothing']!)).toBe(1_000_000);
    });
  });

  describe('a reversal already on the card', () => {
    // M1: a reversal the bank already posted (an imported statement credit) is never added a second time.
    it('reads it under the charge, refuses another, and the year reads waived', async () => {
      const t = await setup();
      const fee = await t.charge('ANNUAL FEE', 'miscellaneous.membership_fee', 450_000, '2026-10-05');
      await postTransaction(t.database, t.ws, { occurredOn: '2026-10-20', description: 'ANNUAL FEE REVERSAL', lines: refundLines({ categoryAccountId: t.keys['miscellaneous.membership_fee']!, paymentAccountId: t.id, amountMinor: 450_000, currency: 'IDR' }) });
      expect(await t.current()).toMatchObject({ charge: { transactionId: fee }, reversal: { on: '2026-10-20', ours: false }, state: 'waived' });
      await expect(t.reverse(450_000, TODAY)).rejects.toThrow('already on the card, on 20 Oct');
      await expect(saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY })).rejects.toThrow(/already marked waived/);
      expect(await t.balance(t.id)).toBe(0);
    });

    it('finds a reversal of the fee’s amount when the fee itself was never recorded', async () => {
      const t = await setup();
      await postTransaction(t.database, t.ws, { occurredOn: '2026-11-02', description: 'IURAN TAHUNAN DIBATALKAN', lines: refundLines({ categoryAccountId: t.keys['miscellaneous.fees_charges']!, paymentAccountId: t.id, amountMinor: 450_000, currency: 'IDR' }) });
      expect(await t.current()).toMatchObject({ charge: null, reversal: { on: '2026-11-02' }, lines: ['reversal'] });
    });

    it('does not take a credit for a different amount, or one not about a fee, as the reversal', async () => {
      const t = await setup();
      await t.charge('ANNUAL FEE', 'miscellaneous.membership_fee', 450_000, '2026-10-05');
      await postTransaction(t.database, t.ws, { occurredOn: '2026-10-20', description: 'Cashback', lines: refundLines({ categoryAccountId: t.keys['shopping.clothing']!, paymentAccountId: t.id, amountMinor: 450_000, currency: 'IDR' }) });
      await postTransaction(t.database, t.ws, { occurredOn: '2026-10-21', description: 'Annual fee adjustment', lines: refundLines({ categoryAccountId: t.keys['miscellaneous.membership_fee']!, paymentAccountId: t.id, amountMinor: 50_000, currency: 'IDR' }) });
      expect((await t.current()).reversal).toBeNull();
    });

    // L-b: a reversal filed as income counts by its name.
    it('takes an income line named like the fee as a reversal, and not one named otherwise', async () => {
      const t = await setup();
      const credit = (on: string, description: string) =>
        postTransaction(t.database, t.ws, { occurredOn: on, description, lines: refundLines({ categoryAccountId: t.keys['income.other']!, paymentAccountId: t.id, amountMinor: 450_000, currency: 'IDR' }) });
      await credit('2026-10-21', 'Cashback');
      expect((await t.current()).reversal).toBeNull();
      await credit('2026-10-22', 'ANNUAL FEE REVERSAL');
      expect((await t.current()).reversal?.on).toBe('2026-10-22');
    });
  });

  describe('Waived, not charged', () => {
    it('only marks the year: nothing is posted, and Undo clears the mark', async () => {
      const t = await setup();
      expect(await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY })).toEqual({ year: 2026, transactionId: null });
      expect(await t.balance(t.id)).toBe(0);
      expect(await t.status()).toMatchObject({ waived: true, back: null });
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await t.year()).toBeNull();
      expect(await t.status()).toMatchObject({ waived: false });
    });

    it('covers the coming charge when it is within 30 days, waived before it is charged', async () => {
      const t = await card();
      await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2020-11-20' });
      expect((await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY })).year).toBe(2026);
      expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2026);
    });

    it('covers the last charge when the next is over 30 days away', async () => {
      const t = await card();
      await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2024-03-12' });
      await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2026);
    });

    it('keeps the mark through a later save of the terms', async () => {
      const t = await setup();
      await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeMinor: 450_000, annualFeeOn: '2025-10-05' });
      expect(await t.year()).toBe(2026);
    });

    // M2: no fee date, no year to mark: refused, with the way to set it.
    it('refuses a card with no fee date, and marks once the date is set', async () => {
      const t = await card();
      await expect(saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY })).rejects.toThrow('Set the day the fee is charged first.');
      await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2026-10-05' });
      expect(await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY })).toEqual({ year: 2026, transactionId: null });
      expect((await feeWaivedStatus(t.database.db, t.ws, { cardId: t.id, today: TODAY })).waived).toBe(true);
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
      expect(await t.status()).toEqual({ year: 2026, covered: '2026-10-05', waived: true, back: { transactionId, amountMinor: 450_000, on: '2026-11-03', intoAccountId: t.id, cancelsCharge: false }, challengeYear: null, dated: true });
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await t.status()).toMatchObject({ waived: false, back: null });
      expect(await t.balance(t.id)).toBe(0);
      expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toEqual(challenge);
    });

    it('the old Waived (a mark, and a refund kept nowhere) reads waived with what came back, and Undo voids it', async () => {
      const t = await setup();
      await t.charge('Annual fee', 'miscellaneous.membership_fee', 450_000, '2026-10-05');
      // As the old Waived left it: the year marked over a recorded charge.
      await t.database.db.run(sql`UPDATE card_terms SET annual_fee_waived_year = 2026 WHERE account_id = ${t.id}`);
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

    it('an old Fee refunded year whose refund was edited before edits carried the link reads waived, and Undo voids the edit', async () => {
      const t = await setup();
      const challenge: FeeWaiver = { kind: 'challenge', amountMinor: 3_000_000, countedFrom: '2026-10-01', spendBy: '2026-11-01', categoryIds: [] };
      const refund = (occurredOn: string) => ({ occurredOn, description: REFUND_DESCRIPTION, lines: refundLines({ categoryAccountId: t.keys['miscellaneous.membership_fee']!, paymentAccountId: t.id, amountMinor: 450_000, currency: 'IDR' }) });
      const original = await postTransaction(t.database, t.ws, refund('2026-11-03'));
      await t.database.db.run(sql`INSERT INTO card_fee_refunds (transaction_id, workspace_id, account_id, fee_year, challenge_json, created_at)
        VALUES (${original}, ${t.ws.workspaceId}, ${t.id}, 2026, ${JSON.stringify(challenge)}, '2026-11-03T00:00:00.000Z')`);
      const edited = await replaceTransaction(t.database, t.ws, original, refund('2026-11-04'));
      // As an edit made before edits carried the link left it: the kept refund still names the transaction it replaced.
      await t.database.db.run(sql`UPDATE card_fee_refunds SET transaction_id = ${original} WHERE transaction_id = ${edited}`);
      expect(await t.status()).toMatchObject({ waived: true, back: { transactionId: edited, on: '2026-11-04' } });
      expect(await listFeeRefunds(t.database.db, t.ws, t.id)).toEqual([{ transactionId: edited, accountId: t.id, feeYear: 2026 }]);
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await t.balance(t.id)).toBe(0);
      expect(await t.status()).toMatchObject({ waived: false, back: null });
      expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toEqual(challenge);
    });

    // L3: an old Fee refunded could go to a bank account: the status names where it went.
    it('names the account an old refund went to', async () => {
      const t = await setup();
      const bank = await createAccount(t.database, t.ws, { name: 'Sample bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
      const transactionId = await postTransaction(t.database, t.ws, {
        occurredOn: '2026-11-03',
        description: REFUND_DESCRIPTION,
        lines: refundLines({ categoryAccountId: t.keys['miscellaneous.membership_fee']!, paymentAccountId: bank.id, amountMinor: 450_000, currency: 'IDR' }),
      });
      await t.database.db.run(sql`INSERT INTO card_fee_refunds (transaction_id, workspace_id, account_id, fee_year, challenge_json, created_at)
        VALUES (${transactionId}, ${t.ws.workspaceId}, ${t.id}, 2026, 'null', '2026-11-03T00:00:00.000Z')`);
      expect((await t.status()).back).toMatchObject({ transactionId, intoAccountId: bank.id });
    });
  });

  describe('the page’s own reversal', () => {
    const refund = (t: Awaited<ReturnType<typeof setup>>, key: string, occurredOn: string, description = FEE_REVERSAL_DESCRIPTION) => ({
      occurredOn,
      description,
      lines: refundLines({ categoryAccountId: t.keys[key]!, paymentAccountId: t.id, amountMinor: 450_000, currency: 'IDR' }),
    });

    // H1: an edit replaces the reversal's transaction; the link moves with it, so the year stays waived.
    it('an edited reversal (its date) still reads as the app’s, refuses a second, and Undo voids the edit', async () => {
      const t = await setup();
      await t.charge('Annual fee', 'miscellaneous.membership_fee', 450_000, '2026-10-05');
      const id = await t.reverse(450_000, '2026-11-11');
      const edited = await replaceTransaction(t.database, t.ws, id, refund(t, 'miscellaneous.membership_fee', '2026-11-10'));
      expect(await t.current()).toMatchObject({ reversal: { transactionId: edited, on: '2026-11-10', ours: true }, state: 'waived' });
      expect(await t.status()).toMatchObject({ waived: true, back: { transactionId: edited, amountMinor: 450_000, on: '2026-11-10' } });
      expect(await listFeeRefunds(t.database.db, t.ws, t.id)).toEqual([{ transactionId: edited, accountId: t.id, feeYear: 2026 }]);
      await expect(t.reverse(450_000, TODAY)).rejects.toThrow(/already on the card/);
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await t.balance(t.id)).toBe(-450_000);
      expect(await t.current()).toMatchObject({ lines: ['charged'], reversal: null });
    });

    it('a reversal edited into another category is still the year’s, and Undo voids it', async () => {
      const t = await setup();
      await t.charge('Annual fee', 'miscellaneous.membership_fee', 450_000, '2026-10-05');
      const id = await t.reverse(450_000, TODAY);
      const edited = await replaceTransaction(t.database, t.ws, id, refund(t, 'miscellaneous.fees_charges', TODAY));
      expect(await t.status()).toMatchObject({ waived: true, back: { transactionId: edited } });
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await t.balance(t.id)).toBe(-450_000);
      expect(await t.balance(t.keys['miscellaneous.fees_charges']!)).toBe(0);
    });

    // L2: a reversal keeps no challenge, so Undo never brings back one removed since.
    it('keeps no challenge with the reversal: one removed afterwards stays removed after Undo', async () => {
      const t = await setup();
      await saveFeeWaiver(t.database, t.ws, t.id, { kind: 'challenge', amountMinor: 3_000_000, countedFrom: '2026-10-01', spendBy: '2026-11-01', categoryIds: [] });
      await t.charge('Annual fee', 'miscellaneous.membership_fee', 450_000, '2026-10-05');
      const id = await t.reverse(450_000, TODAY);
      expect(await t.database.db.values(sql`SELECT challenge_json FROM card_fee_refunds WHERE transaction_id = ${id}`)).toEqual([['null']]);
      await clearFeeWaiver(t.database, t.ws, t.id);
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toBeNull();
    });

    // N3: a reversal typed in by hand is a reversal found on the card; the app's own, edited or not, is the app's.
    it('reads a hand-typed "Annual fee refund" as a reversal found on the card', async () => {
      const t = await setup();
      await t.charge('Annual fee', 'miscellaneous.membership_fee', 450_000, '2026-10-05');
      await postTransaction(t.database, t.ws, refund(t, 'miscellaneous.membership_fee', '2026-10-25', REFUND_DESCRIPTION));
      expect((await t.current()).reversal).toMatchObject({ on: '2026-10-25', ours: false });
      // Undo takes back only what the app wrote: the one typed in stays.
      await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
      expect(await t.balance(t.id)).toBe(0);
    });

    // L6: the reversal is never dated before its charge, nor after today.
    it('refuses a reversal for a charge still ahead', async () => {
      const t = await card();
      await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeMinor: 450_000, annualFeeOn: '2020-11-20' });
      await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: 450_000, on: TODAY });
      await expect(addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: 450_000, on: '2026-11-13' })).rejects.toThrow(/after today/);
    });
  });

  describe('review round 2', () => {
    const credit = (t: Awaited<ReturnType<typeof setup>>, key: string, occurredOn: string, description: string, amountMinor = 450_000) =>
      postTransaction(t.database, t.ws, { occurredOn, description, lines: refundLines({ categoryAccountId: t.keys[key]!, paymentAccountId: t.id, amountMinor, currency: 'IDR' }) });

    // N1, round 3: the challenge keeps the year of the fee it is for, from its own last day (the nearest annual charge).
    describe('which fee a challenge is for', () => {
      const challengeOn = async (countedFrom: string, spendBy: string) => {
        const t = await setup();
        await saveFeeWaiver(t.database, t.ws, t.id, { kind: 'challenge', amountMinor: 3_000_000, countedFrom, spendBy, categoryIds: [] });
        const at = (today: string) => feeWaivedStatus(t.database.db, t.ws, { cardId: t.id, today });
        return { t, at };
      };
      const covers = (s: { challengeYear: number | null; year: number }) => s.challengeYear === s.year;

      it('a three-month challenge given after the fee posted is that fee’s, and not next year’s', async () => {
        // The fee posts 5 Oct 2025; the bank gives the challenge on 20 Oct, to spend by 5 Jan 2026.
        const { at } = await challengeOn('2025-10-20', '2026-01-05');
        expect(covers(await at('2025-12-01'))).toBe(true);
        expect(covers(await at('2026-01-10'))).toBe(true);
        // A month before the 2026 fee, the covered charge is 2026's: the old challenge is not about it.
        expect(covers(await at('2026-09-10'))).toBe(false);
      });

      it('a thirty-day challenge covers its own year only', async () => {
        const { at } = await challengeOn('2025-10-10', '2025-11-09');
        expect(covers(await at('2025-11-01'))).toBe(true);
        expect(covers(await at('2026-09-20'))).toBe(false);
        expect(covers(await at('2026-10-20'))).toBe(false);
      });

      it('a challenge given before the fee, within its 30 days, is for that coming fee', async () => {
        const { at } = await challengeOn('2026-09-15', '2026-10-01');
        expect((await at('2026-09-20')).challengeYear).toBe(2026);
        expect(covers(await at('2026-10-20'))).toBe(true);
      });

      it('an old challenge with no year kept is read by the charge its last day covers', async () => {
        const { t, at } = await challengeOn('2025-10-20', '2026-01-05');
        await t.database.db.run(sql`UPDATE card_fee_waivers SET fee_year = NULL`);
        expect((await at('2026-01-10')).challengeYear).toBe(2025);
        expect(covers(await at('2026-01-10'))).toBe(true);
        expect(covers(await at('2026-09-10'))).toBe(false);
      });

      // P1: a challenge given more than 30 days before the fee is the coming fee's, not last year's.
      it('a challenge saved two months before the fee (spend by 30 Sep for a 5 Oct fee) is offered for that fee', async () => {
        const { at } = await challengeOn('2026-08-01', '2026-09-30');
        expect((await at('2026-08-01')).challengeYear).toBe(2026);
        expect(covers(await at('2026-09-30'))).toBe(true);
        expect(covers(await at('2026-10-06'))).toBe(true);
      });

      it.each([
        ['2025-11-04', 2025],
        ['2026-01-05', 2025],
        ['2026-09-30', 2026],
        ['2026-08-31', 2026],
      ])('spend by %s is for the %i fee (the annual charge nearest it)', (spendBy, year) => expect(challengeYearOf('2025-10-05', spendBy)).toBe(year));

      it('reads 29 Feb as 28 Feb in a year without one', () => {
        expect(challengeYearOf('2024-02-29', '2025-03-10')).toBe(2025);
        expect(challengeYearOf('2024-02-29', '2025-11-01')).toBe(2026);
      });

      // P2: editing an old challenge keeps the fee it was for.
      it('editing an old challenge, a year on, keeps its fee year', async () => {
        const { t, at } = await challengeOn('2025-10-20', '2026-01-05');
        await t.database.db.run(sql`UPDATE card_fee_waivers SET fee_year = NULL`);
        await saveFeeWaiver(t.database, t.ws, t.id, { kind: 'challenge', amountMinor: 2_500_000, countedFrom: '2025-10-20', spendBy: '2026-01-05', categoryIds: [] });
        expect(await t.database.db.values(sql`SELECT fee_year FROM card_fee_waivers`)).toEqual([[2025]]);
        expect(covers(await at('2026-09-10'))).toBe(false);
      });

      it('a challenge saved before the card had a fee date is read by the date set later', async () => {
        const t = await card();
        await saveFeeWaiver(t.database, t.ws, t.id, { kind: 'challenge', amountMinor: 3_000_000, countedFrom: '2026-08-01', spendBy: '2026-09-30', categoryIds: [] });
        expect(await t.database.db.values(sql`SELECT fee_year FROM card_fee_waivers`)).toEqual([[null]]);
        await saveCardTerms(t.database, t.ws, { accountId: t.id, ...terms, annualFeeOn: '2025-10-05' });
        expect((await feeWaivedStatus(t.database.db, t.ws, { cardId: t.id, today: '2026-10-06' })).challengeYear).toBe(2026);
      });

      it('a target, or no waiver, is no challenge', async () => {
        const t = await setup();
        expect((await t.status()).challengeYear).toBeNull();
        await saveFeeWaiver(t.database, t.ws, t.id, { kind: 'automatic', amountMinor: 50_000_000, countedFrom: null, spendBy: null, categoryIds: [] });
        expect((await t.status()).challengeYear).toBeNull();
      });
    });

    // L-d: the walk back through edits has an index.
    it('indexes transactions by what they replaced', async () => {
      const t = await setup();
      expect(await t.database.db.values(sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'transactions_replaces_idx'`)).toEqual([['transactions_replaces_idx']]);
    });
  });
});
