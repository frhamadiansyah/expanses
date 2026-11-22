import { describe, expect, it } from 'vitest';
import { namesInWords, undoPaymentQuestion } from './undo-payment';

describe('Undo payment’s question', () => {
  const bill = (name: string, billMonth = '2026-11') => ({ name, billMonth });

  it('names every bill a payment of several leaves unpaid (owner, option A)', () => {
    const text = undoPaymentQuestion('Mobile phone · November bill', { totalMinor: 635_000, currency: 'IDR', bills: [bill('Internet'), bill('Mobile phone'), bill('Mobile phone 2')] });
    expect(text.startsWith('Undo the whole payment?\n\nDeletes the ')).toBe(true);
    expect(text).toMatch(/635\.000 payment\. Internet, Mobile phone and Mobile phone 2 become unpaid for November\.$/);
    expect(undoPaymentQuestion('x', { totalMinor: 535_000, currency: 'IDR', bills: [bill('Internet', '2026-10'), bill('Mobile phone')] })).toMatch(/Internet and Mobile phone become unpaid for their months\.$/);
  });

  it('asks as before for a payment of one bill', () => {
    expect(undoPaymentQuestion('Internet · November bill', { totalMinor: 385_000, currency: 'IDR', bills: [bill('Internet')] })).toBe('Undo Internet · November bill? The payment is deleted.');
    expect(undoPaymentQuestion('Internet · November bill', null)).toBe('Undo Internet · November bill? The payment is deleted.');
  });

  it('writes names as a person would', () => {
    expect(namesInWords(['Internet'])).toBe('Internet');
    expect(namesInWords(['Internet', 'Water'])).toBe('Internet and Water');
  });
});
