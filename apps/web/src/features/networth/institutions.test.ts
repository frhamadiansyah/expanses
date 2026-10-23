import type { AccountRow, AssetProfileRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { institutionChoices } from './institutions';

const account = (id: string, name: string, subtype: string): AccountRow => ({ id, name, subtype, kind: 'asset', parentId: null, archivedAt: null }) as unknown as AccountRow;
const profile = (accountId: string, assetKind: string, inst?: string): AssetProfileRow =>
  ({ accountId, assetKind, coretaxFields: inst ? { inst } : {} }) as unknown as AssetProfileRow;

describe('institutionChoices', () => {
  it('offers banks by their bank name and brokers by name, never an account’s own name or a digital wallet', () => {
    const accounts = [
      account('a', 'Everyday Current', 'bank'),
      account('b', 'Rainy Day Savings', 'savings'),
      account('c', 'Pocket Wallet', 'ewallet'),
      account('d', 'Contoh Sekuritas', 'fund'),
      account('e', 'Unnamed Bank Account', 'bank'),
    ];
    const profiles = [profile('a', 'cash', 'Bank Contoh'), profile('b', 'cash', 'Bank Contoh'), profile('f', 'bond', 'Bank Lain')];
    expect(institutionChoices(accounts, profiles)).toEqual(['Bank Contoh', 'Bank Lain', 'Contoh Sekuritas']);
  });
});
