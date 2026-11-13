import { describe, expect, it } from 'vitest';
import { jointWithPockets } from './joint-pockets';

/*
 * A joint account's pockets are joint too, for Cashflow's transfer rule (owner 2026-11-13): a transfer into the USD
 * pocket of a joint account is the household's, as one into the account is. Display only; invented ids.
 */
const accounts = [
  { id: 'joint', parentId: null },
  { id: 'joint-usd', parentId: 'joint' },
  { id: 'joint-sgd', parentId: 'joint' },
  { id: 'own', parentId: null },
  { id: 'own-usd', parentId: 'own' },
  { id: 'other', parentId: null },
  { id: 'other-eur', parentId: 'other' },
];

describe('jointWithPockets', () => {
  it('adds every pocket of a joint account', () => {
    expect([...jointWithPockets(new Set(['joint']), accounts)].sort()).toEqual(['joint', 'joint-sgd', 'joint-usd']);
  });

  it('a joint pocket makes its account joint, and so its other pockets', () => {
    expect([...jointWithPockets(new Set(['other-eur']), accounts)].sort()).toEqual(['other', 'other-eur']);
  });

  it('leaves own accounts and their pockets alone', () => {
    const joint = jointWithPockets(new Set(['joint']), accounts);
    expect(joint.has('own')).toBe(false);
    expect(joint.has('own-usd')).toBe(false);
  });

  it('is empty with nothing joint', () => expect(jointWithPockets(new Set(), accounts).size).toBe(0));
});
