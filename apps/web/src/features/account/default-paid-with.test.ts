import type { AccountRow, CardRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { defaultPaidWithKey, payableOptions, resolveDefaultPaidWith } from './default-paid-with';

const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name: id, icon: null, currency: 'IDR', valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});
const accounts = [
  account('bca', 'asset', 'bank'),
  account('old', 'asset', 'bank', { archivedAt: '2026-10-01T00:00:00Z' }),
  account('visa', 'liability', 'credit_card'),
  account('loan', 'liability', 'loan'),
  account('house', 'asset', 'property'),
];
const cards: CardRow[] = [
  { id: 'c1', accountId: 'visa', last4: '1111', holderName: 'A', isPrimary: true },
  { id: 'c2', accountId: 'visa', last4: '2222', holderName: 'B', isPrimary: false },
];

describe('the Default Paid with, read against what can pay now', () => {
  const options = payableOptions(accounts, cards);

  it('is the option it names while that is still a way to pay', () => {
    expect(resolveDefaultPaidWith('bca', options)?.accountId).toBe('bca');
    // A card on an account that carries several is named by account and card together.
    expect(resolveDefaultPaidWith('visa:c2', options)).toMatchObject({ accountId: 'visa', cardId: 'c2' });
  });

  it('reads as None when nothing is chosen', () => {
    expect(resolveDefaultPaidWith(null, options)).toBeNull();
    expect(resolveDefaultPaidWith('', options)).toBeNull();
    expect(resolveDefaultPaidWith(undefined, options)).toBeNull();
  });

  it('reads as None once the account is archived, removed, or never was a way to pay', () => {
    expect(resolveDefaultPaidWith('old', options)).toBeNull();
    expect(resolveDefaultPaidWith('gone', options)).toBeNull();
    expect(resolveDefaultPaidWith('house', options)).toBeNull();
    expect(resolveDefaultPaidWith('loan', options)).toBeNull();
    // The account alone, once it carries several cards, is no longer an option; neither is a card since removed.
    expect(resolveDefaultPaidWith('visa', options)).toBeNull();
    expect(resolveDefaultPaidWith('visa:c9', options)).toBeNull();
  });

  it('is kept per workspace', () => {
    expect(defaultPaidWithKey('a')).not.toBe(defaultPaidWithKey('b'));
  });
});
