import { describe, expect, it } from 'vitest';
import { type CoretaxInputs, coretaxRows, type ReportSettings, sectionTotals, utangRows } from '../src/index';

const YEAR = 2026;

const settings = (overrides: Partial<ReportSettings> = {}): ReportSettings => ({
  propertyBasis: 'cost',
  repeatRows: 'holding',
  // Rp 16.000 to the dollar, as a rate times ten thousand.
  kmkRateBps: { USD: 160_000_000 },
  ...overrides,
});

const empty: CoretaxInputs = { cash: [], holdings: [], estimated: [], receivables: [], debts: [] };

const inputs = (partial: Partial<CoretaxInputs> = {}): CoretaxInputs => ({ ...empty, ...partial });

const bca = {
  accountId: 'bca',
  name: 'BCA Tahapan',
  code: '012',
  balanceMinor: 50_000_000,
  currency: 'IDR',
  fields: { owner: 'Fandrian', inst: 'Bank Central Asia', loc: 'IDN' },
};

/** 15 g of gold: 10 g bought in 2024 for Rp 13.100.000, 5 g in 2026 for Rp 9.300.000. */
const gold = {
  accountId: 'gold',
  name: 'Antam gold bars',
  code: '051',
  currency: 'IDR',
  priceMicro: 1_900_000_000_000,
  byYear: {
    '2024': { unitsMicro: 10_000_000, costMinor: 13_100_000 },
    '2026': { unitsMicro: 5_000_000, costMinor: 9_300_000 },
  },
  fields: {},
};

const house = {
  accountId: 'house',
  name: 'House in Bintaro',
  code: '061',
  currency: 'IDR',
  costMinor: 900_000_000,
  valueMinor: 1_420_000_000,
  fields: { loc: 'Bintaro', land: '120', bldg: '90', source: 'Pembelian' },
};

describe('kas', () => {
  it('reports what the account held on 31 December', () => {
    const rows = coretaxRows(YEAR, inputs({ cash: [bca] }), settings());

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ section: 'kas', code: '012', name: 'BCA Tahapan', balanceMinor: 50_000_000, valueMinor: 50_000_000 });
  });

  it('converts a foreign account at the KMK rate', () => {
    const usd = { ...bca, accountId: 'citi', name: 'Citibank USD', balanceMinor: 100_000, currency: 'USD' };

    const rows = coretaxRows(YEAR, inputs({ cash: [usd] }), settings());

    // USD 1.000,00 at Rp 16.000 is Rp 16.000.000.
    expect(rows[0]!.valueMinor).toBe(16_000_000);
  });

  it('leaves a foreign account at nothing when no KMK rate was entered', () => {
    const eur = { ...bca, accountId: 'eur', name: 'EUR account', balanceMinor: 100_000, currency: 'EUR' };

    const rows = coretaxRows(YEAR, inputs({ cash: [eur] }), settings());

    expect(rows[0]).toMatchObject({ valueMinor: 0, note: expect.stringContaining('KMK') });
  });

  it('carries the fields the section asks for', () => {
    const rows = coretaxRows(YEAR, inputs({ cash: [bca] }), settings());

    expect(rows[0]!.fields).toMatchObject({ owner: 'Fandrian', inst: 'Bank Central Asia' });
  });
});

describe('holdings', () => {
  it('reports cost at what was paid and value at the 31 December price', () => {
    const rows = coretaxRows(YEAR, inputs({ holdings: [gold] }), settings());

    expect(rows).toHaveLength(1);
    // 15 g cost Rp 22.400.000 and is worth 15 × Rp 1.900.000.
    expect(rows[0]).toMatchObject({ section: 'lainnya', code: '051', costMinor: 22_400_000, valueMinor: 28_500_000 });
  });

  it('takes the earliest year when everything is on one row', () => {
    const rows = coretaxRows(YEAR, inputs({ holdings: [gold] }), settings());

    expect(rows[0]!.acquiredYear).toBe(2024);
  });

  it('splits by year of purchase when asked, and the parts add back to the whole', () => {
    const rows = coretaxRows(YEAR, inputs({ holdings: [gold] }), settings({ repeatRows: 'year' }));

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.acquiredYear)).toEqual([2024, 2026]);
    expect(rows.reduce((total, row) => total + row.costMinor, 0)).toBe(22_400_000);
    expect(rows.reduce((total, row) => total + row.valueMinor, 0)).toBe(28_500_000);
  });

  it('gives each split row its own key', () => {
    const rows = coretaxRows(YEAR, inputs({ holdings: [gold] }), settings({ repeatRows: 'year' }));

    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  it('reports nothing for a holding that was sold', () => {
    const sold = { ...gold, accountId: 'tlkm', byYear: { '2024': { unitsMicro: 0, costMinor: 0 } } };

    expect(coretaxRows(YEAR, inputs({ holdings: [sold] }), settings())).toEqual([]);
  });

  it('leaves out a year whose parcel was sold, keeping the rest', () => {
    const part = { ...gold, byYear: { '2024': { unitsMicro: 0, costMinor: 0 }, '2026': gold.byYear['2026'] } };

    const rows = coretaxRows(YEAR, inputs({ holdings: [part] }), settings({ repeatRows: 'year' }));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.acquiredYear).toBe(2026);
  });
});

