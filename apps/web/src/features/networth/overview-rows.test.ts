import type { AssetValueRow, NetWorthPoint, TradeTemplateRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { attentionItems, deltaSince, monthsSinceJanuary } from './overview-rows';

const value = (partial: Partial<AssetValueRow> & Pick<AssetValueRow, 'accountId' | 'name' | 'mode'>): AssetValueRow => ({
  valueMinor: 1_000_000,
  costMinor: 1_000_000,
  source: 'ledger',
  asOf: null,
  currency: 'IDR',
  planGroup: 'invest',
  stale: false,
  unitsMicro: null,
  ...partial,
});

const template = (id: string, accountId: string): TradeTemplateRow => ({
  id,
  workspaceId: 'ws',
  accountId,
  cashAccountId: 'bca',
  amountMinor: 2_000_000,
  unitsMicro: null,
  dayOfMonth: 5,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
});

const point = (month: string, netWorthMinor: number): NetWorthPoint => ({ month, onDate: `${month}-28`, assetsMinor: netWorthMinor, liabilitiesMinor: 0, netWorthMinor });

describe('attentionItems', () => {
  it('says nothing when every value is fresh', () => {
    expect(attentionItems([value({ accountId: 'gold', name: 'Antam gold bars', mode: 'market', unitsMicro: 32_000_000 })], [])).toEqual([]);
  });

  it('names a holding whose price has gone stale, with the date', () => {
    const items = attentionItems([value({ accountId: 'gold', name: 'Antam gold bars', mode: 'market', unitsMicro: 32_000_000, stale: true, source: 'price', asOf: '2026-08-11' })], []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tone: 'warn', action: 'Update', to: '/net-worth/assets' });
    expect(items[0]!.text).toContain('Antam gold bars');
    expect(items[0]!.text).toContain('11 Aug 2026');
  });

  it('says when a holding has no price at all', () => {
    const items = attentionItems([value({ accountId: 'gold', name: 'Antam gold bars', mode: 'market', unitsMicro: 32_000_000, stale: true, source: 'cost' })], []);
    expect(items[0]!.text).toContain('no price yet');
  });

  it('calls a property value an estimate', () => {
    const items = attentionItems([value({ accountId: 'house', name: 'House in Bintaro', mode: 'snapshot', stale: true, source: 'valuation', asOf: '2025-01-15', planGroup: 'use' })], []);
    expect(items[0]!.text).toContain('estimate last updated');
  });

  it('leaves sold holdings alone', () => {
    const items = attentionItems([value({ accountId: 'tlkm', name: 'TLKM shares', mode: 'market', unitsMicro: 0, stale: true, source: 'cost' })], []);
    expect(items).toEqual([]);
  });

  it('lists a monthly buy that is due, by name', () => {
    const items = attentionItems([value({ accountId: 'fund', name: 'Equity fund', mode: 'market', unitsMicro: 1_000_000 })], [template('t1', 'fund')]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tone: 'warn', action: 'Record', to: '/net-worth/trades' });
    expect(items[0]!.text).toContain('Equity fund');
  });

  it('gives every item its own key', () => {
    const items = attentionItems(
      [
        value({ accountId: 'gold', name: 'Antam gold bars', mode: 'market', unitsMicro: 32_000_000, stale: true, source: 'price', asOf: '2026-08-11' }),
        value({ accountId: 'fund', name: 'Equity fund', mode: 'market', unitsMicro: 1_000_000 }),
      ],
      [template('t1', 'fund')],
    );
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });
});

describe('deltaSince', () => {
  const points = [point('2026-06', 1_000_000_000), point('2026-07', 1_100_000_000), point('2026-08', 1_150_000_000), point('2026-09', 1_200_000_000)];

  it('measures against the month asked for', () => {
    expect(deltaSince(points, 1)).toBe(50_000_000);
    expect(deltaSince(points, 3)).toBe(200_000_000);
  });

  it('is null when the series does not reach back that far', () => {
    expect(deltaSince(points, 12)).toBeNull();
    expect(deltaSince([], 1)).toBeNull();
  });
});

describe('monthsSinceJanuary', () => {
  it('counts back to January of the last point year', () => {
    const points = ['2026-01', '2026-02', '2026-03'].map((month) => point(month, 1));
    expect(monthsSinceJanuary(points)).toBe(2);
  });

  it('is null when January is not in the series', () => {
    const points = ['2025-11', '2025-12'].map((month) => point(month, 1));
    expect(monthsSinceJanuary(points)).toBeNull();
  });
});
