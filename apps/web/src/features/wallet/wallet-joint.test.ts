import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import type { ReceivedItem } from '../networth/joint-rows';
import { fromPhoneLine, isJointKey, jointChip, jointKey, JOINT_ORDER_KEY, placeJoint, readJointOrder, splitLast4, walletJoint, walletKeys, writeJointOrder } from './wallet-joint';

const row = (id: string, subtype: string, extra: Partial<AccountRow> = {}) =>
  ({ id, name: id, parentId: null, kind: 'asset', subtype, currency: 'IDR', archivedAt: null, sortOrder: 0, forSpending: 1, ...extra }) as AccountRow;
const card = (id: string, extra: Partial<AccountRow> = {}) => row(id, 'credit_card', { kind: 'liability', ...extra });

const RINA = 'member-rina';
const ANDI = 'member-andi';
const names = { [RINA]: 'Rina', [ANDI]: 'Andi' };

/** A summary Rina's phone sent, as `receivedItems` hands it over: only the fields Wallet reads matter. */
const item = (itemId: string, subtype: string, extra: Partial<ReceivedItem> = {}): ReceivedItem =>
  ({
    itemId,
    owner: RINA,
    kind: subtype === 'credit_card' ? 'liability' : 'asset',
    subtype,
    name: itemId,
    currency: 'IDR',
    balanceMinor: 0,
    asOf: '2026-11-12',
    joint: true,
    ...extra,
  }) as ReceivedItem;

describe('which of the partner’s items are Wallet cards', () => {
  const items = [
    item('savings', 'savings', { name: 'Joint savings ···· 7781', balanceMinor: 8_000_000 }),
    item('card', 'credit_card', { name: 'CIMB World ···· 5678', balanceMinor: 850_000 }),
    item('bank-not-joint', 'bank', { joint: undefined }),
    item('deposit', 'time_deposit'),
    item('fund', 'investment'),
    item('loan', 'loan', { kind: 'liability' }),
    item('mine', 'bank', { owner: ANDI }),
    item('wallet', 'ewallet', { balanceMinor: 150_000 }),
  ];

  it('keeps the other members’ joint items that can pay — money and a credit card — and nothing else', () => {
    expect(walletJoint(items, ANDI, names).map((j) => j.itemId)).toEqual(['savings', 'card', 'wallet']);
  });

  it('reads each as a card: its name and last four, whose it is, money or a card, and its figure', () => {
    const [savings, credit] = walletJoint(items, ANDI, names);
    expect(savings).toMatchObject({ key: jointKey('savings'), side: 'money', name: 'Joint savings', last4: '7781', ownerName: 'Rina', minor: 8_000_000, currency: 'IDR' });
    expect(credit).toMatchObject({ key: jointKey('card'), side: 'credit', name: 'CIMB World', last4: '5678', minor: 850_000 });
  });

  it('carries the bank, tier and account digits its holder’s summary sends, the card’s digits first', () => {
    const [plain] = walletJoint([item('a', 'savings', { name: 'Joint savings', face: { bank: 'Bank Contoh', tier: 'gold', last4: '4096' } })], ANDI, names);
    expect(plain).toMatchObject({ name: 'Joint savings', last4: '4096', bank: 'Bank Contoh', tier: 'gold' });
    const [carded] = walletJoint([item('b', 'bank', { name: 'Joint ···· 2718', face: { last4: '4096' } })], ANDI, names);
    expect(carded).toMatchObject({ name: 'Joint', last4: '2718', bank: null, tier: null });
    const [bare] = walletJoint([item('c', 'bank', { name: 'Joint' })], ANDI, names);
    expect(bare).toMatchObject({ last4: null, bank: null, tier: null });
  });

  it('names a member the workspace has not named "Someone"', () => {
    expect(walletJoint([item('x', 'cash', { owner: 'member-who' })], ANDI, names)[0]!.ownerName).toBe('Someone');
  });

  it('keeps a joint card’s key apart from any account id', () => {
    expect(isJointKey(jointKey('abc'))).toBe(true);
    expect(isJointKey('abc')).toBe(false);
  });
});

describe('splitLast4: the digits a summary’s name carries', () => {
  it('takes the four digits its owner’s phone added, and leaves a name without them as it is', () => {
    expect(splitLast4('BCA Tahapan ···· 2204')).toEqual({ name: 'BCA Tahapan', last4: '2204' });
    expect(splitLast4('Joint savings')).toEqual({ name: 'Joint savings', last4: null });
    expect(splitLast4('Room 1234')).toEqual({ name: 'Room 1234', last4: null });
  });
});

