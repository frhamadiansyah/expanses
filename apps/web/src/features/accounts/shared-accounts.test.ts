import type { ItemSummary } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { assetKindTile, debtKindTile } from '../ownables/catalogue-view';
import { rowKindOf } from '../networth/sheet-drawers';
import { itemTile, sharedSections } from './shared-accounts';

const item = (over: Partial<ItemSummary> & { itemId: string }): ItemSummary & { itemId: string } => ({
  owner: 'm-andi',
  kind: 'asset',
  subtype: 'bank',
  name: 'Andi BCA',
  currency: 'IDR',
  balanceMinor: 1_000,
  asOf: '2026-09-30',
  card: null,
  period: { start: '2026-09-01', end: '2026-09-30' },
  openingMinor: 0,
  householdMinor: 0,
  otherUseMinor: 0,
  transferMinor: 0,
  transfers: [],
  monthEnds: [],
  tax: null,
  ...over,
});

describe('sharedSections (joint-net-worth §8.2: separate → "Andi\'s, shared" in Accounts)', () => {
  const names = { 'm-rina': 'Rina', 'm-andi': 'Andi', 'm-budi': 'Budi' };
  const members = ['m-rina', 'm-andi', 'm-budi'];

  it('lists each other member’s shared items under their name, in the group’s order', () => {
    const sections = sharedSections('separate', members, names, [
      item({ itemId: 'b1', owner: 'm-budi', name: 'Budi cash', subtype: 'cash' }),
      item({ itemId: 'a1', name: 'Andi BCA' }),
      item({ itemId: 'a2', name: 'Andi Visa', kind: 'liability', subtype: 'credit_card', balanceMinor: 500 }),
    ]);
    expect(sections.map((s) => [s.owner, s.title, s.items.map((i) => i.itemId)])).toEqual([
      ['m-andi', "Andi's, shared", ['a1', 'a2']],
      ['m-budi', "Budi's, shared", ['b1']],
    ]);
    expect(sections[0]!.items[1]).toMatchObject({ name: 'Andi Visa', kindLabel: 'Credit card', minor: 500, currency: 'IDR' });
    // Each owner's initial wears their own colour, the one the household's Net worth gives them on both phones.
    expect(sections.map((s) => [s.ownerName, s.colour])).toEqual([
      ['Andi', 'var(--owner-2)'],
      ['Budi', 'var(--owner-3)'],
    ]);
    expect(typeof sections[0]!.items[1]!.tile).not.toBe('undefined');
  });

  it('is empty in joint mode, where the items are the household’s Net worth instead', () => {
    expect(sharedSections('joint', members, names, [item({ itemId: 'a1' })])).toEqual([]);
  });
});

describe('itemTile (the partner page wears the drawing its row wears)', () => {
  it('reads the sent sheet facts: gold wears gold’s drawing, a home loan a house’s, a paylater its own', () => {
    const goldKind = rowKindOf('other', { accountId: 'x', code: '0701' }, () => 'investment').key;
    expect(itemTile({ kind: 'asset', subtype: 'investment', sheet: { code: '0701' } })).toBe(assetKindTile('other', goldKind));
    expect(itemTile({ kind: 'liability', subtype: 'loan', sheet: { icon: 'home' } })).toBe(debtKindTile('home_mortgage'));
    expect(itemTile({ kind: 'liability', subtype: 'loan', sheet: { item: 'online_loan', icon: 'loan' } })).toBe(debtKindTile('online_loan'));
    // From an older build, with no sheet: by its subtype alone, as before.
    expect(itemTile({ kind: 'liability', subtype: 'credit_card' })).toBe(debtKindTile('credit_card'));
  });
});
