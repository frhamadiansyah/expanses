import { refundLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  addFeeCharge,
  addFeeReversal,
  categoryIdsByKey,
  categoryTotalsIn,
  createAccount,
  feeLeftOutIds,
  listTransactions,
  nativeBalances,
  periodFlows,
  postTransaction,
  replaceTransaction,
  saveCardTerms,
  undoFeeWaived,
  voidTransaction,
} from '../src/index';
import { setupDb } from './helpers';

/*
 * A reversed fee is left out (owner, 22 Nov 2026, option 1 of the fee-same-everywhere mockup): once a year's annual fee
 * came back on the card, the charge and the money back both leave every report, worked out and never stored. Balances
 * never change. Invented cards and figures.
 */

const TODAY = '2026-11-13';
const FEE = 950_000;
const OTHER = 1_234_500;

async function card(opening?: { minor: number; on: string }) {
  const t = await setupDb();
  const acc = await createAccount(t.database, t.ws, {
    name: 'Sample card',
    kind: 'liability',
    subtype: 'credit_card',
    currency: 'IDR',
    ...(opening ? { openingBalanceMinor: opening.minor, openedOn: opening.on } : {}),
  });
  await saveCardTerms(t.database, t.ws, { accountId: acc.id, statementDay: 22, dueDay: 9, creditLimitMinor: null, annualFeeMinor: FEE, annualFeeOn: '2025-10-15' });
  const keys = await categoryIdsByKey(t.database, t.ws);
  const spend = (description: string, key: string, amountMinor: number, occurredOn: string) =>
    postTransaction(t.database, t.ws, {
      occurredOn,
      description,
      lines: [
        { accountId: keys[key]!, amountMinor, currency: 'IDR' },
        { accountId: acc.id, amountMinor: -amountMinor, currency: 'IDR' },
      ],
    });
  const refund = (description: string, key: string, amountMinor: number, occurredOn: string) =>
    postTransaction(t.database, t.ws, { occurredOn, description, lines: refundLines({ categoryAccountId: keys[key]!, paymentAccountId: acc.id, amountMinor, currency: 'IDR' }) });
  /** Each month's spending as Health and Cashflow's trend read it. */
  const months = async () => (await periodFlows(t.database, t.ws, { from: '2026-10-01', to: '2026-11-30' }, { monthStart: 1 })).byMonth.map((m) => [m.month, m.spendingMinor]);
  /** One month's Membership fee as the category report and budgets read it. */
  const membership = async (from: string, to: string) =>
    (await categoryTotalsIn(t.database, t.ws, 'expense', from, to)).rows.find((row) => row.accountId === keys['miscellaneous.membership_fee'])?.amountBaseMinor ?? 0;
  const view = async (id: string) => (await listTransactions(t.database, t.ws, { id, includeVoid: true }))[0]!;
  const out = () => feeLeftOutIds(t.database, t.ws);
  const balance = async () => (await nativeBalances(t.database, t.ws))[acc.id] ?? 0;
  return { ...t, id: acc.id, keys, spend, refund, months, membership, view, out, balance };
}