describe('property and vehicles', () => {
  it('reports what was paid when the basis is cost', () => {
    const rows = coretaxRows(YEAR, inputs({ estimated: [house] }), settings({ propertyBasis: 'cost' }));

    expect(rows[0]).toMatchObject({ section: 'tidak_bergerak', costMinor: 900_000_000, valueMinor: 900_000_000 });
  });

  it('reports the estimate when the basis says so, leaving the cost alone', () => {
    const rows = coretaxRows(YEAR, inputs({ estimated: [house] }), settings({ propertyBasis: 'estimate' }));

    expect(rows[0]).toMatchObject({ costMinor: 900_000_000, valueMinor: 1_420_000_000 });
  });

  it('names the basis it used, so the choice is visible on the row', () => {
    const rows = coretaxRows(YEAR, inputs({ estimated: [house] }), settings({ propertyBasis: 'njop' }));

    expect(rows[0]!.note).toContain('njop');
  });
});

describe('piutang', () => {
  it('reports what is still owed to you', () => {
    const andi = { accountId: 'andi', name: 'Andi', code: '021', balanceMinor: 9_000_000, currency: 'IDR', fields: { name: 'Andi' } };

    const rows = coretaxRows(YEAR, inputs({ receivables: [andi] }), settings());

    expect(rows[0]).toMatchObject({ section: 'piutang', code: '021', balanceMinor: 9_000_000, valueMinor: 9_000_000 });
  });

  it('reports nothing for a debt already settled', () => {
    const settled = { accountId: 'budi', name: 'Budi', code: '021', balanceMinor: 0, currency: 'IDR', fields: {} };

    expect(coretaxRows(YEAR, inputs({ receivables: [settled] }), settings())).toEqual([]);
  });
});

describe('utang', () => {
  const kpr = { accountId: 'kpr', name: 'KPR Bintaro', code: '101', balanceMinor: 698_150_134, currency: 'IDR', note: 'Bank BTN' };
  const card = { accountId: 'card', name: 'BCA KrisFlyer', code: '102', balanceMinor: 4_000_000, currency: 'IDR', note: null };

  it('reports every debt still open, on its own table', () => {
    const rows = utangRows(YEAR, inputs({ debts: [kpr, card] }), settings());

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.section === 'utang')).toBe(true);
    expect(rows[1]).toMatchObject({ code: '102', name: 'BCA KrisFlyer', balanceMinor: 4_000_000 });
  });

  it('reports nothing for a debt cleared before 31 December', () => {
    expect(utangRows(YEAR, inputs({ debts: [{ ...kpr, balanceMinor: 0 }] }), settings())).toEqual([]);
  });

  it('keeps the lender on the row', () => {
    const rows = utangRows(YEAR, inputs({ debts: [kpr] }), settings());

    expect(rows[0]!.note).toBe('Bank BTN');
  });

  it('leaves the harta rows to the other table', () => {
    expect(coretaxRows(YEAR, inputs({ debts: [kpr] }), settings())).toEqual([]);
  });
});

describe('sectionTotals', () => {
  it('adds up the rows each section covers', () => {
    const rows = coretaxRows(YEAR, inputs({ cash: [bca], holdings: [gold], estimated: [house] }), settings());

    const totals = sectionTotals(rows);
    expect(totals.find((total) => total.section === 'kas')).toMatchObject({ valueMinor: 50_000_000 });
    expect(totals.find((total) => total.section === 'lainnya')).toMatchObject({ costMinor: 22_400_000, valueMinor: 28_500_000 });
    expect(totals.find((total) => total.section === 'tidak_bergerak')).toMatchObject({ valueMinor: 900_000_000 });
  });

  it('leaves out a section with no rows', () => {
    const totals = sectionTotals(coretaxRows(YEAR, inputs({ cash: [bca] }), settings()));

    expect(totals.map((total) => total.section)).toEqual(['kas']);
  });

  it('has nothing to add for an empty year', () => {
    expect(sectionTotals(coretaxRows(YEAR, empty, settings()))).toEqual([]);
  });
});
