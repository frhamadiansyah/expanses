import { describe, expect, it } from 'vitest';
import { RETIREMENT_DEFAULTS, retirementWorking } from './retirement-form';

const filled = { ...RETIREMENT_DEFAULTS, annualSpend: '120000000', ageNow: '35', retireAge: '55', yearsInRetirement: '20' };

describe('the retirement working on the Calculators page', () => {
  it('opens on 3.5% inflation, 10% while saving and 5% while retired', () => {
    expect(RETIREMENT_DEFAULTS).toMatchObject({ inflation: '3.5', returnBefore: '10', returnInRetirement: '5' });
  });

  it('saves at the return while saving, not the return while retired (the defect it fixes)', () => {
    const at10 = retirementWorking(filled, 'IDR');
    const at5 = retirementWorking({ ...filled, returnBefore: '5' }, 'IDR');
    expect(at10.answer?.targetMinor).toBe(at5.answer?.targetMinor);
    expect(at10.answer!.monthlyMinor).toBeLessThan(at5.answer!.monthlyMinor);
    // The drawdown return moves the pot, never the saving rate.
    expect(at10.answer!.returnBps).toBe(1000);
    expect(at10.inputs).toMatchObject({ version: 2, yearsToRetirement: 20, returnBeforeBps: 1000, returnInRetirementBps: 500, inflationBps: 350 });
  });

  it('shows the pot in the money of the day you stop, which the goal reaches by inflating today’s once', () => {
    // 120 jt a year for 20 years at 5% against 3.5%, inflated 20 years at 3.5%.
    expect(retirementWorking(filled, 'IDR').answer!.targetMinor).toBe(4_120_008_061);
  });

  it('puts each refusal on its own row and never throws, whatever is typed', () => {
    const working = retirementWorking({ ...filled, inflation: '-', returnBefore: ',', returnInRetirement: '-100', yearsInRetirement: '20,5' }, 'IDR');
    expect(working.answer).toBeNull();
    expect(Object.keys(working.problems).sort()).toEqual(['inflation', 'returnBefore', 'returnInRetirement', 'yearsInRetirement']);
    expect(retirementWorking({ ...filled, retireAge: '30' }, 'IDR').problems.retireAge).toMatch(/after/);

    const junk = ['', '-', ',', '.', '-100', '1e400', '999999999999999999999', 'x', '0', '20,5', '  '];
    for (const value of junk) {
      for (const field of Object.keys(RETIREMENT_DEFAULTS) as (keyof typeof RETIREMENT_DEFAULTS)[]) {
        expect(() => retirementWorking({ ...filled, [field]: value }, 'IDR'), `${field}=${value}`).not.toThrow();
      }
    }
  });

  it('shows no answer, and no refusal, while the spending is still empty', () => {
    const working = retirementWorking(RETIREMENT_DEFAULTS, 'IDR');
    expect(working.answer).toBeNull();
    expect(working.problems).toEqual({});
  });
});
