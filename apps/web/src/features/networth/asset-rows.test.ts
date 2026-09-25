import type { AccountRow, AssetProfileRow, AssetValueRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { groupAssets, liveGroups, rowSubtitle, soldRows, staleRows, totalOf } from './asset-rows';

const value = (partial: Partial<AssetValueRow> & Pick<AssetValueRow, 'accountId' | 'name' | 'planGroup' | 'mode'>): AssetValueRow => ({
  valueMinor: 0,
  costMinor: 0,
  source: 'ledger',
  asOf: null,
  currency: 'IDR',
  coretaxCode: null,
  stale: false,
  unitsMicro: null,
  ...partial,
});

const profile = (accountId: string, partial: Partial<AssetProfileRow> = {}): AssetProfileRow => ({
  accountId,
  workspaceId: 'ws',
  reportable: true,
  taxTreatment: null,
  assetKind: 'gold',
  planGroup: 'invest',
  unitKind: 'grams',
  lotSize: null,
  risk: 'medium',
  coretaxSection: 'lainnya',
  coretaxCode: '0701',
  acquiredYear: null,
  coretaxFields: {},
  updatedAt: '2026-09-12T00:00:00Z',
  ...partial,
});

const values: AssetValueRow[] = [
  value({ accountId: 'house', name: 'House in Bintaro', planGroup: 'use', mode: 'snapshot', valueMinor: 1_420_000_000, source: 'valuation', asOf: '2026-01-15' }),
  value({ accountId: 'bca', name: 'BCA Tahapan', planGroup: 'liquid', mode: 'derived', valueMinor: 48_250_000 }),
  value({ accountId: 'gold', name: 'Antam gold bars', planGroup: 'invest', mode: 'market', valueMinor: 58_944_000, source: 'price', asOf: '2026-09-11', unitsMicro: 32_000_000 }),
  value({ accountId: 'tlkm', name: 'TLKM shares', planGroup: 'invest', mode: 'market', valueMinor: 0, source: 'cost', unitsMicro: 0, stale: true }),
];
const idrOnly = { accounts: [], baseCurrency: 'IDR', ratesToBase: {} };
const profiles = [profile('gold'), profile('bca', { assetKind: 'cash', planGroup: 'liquid', unitKind: null, risk: null, coretaxSection: 'kas', coretaxCode: '0102' })];

describe('groupAssets', () => {
  it('puts groups in balance-sheet order and drops empty ones', () => {
    expect(groupAssets(values, profiles, idrOnly).map((group) => group.group)).toEqual(['liquid', 'invest', 'use']);
  });

  it('labels each group', () => {
    expect(groupAssets(values, profiles, idrOnly).map((group) => group.label)).toEqual(['Cash & equivalents', 'Investments', 'Personal use']);
  });

  it('adds up the rows it holds', () => {
    const [liquid, invest] = groupAssets(values, profiles, idrOnly);
    expect(liquid!.totalMinor).toBe(48_250_000);
    expect(invest!.totalMinor).toBe(58_944_000);
    expect(totalOf(groupAssets(values, profiles, idrOnly))).toEqual({ totalMinor: 48_250_000 + 58_944_000 + 1_420_000_000, missing: [] });
  });

  it('marks a holding with no units as sold and leaves it out of the total', () => {
    const groups = groupAssets(values, profiles, idrOnly);
    expect(soldRows(groups).map((row) => row.name)).toEqual(['TLKM shares']);
    expect(liveGroups(groups).flatMap((group) => group.rows).map((row) => row.accountId)).toEqual(['bca', 'gold', 'house']);
  });

  it('names how each value was worked out', () => {
    const rows = groupAssets(values, profiles, idrOnly).flatMap((group) => group.rows);
    expect(rows.find((row) => row.accountId === 'bca')!.method).toBe('Ledger balance');
    expect(rows.find((row) => row.accountId === 'gold')!.method).toBe('Units × price');
    expect(rows.find((row) => row.accountId === 'house')!.method).toBe('Your estimate');
  });

  it('shows the Coretax code and table when the asset has a profile', () => {
    const rows = groupAssets(values, profiles, idrOnly).flatMap((group) => group.rows);
    expect(rows.find((row) => row.accountId === 'gold')!.coretax).toBe('0701 · Harta Lainnya');
    expect(rows.find((row) => row.accountId === 'house')!.coretax).toBe('');
  });

  it('lists what needs a fresh price, ignoring sold holdings', () => {
    const withStale = values.map((row) => (row.accountId === 'gold' ? { ...row, stale: true } : row));
    expect(staleRows(groupAssets(withStale, profiles, idrOnly)).map((row) => row.name)).toEqual(['Antam gold bars']);
  });
});

describe('an account with pockets, and totals across currencies', () => {
  const liquid = (accountId: string, name: string, currency: string, valueMinor: number) =>
    ({ ...values[0]!, accountId, name, currency, valueMinor, planGroup: 'liquid', mode: 'derived', stale: false, unitsMicro: null }) as AssetValueRow;
  const rows = [liquid('usd', 'Valas · USD', 'USD', 240_000), liquid('sgd', 'Valas · SGD', 'SGD', 115_000), liquid('idr', 'Valas · IDR', 'IDR', 5_400_000), liquid('cash', 'Cash', 'IDR', 1_000_000)];
  const accounts = [
    { id: 'valas', name: 'Valas', parentId: null, kind: 'asset', subtype: 'savings', archivedAt: null },
    { id: 'usd', name: 'Valas · USD', parentId: 'valas', kind: 'asset', subtype: 'savings', archivedAt: null },
    { id: 'sgd', name: 'Valas · SGD', parentId: 'valas', kind: 'asset', subtype: 'savings', archivedAt: null },
    { id: 'idr', name: 'Valas · IDR', parentId: 'valas', kind: 'asset', subtype: 'savings', archivedAt: null },
    { id: 'cash', name: 'Cash', parentId: null, kind: 'asset', subtype: 'cash', archivedAt: null },
  ] as AccountRow[];
  const grouping = { accounts, baseCurrency: 'IDR', ratesToBase: { USD: 16_250, SGD: 12_680 } };

  it('shows the pockets as one row for their account, at the ≈ total', () => {
    const [cash] = groupAssets(rows, [], grouping);
    expect(cash!.rows.map((row) => [row.accountId, row.name, row.valueMinor, row.currency, row.pockets])).toEqual([
      ['valas', 'Valas', 58_982_000, 'IDR', 3],
      ['cash', 'Cash', 1_000_000, 'IDR', null],
    ]);
  });

  it('converts the group total instead of adding minor units of three currencies', () => {
    // Raw addition would say 6.755.000.
    expect(groupAssets(rows, [], grouping)[0]).toMatchObject({ totalMinor: 59_982_000, missing: [] });
    expect(totalOf(groupAssets(rows, [], grouping))).toEqual({ totalMinor: 59_982_000, missing: [] });
  });

  it('gives no total when a rate is missing, and names it', () => {
    const groups = groupAssets(rows, [], { ...grouping, ratesToBase: { USD: 16_250 } });
    expect(groups[0]).toMatchObject({ totalMinor: null, missing: ['SGD'] });
    expect(groups[0]!.rows[0]).toMatchObject({ accountId: 'valas', pockets: 3, missing: ['SGD'] });
    expect(totalOf(groups)).toEqual({ totalMinor: null, missing: ['SGD'] });
  });
});

describe('a foreign asset that is not a pocket', () => {
  const fund = { ...values[1]!, accountId: 'fund', name: 'Dollar fund', currency: 'USD', valueMinor: 100_050 } as AssetValueRow;
  const idr = { ...values[1]!, accountId: 'bca', valueMinor: 1_000_000 } as AssetValueRow;

  it('is converted into the total, not added as rupiah', () => {
    // $1.000,50 at 16.250 = 16.258.125; raw addition would say 1.100.050.
    const groups = groupAssets([fund, idr], [], { accounts: [], baseCurrency: 'IDR', ratesToBase: { USD: 16_250 } });
    expect(totalOf(groups)).toEqual({ totalMinor: 17_258_125, missing: [] });
    // The row itself stays in its own currency.
    expect(groups[0]!.rows[0]).toMatchObject({ accountId: 'fund', valueMinor: 100_050, currency: 'USD', pockets: null, missing: [] });
  });

  it('without a rate leaves the total blank and names the currency', () => {
    expect(totalOf(groupAssets([fund, idr], [], { accounts: [], baseCurrency: 'IDR', ratesToBase: {} }))).toEqual({ totalMinor: null, missing: ['USD'] });
  });
});

describe('a deposit with something due', () => {
  it('says Due quietly in its subtitle, and nothing else changes', () => {
    const due = groupAssets(values, profiles, { ...idrOnly, due: new Set(['bca']) }).flatMap((group) => group.rows);
    const bca = due.find((row) => row.accountId === 'bca')!;
    expect(bca.due).toBe(true);
    expect(rowSubtitle(bca)).toBe('Ledger balance · 0102 · Kas dan Setara Kas · Due');
    expect(rowSubtitle(due.find((row) => row.accountId === 'gold')!)).not.toContain('Due');
    expect(due.find((row) => row.accountId === 'gold')!.due).toBe(false);
    // Without the set, as every other caller passes it: nobody is due.
    expect(groupAssets(values, profiles, idrOnly).flatMap((group) => group.rows).some((row) => row.due)).toBe(false);
  });

  it('keeps the other markers where they were', () => {
    const rows = groupAssets(values, profiles, idrOnly).flatMap((group) => group.rows);
    expect(rowSubtitle(rows.find((row) => row.accountId === 'tlkm')!)).toBe('Units × price · Sold');
    const stale = groupAssets(values.map((row) => (row.accountId === 'gold' ? { ...row, stale: true } : row)), profiles, idrOnly).flatMap((group) => group.rows);
    expect(rowSubtitle(stale.find((row) => row.accountId === 'gold')!)).toBe('Units × price · 0701 · Harta Lainnya · Update price');
  });
});
