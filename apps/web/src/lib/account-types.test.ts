import { CASH_ITEMS } from '@expanses/core';
import type { AccountRow, AccountSubtype } from '@expanses/db';
import { BALANCE_SUBTYPES, SPENDABLE_SUBTYPES as LEDGER_SPENDABLE } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_TYPES, canPayWith, SPENDABLE_SUBTYPES, SUBTYPE_LABELS, WALLET_SUBTYPES } from './account-types';

describe('the account types someone can open', () => {
  /**
   * The picker and the Accounts page draw the same seven kinds of account from different tables. Two names for
   * one kind — "Electronic money" in the picker, "Digital wallet" on the row it opens — is a bug a person feels
   * before they can name it, so the catalogue's labels are the app's own, word for word.
   */
  it('calls a money account the same thing in the picker as on the account it opens', () => {
    for (const item of CASH_ITEMS) expect(item.label, item.id).toBe(SUBTYPE_LABELS[item.id as AccountSubtype]);
  });

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

describe('what can pay', () => {
  it('offers the same accounts the ledger lets money be set aside on', () => {
    expect([...SPENDABLE_SUBTYPES].sort()).toEqual([...LEDGER_SPENDABLE].sort());
  });

  it('adds a credit card to pay a bill with, and nothing else', () => {
    expect([...WALLET_SUBTYPES].sort()).toEqual([...SPENDABLE_SUBTYPES, 'credit_card'].sort());
  });

  it('holds money and is an asset, bar the card', () => {
    for (const subtype of SPENDABLE_SUBTYPES) {
      expect(BALANCE_SUBTYPES.asset as readonly string[], subtype).toContain(subtype);
      expect(ACCOUNT_TYPES.map((type) => type.subtype), subtype).toContain(subtype);
    }
  });
});

/**
 * Every "pay with", "paid from", "received into" and "transfer from" list is built on this, because being a money
 * account is not the same as being a way to pay: a time deposit holds money that is locked until it matures.
 */
describe('what a picker may offer as a way to pay', () => {
  const account = (subtype: AccountRow['subtype'], kind: AccountRow['kind'] = 'asset') => ({ id: subtype, kind, subtype }) as AccountRow;

  it('offers money the owner can move, and never a locked deposit', () => {
    expect(canPayWith(account('bank'))).toBe(true);
    expect(canPayWith(account('cash'))).toBe(true);
    expect(canPayWith(account('ewallet'))).toBe(true);
    expect(canPayWith(account('fund'))).toBe(true);
    expect(canPayWith(account('other_cash'))).toBe(true);
    expect(canPayWith(account('time_deposit'))).toBe(false);
  });

  it('never offers a holding, which is worth what it is worth and is not money', () => {
    expect(canPayWith(account('property'))).toBe(false);
    expect(canPayWith(account('vehicle'))).toBe(false);
    expect(canPayWith(account('investment'))).toBe(false);
  });

  it('keeps every liability, since a card or a loan settles later rather than holding money now', () => {
    expect(canPayWith(account('credit_card', 'liability'))).toBe(true);
    expect(canPayWith(account('loan', 'liability'))).toBe(true);
    expect(canPayWith(account('payable', 'liability'))).toBe(true);
  });

  it('agrees with the list of what holds spendable money, asset by asset', () => {
    for (const type of ACCOUNT_TYPES.filter((row) => row.kind === 'asset')) {
      expect(canPayWith(account(type.subtype)), type.subtype).toBe(SPENDABLE_SUBTYPES.includes(type.subtype));
    }
  });

  /** An old purchase posted against a house must still say so when it is opened, or editing it would move the money. */
  it('always keeps the account the field already names, however un-spendable it is', () => {
    expect(canPayWith(account('property'), 'property')).toBe(true);
    expect(canPayWith(account('vehicle'), 'vehicle')).toBe(true);
    expect(canPayWith(account('investment'), 'investment')).toBe(true);
    expect(canPayWith(account('time_deposit'), 'time_deposit')).toBe(true);
  });

  it('keeps only that one account, so every other choice stays strict', () => {
    expect(canPayWith(account('property'), 'vehicle')).toBe(false);
    expect(canPayWith(account('time_deposit'), 'property')).toBe(false);
    expect(canPayWith(account('property'), '')).toBe(false);
    expect(canPayWith(account('property'), null)).toBe(false);
  });
});
