import { describe, expect, it } from 'vitest';
import { emergencyDraftFrom, emergencyInputsOf, monthsNote, typedMonths, withAnswers } from './emergency-form';

describe('the emergency months box', () => {
  it('opens on single and salaried, three months, essential', () => {
    expect(emergencyInputsOf(emergencyDraftFrom())).toEqual({ months: 3, household: 'single', income: 'salaried', base: 'essential' });
  });

  it('follows the two answers until a figure is typed', () => {
    let draft = withAnswers(emergencyDraftFrom(), { household: 'children' });
    expect(draft.months).toBe('12');
    draft = withAnswers(draft, { income: 'irregular' });
    expect(draft.months).toBe('24');
    expect(monthsNote(draft)).toBe('24 months · with children, freelance or irregular');

    draft = typedMonths(draft, '9');
    draft = withAnswers(draft, { household: 'single' });
    expect(draft.months).toBe('9');
    expect(monthsNote(draft)).toBe('Your own figure · the guide for single, freelance or irregular is 6');
  });

  it('reads a working saved before the answers existed as the user’s own figure', () => {
    const draft = emergencyDraftFrom({ months: 6 });
    expect(draft.months).toBe('6');
    expect(draft.monthsTyped).toBe(true);
  });

  it('refuses months that are not a number above zero', () => {
    expect(() => emergencyInputsOf(typedMonths(emergencyDraftFrom(), '0'))).toThrow();
  });

  it('reads 9,5 months with a comma, the one reader every form uses', () => {
    expect(emergencyInputsOf(typedMonths(emergencyDraftFrom(), '9,5')).months).toBe(9.5);
  });

  it('reopens a saved working on its answers and its base', () => {
    const draft = emergencyDraftFrom({ months: 12, household: 'children', income: 'salaried', base: 'all' });
    expect(draft).toEqual({ household: 'children', income: 'salaried', months: '12', monthsTyped: false, base: 'all' });
    expect(monthsNote(draft)).toBe('12 months · with children, salaried');
  });
});
