import type { AccountRow, BillChoice, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { onePaymentRefusal } from '../bills/PaySeveralSheet';
import { billChoicesForPart, billLabel, partBillLabel, withPartBill } from './split-bills';
import { billLinksOf, duplicateDraft, emptyForm, formFromTransaction, formToPost, type FormDraft, type SplitRow } from './tx-form';

/*
 * One payment, several bills (2026-11-22): the Split sheet's Bill row and Pay several's One payment, as rules. Invented
 * bills, card and figures.
 */

const accounts = [
  { id: 'card', name: 'Kartu Contoh', kind: 'liability', subtype: 'credit_card', currency: 'IDR' },
  { id: 'internet', name: 'Internet', kind: 'expense', subtype: 'category', currency: null },
  { id: 'phone', name: 'Phone', kind: 'expense', subtype: 'category', currency: null },
] as AccountRow[];

const choice = (templateId: string, name: string, categoryAccountId: string, amountMinor: number | null, billMonth = '2026-11'): BillChoice => ({
  templateId, name, categoryAccountId, amountMinor, billMonth,
});
const CHOICES = [choice('b-net', 'Internet', 'internet', 385_000), choice('b-ph', 'Mobile phone', 'phone', 150_000), choice('b-ph2', 'Mobile phone 2', 'phone', 100_000)];

const parts: SplitRow[] = [
  { categoryId: 'internet', amount: '385000' },
  { categoryId: 'phone', amount: '150000' },
  { categoryId: 'phone', amount: '100000', rest: true },
];

describe('a part’s Bill row', () => {
  it('names a bill with its month', () => {
    expect(billLabel({ name: 'Mobile phone', billMonth: '2026-11' })).toBe('Mobile phone · Nov');
    expect(partBillLabel({ templateId: 'b-ph', billMonth: '2026-11' }, CHOICES, new Map())).toBe('Mobile phone · Nov');
    expect(partBillLabel({ templateId: 'gone', billMonth: '2026-11' }, CHOICES, new Map([['gone', 'Old bill']]))).toBe('Old bill · Nov');
    expect(partBillLabel(null, CHOICES, new Map())).toBeNull();
  });

  it('offers the part’s own category first, and never a bill another part pays', () => {
    expect(billChoicesForPart(CHOICES, parts, 1).map((c) => c.name)).toEqual(['Mobile phone', 'Mobile phone 2', 'Internet']);
    const one = withPartBill(parts, 1, CHOICES[1]!);
    expect(billChoicesForPart(CHOICES, one, 2).map((c) => c.name)).toEqual(['Mobile phone 2', 'Internet']);
    expect(billChoicesForPart(CHOICES, one, 1).map((c) => c.name)).toEqual(['Mobile phone', 'Mobile phone 2', 'Internet']);
  });

  it('picking a bill moves it off any other part, and None takes it away; the rest of the part stays', () => {
    const one = withPartBill(parts, 1, CHOICES[1]!);
    expect(one[1]).toEqual({ categoryId: 'phone', amount: '150000', bill: { templateId: 'b-ph', billMonth: '2026-11' } });
    const moved = withPartBill(one, 2, CHOICES[1]!);
    expect(moved[1]!.bill).toBeUndefined();
    expect(moved[2]).toEqual({ categoryId: 'phone', amount: '100000', rest: true, bill: { templateId: 'b-ph', billMonth: '2026-11' } });
    expect(withPartBill(moved, 2, null)[2]).toEqual({ categoryId: 'phone', amount: '100000', rest: true });
  });
});

describe('what a split saves about its bills', () => {
  const draft: FormDraft = { ...emptyForm('ws-1'), moneyId: 'card', currency: 'IDR', amount: '635000', occurredOn: '2026-11-22', splits: parts };

  it('a new purchase says the parts’ bills; with none it says nothing', () => {
    expect(billLinksOf(draft, true)).toEqual({});
    const billed = { ...draft, splits: withPartBill(withPartBill(parts, 0, CHOICES[0]!), 2, CHOICES[2]!) };
    const post = formToPost(billed, accounts);
    expect(post.kind === 'post' && post.input.billLinks).toEqual([
      { templateId: 'b-net', billMonth: '2026-11' },
      { templateId: 'b-ph2', billMonth: '2026-11' },
    ]);
  });

  it('an edit says them outright, keeping the bills no part was shown with; a part taken away lets its bill go', () => {
    const editing: FormDraft = {
      ...draft,
      editing: true,
      splits: withPartBill(parts, 0, CHOICES[0]!),
      billsOpened: { transactionId: 'tx-1', kept: [{ templateId: 'b-water', billMonth: '2026-10' }] },
    };
    expect(billLinksOf(editing, true).billLinks).toEqual([
      { templateId: 'b-net', billMonth: '2026-11' },
      { templateId: 'b-water', billMonth: '2026-10' },
    ]);
    // The edit opened on bills and every part's was taken away: it says so (an empty list), so they go.
    expect(billLinksOf({ ...editing, splits: parts, billsOpened: { transactionId: 'tx-1', kept: [] } }, true).billLinks).toEqual([]);
    // Not a split: nothing is said, and the edit carries what it had.
    expect(billLinksOf(editing, false)).toEqual({});
  });

  it('reopened, a payment of three bills shows each on the part that pays it — two of one category by their amounts', () => {
    const entry = (accountId: string, accountKind: string, amountMinor: number) => ({ accountId, accountKind, accountName: accountId, amountMinor, amountBaseMinor: amountMinor, currency: 'IDR' });
    const tx = {
      id: 'tx-1', occurredOn: '2026-11-22', description: 'Bayar sekaligus', status: 'posted', originalCurrency: null, originalAmountMinor: null, mcc: null, cardId: null,
      entries: [entry('internet', 'expense', 385_000), entry('phone', 'expense', 100_000), entry('phone', 'expense', 150_000), entry('card', 'liability', -635_000)],
      bills: [
        { templateId: 'b-net', billMonth: '2026-11', name: 'Internet', categoryAccountId: 'internet', amountMinor: 385_000, own: true },
        { templateId: 'b-ph', billMonth: '2026-11', name: 'Mobile phone', categoryAccountId: 'phone', amountMinor: 150_000, own: false },
        { templateId: 'b-ph2', billMonth: '2026-11', name: 'Mobile phone 2', categoryAccountId: 'phone', amountMinor: 100_000, own: false },
      ],
    } as unknown as TransactionView;
    const form = formFromTransaction(tx, accounts);
    expect(form.splits.map((row) => row.bill)).toEqual([
      { templateId: 'b-net', billMonth: '2026-11', own: true },
      { templateId: 'b-ph2', billMonth: '2026-11' },
      { templateId: 'b-ph', billMonth: '2026-11' },
    ]);
    expect(form.billsOpened).toEqual({ transactionId: 'tx-1', kept: [] });
    // A copy of it pays none of them again.
    const copy = duplicateDraft(tx, accounts);
    expect(copy.billsOpened).toBeUndefined();
    expect(copy.splits.some((row) => row.bill)).toBe(false);
  });
});

describe('Pay several’s One payment', () => {
  const card = { name: 'Kartu Contoh', currency: 'IDR' };
  it('needs two bills, one Payment method and every bill in its money', () => {
    expect(onePaymentRefusal({ ticked: 3, account: card, foreignNames: [] })).toBeNull();
    expect(onePaymentRefusal({ ticked: 1, account: card, foreignNames: [] })).toMatch(/two bills/);
    expect(onePaymentRefusal({ ticked: 3, account: null, foreignNames: [] })).toBe('Choose the one Payment method they were paid with.');
    expect(onePaymentRefusal({ ticked: 2, account: card, foreignNames: ['Cloud storage'] })).toBe('Cloud storage is in another currency: One payment pays bills in IDR only.');
  });
});
