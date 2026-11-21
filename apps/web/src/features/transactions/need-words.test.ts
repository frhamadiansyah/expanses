import { describe, expect, it } from 'vitest';
import { needWords } from './need-words';

describe('needWords', () => {
  it('names a missing account as a payment method, and leaves the other needs as they are', () => {
    expect(needWords(['paid with'])).toBe('a payment method');
    expect(needWords(['date', 'amount', 'paid with', 'category'])).toBe('date & amount & a payment method & category');
  });
});
