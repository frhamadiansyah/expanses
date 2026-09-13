import { describe, expect, it } from 'vitest';
import { type IncomeHolding, investmentIncomeFor, type TradeRecord } from '../src/index';

const YEAR = 2026;

const holdings: IncomeHolding[] = [
  { accountId: 'bbri', name: 'BBRI shares', assetKind: 'stock', currency: 'IDR' },
  { accountId: 'ori', name: 'ORI023', assetKind: 'bond', currency: 'IDR' },
  { accountId: 'fund', name: 'Equity fund', assetKind: 'fund', currency: 'IDR' },
  { accountId: 'vti', name: 'VTI', assetKind: 'stock', currency: 'USD' },
  { accountId: 'gold', name: 'Antam gold', assetKind: 'gold', currency: 'IDR' },
];

const trade = (partial: Partial<TradeRecord> & Pick<TradeRecord, 'id' | 'accountId' | 'kind'>): TradeRecord => ({
  occurredOn: '2026-05-05',
  createdAt: '2026-05-05T00:00:00Z',
  unitsMicro: 0,
  grossMinor: 0,
  feeMinor: 0,
  taxMinor: 0,
  ...partial,
});

const income = (input: { trades: TradeRecord[] }) => investmentIncomeFor({ ...input, holdings, year: YEAR, baseCurrency: 'IDR' });

