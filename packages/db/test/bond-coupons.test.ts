import { describe, expect, it } from 'vitest';
import { createAccount, listBondCoupons, listTrades, recordDueCoupons, recordTrade, removeBondCoupon, saveAssetProfile, saveBondCoupon } from '../src/index';
import { setupDb } from './helpers';

const PAR = (rupiah: number) => rupiah * 1_000_000;

async function bond() {
  const { database, ws } = await setupDb();
  const bank = await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const ori = await createAccount(database, ws, { name: 'Retail bond', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: ori.id, assetKind: 'bond' });
  // Rp10.000.000 of par, owned before the app.
  await recordTrade(database, ws, { accountId: ori.id, kind: 'buy', occurredOn: '2026-01-10', unitsMicro: PAR(10_000_000), grossMinor: 10_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
  const terms = { accountId: ori.id, rateBps: 630, perYear: 12 as const, nextOn: '2026-08-15', maturesOn: null, taxBps: 1_000, cashAccountId: bank.id, auto: true };
  return { database, ws, bank, ori, terms };
}

const coupons = async (t: Awaited<ReturnType<typeof bond>>) =>
  (await listTrades(t.database, t.ws, { accountId: t.ori.id })).filter((trade) => trade.kind === 'income').map((trade) => [trade.occurredOn, trade.grossMinor, trade.taxMinor]);

describe('a bond’s coupons (0081)', () => {
  it('records every coupon due, each once, and moves its next payment on', async () => {
    const t = await bond();
    await saveBondCoupon(t.database, t.ws, t.terms);
    expect(await recordDueCoupons(t.database, t.ws, '2026-10-22')).toBe(3);
    expect(await coupons(t)).toEqual([
      ['2026-08-15', 52_500, 5_250],
      ['2026-09-15', 52_500, 5_250],
      ['2026-10-15', 52_500, 5_250],
    ]);
    expect((await listBondCoupons(t.database, t.ws))[t.ori.id]!.nextOn).toBe('2026-11-15');
    // Opened again the same day: nothing more is due.
    expect(await recordDueCoupons(t.database, t.ws, '2026-10-22')).toBe(0);
  });

  it('records nothing when switched off, and nothing past maturity', async () => {
    const t = await bond();
    await saveBondCoupon(t.database, t.ws, { ...t.terms, auto: false });
    expect(await recordDueCoupons(t.database, t.ws, '2026-10-22')).toBe(0);
    await saveBondCoupon(t.database, t.ws, { ...t.terms, maturesOn: '2026-09-15' });
    expect(await recordDueCoupons(t.database, t.ws, '2026-12-22')).toBe(2);
  });

  it('pays on the par held that day, and nothing once it was all sold', async () => {
    const t = await bond();
    await recordTrade(t.database, t.ws, { accountId: t.ori.id, kind: 'sell', occurredOn: '2026-09-01', unitsMicro: PAR(4_000_000), grossMinor: 4_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: t.bank.id });
    await recordTrade(t.database, t.ws, { accountId: t.ori.id, kind: 'sell', occurredOn: '2026-10-01', unitsMicro: PAR(6_000_000), grossMinor: 6_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: t.bank.id });
    await saveBondCoupon(t.database, t.ws, t.terms);
    expect(await recordDueCoupons(t.database, t.ws, '2026-10-22')).toBe(2);
    expect(await coupons(t)).toEqual([
      ['2026-08-15', 52_500, 5_250],
      ['2026-09-15', 31_500, 3_150],
    ]);
  });

  it('is only a bond’s, and refuses terms that do not hold', async () => {
    const t = await bond();
    await expect(saveBondCoupon(t.database, t.ws, { ...t.terms, accountId: t.bank.id })).rejects.toThrow(/Only a bond/);
    await expect(saveBondCoupon(t.database, t.ws, { ...t.terms, rateBps: 0 })).rejects.toThrow(/rate/);
    await expect(saveBondCoupon(t.database, t.ws, { ...t.terms, perYear: 3 as never })).rejects.toThrow(/monthly/);
    await expect(saveBondCoupon(t.database, t.ws, { ...t.terms, maturesOn: '2026-01-01' })).rejects.toThrow(/matures/);
    await saveBondCoupon(t.database, t.ws, t.terms);
    await removeBondCoupon(t.database, t.ws, t.ori.id);
    expect(await listBondCoupons(t.database, t.ws)).toEqual({});
  });
});
