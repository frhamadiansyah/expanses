import { CASH_ITEMS } from '@expanses/core';
import type { AccountRow, AccountSubtype } from '@expanses/db';
import { BALANCE_SUBTYPES, MONEY_SUBTYPES as LEDGER_MONEY, SPENDABLE_SUBTYPES as LEDGER_SPENDABLE } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_TYPES, canMoveMoneyIn, canPayWith, canReceiveInto, canTransferBetween, canTransferWith, keptForSpending, MONEY_SUBTYPES, SPENDABLE_SUBTYPES, SUBTYPE_LABELS, WALLET_SUBTYPES } from './account-types';

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
    // A shared event's trip balance is made by the event and never offered by a picker (shared events §5).
    for (const subtype of [...BALANCE_SUBTYPES.asset, ...BALANCE_SUBTYPES.liability].filter((s) => s !== 'event_balance')) {
      expect(offered, subtype).toContain(subtype);
    }
  });
});

describe('what can pay', () => {
  it('is the ledger’s own two lists, in step with it', () => {
    expect([...SPENDABLE_SUBTYPES].sort()).toEqual([...LEDGER_SPENDABLE].sort());
    expect([...MONEY_SUBTYPES].sort()).toEqual([...LEDGER_MONEY].sort());
  });

  /*
   * The owner's rule, and the reason the two lists exist: money parked in an RDN cannot be spent from. It has to be
   * moved to a current or savings account first — so a transaction, a bill, a card and an instalment are never paid
   * with it. It is still money the ledger moves: a buy is paid out of it, and a goal may wait there.
   */

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

  it('offers money that can be paid from — never a broker’s cash, never a locked deposit', () => {
    expect(canPayWith(account('bank'))).toBe(true);
    expect(canPayWith(account('cash'))).toBe(true);
    expect(canPayWith(account('ewallet'))).toBe(true);
    expect(canPayWith(account('other_cash'))).toBe(true);
    // An RDN cannot be spent from: the money is moved to a bank account first. It is still money the ledger moves.
    expect(canPayWith(account('fund'))).toBe(false);
    expect([...MONEY_SUBTYPES]).toContain('fund');
    expect(canPayWith(account('time_deposit'))).toBe(false);
  });

  it('never offers a holding, which is worth what it is worth and is not money', () => {
    expect(canPayWith(account('property'))).toBe(false);
    expect(canPayWith(account('vehicle'))).toBe(false);
    expect(canPayWith(account('investment'))).toBe(false);
  });

  it('offers a card, and nothing else that settles later: a loan and a person cannot pay for anything', () => {
    expect(canPayWith(account('credit_card', 'liability'))).toBe(true);
    expect(canPayWith(account('loan', 'liability'))).toBe(false);
    expect(canPayWith(account('payable', 'liability'))).toBe(false);
  });

  /* Income is the mirror of paying, and the one place a broker's cash is named: a dividend or a coupon lands there. */
  it('receives income into money you hold, a broker’s cash included', () => {
    expect(canReceiveInto(account('bank'))).toBe(true);
    expect(canReceiveInto(account('savings'))).toBe(true);
    expect(canReceiveInto(account('fund'))).toBe(true);
    expect(canReceiveInto(account('time_deposit'))).toBe(false);
    expect(canReceiveInto(account('credit_card', 'liability'))).toBe(false);
    expect(canReceiveInto(account('property'))).toBe(false);
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

/**
 * "For spending" (0086): an account switched off is kept as savings. It leaves every pay-from list, but a transfer
 * still names it on either side and income still lands in it — money can still be moved in and out.
 */
describe('an account switched off "For spending"', () => {
  const account = (subtype: AccountSubtype, kind: 'asset' | 'liability' = 'asset') => ({ id: subtype, kind, subtype }) as AccountRow;
  const off = (subtype: AccountSubtype, kind: 'asset' | 'liability' = 'asset'): AccountRow => ({ ...account(subtype, kind), forSpending: 0 });
  const on = (subtype: AccountSubtype): AccountRow => ({ ...account(subtype), forSpending: 1 });

  it('is not kept for spending, whatever kind of money it is', () => {
    for (const subtype of SPENDABLE_SUBTYPES) {
      expect(keptForSpending(on(subtype)), subtype).toBe(true);
      expect(keptForSpending(off(subtype)), subtype).toBe(false);
    }
    // The switch means nothing on money that could never be paid from, and nothing on a card.
    expect(keptForSpending(on('fund'))).toBe(false);
    expect(keptForSpending(on('time_deposit'))).toBe(false);
    expect(keptForSpending({ ...account('credit_card', 'liability'), forSpending: 1 })).toBe(false);
  });

  it('reads as on when the row carries no switch at all', () => {
    expect(keptForSpending(account('savings'))).toBe(true);
    expect(canPayWith(account('savings'))).toBe(true);
  });

  it('leaves "Paid with", but is kept where a purchase already names it', () => {
    expect(canPayWith(off('savings'))).toBe(false);
    expect(canPayWith(off('bank'))).toBe(false);
    expect(canPayWith(off('savings'), 'savings')).toBe(true);
    // A credit card has the switch too: off, it is not charged from a new choice, but kept where a purchase names it.
    expect(canPayWith(off('credit_card', 'liability'))).toBe(false);
    expect(canPayWith(off('credit_card', 'liability'), 'credit_card')).toBe(true);
    expect(canPayWith({ ...account('credit_card', 'liability'), forSpending: 1 })).toBe(true);
    expect(canPayWith(account('credit_card', 'liability'))).toBe(true);
    expect(canMoveMoneyIn(off('credit_card', 'liability'), account('ewallet'))).toBe(false);
    expect(canMoveMoneyIn(account('credit_card', 'liability'), account('ewallet'))).toBe(true);
  });

  it('is still a transfer’s From or To, and still receives income', () => {
    expect(canTransferWith(off('savings'))).toBe(true);
    expect(canTransferBetween(off('savings'), account('bank'))).toBe(true);
    expect(canTransferBetween(account('bank'), off('savings'))).toBe(true);
    expect(canReceiveInto(off('savings'))).toBe(true);
    expect(canMoveMoneyIn(off('savings'), account('cash'))).toBe(true);
  });
});

/**
 * A pocket switched off "For spending": the lira left in a Cash account after a trip, kept as savings while the rupiah
 * beside it is still spent. A pocket is kept for spending only when it and its account both are.
 */
describe('a pocket switched off "For spending"', () => {
  const cash = (id: string, forSpending: number, parentId: string | null = null, currency = 'IDR') =>
    ({ id, name: id, kind: 'asset', subtype: 'cash', parentId, currency, forSpending, archivedAt: null }) as AccountRow;

  it('is kept only when the pocket and its account both are', () => {
    expect(keptForSpending(cash('idr', 1, 'c'), cash('c', 1))).toBe(true);
    expect(keptForSpending(cash('try', 0, 'c'), cash('c', 1))).toBe(false);
    // The account off keeps every pocket out, whatever the pocket's own switch says.
    expect(keptForSpending(cash('idr', 1, 'c'), cash('c', 0))).toBe(false);
    expect(keptForSpending(cash('try', 0, 'c'), cash('c', 0))).toBe(false);
  });

  it('is on by default: no switch on the pocket or on its account reads as on', () => {
    const bare = { id: 'p', kind: 'asset', subtype: 'cash', parentId: 'c' } as AccountRow;
    expect(keptForSpending(bare, { forSpending: undefined })).toBe(true);
    expect(keptForSpending(bare, null)).toBe(true);
    expect(keptForSpending(bare)).toBe(true);
  });

  it('leaves Paid with, but stays a transfer’s To and still receives', () => {
    // Rows as listAccounts reads them: a pocket's switch is already its own and its account's together.
    const rows = [cash('idr', 1, 'c'), cash('try', 0, 'c', 'TRY'), cash('wallet', 1)];
    expect(rows.filter((a) => canPayWith(a)).map((a) => a.id)).toEqual(['idr', 'wallet']);
    expect(canPayWith(rows[1]!, 'try')).toBe(true);
    expect(canTransferWith(rows[1]!)).toBe(true);
    expect(canTransferBetween(rows[0]!, rows[1]!)).toBe(true);
    expect(canReceiveInto(rows[1]!)).toBe(true);
  });
});

/**
 * The owner's rule for transfers, asked on the way money never leaves: ANTAM gold bars, the car, the house, KPR BCA
 * and a car loan were all on offer as somewhere to transfer *from*, because every picker of money was built from
 * "every active account".
 */
describe('what a transfer may move money between', () => {
  const account = (subtype: AccountRow['subtype'], kind: AccountRow['kind'] = 'asset') => ({ id: subtype, kind, subtype }) as AccountRow;

  it('offers money you hold, and nothing owed by or to a person', () => {
    for (const subtype of ['bank', 'cash', 'savings', 'ewallet', 'other_cash', 'fund'] as const) {
      expect(canTransferWith(account(subtype)), subtype).toBe(true);
    }
    // A loan with a person moves through the person's own forms.
    expect(canTransferWith(account('receivable'))).toBe(false);
    expect(canTransferWith(account('payable', 'liability'))).toBe(false);
  });

  it('never offers a thing you own, nor a debt', () => {
    expect(canTransferWith(account('investment'))).toBe(false); // gold bars, shares
    expect(canTransferWith(account('property'))).toBe(false); // a house
    expect(canTransferWith(account('vehicle'))).toBe(false); // a car
    expect(canTransferWith(account('credit_card', 'liability'))).toBe(false);
    expect(canTransferWith(account('loan', 'liability'))).toBe(false); // KPR, a car loan
    // A deposit's money leaves through its own Break early or Withdraw.
    expect(canTransferWith(account('time_deposit'))).toBe(false);
  });

  it('always keeps the account the row already names', () => {
    expect(canTransferWith(account('property'), 'property')).toBe(true);
    expect(canTransferWith(account('loan', 'liability'), 'loan')).toBe(true);
    expect(canTransferWith(account('property'), 'bank')).toBe(false);
  });
});

describe('which accounts may pair in a transfer', () => {
  const a = (id: string, subtype: AccountRow['subtype']) => ({ id, subtype });
  it('pairs a broker cash account with a current account only, both ways', () => {
    expect(canTransferBetween(a('rdn', 'fund'), a('everyday', 'bank'))).toBe(true);
    expect(canTransferBetween(a('everyday', 'bank'), a('rdn', 'fund'))).toBe(true);
    for (const subtype of ['cash', 'savings', 'ewallet', 'other_cash'] as const) {
      expect(canTransferBetween(a('rdn', 'fund'), a('x', subtype)), subtype).toBe(false);
      expect(canTransferBetween(a('x', subtype), a('rdn', 'fund')), subtype).toBe(false);
    }
  });
  it('lets other money move freely, but never into itself', () => {
    expect(canTransferBetween(a('wallet', 'ewallet'), a('cash', 'cash'))).toBe(true);
    expect(canTransferBetween(a('cash', 'cash'), a('cash', 'cash'))).toBe(false);
  });
});

describe('what Withdraw and Top up may bring money in from', () => {
  const a = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype']) => ({ id, kind, subtype });
  const cash = a('cash', 'asset', 'cash');
  const wallet = a('gopay', 'asset', 'ewallet');
  it('takes money you hold, never a broker cash account or itself', () => {
    expect(canMoveMoneyIn(a('bca', 'asset', 'bank'), cash)).toBe(true);
    expect(canMoveMoneyIn(a('tabungan', 'asset', 'savings'), wallet)).toBe(true);
    expect(canMoveMoneyIn(a('rdn', 'asset', 'fund'), cash)).toBe(false);
    expect(canMoveMoneyIn(a('house', 'asset', 'property'), cash)).toBe(false);
    expect(canMoveMoneyIn(cash, cash)).toBe(false);
  });
  it('takes a credit card into a wallet only, while a transfer still takes none', () => {
    const card = a('card', 'liability', 'credit_card');
    expect(canMoveMoneyIn(card, wallet)).toBe(true);
    expect(canMoveMoneyIn(card, cash)).toBe(false);
    expect(canMoveMoneyIn(a('kpr', 'liability', 'loan'), wallet)).toBe(false);
    expect(canTransferWith(card)).toBe(false);
  });
});
