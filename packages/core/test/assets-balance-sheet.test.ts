import { describe, expect, it } from 'vitest';
import { balanceSheet, type SheetAsset, type SheetLiability } from '../src/index';
const asset = (accountId: string, name: string, planGroup: SheetAsset['planGroup'], valueMinor: number, subtype = 'bank'): SheetAsset => ({ accountId, name, planGroup, valueMinor, subtype });

const assets: SheetAsset[] = [
  asset('house', 'House in Bintaro', 'use', 1_420_000_000, 'property'),
  asset('bca', 'BCA Tahapan', 'liquid', 48_250_000),
  asset('fund', 'Sucorinvest fund', 'invest', 58_944_000, 'investment'),
  asset('depo', 'BCA time deposit', 'liquid', 100_000_000, 'time_deposit'),
];

const card: SheetLiability = { accountId: 'card', name: 'BCA KrisFlyer', subtype: 'credit_card', balanceMinor: 14_820_000, dueWithinYearMinor: 14_820_000, note: 'Statement 28 Aug' };
const kpr: SheetLiability = { accountId: 'kpr', name: 'KPR Bintaro', subtype: 'loan', balanceMinor: 742_300_000, dueWithinYearMinor: 0, note: null };

describe('balanceSheet', () => {
  it('groups assets in balance-sheet order and drops empty groups', () => {
    const sheet = balanceSheet(assets, []);
    expect(sheet.assetGroups.map((group) => group.key)).toEqual(['liquid', 'invest', 'immovable']);
    expect(sheet.assetGroups.map((group) => group.label)).toEqual(['Cash & equivalents', 'Investments', 'Immovable property']);
  });

  it('adds up each group and the assets total', () => {
    const sheet = balanceSheet(assets, []);
    expect(sheet.assetGroups[0]!.totalMinor).toBe(148_250_000);
    expect(sheet.assetGroups[1]!.totalMinor).toBe(58_944_000);
    expect(sheet.assetsTotalMinor).toBe(148_250_000 + 58_944_000 + 1_420_000_000);
  });

  it('keeps assets in the order given inside a group', () => {
    const sheet = balanceSheet(assets, []);
    expect(sheet.assetGroups[0]!.rows.map((row) => row.accountId)).toEqual(['bca', 'depo']);
  });

  it('draws the assets in the catalogue’s own categories, not the plan groups', () => {
    const gold: SheetAsset = { accountId: 'gold', name: 'UBS gold 10g', planGroup: 'invest', valueMinor: 49_200_000, code: '0701', subtype: 'investment' };
    const budi: SheetAsset = { accountId: 'budi', name: 'Budi', planGroup: 'owed', valueMinor: 2_000_000, code: '0201', subtype: 'receivable' };
    const sheet = balanceSheet([...assets, gold, budi], []);

    expect(sheet.assetGroups.map((group) => group.label)).toEqual([
      'Cash & equivalents',
      'Receivables',
      'Investments',
      'Immovable property',
      'Intangible and other',
    ]);
    // Gold leaves Investments for the family the catalogue puts it in, and money owed to you is a category of its own.
    expect(sheet.assetGroups.find((group) => group.key === 'other')!.rows.map((row) => row.name)).toEqual(['UBS gold 10g']);
    expect(sheet.assetGroups.find((group) => group.key === 'receivable')!.rows.map((row) => row.name)).toEqual(['Budi']);
    expect(sheet.assetGroups.find((group) => group.key === 'invest')!.rows.map((row) => row.name)).not.toContain('UBS gold 10g');
    // The rows keep the code they were opened under: what a listing groups a share by is this, not "Investment".
    expect(sheet.assetGroups.find((group) => group.key === 'invest')!.rows[0]!.code).toBeNull();
    expect(sheet.assetGroups.find((group) => group.key === 'other')!.rows[0]!.code).toBe('0701');
  });

  it('reads a row the catalogue cannot name by the kind of account it is', () => {
    const unknown = (accountId: string, subtype: string, code: string | null): SheetAsset => ({ accountId, name: accountId, planGroup: 'use', valueMinor: 1_000, subtype, code });
    const sheet = balanceSheet(
      [unknown('x', 'property', '9999'), unknown('y', 'vehicle', null), unknown('z', 'bank', null)],
      [],
    );

    // A code nothing knows does not make a house into money: the account it is decides, and a car is movable.
    expect(sheet.assetGroups.map((group) => group.key)).toEqual(['liquid', 'movable', 'immovable']);
    expect(sheet.assetGroups.map((group) => group.rows.map((row) => row.name))).toEqual([['z'], ['y'], ['x']]);
  });

  it('puts a credit card entirely in due within a year', () => {
    const sheet = balanceSheet(assets, [card]);
    expect(sheet.shortTerm.rows.map((row) => row.accountId)).toEqual(['card']);
    expect(sheet.shortTerm.totalMinor).toBe(14_820_000);
    expect(sheet.longTerm.rows).toEqual([]);
  });

  it('treats a loan with no principal due in a year as long-term', () => {
    const sheet = balanceSheet(assets, [kpr]);
    expect(sheet.longTerm.rows.map((row) => row.accountId)).toEqual(['kpr']);
    expect(sheet.longTerm.totalMinor).toBe(742_300_000);
    expect(sheet.shortTerm.rows).toEqual([]);
  });

  it('splits a loan across both groups and keeps its note on each side', () => {
    const split: SheetLiability = { ...kpr, dueWithinYearMinor: 30_000_000, note: '174 months left' };
    const sheet = balanceSheet(assets, [split]);
    expect(sheet.shortTerm.rows).toEqual([{ accountId: 'kpr', name: 'KPR Bintaro', amountMinor: 30_000_000, note: '174 months left' }]);
    expect(sheet.longTerm.rows).toEqual([{ accountId: 'kpr', name: 'KPR Bintaro', amountMinor: 712_300_000, note: '174 months left' }]);
    expect(sheet.liabilitiesTotalMinor).toBe(742_300_000);
  });

  it('names a debt once in the list of what is owed, whole, however its schedule splits it', () => {
    const split: SheetLiability = { ...kpr, dueWithinYearMinor: 30_000_000, note: '174 months left' };
    const sheet = balanceSheet(assets, [card, split]);

    // Both halves are in the split, and the debt is one row: a mortgage read twice reads as two mortgages.
    expect(sheet.shortTerm.rows).toHaveLength(2);
    expect(sheet.longTerm.rows).toHaveLength(1);
    expect(sheet.debts.rows).toEqual([
      { accountId: 'card', name: 'BCA KrisFlyer', amountMinor: 14_820_000, note: 'Statement 28 Aug' },
      { accountId: 'kpr', name: 'KPR Bintaro', amountMinor: 742_300_000, note: '174 months left' },
    ]);
    // What is owed on each is what the split comes to: one money, told two ways.
    expect(sheet.debts.totalMinor).toBe(sheet.liabilitiesTotalMinor);
  });

  it('caps the part due within a year at what is owed', () => {
    const sheet = balanceSheet(assets, [{ ...kpr, dueWithinYearMinor: 999_000_000_000 }]);
    expect(sheet.shortTerm.totalMinor).toBe(742_300_000);
    expect(sheet.longTerm.rows).toEqual([]);
  });

  it('labels the two debt groups', () => {
    const sheet = balanceSheet(assets, [card, kpr]);
    expect(sheet.shortTerm.label).toBe('Due within a year');
    expect(sheet.longTerm.label).toBe('Long-term');
  });

  it('works out net worth as assets minus every debt', () => {
    const sheet = balanceSheet(assets, [card, kpr]);
    expect(sheet.liabilitiesTotalMinor).toBe(14_820_000 + 742_300_000);
    expect(sheet.netWorthMinor).toBe(sheet.assetsTotalMinor - sheet.liabilitiesTotalMinor);
  });

  it('leaves an empty sheet at zero with no groups', () => {
    const sheet = balanceSheet([], []);
    expect(sheet).toMatchObject({ assetGroups: [], assetsTotalMinor: 0, liabilitiesTotalMinor: 0, netWorthMinor: 0 });
    expect(sheet.debts.rows).toEqual([]);
    expect(sheet.shortTerm.rows).toEqual([]);
    expect(sheet.longTerm.rows).toEqual([]);
  });

  it('ignores a debt that is already paid off', () => {
    const sheet = balanceSheet(assets, [{ ...card, balanceMinor: 0, dueWithinYearMinor: 0 }]);
    expect(sheet.debts.rows).toEqual([]);
    expect(sheet.shortTerm.rows).toEqual([]);
    expect(sheet.liabilitiesTotalMinor).toBe(0);
  });
});
