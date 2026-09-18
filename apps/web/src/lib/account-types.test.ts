import { BALANCE_SUBTYPES } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_TYPES, SUBTYPE_LABELS } from './account-types';

describe('the account types someone can open', () => {
  it('offers a fund account and a digital wallet, both holding money', () => {
    const fund = ACCOUNT_TYPES.find((type) => type.subtype === 'fund');
    const wallet = ACCOUNT_TYPES.find((type) => type.subtype === 'ewallet');
    expect(fund).toEqual({ subtype: 'fund', kind: 'asset' });
    expect(wallet).toEqual({ subtype: 'ewallet', kind: 'asset' });
    expect(SUBTYPE_LABELS.fund).toBe('Fund account');
    expect(SUBTYPE_LABELS.ewallet).toBe('Digital wallet');
  });

  it('names every type it offers', () => {
    for (const type of ACCOUNT_TYPES) expect(SUBTYPE_LABELS[type.subtype], type.subtype).toBeTruthy();
  });

  it('offers only types the ledger accepts for the kind it files them under', () => {
    for (const type of ACCOUNT_TYPES) {
      expect(BALANCE_SUBTYPES[type.kind] as readonly string[], type.subtype).toContain(type.subtype);
    }
  });

  it('offers every type the ledger balances, so none is unreachable', () => {
    const offered = new Set(ACCOUNT_TYPES.map((type) => type.subtype));
    for (const subtype of [...BALANCE_SUBTYPES.asset, ...BALANCE_SUBTYPES.liability]) {
      expect(offered, subtype).toContain(subtype);
    }
  });
});
