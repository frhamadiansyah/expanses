import type { ListOutcome, ListRow } from '@expanses/core';
import type { TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { emptyForm, type FormDraft } from '../transactions/tx-form';
import { addedToast, candidateOf, canRecord, editFromForm, formOfRow, listCounts, listInputs, newRowsFrom, recordLabel, toggled, withEdit } from './list-model';

const row = (on: string, description: string, amountMinor: number, direction: 'out' | 'in'): ListRow => ({
  on,
  time: null,
  description,
  source: null,
  ref: null,
  amountMinor,
  direction,
  coins: false,
  image: 0,
});
const rows = [row('2026-09-19', 'Noodle Stall', 41000, 'out'), row('2026-09-18', 'Top up', 1000000, 'in'), row('2026-09-17', 'Cashback', 41, 'in'), row('2026-09-16', 'Tea', 9000, 'out')];
const outcomes: ListOutcome[] = [
  { row: 0, status: 'new' },
  { row: 1, status: 'new' },
  { row: 2, status: 'skipped' },
  { row: 3, status: 'recorded', candidateId: 'x' },
];

describe('list model', () => {
  it('counts each answer and the recorded entries left over', () => {
    expect(listCounts(outcomes, ['a', 'b'])).toEqual({ recorded: 1, new: 2, differs: 0, skipped: 1, notOnList: 2 });
  });

  it('turns new rows into ticked expenses and income with their guessed categories', () => {
    const made = newRowsFrom(rows, outcomes, { 0: 'cat-food', 1: null });
    expect(made.map((r) => [r.id, r.type, r.categoryId, r.ticked])).toEqual([
      [0, 'expense', 'cat-food', true],
      [1, 'income', '', true],
    ]);
  });

  it('never takes what a row was paid with for its note', () => {
    const paid = { ...row('2026-09-15', '', 5000, 'out'), source: 'Wallet Saldo' };
    expect(newRowsFrom([paid], [{ row: 0, status: 'new' }])[0]!.note).toBe('');
  });

  it('records only ticked rows and asks a transfer for its other account', () => {
    let made = newRowsFrom(rows, outcomes);
    expect(canRecord(made)).toBe(true);
    expect(recordLabel(made)).toBe('Record 2');
    made = toggled(made, 1);
    expect(recordLabel(made)).toBe('Record 1');
    made = withEdit(made, 0, { type: 'transfer' });
    expect(canRecord(made)).toBe(false);
    made = withEdit(made, 0, { otherAccountId: 'bank' });
    expect(canRecord(made)).toBe(true);
    expect(canRecord(toggled(made, 0))).toBe(false);
  });

  it('posts an expense out of the account, income into it, a transfer the way the list showed it', () => {
    let made = newRowsFrom(rows, outcomes, { 0: 'cat-food', 1: 'cat-pay' });
    const inputs = listInputs(made, { id: 'wallet', currency: 'IDR' }, { expense: 'unc-e', income: 'unc-i' }, () => undefined);
    expect(inputs.map((i) => i.lines.map((l) => [l.accountId, l.amountMinor]))).toEqual([
      [['cat-food', 41000], ['wallet', -41000]],
      [['wallet', 1000000], ['cat-pay', -1000000]],
    ]);
    made = [withEdit(made, 0, { type: 'transfer', otherAccountId: 'bank' })[0]!, withEdit(made, 1, { type: 'transfer', otherAccountId: 'bank' })[1]!];
    const moves = listInputs(made, { id: 'wallet', currency: 'IDR' }, { expense: 'unc-e', income: 'unc-i' }, () => undefined);
    expect(moves.map((i) => i.lines.map((l) => [l.accountId, l.amountMinor]))).toEqual([
      [['bank', 41000], ['wallet', -41000]],
      [['wallet', 1000000], ['bank', -1000000]],
    ]);
  });

  it('files an entry without a category under Uncategorised and leaves unticked rows out', () => {
    const made = toggled(newRowsFrom(rows, outcomes), 1);
    const inputs = listInputs(made, { id: 'wallet', currency: 'IDR' }, { expense: 'unc-e', income: 'unc-i' }, () => undefined);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.lines[0]!.accountId).toBe('unc-e');
    expect(inputs[0]!.description).toBe('Noodle Stall');
  });

  it('says what was added and skipped', () => {
    expect(addedToast(5, 3)).toBe('Added 5 · skipped 3');
    expect(addedToast(2, 0)).toBe('Added 2');
  });

  it('reads a recorded entry as the account\'s own net, and nothing for a void or a zero net', () => {
    const view = (status: 'posted' | 'void', amounts: number[]) =>
      ({ id: 't', occurredOn: '2026-09-19', description: 'x', status, entries: amounts.map((amountMinor, i) => ({ accountId: i === 0 ? 'wallet' : 'other', amountMinor })) }) as unknown as TransactionView;
    expect(candidateOf(view('posted', [-5000, 5000]), 'wallet')).toMatchObject({ amountMinor: 5000, direction: 'out' });
    expect(candidateOf(view('posted', [7000, -7000]), 'wallet')).toMatchObject({ amountMinor: 7000, direction: 'in' });
    expect(candidateOf(view('void', [-5000, 5000]), 'wallet')).toBeNull();
    expect(candidateOf(view('posted', [0, 0]), 'wallet')).toBeNull();
  });

  describe('the row on the full Add screen', () => {
    const made = newRowsFrom(rows, outcomes, { 0: 'cat-food' });
    const form = (row: (typeof made)[number]): FormDraft => ({ ...emptyForm('book', '2026-09-20'), ...formOfRow(row, 'wallet', 'IDR') });

    it('opens an expense on the account, with its figure, category, note and day', () => {
      expect(formOfRow(made[0]!, 'wallet', 'IDR')).toMatchObject({ mode: 'expense', moneyId: 'wallet', toId: '', amount: '41000', categoryId: 'cat-food', description: 'Noodle Stall', occurredOn: '2026-09-19', currency: 'IDR' });
    });

    it('opens a transfer with the account on the side the list showed', () => {
      const out = withEdit(made, 0, { type: 'transfer', otherAccountId: 'bank' })[0]!;
      expect(formOfRow(out, 'wallet', 'IDR')).toMatchObject({ mode: 'transfer', moneyId: 'wallet', toId: 'bank', categoryId: '', currency: '' });
      const into = withEdit(made, 1, { type: 'transfer', otherAccountId: 'bank' })[1]!;
      expect(formOfRow(into, 'wallet', 'IDR')).toMatchObject({ mode: 'transfer', moneyId: 'bank', toId: 'wallet' });
    });

    it('writes the form back onto the row, posting nothing: a new figure, category, note and day', () => {
      const edited = { ...form(made[0]!), amount: '45.500', categoryId: 'cat-cafe', description: ' Noodle Stall Tebet ', occurredOn: '2026-09-18' };
      expect(editFromForm(edited, 'wallet', 'IDR')).toEqual({
        type: 'expense',
        direction: 'out',
        amountMinor: 45500,
        categoryId: 'cat-cafe',
        otherAccountId: '',
        note: 'Noodle Stall Tebet',
        occurredOn: '2026-09-18',
      });
      // No category: filed under Uncategorised when recorded.
      expect(editFromForm({ ...edited, categoryId: '' }, 'wallet', 'IDR').categoryId).toBe('');
    });

    it('reads a transfer back by which side the account is on', () => {
      const base = form(made[0]!);
      expect(editFromForm({ ...base, mode: 'transfer', moneyId: 'bank', toId: 'wallet', categoryId: 'cat-food' }, 'wallet', 'IDR')).toMatchObject({
        type: 'transfer',
        direction: 'in',
        otherAccountId: 'bank',
        categoryId: '',
      });
      expect(editFromForm({ ...base, mode: 'transfer', moneyId: 'wallet', toId: 'bank' }, 'wallet', 'IDR')).toMatchObject({ direction: 'out', otherAccountId: 'bank' });
    });

    it('refuses a form that moves the row off its account, or has no figure', () => {
      const base = form(made[0]!);
      expect(() => editFromForm({ ...base, moneyId: 'bank' }, 'wallet', 'IDR')).toThrow(/this account/);
      expect(() => editFromForm({ ...base, mode: 'transfer', moneyId: 'bank', toId: 'cash' }, 'wallet', 'IDR')).toThrow(/this account/);
      expect(() => editFromForm({ ...base, amount: '' }, 'wallet', 'IDR')).toThrow(/greater than zero/);
      expect(() => editFromForm({ ...base, mode: 'trade' }, 'wallet', 'IDR')).toThrow();
      // A transfer to an account in another currency would post one figure on both sides.
      expect(() => editFromForm({ ...base, mode: 'transfer', moneyId: 'wallet', toId: 'usd' }, 'wallet', 'IDR', ['bank'])).toThrow(/IDR account/);
      expect(editFromForm({ ...base, mode: 'transfer', moneyId: 'wallet', toId: 'bank' }, 'wallet', 'IDR', ['bank'])).toMatchObject({ otherAccountId: 'bank' });
    });
  });
});
