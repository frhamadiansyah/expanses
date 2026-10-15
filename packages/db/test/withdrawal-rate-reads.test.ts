import { exchangeLines, expenseLines, transferLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { createAccount, exchangeResultOf, foreignCostPreview, foreignLots, listAccounts, postTransaction, recalcForeignTx, systemAccountId, withdrawalsUsedBy } from '../src/index';
import { setupDb } from './helpers';

/* Withdrawal rate §7's figures, read. Invented: lira at 525 and 540, the day's 512. */
const RATES = { TRY: 512 };

async function trip() {
  const t = await setupDb();
  const restaurants = (await listAccounts(t.database, t.ws)).find((a) => a.name === 'Restaurants')!.id;
  const bank = (await createAccount(t.database, t.ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-10-01' })).id;
  const lira = (await createAccount(t.database, t.ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
  const wallet = (await createAccount(t.database, t.ws, { name: 'Lira wallet', kind: 'asset', subtype: 'ewallet', currency: 'TRY' })).id;
  const exchange = await systemAccountId(t.database.db, t.ws, 'currency_exchange');
  const post = (occurredOn: string, description: string, lines: Parameters<typeof postTransaction>[2]['lines']) => postTransaction(t.database, t.ws, { occurredOn, description, lines, ratesToBase: RATES });
  const withdraw = (occurredOn: string, idr: number, kurus: number) =>
    post(occurredOn, 'ATM', exchangeLines({ fromAccountId: bank, fromAmountMinor: idr, fromCurrency: 'IDR', toAccountId: lira, toAmountMinor: kurus, toCurrency: 'TRY', exchangeAccountId: exchange }));
  const spend = (occurredOn: string, kurus: number, from = lira) => post(occurredOn, 'Dinner', expenseLines({ categoryAccountId: restaurants, paymentAccountId: from, amountMinor: kurus, currency: 'TRY' }));
  // Whether or not the doors already did it (Task 7 wires them), the figures read here are the recalculated ones.
  const settle = async () => {
    await t.database.transaction((tx) => recalcForeignTx(tx, t.ws, lira, null));
    await t.database.transaction((tx) => recalcForeignTx(tx, t.ws, wallet, null));
  };
  const preview = (amountMinor: number, over: { excludeTransactionId?: string; dayRate?: number | null; accountId?: string } = {}) =>
    foreignCostPreview(t.database, t.ws, { accountId: over.accountId ?? lira, amountMinor, occurredOn: '2026-11-15', excludeTransactionId: over.excludeTransactionId ?? null, dayRate: over.dayRate ?? null });
  return { ...t, restaurants, bank, lira, wallet, exchange, post, withdraw, spend, settle, preview };
}

describe('foreignCostPreview (Add screen, R20)', () => {
  it('prices ₺450 at the withdrawal rate before it is saved', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await t.settle();
    const seen = await t.preview(45_000);
    expect(seen).toMatchObject({ currency: 'TRY', costBaseMinor: 236_250, coveredMinor: 45_000, coveredCostBaseMinor: 236_250, uncoveredMinor: 0, ratePerUnit: 525 });
    expect(seen!.lots.map((lot) => [lot.lotDate, lot.minor])).toEqual([['2026-11-02', 45_000]]);
  });

  it('values what no withdrawal covers at the day’s rate it is given, and gives no total without one', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 105_000, 20_000);
    await t.settle();
    expect(await t.preview(50_000, { dayRate: 512 })).toMatchObject({ costBaseMinor: 258_600, coveredMinor: 20_000, uncoveredMinor: 30_000 });
    expect(await t.preview(50_000)).toMatchObject({ costBaseMinor: null, uncoveredMinor: 30_000, ratePerUnit: null });
  });

  it('previews an edit without the transaction being edited', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const dinner = await t.spend('2026-11-03', 900_000);
    await t.settle();
    expect(await t.preview(950_000, { excludeTransactionId: dinner })).toMatchObject({ costBaseMinor: 4_987_500, uncoveredMinor: 0 });
    expect(await t.preview(950_000, { dayRate: 512 })).toMatchObject({ coveredMinor: 100_000, uncoveredMinor: 850_000, costBaseMinor: 525_000 + 4_352_000 });
  });

  it('is nothing for money that is not foreign, or no money at all', async () => {
    const t = await trip();
    expect(await t.preview(45_000, { accountId: t.bank })).toBeNull();
    expect(await t.preview(0)).toBeNull();
  });
});

describe('foreignLots and withdrawalsUsedBy (account page, receipt)', () => {
  it('lists the withdrawals left, a moved one under its own date, and what spending used', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 52_500, 10_000);
    await t.withdraw('2026-11-09', 54_000, 10_000);
    await t.post('2026-11-10', 'Between pockets', transferLines({ fromAccountId: t.lira, toAccountId: t.wallet, amountMinor: 5_000, currency: 'TRY' }));
    const dinner = await t.spend('2026-11-12', 10_000);
    await t.settle();
    expect(await foreignLots(t.database, t.ws, t.lira)).toMatchObject({
      currency: 'TRY',
      costBaseMinor: 27_000,
      shortfallMinor: 0,
      open: [{ lotDate: '2026-11-09', minor: 10_000, leftMinor: 5_000, costBaseMinor: 54_000, leftCostBaseMinor: 27_000 }],
    });
    expect((await foreignLots(t.database, t.ws, t.wallet))!.open).toMatchObject([{ lotDate: '2026-11-02', minor: 5_000, leftMinor: 5_000, leftCostBaseMinor: 26_250 }]);
    const used = await withdrawalsUsedBy(t.database, t.ws, dinner);
    expect(used).toMatchObject({ accountId: t.lira, currency: 'TRY', minor: 10_000, costBaseMinor: 53_250, uncoveredMinor: 0, ratePerUnit: 532.5 });
    expect(used!.uses.map((use) => [use.lotDate, use.minor, use.costBaseMinor])).toEqual([
      ['2026-11-02', 5_000, 26_250],
      ['2026-11-09', 5_000, 27_000],
    ]);
  });

  it('is nothing for a transaction that took no foreign money', async () => {
    const t = await trip();
    const market = await postTransaction(t.database, t.ws, { occurredOn: '2026-11-03', description: 'Market', lines: expenseLines({ categoryAccountId: t.restaurants, paymentAccountId: t.bank, amountMinor: 50_000, currency: 'IDR' }) });
    expect(await withdrawalsUsedBy(t.database, t.ws, market)).toBeNull();
  });
});

describe('exchangeResultOf (Move page, R15)', () => {
  it('is the loss an exchange back into rupiah carries, and nothing for a spend', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const back = await t.post('2026-11-20', 'Back to rupiah', exchangeLines({ fromAccountId: t.lira, fromAmountMinor: 50_000, fromCurrency: 'TRY', toAccountId: t.bank, toAmountMinor: 250_000, toCurrency: 'IDR', exchangeAccountId: t.exchange }));
    const dinner = await t.spend('2026-11-03', 45_000);
    await t.settle();
    expect(await exchangeResultOf(t.database, back)).toBe(-12_500);
    expect(await exchangeResultOf(t.database, dinner)).toBe(0);
  });
});