describe('a reversed fee is left out of every report', () => {
  it('leaves out the fee and its reversal; each month shows only the other spending; the balance still moves', async () => {
    const t = await card();
    await t.spend('Dinner', 'food_beverage.restaurants', OTHER, '2026-10-20');
    const fee = await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    const owed = await t.balance();
    const back = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-03' });

    expect([...(await t.out())].sort()).toEqual([fee, back].sort());
    expect(await t.months()).toEqual([
      ['2026-10', OTHER],
      ['2026-11', 0],
    ]);
    expect(await t.membership('2026-10-01', '2026-10-31')).toBe(0);
    expect(await t.membership('2026-11-01', '2026-11-30')).toBe(0);
    expect(await t.view(fee)).toMatchObject({ excluded: true, feeLeftOut: true, excludedMark: false });
    expect(await t.view(back)).toMatchObject({ excluded: true, feeLeftOut: true, excludedMark: false });
    // Only the reading changes: the card still owes less by the reversal.
    expect(await t.balance()).toBe(owed + FEE);
  });

  it('keeps a fee that was not reversed counting, as before', async () => {
    const t = await card();
    const fee = await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    expect((await t.out()).size).toBe(0);
    expect(await t.membership('2026-10-01', '2026-10-31')).toBe(FEE);
    const v = await t.view(fee);
    expect(v.excluded).toBe(false);
    expect(v.feeLeftOut).toBeUndefined();
  });

  it('counts the fee again once the reversal is deleted, or Reset on the fee page', async () => {
    const t = await card();
    const fee = await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    const back = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-03' });
    expect(await t.membership('2026-10-01', '2026-10-31')).toBe(0);
    await voidTransaction(t.database, t.ws, back);
    expect((await t.out()).size).toBe(0);
    expect(await t.membership('2026-10-01', '2026-10-31')).toBe(FEE);
    expect((await t.view(fee)).excluded).toBe(false);

    await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-04' });
    expect(await t.membership('2026-10-01', '2026-10-31')).toBe(0);
    await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
    expect((await t.out()).size).toBe(0);
    expect(await t.membership('2026-10-01', '2026-10-31')).toBe(FEE);
  });

  it('leaves the reversal alone out when the fee charge is deleted: nothing lowers a month for a charge not there', async () => {
    const t = await card();
    const fee = await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    const back = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-03' });
    await voidTransaction(t.database, t.ws, fee);
    expect([...(await t.out())]).toEqual([back]);
    expect(await t.months()).toEqual([
      ['2026-10', 0],
      ['2026-11', 0],
    ]);
  });

  it('follows an edit of the fee: the replacement is the fee now', async () => {
    const t = await card();
    const fee = await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    const back = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-03' });
    const edited = await replaceTransaction(t.database, t.ws, fee, {
      occurredOn: '2026-10-16',
      description: 'Annual fee (edited)',
      lines: [
        { accountId: t.keys['miscellaneous.membership_fee']!, amountMinor: FEE, currency: 'IDR' },
        { accountId: t.id, amountMinor: -FEE, currency: 'IDR' },
      ],
    });
    expect([...(await t.out())].sort()).toEqual([edited, back].sort());
  });

  it('reads a card charged before the app the same way: its fee row and its money back are left out', async () => {
    const t = await card({ minor: 4_000_000, on: '2026-11-01' });
    const back = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-13' });
    const out = [...(await t.out())];
    expect(out).toHaveLength(2);
    expect(out).toContain(back);
    expect(await t.membership('2026-10-01', '2026-10-31')).toBe(0);
    expect(await t.membership('2026-11-01', '2026-11-30')).toBe(0);
    // Its own stored mark (addFeeReversal's) is the form's to show; the rule reads beside it.
    expect(await t.view(back)).toMatchObject({ excluded: true, feeLeftOut: true, excludedMark: true });
  });

  it('leaves out money back on a card charged before the app that came with no fee row (an older phone’s)', async () => {
    const t = await card({ minor: 4_000_000, on: '2026-11-01' });
    const back = await t.refund('Annual fee reversal', 'miscellaneous.membership_fee', FEE, '2026-11-13');
    expect([...(await t.out())]).toEqual([back]);
    expect(await t.membership('2026-11-01', '2026-11-30')).toBe(0);
  });

  it('matches money back typed in by hand, with the fee already recorded and counting (the owner’s existing data)', async () => {
    const t = await card();
    const fee = await t.spend('Iuran tahunan kartu', 'miscellaneous.membership_fee', FEE, '2026-10-15');
    const back = await t.refund('Annual fee refund', 'miscellaneous.membership_fee', FEE, '2026-11-05');
    expect([...(await t.out())].sort()).toEqual([fee, back].sort());
    expect(await t.months()).toEqual([
      ['2026-10', 0],
      ['2026-11', 0],
    ]);
  });

  it('leaves both counting when only part of the fee came back, so the part kept is still spending', async () => {
    const t = await card();
    await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE / 2, on: '2026-11-03' });
    expect((await t.out()).size).toBe(0);
    expect(await t.months()).toEqual([
      ['2026-10', FEE],
      ['2026-11', -FEE / 2],
    ]);
  });

  it('never touches another card’s refunds, or a card with no fee date', async () => {
    const t = await card();
    const plain = await createAccount(t.database, t.ws, { name: 'No fee card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await postTransaction(t.database, t.ws, {
      occurredOn: '2026-10-15',
      description: 'Annual fee',
      lines: [
        { accountId: t.keys['miscellaneous.membership_fee']!, amountMinor: FEE, currency: 'IDR' },
        { accountId: plain.id, amountMinor: -FEE, currency: 'IDR' },
      ],
    });
    await postTransaction(t.database, t.ws, {
      occurredOn: '2026-11-03',
      description: 'Annual fee reversal',
      lines: refundLines({ categoryAccountId: t.keys['miscellaneous.membership_fee']!, paymentAccountId: plain.id, amountMinor: FEE, currency: 'IDR' }),
    });
    await t.refund('Shoes returned', 'shopping.clothing', 50_000, '2026-11-02');
    expect((await t.out()).size).toBe(0);
  });
});
