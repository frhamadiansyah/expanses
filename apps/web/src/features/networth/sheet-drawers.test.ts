import type { SheetRow } from '@expanses/core';
import type { AccountSubtype } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { rowKindOf, sheetDrawers } from './sheet-drawers';

const row = (accountId: string, amountMinor: number, code: string | null = null): SheetRow => ({ accountId, name: accountId, amountMinor, note: null, code });
const types = (entries: [string, AccountSubtype][]) => new Map(entries);
/** Money is read by the kind of account a row is, which is the section `liquid` and the others' fallback. */
const byAccount = (subtypes: Map<string, AccountSubtype>) => (row: SheetRow) => rowKindOf('liquid', row, (accountId) => subtypes.get(accountId));

describe('sheetDrawers', () => {
  it('folds the same kind of account together, however far apart the rows are', () => {
    const rows = [row('bca', 50_000_000), row('jenius', 20_000_000), row('mandiri', 5_000_000)];
    const drawers = sheetDrawers(rows, byAccount(types([['bca', 'bank'], ['jenius', 'savings'], ['mandiri', 'bank']])));

    expect(drawers.map((drawer) => drawer.label)).toEqual(['Current account', 'Saving account']);
    expect(drawers[0]!.rows.map((each) => each.accountId)).toEqual(['bca', 'mandiri']);
  });

  it('adds each drawer up, so a type reads without being opened', () => {
    const rows = [row('bca', 50_000_000), row('mandiri', 5_000_000), row('jenius', 20_000_000)];
    const drawers = sheetDrawers(rows, byAccount(types([['bca', 'bank'], ['mandiri', 'bank'], ['jenius', 'savings']])));

    expect(drawers.map((drawer) => drawer.totalMinor)).toEqual([55_000_000, 20_000_000]);
    // And the drawers still come to the group: folding is a drawing, not a sum of its own.
    expect(drawers.reduce((total, drawer) => total + drawer.totalMinor, 0)).toBe(75_000_000);
  });

  it('reads in the order the rows came in, so the biggest type is still first', () => {
    const rows = [row('card', 10_000_000), row('bca', 50_000_000), row('other-card', 1_000_000)];
    const drawers = sheetDrawers(rows, byAccount(types([['card', 'credit_card'], ['bca', 'bank'], ['other-card', 'credit_card']])));

    expect(drawers.map((drawer) => drawer.key)).toEqual(['credit_card', 'bank']);
  });

  it('keeps a row whose account is not among them rather than dropping it', () => {
    const drawers = sheetDrawers([row('gone', 4_000_000)], byAccount(types([])));

    expect(drawers).toEqual([{ key: 'other', label: 'Other', rows: [row('gone', 4_000_000)], totalMinor: 4_000_000 }]);
  });

  it('folds nothing out of nothing', () => {
    expect(sheetDrawers([], byAccount(types([])))).toEqual([]);
  });
});

describe('rowKindOf', () => {
  const subtypeOf = (accountId: string) => types([['gold', 'investment'], ['bbri', 'investment'], ['bca', 'bank']]).get(accountId);

  it('reads a holding by the catalogue item it was opened as, not by its account kind', () => {
    expect(rowKindOf('invest', row('bbri', 6_270_000, '0303'), subtypeOf)).toEqual({ key: 'stock', label: 'Listed shares' });
    expect(rowKindOf('other', row('gold', 49_200_000, '0701'), subtypeOf)).toEqual({ key: 'gold', label: 'Gold bullion' });
  });

  it('reads money by the kind of account it is, even where a code came with it', () => {
    // A deposit files under `0104` like any time deposit, and its drawer says so.
    expect(rowKindOf('liquid', row('depo', 100_000_000, '0104'), (accountId) => types([['depo', 'time_deposit']]).get(accountId))).toEqual({
      key: 'time_deposit',
      label: 'Time deposit',
    });
    // And money owed to you, which is filed with the cash, is read by that name.
    expect(rowKindOf('liquid', row('budi', 2_000_000, '0201'), (accountId) => types([['budi', 'receivable']]).get(accountId))).toEqual({
      key: 'receivable',
      label: 'Receivables',
    });
  });

  it('falls back to the account kind when the catalogue does not know the code', () => {
    expect(rowKindOf('invest', row('bbri', 6_270_000, '9999'), subtypeOf)).toEqual({ key: 'investment', label: 'Investment' });
    expect(rowKindOf('invest', row('bbri', 6_270_000), subtypeOf)).toEqual({ key: 'investment', label: 'Investment' });
  });

  it('says Other for a row whose account is not there at all', () => {
    expect(rowKindOf('invest', row('gone', 1_000, '0303'), () => undefined).label).toBe('Listed shares');
    expect(rowKindOf('invest', row('gone', 1_000), () => undefined)).toEqual({ key: 'other', label: 'Other' });
  });
});
