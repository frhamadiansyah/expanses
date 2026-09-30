import type { PaidWithItem } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { sharedPaymentSections, sharedTitle } from './PaymentSheet';
import { emptyForm, paidFromHint, sharedPaymentOf } from './tx-form';

/*
 * Paid with the partner's shared item (joint net worth §7.1, D14; task 7): a group "Rina's, shared" under one's own
 * accounts, only in the net-worth group's workspace.
 */

const item = (itemId: string, subtype: string, name: string, owner = 'm-rina', ownerName = 'Rina') =>
  ({ itemId, owner, ownerName, subtype, name, currency: 'IDR' }) as PaidWithItem;
const items = [item('i-bank', 'bank', 'Rina BCA'), item('i-card', 'credit_card', 'Rina Visa ···· 1234'), item('i-wallet', 'cash', 'Rina Wallet')];
const here = { formBookId: 'book-home', groupWorkspaceBookId: 'book-home' };
const titles = (sections: ReturnType<typeof sharedPaymentSections>) => sections.map((s) => [s.title, s.items.map((i) => i.itemId)]);

describe('Paid with: the partner’s shared items', () => {
  it('groups them under “Rina’s, shared” in the group’s workspace', () => {
    expect(sharedTitle('Rina')).toBe('Rina’s, shared');
    expect(titles(sharedPaymentSections(items, here, null, ''))).toEqual([['Rina’s, shared', ['i-bank', 'i-card', 'i-wallet']]]);
  });

  it('offers nothing in another workspace, or with no group', () => {
    expect(sharedPaymentSections(items, { formBookId: 'book-business', groupWorkspaceBookId: 'book-home' }, null, '')).toEqual([]);
    expect(sharedPaymentSections(items, { formBookId: 'book-home', groupWorkspaceBookId: null }, null, '')).toEqual([]);
  });

  it('a tab narrows to its kind; a search looks across both, by name, owner or currency', () => {
    expect(titles(sharedPaymentSections(items, here, 'cards', ''))).toEqual([['Rina’s, shared', ['i-card']]]);
    expect(titles(sharedPaymentSections(items, here, 'accounts', ''))).toEqual([['Rina’s, shared', ['i-bank', 'i-wallet']]]);
    expect(titles(sharedPaymentSections(items, here, 'accounts', 'visa'))).toEqual([['Rina’s, shared', ['i-card']]]);
    expect(titles(sharedPaymentSections(items, here, 'cards', 'rina'))).toEqual([['Rina’s, shared', ['i-bank', 'i-card', 'i-wallet']]]);
    expect(sharedPaymentSections(items, here, null, 'mandiri')).toEqual([]);
  });

  it('one section per owner, in the order the items come', () => {
    const two = [...items, item('i-sari', 'bank', 'Sari BNI', 'm-sari', 'Sari')];
    expect(titles(sharedPaymentSections(two, here, null, '')).map(([title]) => title)).toEqual(['Rina’s, shared', 'Sari’s, shared']);
  });
});

describe('the form’s paidFrom', () => {
  const rinaCard = { owner: 'm-rina', itemId: 'i-card' };

  it('tells the ledger only what was picked in this form, and only for an expense', () => {
    expect(paidFromHint({ ...emptyForm('b'), paidFrom: undefined })).toEqual({});
    expect(paidFromHint({ ...emptyForm('b'), paidFrom: rinaCard })).toEqual({ paidFrom: rinaCard });
    expect(paidFromHint({ ...emptyForm('b'), paidFrom: null })).toEqual({ paidFrom: null });
    expect(paidFromHint({ ...emptyForm('b'), mode: 'income', paidFrom: rinaCard })).toEqual({});
  });

  it('reads the partner’s item the edited purchase was paid from, until something else is picked', () => {
    const saved = { paidBy: 'm-andi', mine: true, paidFrom: rinaCard };
    expect(sharedPaymentOf(emptyForm('b'), saved)).toEqual(rinaCard);
    expect(sharedPaymentOf({ ...emptyForm('b'), paidFrom: null }, saved)).toBeNull();
    // Rina's own purchase from her own card, read on Andi's phone: not a way Andi paid.
    expect(sharedPaymentOf(emptyForm('b'), { paidBy: 'm-rina', mine: false, paidFrom: rinaCard })).toBeNull();
    // Andi's purchase from his own shared bank: his own account, not a partner's item.
    expect(sharedPaymentOf(emptyForm('b'), { paidBy: 'm-andi', mine: true, paidFrom: { owner: 'm-andi', itemId: 'i-x' } })).toBeNull();
    expect(sharedPaymentOf(emptyForm('b'), null)).toBeNull();
  });
});
