import { describe, expect, it } from 'vitest';
import { applyReceipt, filledLine } from './receipt-fill';
import { emptyForm } from './tx-form';

const TODAY = '2026-10-22';
const blank = { ...emptyForm('book-1'), occurredOn: TODAY };
const fill = { amountMinor: 245_300, currency: 'IDR', name: 'SUPERMARKET MAWAR', date: '2026-10-20' };
const o = { postingCurrency: 'IDR', today: TODAY, foreignAllowed: true };

describe('a receipt read onto the add form', () => {
  it('fills the amount, the note and the day when they are still empty', () => {
    const { next, filled } = applyReceipt(blank, fill, o);
    expect(next).toMatchObject({ amount: '245300', description: 'SUPERMARKET MAWAR', occurredOn: '2026-10-20' });
    expect(filled!.fields).toEqual(['amount', 'note', 'date']);
    expect(filledLine(filled!.fields)).toBe('Filled from the receipt: amount, note, date. Check them.');
  });

  it('never overwrites what was typed, nor a day already moved off today', () => {
    const typed = { ...blank, amount: '100000', description: 'Lunch', occurredOn: '2026-10-21' };
    const { next, filled } = applyReceipt(typed, fill, o);
    expect(next).toBe(typed);
    expect(filled).toBeNull();
  });

  it('switches the currency for a foreign receipt only where the form allows one', () => {
    const usd = { ...fill, amountMinor: 1250, currency: 'USD' };
    expect(applyReceipt(blank, usd, o).next).toMatchObject({ amount: '12.50', currency: 'USD' });
    expect(applyReceipt(blank, usd, { ...o, foreignAllowed: false }).filled!.fields).toEqual(['note', 'date']);
  });

  it('does not believe a receipt dated after today', () => {
    expect(applyReceipt(blank, { ...fill, date: '2026-10-30' }, o).filled!.fields).toEqual(['amount', 'note']);
  });
});
