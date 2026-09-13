import type { AssetProfileRow, AssetValueRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { groupAssets, liveGroups, soldRows, staleRows, totalOf } from './asset-rows';

const value = (partial: Partial<AssetValueRow> & Pick<AssetValueRow, 'accountId' | 'name' | 'planGroup' | 'mode'>): AssetValueRow => ({
  valueMinor: 0,
  costMinor: 0,
  source: 'ledger',
  asOf: null,
  currency: 'IDR',
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
const profiles = [profile('gold'), profile('bca', { assetKind: 'cash', planGroup: 'liquid', unitKind: null, risk: null, coretaxSection: 'kas', coretaxCode: '0102' })];

describe('groupAssets', () => {
  it('puts groups in balance-sheet order and drops empty ones', () => {
    expect(groupAssets(values, profiles).map((group) => group.group)).toEqual(['liquid', 'invest', 'use']);
  });

  it('labels each group', () => {
    expect(groupAssets(values, profiles).map((group) => group.label)).toEqual(['Cash & equivalents', 'Investments', 'Personal use']);
  });

  it('adds up the rows it holds', () => {
    const [liquid, invest] = groupAssets(values, profiles);
    expect(liquid!.totalMinor).toBe(48_250_000);
    expect(invest!.totalMinor).toBe(58_944_000);
    expect(totalOf(groupAssets(values, profiles))).toBe(48_250_000 + 58_944_000 + 1_420_000_000);
  });

  it('marks a holding with no units as sold and leaves it out of the total', () => {
    const groups = groupAssets(values, profiles);
    expect(soldRows(groups).map((row) => row.name)).toEqual(['TLKM shares']);
    expect(liveGroups(groups).flatMap((group) => group.rows).map((row) => row.accountId)).toEqual(['bca', 'gold', 'house']);
  });

  it('names how each value was worked out', () => {
    const rows = groupAssets(values, profiles).flatMap((group) => group.rows);
    expect(rows.find((row) => row.accountId === 'bca')!.method).toBe('Ledger balance');
    expect(rows.find((row) => row.accountId === 'gold')!.method).toBe('Units × price');
    expect(rows.find((row) => row.accountId === 'house')!.method).toBe('Your estimate');
  });

  it('shows the Coretax code and table when the asset has a profile', () => {
    const rows = groupAssets(values, profiles).flatMap((group) => group.rows);
    expect(rows.find((row) => row.accountId === 'gold')!.coretax).toBe('0701 · Harta Lainnya');
    expect(rows.find((row) => row.accountId === 'house')!.coretax).toBe('');
  });

  it('lists what needs a fresh price, ignoring sold holdings', () => {
    const withStale = values.map((row) => (row.accountId === 'gold' ? { ...row, stale: true } : row));
    expect(staleRows(groupAssets(withStale, profiles)).map((row) => row.name)).toEqual(['Antam gold bars']);
  });
});
