import { describe, expect, it } from 'vitest';
import type { ReceivedItem } from './joint-rows';
import { sharedAssetGroups } from './shared-assets';

const item = (over: Partial<ReceivedItem>): ReceivedItem =>
  ({ itemId: 'i1', owner: 'rina', kind: 'asset', subtype: 'bank', name: 'Rina Bank', currency: 'IDR', balanceMinor: 1000, asOf: '2026-10-01', ...over }) as ReceivedItem;
const group = { me: 'dewi', members: ['rina', 'dewi'] };

describe('sharedAssetGroups', () => {
  it('lists only the owner’s shared assets under their name, never debts or my own', () => {
    const groups = sharedAssetGroups({
      group,
      names: { rina: 'Rina', dewi: 'Dewi' },
      items: [item({ itemId: 'b', name: 'B' }), item({ itemId: 'a', name: 'A' }), item({ itemId: 'c', kind: 'liability', subtype: 'credit_card', name: 'Card' }), item({ itemId: 'm', owner: 'dewi', name: 'Mine' })],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.header).toBe('Shared by Rina');
    expect(groups[0]!.items.map((each) => each.name)).toEqual(['A', 'B']);
  });
  it('names an unnamed member Someone', () => {
    expect(sharedAssetGroups({ group, names: {}, items: [item({})] })[0]!.header).toBe('Shared by Someone');
  });
  it('is empty with nothing shared or no group', () => {
    expect(sharedAssetGroups(null)).toEqual([]);
    expect(sharedAssetGroups({ group, names: {}, items: [] })).toEqual([]);
  });
});
