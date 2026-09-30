import { describe, expect, it } from 'vitest';
import { codeLine, fieldsToSave, planGroupChoices } from './settings-model';

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