describe('the order the partner’s cards take in Wallet', () => {
  const accounts = [row('payroll', 'bank'), row('cash', 'cash'), row('gopay', 'ewallet'), card('card-1234')];
  const joint = [
    { key: jointKey('savings'), side: 'money' as const, subtype: 'savings' },
    { key: jointKey('card'), side: 'credit' as const, subtype: 'credit_card' },
  ];

  it('by the own cards’ rules: money at the back by kind, the credit cards in front, own before the partner’s of a kind', () => {
    expect(walletKeys(accounts, joint, null)).toEqual(['payroll', jointKey('savings'), 'cash', 'gopay', 'card-1234', jointKey('card')]);
  });

  it('a wallet in the partner’s name goes among the wallets', () => {
    expect(walletKeys(accounts, [{ key: jointKey('ovo'), side: 'money', subtype: 'ewallet' }], null)).toEqual(['payroll', 'cash', 'gopay', jointKey('ovo'), 'card-1234']);
  });

  it('once the own cards are in an order by hand, a partner’s card not placed yet is appended', () => {
    const placed = [row('payroll', 'bank', { sortOrder: 2 }), row('cash', 'cash', { sortOrder: 3 }), row('gopay', 'ewallet', { sortOrder: 4 }), card('card-1234', { sortOrder: 1 })];
    expect(walletKeys(placed, joint, null)).toEqual(['card-1234', 'payroll', 'cash', 'gopay', jointKey('savings'), jointKey('card')]);
  });

  it('a partner’s card placed by Reorder cards stands where it was put, after the card before it', () => {
    const placed = [row('payroll', 'bank', { sortOrder: 2 }), row('cash', 'cash', { sortOrder: 3 }), row('gopay', 'ewallet', { sortOrder: 4 }), card('card-1234', { sortOrder: 1 })];
    const saved = [jointKey('card'), 'card-1234', 'payroll', jointKey('savings'), 'cash', 'gopay'];
    expect(walletKeys(placed, joint, saved)).toEqual([jointKey('card'), 'card-1234', 'payroll', jointKey('savings'), 'cash', 'gopay']);
  });

  it('a card that left meanwhile is skipped over: the partner’s card follows the nearest one still there', () => {
    expect(placeJoint(['a', 'c', 'j1'], new Set(['j1']), ['a', 'b', 'j1', 'c'])).toEqual(['a', 'j1', 'c']);
  });

  it('ignores a saved key no card has any more, and a joint card no longer shared drops out', () => {
    expect(placeJoint(['a', 'b'], new Set(), ['gone', 'a', 'joint:old', 'b'])).toEqual(['a', 'b']);
  });

  it('two partner cards placed together keep their saved order', () => {
    expect(placeJoint(['a', 'b', 'j1', 'j2'], new Set(['j1', 'j2']), ['j2', 'j1', 'a', 'b'])).toEqual(['j2', 'j1', 'a', 'b']);
  });
});

describe('where the partner’s cards’ places are kept: this device', () => {
  const store = () => {
    const kept = new Map<string, string>();
    return {
      kept,
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    };
  };

  it('keeps the whole order while it holds a partner’s card, and nothing once it holds none', () => {
    const s = store();
    writeJointOrder(['a', jointKey('x'), 'b'], s);
    expect(readJointOrder(s)).toEqual(['a', jointKey('x'), 'b']);
    writeJointOrder(['a', 'b'], s);
    expect(s.kept.has(JOINT_ORDER_KEY)).toBe(false);
    expect(readJointOrder(s)).toBeNull();
  });

  it('reads storage that cannot be read, or holds nonsense, as no order', () => {
    expect(readJointOrder({ getItem: () => { throw new Error('private'); } })).toBeNull();
    expect(readJointOrder({ getItem: () => '{"not":"a list"}' })).toBeNull();
    expect(readJointOrder({ getItem: () => 'not json' })).toBeNull();
    expect(() => writeJointOrder([jointKey('x')], { setItem: () => { throw new Error('full'); }, removeItem: () => undefined })).not.toThrow();
  });
});

describe('the line under a joint card’s figure: where it came from, and when', () => {
  const now = Date.parse('2026-11-12T10:00:00+07:00');
  it('says how long ago the owner’s phone was last heard from', () => {
    expect(fromPhoneLine('Rina', now - 20_000, '2026-11-12', now, '2026-11-12')).toBe('from Rina’s phone · just now');
    expect(fromPhoneLine('Rina', now - 2 * 60_000, '2026-11-12', now, '2026-11-12')).toBe('from Rina’s phone · 2 min ago');
    expect(fromPhoneLine('Rina', now - 3 * 3_600_000, '2026-11-12', now, '2026-11-12')).toBe('from Rina’s phone · 3 h ago');
  });

  it('falls back to the summary’s own day when the phone was never heard from, or long ago', () => {
    expect(fromPhoneLine('Rina', null, '2026-11-12', now, '2026-11-12')).toBe('from Rina’s phone · today');
    expect(fromPhoneLine('Rina', null, '2026-11-08', now, '2026-11-12')).toBe('from Rina’s phone · 8 Nov');
    expect(fromPhoneLine('Rina', now - 3 * 86_400_000, '2026-11-09', now, '2026-11-12')).toBe('from Rina’s phone · 9 Nov');
  });
});

describe('the chip of words on a partner’s money card', () => {
  it('says what an own card of its kind says, and names the kind where an own card would only say "Account"', () => {
    expect(jointChip('savings', null)).toBe('Saving account');
    expect(jointChip('bank', null)).toBe('Current account');
    expect(jointChip('savings', '7781')).toBe('Debit ···· 7781');
    expect(jointChip('cash', null)).toBe('Cash');
    expect(jointChip('ewallet', null)).toBe('E-wallet');
  });
});
