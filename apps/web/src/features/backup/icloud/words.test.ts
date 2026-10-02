import { describe, expect, it } from 'vitest';
import { copiesWord, whenShort } from './words';

describe('iCloud copy words', () => {
  const now = new Date(2026, 9, 2, 9, 30);
  it('says today, yesterday, or the date', () => {
    expect(whenShort(new Date(2026, 9, 2, 7, 12).toISOString(), now)).toBe('Today, 07:12');
    expect(whenShort(new Date(2026, 9, 1, 22, 40).toISOString(), now)).toBe('Yesterday, 22:40');
    expect(whenShort(new Date(2026, 8, 30, 7, 31).toISOString(), now)).toBe('30 Sep 2026, 07:31');
  });
  it('counts copies', () => {
    expect(copiesWord(1)).toBe('1 copy');
    expect(copiesWord(7)).toBe('7 copies');
  });
});
