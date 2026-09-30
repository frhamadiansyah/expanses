import type { AccountRow, PaidWithItem } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { partnerChoice, partnerItemOfChoice, partnerTitle, partnerTransferSections } from './member-transfer';
import { emptyForm, memberTransferOf, ownTransferAccountId, type FormDraft } from './tx-form';

/*
 * Transfers between partners on the Transfer tab (joint net worth §7.2; task 8): To — and From, for money received —
 * list the partner's shared items under "Andi’s, shared with Household", only in the group's workspace and only in the
 * transfer's currency.
 */

const item = (itemId: string, currency: string, name: string, owner = 'm-andi', ownerName: string | null = 'Andi') =>
  ({ itemId, owner, ownerName, subtype: 'bank', name, currency }) as PaidWithItem;
const items = [item('i-mandiri', 'IDR', 'Andi Mandiri'), item('i-usd', 'USD', 'Andi Dollars'), item('i-wallet', 'IDR', 'Andi Wallet')];
const here = { formBookId: 'book-home', groupWorkspaceBookId: 'book-home' };
const titles = (sections: ReturnType<typeof partnerTransferSections>) => sections.map((s) => [s.title, s.items.map((i) => i.itemId)]);

describe('Transfer: the partner’s shared items', () => {
  it('appear under “Andi’s, shared with Household”, only those in the transfer’s currency', () => {
    expect(titles(partnerTransferSections(items, here, 'IDR', 'Household'))).toEqual([['Andi’s, shared with Household', ['i-mandiri', 'i-wallet']]]);
    expect(titles(partnerTransferSections(items, here, 'USD', 'Household'))).toEqual([['Andi’s, shared with Household', ['i-usd']]]);
    expect(partnerTransferSections(items, here, 'EUR', 'Household')).toEqual([]);
  });

  it('appear only in the group’s workspace, and only once the other side’s currency is known', () => {
    expect(partnerTransferSections(items, { formBookId: 'book-business', groupWorkspaceBookId: 'book-home' }, 'IDR', 'Business')).toEqual([]);
    expect(partnerTransferSections(items, { formBookId: 'book-home', groupWorkspaceBookId: null }, 'IDR', 'Household')).toEqual([]);
    expect(partnerTransferSections(items, here, '', 'Household')).toEqual([]);
  });

  it('one section per owner; an owner with no name here reads as the workspace’s', () => {
    const two = [...items, item('i-sari', 'IDR', 'Sari BNI', 'm-sari', 'Sari'), item('i-x', 'IDR', 'BNI', 'm-x', null)];
    expect(titles(partnerTransferSections(two, here, 'IDR', 'Household')).map(([title]) => title)).toEqual([
      'Andi’s, shared with Household',
      'Sari’s, shared with Household',
      'Shared with Household',
    ]);
    expect(partnerTitle(null, 'Home')).toBe('Shared with Home');
  });

  it('a partner’s item in the To list never reads as one of this person’s own accounts', () => {
    expect(partnerItemOfChoice(partnerChoice('i-mandiri'))).toBe('i-mandiri');
    expect(partnerItemOfChoice('01a0-account-id')).toBeNull();
  });
});

describe('Transfer: what a transfer with a partner records', () => {
  const accounts = [
    { id: 'a-bca', name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' },
    { id: 'a-usd', name: 'Dollars', kind: 'asset', subtype: 'bank', currency: 'USD' },
  ] as AccountRow[];
  const draft = (patch: Partial<FormDraft>): FormDraft => ({ ...emptyForm('book-home', '2026-09-30'), mode: 'transfer', amount: '5000000', ...patch });
  const andi = { owner: 'm-andi', itemId: 'i-mandiri', currency: 'IDR' };

  it('to the partner: From is this person’s account, To the partner’s item', () => {
    const d = draft({ moneyId: 'a-bca', partner: { side: 'to', ...andi }, description: ' For the rent ' });
    expect(ownTransferAccountId(d)).toBe('a-bca');
    expect(memberTransferOf(d, accounts, 'm-rina', 'i-bca')).toEqual({
      occurredOn: '2026-09-30',
      amountMinor: 5_000_000,
      currency: 'IDR',
      from: { owner: 'm-rina', itemId: 'i-bca' },
      to: { owner: 'm-andi', itemId: 'i-mandiri' },
      description: 'For the rent',
    });
  });

  it('from the partner (money received): From is their item, To this person’s account', () => {
    const d = draft({ toId: 'a-bca', partner: { side: 'from', ...andi } });
    expect(ownTransferAccountId(d)).toBe('a-bca');
    const input = memberTransferOf(d, accounts, 'm-rina', 'i-bca');
    expect([input.from, input.to, input.description]).toEqual([{ owner: 'm-andi', itemId: 'i-mandiri' }, { owner: 'm-rina', itemId: 'i-bca' }, null]);
  });

  it('refuses two currencies, a missing own account and an empty figure', () => {
    expect(() => memberTransferOf(draft({ moneyId: 'a-usd', partner: { side: 'to', ...andi } }), accounts, 'm-rina', 'i-usd')).toThrow('Pick an account in IDR');
    expect(() => memberTransferOf(draft({ partner: { side: 'to', ...andi } }), accounts, 'm-rina', 'x')).toThrow('Choose the From account');
    expect(() => memberTransferOf(draft({ partner: { side: 'from', ...andi } }), accounts, 'm-rina', 'x')).toThrow('Choose the To account');
    expect(() => memberTransferOf(draft({ moneyId: 'a-bca', amount: '', partner: { side: 'to', ...andi } }), accounts, 'm-rina', 'x')).toThrow('Amount is empty');
  });
});