describe('what each holding paid', () => {
  it('calls a share income a dividend and a bond income a coupon', () => {
    const rows = income({
      trades: [
        trade({ id: 't1', accountId: 'bbri', kind: 'income', grossMinor: 1_000_000, taxMinor: 100_000 }),
        trade({ id: 't2', accountId: 'ori', kind: 'income', grossMinor: 600_000, taxMinor: 60_000 }),
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({ name: 'BBRI shares', kind: 'dividend', grossMinor: 1_000_000, taxMinor: 100_000 }),
      expect.objectContaining({ name: 'ORI023', kind: 'coupon', grossMinor: 600_000, taxMinor: 60_000 }),
    ]);
  });

  it('calls a fund income a distribution', () => {
    const rows = income({ trades: [trade({ id: 't1', accountId: 'fund', kind: 'income', grossMinor: 250_000, taxMinor: 25_000 })] });

    expect(rows[0]).toMatchObject({ kind: 'distribution' });
  });

  it('keeps a sale apart from income, with the tax the broker withheld', () => {
    const rows = income({
      trades: [
        trade({ id: 't1', accountId: 'bbri', kind: 'income', grossMinor: 1_000_000, taxMinor: 100_000 }),
        trade({ id: 't2', accountId: 'bbri', kind: 'sell', grossMinor: 20_000_000, taxMinor: 20_000 }),
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.kind === 'sale')).toMatchObject({ grossMinor: 20_000_000, taxMinor: 20_000 });
  });

  it('adds up several payments from the same holding', () => {
    const rows = income({
      trades: [
        trade({ id: 't1', accountId: 'ori', kind: 'income', grossMinor: 600_000, taxMinor: 60_000 }),
        trade({ id: 't2', accountId: 'ori', kind: 'income', occurredOn: '2026-11-05', grossMinor: 600_000, taxMinor: 60_000 }),
      ],
    });

    expect(rows).toEqual([expect.objectContaining({ name: 'ORI023', grossMinor: 1_200_000, taxMinor: 120_000 })]);
  });
});

describe('what it leaves out', () => {
  it('counts only the year asked for', () => {
    const rows = income({
      trades: [
        trade({ id: 't1', accountId: 'ori', kind: 'income', occurredOn: '2025-12-31', grossMinor: 600_000 }),
        trade({ id: 't2', accountId: 'ori', kind: 'income', occurredOn: '2027-01-01', grossMinor: 600_000 }),
      ],
    });

    expect(rows).toEqual([]);
  });

  it('ignores buys and unit changes, which pay nothing', () => {
    const rows = income({
      trades: [
        trade({ id: 't1', accountId: 'bbri', kind: 'buy', grossMinor: 5_000_000 }),
        trade({ id: 't2', accountId: 'bbri', kind: 'unit_change', unitsMicro: 1_000_000 }),
      ],
    });

    expect(rows).toEqual([]);
  });

  it('drops a row that paid nothing and withheld nothing', () => {
    expect(income({ trades: [trade({ id: 't1', accountId: 'bbri', kind: 'income' })] })).toEqual([]);
  });

  it('says nothing about a holding it does not know', () => {
    const rows = income({ trades: [trade({ id: 't1', accountId: 'mystery', kind: 'income', grossMinor: 100_000 })] });

    expect(rows[0]).toMatchObject({ kind: 'other', name: 'mystery' });
  });
});

describe('holdings abroad', () => {
  it('marks them, because they are not taxed as final here', () => {
    const rows = income({ trades: [trade({ id: 't1', accountId: 'vti', kind: 'income', grossMinor: 1_400_000, taxMinor: 210_000 })] });

    expect(rows[0]).toMatchObject({ name: 'VTI', foreign: true, kind: 'dividend' });
  });

  it('leaves a holding in the base currency unmarked', () => {
    const rows = income({ trades: [trade({ id: 't1', accountId: 'gold', kind: 'sell', grossMinor: 9_000_000 })] });

    expect(rows[0]).toMatchObject({ foreign: false, kind: 'sale' });
  });
});

describe('how each row is taxed', () => {
  it('carries the treatment the owner set on the holding', () => {
    const rows = investmentIncomeFor({
      trades: [trade({ id: 't1', accountId: 'ori', kind: 'income', grossMinor: 600_000, taxMinor: 60_000 })],
      holdings: [{ accountId: 'ori', name: 'ORI023', assetKind: 'bond', currency: 'IDR', treatment: 'final' }],
      year: YEAR,
      baseCurrency: 'IDR',
    });

    expect(rows[0]).toMatchObject({ treatment: 'final' });
  });

  it('leaves a holding nobody has set as unset, rather than guessing from what it is', () => {
    const rows = income({ trades: [trade({ id: 't1', accountId: 'ori', kind: 'income', grossMinor: 600_000 })] });

    expect(rows[0]!.treatment).toBeNull();
  });

  it('puts a reinvested dividend outside the objects of tax', () => {
    const rows = investmentIncomeFor({
      trades: [trade({ id: 't1', accountId: 'bbri', kind: 'income', grossMinor: 600_000, taxMinor: 0, reinvestedMinor: 600_000, reinvestedIntoAccountId: 'ori' })],
      holdings: [
        { accountId: 'bbri', name: 'BBRI shares', assetKind: 'stock', currency: 'IDR', treatment: 'final' },
        { accountId: 'ori', name: 'ORI023', assetKind: 'bond', currency: 'IDR', treatment: 'final' },
      ],
      year: YEAR,
      baseCurrency: 'IDR',
    });

    expect(rows).toEqual([expect.objectContaining({ name: 'BBRI shares', treatment: 'not_object', grossMinor: 600_000 })]);
  });

  it('splits a dividend reinvested in part, so the rest is still taxed as the holding says', () => {
    const rows = investmentIncomeFor({
      trades: [trade({ id: 't1', accountId: 'bbri', kind: 'income', grossMinor: 600_000, taxMinor: 20_000, reinvestedMinor: 400_000, reinvestedIntoAccountId: 'ori' })],
      holdings: [
        { accountId: 'bbri', name: 'BBRI shares', assetKind: 'stock', currency: 'IDR', treatment: 'final' },
        { accountId: 'ori', name: 'ORI023', assetKind: 'bond', currency: 'IDR', treatment: 'final' },
      ],
      year: YEAR,
      baseCurrency: 'IDR',
    });

    const reinvested = rows.find((row) => row.treatment === 'not_object')!;
    const taxed = rows.find((row) => row.treatment === 'final')!;
    expect(reinvested).toMatchObject({ grossMinor: 400_000, taxMinor: 0 });
    // The tax that was withheld belongs to the part that was not reinvested.
    expect(taxed).toMatchObject({ grossMinor: 200_000, taxMinor: 20_000 });
  });

  it('says where a reinvestment went, so it can be shown against the harta', () => {
    const rows = investmentIncomeFor({
      trades: [trade({ id: 't1', accountId: 'bbri', kind: 'income', grossMinor: 600_000, reinvestedMinor: 600_000, reinvestedIntoAccountId: 'ori' })],
      holdings: [
        { accountId: 'bbri', name: 'BBRI shares', assetKind: 'stock', currency: 'IDR', treatment: 'final' },
        { accountId: 'ori', name: 'ORI023', assetKind: 'bond', currency: 'IDR', treatment: 'final' },
      ],
      year: YEAR,
      baseCurrency: 'IDR',
    });

    expect(rows[0]!.reinvestedInto).toEqual([{ accountId: 'ori', name: 'ORI023', amountMinor: 600_000 }]);
  });

  it('ignores a reinvestment bigger than the payment, which is a typing mistake', () => {
    const rows = investmentIncomeFor({
      trades: [trade({ id: 't1', accountId: 'bbri', kind: 'income', grossMinor: 600_000, reinvestedMinor: 900_000 })],
      holdings: [{ accountId: 'bbri', name: 'BBRI shares', assetKind: 'stock', currency: 'IDR', treatment: 'final' }],
      year: YEAR,
      baseCurrency: 'IDR',
    });

    expect(rows).toEqual([expect.objectContaining({ treatment: 'not_object', grossMinor: 600_000 })]);
  });

  it('never treats a sale as reinvested, whatever is on the record', () => {
    const rows = investmentIncomeFor({
      trades: [trade({ id: 't1', accountId: 'bbri', kind: 'sell', grossMinor: 5_000_000, taxMinor: 5_000, reinvestedMinor: 5_000_000 })],
      holdings: [{ accountId: 'bbri', name: 'BBRI shares', assetKind: 'stock', currency: 'IDR', treatment: 'final' }],
      year: YEAR,
      baseCurrency: 'IDR',
    });

    expect(rows).toEqual([expect.objectContaining({ kind: 'sale', treatment: 'final', grossMinor: 5_000_000 })]);
  });
});
