import { describe, expect, it } from 'vitest';
import { codeLine, descriptionPick, fieldsToSave, planGroupChoices } from './settings-model';

describe('what a thing can count as', () => {
  it('offers a house the sides a house can be on, and never cash', () => {
    expect(planGroupChoices('property', 'property', 'use')).toEqual(['invest', 'use']);
  });

  it('offers money cash or investing, and money owed only what is owed', () => {
    expect(planGroupChoices('cash', 'fund', 'liquid')).toEqual(['liquid', 'invest']);
    expect(planGroupChoices(null, 'receivable', 'owed')).toEqual(['owed']);
  });

  it('keeps the side it counts on today, even one the narrowing leaves out', () => {
    expect(planGroupChoices('stock', 'investment', 'liquid')).toEqual(['liquid', 'invest']);
  });

  it('offers everything when it is not known what the thing is', () => {
    expect(planGroupChoices(undefined, 'investment', 'use')).toEqual(['liquid', 'invest', 'owed', 'use']);
  });
});

describe('the code line', () => {
  it('names the code with its table’s words, or says the usual one is used', () => {
    expect(codeLine('0102')).toMatch(/^0102 · \S/);
    expect(codeLine('')).toBe('Usual code');
    expect(codeLine('9999')).toBe('9999');
  });
});

describe('saving the tax report’s details field by field', () => {
  it('keeps the stored answer for a field that does not read well, and saves the rest', () => {
    const stored = { acct: '1', npwp: '001' };
    expect(fieldsToSave(stored, { acct: '22', npwp: 'x', owner: 'A' }, new Set(['npwp']))).toEqual({ acct: '22', npwp: '001', owner: 'A' });
    expect(fieldsToSave({}, { npwp: 'x' }, new Set(['npwp']))).toEqual({});
  });
});

describe('a Description picked from the list', () => {
  it('makes a saving account a current account, and back: the two share 0102, so the kind is what changes', () => {
    expect(descriptionPick({ code: '0102', subtype: 'savings' }, '0102', 'bank')).toEqual({ kind: 'bank' });
    expect(descriptionPick({ code: '0102', subtype: 'bank' }, '0102', 'savings')).toEqual({ kind: 'savings' });
  });

  it('writes the code, and the kind too, when the other of the two is picked from another code', () => {
    expect(descriptionPick({ code: '0101', subtype: 'bank' }, '0102', 'savings')).toEqual({ coretaxCode: '0102', kind: 'savings' });
    expect(descriptionPick({ code: '', subtype: 'savings' }, '0102', 'bank')).toEqual({ coretaxCode: '0102', kind: 'bank' });
  });

  it('writes only the code when the pick is not the other of the two', () => {
    expect(descriptionPick({ code: '0102', subtype: 'bank' }, '0101', 'cash')).toEqual({ coretaxCode: '0101' });
    expect(descriptionPick({ code: '0102', subtype: 'savings' }, '0109', 'code:0109')).toEqual({ coretaxCode: '0109' });
    // Typed in the code sheet: no item at all.
    expect(descriptionPick({ code: '0102', subtype: 'savings' }, '0199')).toEqual({ coretaxCode: '0199' });
    expect(descriptionPick({ code: '0102', subtype: 'savings' }, '')).toEqual({ coretaxCode: null });
  });

  it('never changes any other kind of account, whatever shares its code', () => {
    expect(descriptionPick({ code: '0109', subtype: 'fund' }, '0109', 'other_cash')).toEqual({});
    expect(descriptionPick({ code: '0102', subtype: 'cash' }, '0102', 'savings')).toEqual({});
    expect(descriptionPick({ code: '0101', subtype: 'cash' }, '0102', 'bank')).toEqual({ coretaxCode: '0102' });
    expect(descriptionPick({ code: '0102', subtype: undefined }, '0102', 'savings')).toEqual({});
  });

  it('is nothing at all when the same item is picked again', () => {
    expect(descriptionPick({ code: '0102', subtype: 'savings' }, '0102', 'savings')).toEqual({});
  });
});
