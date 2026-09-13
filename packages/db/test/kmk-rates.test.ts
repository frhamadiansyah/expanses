import { describe, expect, it } from 'vitest';
import {
  createAccount,
  draftReport,
  foreignCurrenciesFor,
  freezeReport,
  kmkRateRowsFor,
  kmkRatesFor,
  savedRows,
  saveAssetProfile,
  setKmkRate,
} from '../src/index';
import { setupDb } from './helpers';

const YEAR = 2026;

/** A dollar account, which is the case the report was quietly reporting as nothing. */
async function withUsdCash() {
  const { database, ws } = await setupDb();
  const account = await createAccount(database, ws, {
    name: 'Interactive Brokers',
    kind: 'asset',
    subtype: 'bank',
    currency: 'USD',
    // USD 10.000, in cents. The opening rate only prices the ledger entry; the report uses the KMK rate.
    openingBalanceMinor: 1_000_000,
    openedOn: `${YEAR}-01-02`,
    openingRateToBase: 16_000,
  });
  await saveAssetProfile(database, ws, { accountId: account.id, assetKind: 'cash' });
  return { database, ws, account };
}

describe('foreignCurrenciesFor', () => {
  it('asks only for the currencies the year actually holds', async () => {
    const { database, ws } = await withUsdCash();

    expect(await foreignCurrenciesFor(database, ws, YEAR)).toEqual(['USD']);
  });

  it("never asks for the report's own currency", async () => {
    const { database, ws } = await setupDb();
    await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 1_000, openedOn: `${YEAR}-01-02` });

    expect(await foreignCurrenciesFor(database, ws, YEAR)).toEqual([]);
  });
});

describe('setKmkRate', () => {
  it('stores the rate with the decree it came from', async () => {
    const { database, ws } = await withUsdCash();
    await setKmkRate(database, ws, YEAR, { currency: 'USD', rate: 17_714, note: 'KMK 42/MK/EF.2/2026' });

    expect(await kmkRateRowsFor(database, ws, YEAR)).toEqual([{ currency: 'USD', rate: 17_714, note: 'KMK 42/MK/EF.2/2026' }]);
    expect(await kmkRatesFor(database, ws, YEAR)).toEqual({ USD: 177_140_000 });
  });

  it('lets a rate typed from the wrong week be corrected', async () => {
    const { database, ws } = await withUsdCash();
    await setKmkRate(database, ws, YEAR, { currency: 'USD', rate: 16_000, note: 'KMK 40/MK/EF.2/2026' });
    await setKmkRate(database, ws, YEAR, { currency: 'USD', rate: 17_714, note: 'KMK 42/MK/EF.2/2026' });

    expect(await kmkRateRowsFor(database, ws, YEAR)).toEqual([{ currency: 'USD', rate: 17_714, note: 'KMK 42/MK/EF.2/2026' }]);
  });

  it('refuses a rate for the currency the report is already in', async () => {
    const { database, ws } = await withUsdCash();

    await expect(setKmkRate(database, ws, YEAR, { currency: 'IDR', rate: 1 })).rejects.toThrow(/needs no rate/);
  });
});

describe('the report rows', () => {
  it('reports a foreign holding as nothing until its rate is entered', async () => {
    const { database, ws } = await withUsdCash();
    await draftReport(database, ws, { taxYear: YEAR });
    await freezeReport(database, ws, YEAR);

    // A frozen row carries no note by design: the note belongs to the live draft, which is where
    // the owner is told a rate is missing. What must be true here is that nothing was invented.
    const [row] = await savedRows(database, ws, YEAR);
    expect(row!.balanceMinor).toBe(0);
  });

  it('converts at the entered rate once it is there', async () => {
    const { database, ws } = await withUsdCash();
    await setKmkRate(database, ws, YEAR, { currency: 'USD', rate: 17_714, note: 'KMK 42/MK/EF.2/2026' });
    await draftReport(database, ws, { taxYear: YEAR });
    await freezeReport(database, ws, YEAR);

    const [row] = await savedRows(database, ws, YEAR);
    // USD 10.000 at 17.714 is Rp 177.140.000, and nothing is left waiting.
    expect(row!.balanceMinor).toBe(177_140_000);
    expect(row!.note).toBeNull();
  });
});
