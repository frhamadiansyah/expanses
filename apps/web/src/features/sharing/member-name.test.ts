import { describe, expect, it } from 'vitest';
import { memberNameDraft } from './member-name';

describe('the Name sheet of this member (D-D2)', () => {
  it('saves a trimmed name that differs from the current one', () => {
    expect(memberNameDraft('  Ratna  ', 'Ratih')).toEqual({ name: 'Ratna', canSave: true, tooLong: false });
  });

  it('cannot save an empty or whitespace name', () => {
    expect(memberNameDraft('', 'Ratih').canSave).toBe(false);
    expect(memberNameDraft('   ', 'Ratih').canSave).toBe(false);
  });

  it('cannot save the same name, spaces aside', () => {
    expect(memberNameDraft(' Ratih ', 'Ratih').canSave).toBe(false);
  });

  it('takes 40 characters after trimming, and not 41', () => {
    expect(memberNameDraft(` ${'a'.repeat(40)} `, 'Ratih')).toMatchObject({ canSave: true, tooLong: false });
    expect(memberNameDraft('a'.repeat(41), 'Ratih')).toMatchObject({ canSave: false, tooLong: true });
  });
});
