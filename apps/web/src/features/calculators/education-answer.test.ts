import { futureValueMinor, monthsUntil } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { addLevel, educationDraftFrom } from '../goals/education-model';
import { educationWorking } from './education-answer';

const TODAY = '2026-09-21';

function oneLevel(feeInflation = '10') {
  const draft = addLevel({ ...educationDraftFrom(undefined, 'IDR'), feeInflation });
  draft.levels[0] = {
    ...draft.levels[0]!,
    start: '2032',
    until: '2038',
    fees: [
      { ...draft.levels[0]!.fees[0]!, amount: '45000000' },
      { ...draft.levels[0]!.fees[1]!, amount: '20000000' },
      { ...draft.levels[0]!.fees[2]!, amount: '' },
    ],
  };
  return draft;
}

describe('the education answer on the Calculators page', () => {
  it('inflates each year once, to its own 1 January, through the goal engine', () => {
    const working = educationWorking(oneLevel(), 'IDR', TODAY);
    const dues = ['2032-01-01', '2033-01-01', '2034-01-01', '2035-01-01', '2036-01-01', '2037-01-01'];
    const todays = [65_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000];
    const once = dues.reduce((total, due, i) => total + futureValueMinor(todays[i]!, 1000, monthsUntil(TODAY, due)), 0);
    expect(working.problem).toBeNull();
    expect(working.answer!.totalMinor).toBe(once);
    // Not today's 165 jt, and not inflated twice.
    expect(working.answer!.totalMinor).toBeGreaterThan(165_000_000);
    const twice = dues.reduce((total, due, i) => total + futureValueMinor(futureValueMinor(todays[i]!, 1000, monthsUntil(TODAY, due)), 1000, monthsUntil(TODAY, due)), 0);
    expect(working.answer!.totalMinor).toBeLessThan(twice);
    expect(working.answer!.monthlyMinor).toBeGreaterThan(0);
  });

  it('a typed return moves the monthly figure, and the target not at all', () => {
    const banded = educationWorking(oneLevel(), 'IDR', TODAY).answer!;
    const draft = oneLevel();
    draft.levels[0] = { ...draft.levels[0]!, returnPercent: '4,5', returnTyped: true };
    const typed = educationWorking(draft, 'IDR', TODAY).answer!;
    expect(typed.totalMinor).toBe(banded.totalMinor);
    expect(typed.monthlyMinor).toBeGreaterThan(banded.monthlyMinor);
  });

  it('says what is wrong, and never throws, whatever is typed', () => {
    expect(educationWorking(educationDraftFrom(undefined, 'IDR'), 'IDR', TODAY)).toEqual({ problem: null, inputs: null, answer: null });
    expect(educationWorking(oneLevel('-'), 'IDR', TODAY).problem).toMatch(/percentage/);
    for (const value of ['', '-', ',', '1e400', '999999999999999999999', 'x', '2032,5']) {
      for (const field of ['start', 'until', 'returnPercent'] as const) {
        const draft = oneLevel();
        draft.levels[0] = { ...draft.levels[0]!, [field]: value, returnTyped: field === 'returnPercent' };
        expect(() => educationWorking(draft, 'IDR', TODAY), `${field}=${value}`).not.toThrow();
      }
      expect(() => educationWorking(oneLevel(value), 'IDR', TODAY)).not.toThrow();
      const fee = oneLevel();
      fee.levels[0]!.fees[1]!.amount = value;
      expect(() => educationWorking(fee, 'IDR', TODAY)).not.toThrow();
    }
  });
});
