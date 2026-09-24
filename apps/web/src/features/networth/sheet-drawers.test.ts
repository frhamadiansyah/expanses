import type { AccountSubtype } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { sheetDrawers } from './sheet-drawers';

const row = (accountId: string, amountMinor: number) => ({ accountId, name: accountId, amountMinor, note: null });
const types = (entries: [string, AccountSubtype][]) => new Map(entries);

describe('sheetDrawers', () => {
  it('folds the same kind of account together, however far apart the rows are', () => {
    const rows = [row('bca', 50_000_000), row('jenius', 20_000_000), row('mandiri', 5_000_000)];
    const drawers = sheetDrawers(rows, types([['bca', 'bank'], ['jenius', 'savings'], ['mandiri', 'bank']]));

    expect(drawers.map((drawer) => drawer.label)).toEqual(['Current account', 'Saving account']);
    expect(drawers[0]!.rows.map((each) => each.accountId)).toEqual(['bca', 'mandiri']);
  });

  it('adds each drawer up, so a type reads without being opened', () => {
    const rows = [row('bca', 50_000_000), row('mandiri', 5_000_000), row('jenius', 20_000_000)];
    const drawers = sheetDrawers(rows, types([['bca', 'bank'], ['mandiri', 'bank'], ['jenius', 'savings']]));

    expect(drawers.map((drawer) => drawer.totalMinor)).toEqual([55_000_000, 20_000_000]);
    // And the drawers still come to the group: folding is a drawing, not a sum of its own.
    expect(drawers.reduce((total, drawer) => total + drawer.totalMinor, 0)).toBe(75_000_000);
  });

  it('reads in the order the rows came in, so the biggest type is still first', () => {
    const rows = [row('card', 10_000_000), row('bca', 50_000_000), row('other-card', 1_000_000)];
    const drawers = sheetDrawers(rows, types([['card', 'credit_card'], ['bca', 'bank'], ['other-card', 'credit_card']]));

    expect(drawers.map((drawer) => drawer.key)).toEqual(['credit_card', 'bank']);
  });

  it('keeps a row whose account is not among them rather than dropping it', () => {
    const drawers = sheetDrawers([row('gone', 4_000_000)], types([]));

    expect(drawers).toEqual([{ key: 'other', label: 'Other', rows: [row('gone', 4_000_000)], totalMinor: 4_000_000 }]);
  });

  it('folds nothing out of nothing', () => {
    expect(sheetDrawers([], types([]))).toEqual([]);
  });
});
