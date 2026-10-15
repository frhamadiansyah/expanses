import { SharingError } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { isStillHasPhone, oldPhoneTitle } from './people-phone';

describe('a lost phone on People', () => {
  it('recognises the refusal that offers removing the old phone, and nothing else', () => {
    expect(isStillHasPhone(new SharingError('STILL_HAS_PHONE', 'Andi still has a phone in this event.'))).toBe(true);
    expect(isStillHasPhone(new SharingError('NOT_OWNER', 'x'))).toBe(false);
    expect(isStillHasPhone(new Error('x'))).toBe(false);
  });

  it('asks twice before removing the old phone, naming the person', () => {
    expect(oldPhoneTitle('Andi', false)).toBe("Remove Andi's old phone");
    expect(oldPhoneTitle('Andi', true)).toBe("Tap again to remove Andi's old phone");
  });
});
