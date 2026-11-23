import type { NeedsPlanRow } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { budgetTiles as tilesOf } from './budget-tiles';

/** The tiles with plain spaces: Intl puts a no-break space after "Rp" below a million. */
const budgetTiles = (...args: Parameters<typeof tilesOf>) =>
  tilesOf(...args).map((tile) => (tile.tag ? { ...tile, tag: { ...tile.tag, text: tile.tag.text.replace(/\u00a0/g, ' ') } } : tile));

const row = (key: NeedsPlanRow['key'], usedMinor: number, plannedMinor: number | null): NeedsPlanRow => ({ key, usedMinor, plannedMinor, warn: false, fill: 0 });

// Invented figures.
describe('budgetTiles', () => {
  it('says what is left of Essential and Lifestyle, red once over', () => {
    const [essential, lifestyle] = budgetTiles([row('essential', 8_205_000, 11_000_000), row('lifestyle', 3_110_000, 3_000_000)], 'IDR');
    expect(essential).toEqual({ key: 'essential', usedMinor: 8_205_000, plannedMinor: 11_000_000, tag: { text: 'Rp 2,8 jt left', tone: 'side' } });
    expect(lifestyle!.tag).toEqual({ text: 'Rp 110.000 over', tone: 'over' });
  });

  it('reads nothing left as Rp 0 left, not over', () => {
    expect(budgetTiles([row('essential', 500_000, 500_000)], 'IDR')[0]!.tag).toEqual({ text: 'Rp 0 left', tone: 'side' });
  });

  it('says what Debts & savings still has to go, On plan once reached, red below nought', () => {
    const tiles = budgetTiles([row('debtsSavings', 1_850_000, 6_000_000)], 'IDR');
    expect(tiles[0]!.tag).toEqual({ text: 'Rp 4,15 jt to go', tone: 'side' });
    expect(budgetTiles([row('debtsSavings', 6_400_000, 6_000_000)], 'IDR')[0]!.tag).toEqual({ text: 'On plan', tone: 'side' });
    expect(budgetTiles([row('debtsSavings', -250_000, 6_000_000)], 'IDR')[0]!.tag).toEqual({ text: 'Rp 6,25 jt to go', tone: 'over' });
  });

  it('has no tag for a side with no plan', () => {
    expect(budgetTiles([row('lifestyle', 420_000, null)], 'IDR')[0]!.tag).toBeNull();
  });
});
