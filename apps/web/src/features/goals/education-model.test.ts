import { type EducationPlanInputs, educationPlanStages } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { addFee, addLevel, educationDraftFrom, educationInputsOf, levelWhen } from './education-model';

describe('the education draft', () => {
  it('offers the next unused level name, and three default fees', () => {
    let draft = addLevel(educationDraftFrom(undefined, 'IDR'));
    draft = addLevel(draft);
    expect(draft.levels.map((level) => level.name)).toEqual(['Preschool', 'Primary School']);
    expect(draft.levels[0]!.fees.map((fee) => [fee.name, fee.charged])).toEqual([
      ['Enrollment', 'once'],
      ['Academic', 'yearly'],
      ['Other', 'once'],
    ]);
  });

  it('reads amounts with parseMajor, drops empty fees, and leaves the return to the band unless it was typed', () => {
    const draft = addLevel(educationDraftFrom(undefined, 'IDR'));
    draft.levels[0] = {
      ...draft.levels[0]!,
      start: '2032',
      until: '2038',
      fees: [
        { ...draft.levels[0]!.fees[0]!, amount: '45.000.000' },
        { ...draft.levels[0]!.fees[1]!, amount: '20.000.000' },
        { ...draft.levels[0]!.fees[2]!, amount: '' },
      ],
    };
    const inputs = educationInputsOf(draft, 'IDR');
    expect(inputs.levels[0]).toMatchObject({ startYear: 2032, untilYear: 2038, startAge: null, returnBps: null });
    expect(inputs.levels[0]!.fees.map((fee) => fee.amountTodayMinor)).toEqual([45_000_000, 20_000_000]);
    expect(inputs.feeInflationBps).toBe(1000);

    draft.levels[0] = { ...draft.levels[0]!, returnPercent: '4,5', returnTyped: true };
    expect(educationInputsOf(draft, 'IDR').levels[0]!.returnBps).toBe(450);
  });

  it('reads the start and end as ages once a birthday is given', () => {
    const draft = addLevel({ ...educationDraftFrom(undefined, 'IDR'), birthday: '2026-03-15' });
    draft.levels[0] = { ...draft.levels[0]!, start: '6', until: '12', fees: [{ ...draft.levels[0]!.fees[1]!, amount: '20000000' }] };
    expect(educationInputsOf(draft, 'IDR').levels[0]).toMatchObject({ startAge: 6, untilAge: 12, startYear: null, untilYear: null });
  });

  it('says when a level runs, and on what day with no birthday', () => {
    const level = { start: '6', until: '12' } as never;
    expect(levelWhen(level, '2026-03-15')).toBe('Ages 6 to 12 · 2032 to 2038');
    expect(levelWhen({ start: '2032', until: '2038' } as never, '')).toBe('2032 to 2038 · due 1 January each year');
  });

  it('reads a saved working back as it was saved, typed return and all (c2 concern 4)', () => {
    const saved: EducationPlanInputs = {
      version: 2,
      birthday: '2026-03-15',
      feeInflationBps: 1200,
      levels: [
        {
          id: 'lv-1',
          name: 'Primary',
          startAge: 6,
          untilAge: 12,
          startYear: null,
          untilYear: null,
          returnBps: 450,
          fees: [
            { id: 'f-1', name: 'Enrollment', amountTodayMinor: 45_000_000, charged: 'once' },
            { id: 'f-2', name: 'Academic', amountTodayMinor: 20_000_000, charged: 'yearly' },
          ],
        },
        { id: 'lv-2', name: 'University', startAge: 18, untilAge: 22, startYear: null, untilYear: null, returnBps: null, fees: [{ id: 'f-3', name: 'Academic', amountTodayMinor: 60_000_000, charged: 'yearly' }] },
      ],
    };
    const draft = educationDraftFrom(saved, 'IDR');
    expect(draft.birthday).toBe('2026-03-15');
    expect(draft.feeInflation).toBe('12');
    expect(draft.levels.map((level) => [level.name, level.start, level.until, level.returnPercent, level.returnTyped])).toEqual([
      ['Primary', '6', '12', '4.5', true],
      ['University', '18', '22', '', false],
    ]);
    expect(draft.levels[0]!.fees.map((fee) => [fee.name, fee.amount, fee.charged])).toEqual([
      ['Enrollment', '45000000', 'once'],
      ['Academic', '20000000', 'yearly'],
    ]);
    // And back again, unchanged: ids kept, so a re-work finds the same stages and their paid marks.
    expect(educationInputsOf(draft, 'IDR')).toEqual(saved);
  });

  it('keeps cents in a dollar workspace both ways', () => {
    const saved: EducationPlanInputs = {
      version: 2,
      birthday: null,
      feeInflationBps: 500,
      levels: [{ id: 'l', name: 'College', startAge: null, untilAge: null, startYear: 2030, untilYear: 2034, returnBps: null, fees: [{ id: 'f', name: 'Tuition', amountTodayMinor: 1_200_050, charged: 'yearly' }] }],
    };
    const draft = educationDraftFrom(saved, 'USD');
    expect(draft.levels[0]!.fees[0]!.amount).toBe('12000.50');
    expect(educationInputsOf(draft, 'USD')).toEqual(saved);
    // "12.000,50" typed the local way is 1.200.050 cents too, not 12.000,50 dollars read as whole.
    draft.levels[0]!.fees[0]!.amount = '12.000,50';
    expect(educationInputsOf(draft, 'USD').levels[0]!.fees[0]!.amountTodayMinor).toBe(1_200_050);
  });

  it('a once fee is in the first year only, a yearly one in every year — through the core stages', () => {
    const draft = addLevel(educationDraftFrom(undefined, 'IDR'));
    draft.levels[0] = {
      ...draft.levels[0]!,
      start: '2032',
      until: '2038',
      fees: [
        { ...draft.levels[0]!.fees[0]!, amount: '45000000' },
        { ...draft.levels[0]!.fees[1]!, amount: '20000000' },
      ],
    };
    const stages = educationPlanStages(educationInputsOf(draft, 'IDR'), '2026-09-21');
    expect(stages.map((stage) => stage.targetTodayMinor)).toEqual([65_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000]);
    expect(stages[0]!.dueOn).toBe('2032-01-01');
  });

  it('adds an empty fee paid once', () => {
    const level = addFee(addLevel(educationDraftFrom(undefined, 'IDR')).levels[0]!);
    expect(level.fees).toHaveLength(4);
    expect(level.fees[3]).toMatchObject({ name: '', amount: '', charged: 'once' });
  });

  it('refuses a half-typed year, rate or return with a sentence, never NaN', () => {
    const base = addLevel(educationDraftFrom(undefined, 'IDR'));
    const level = { ...base.levels[0]!, start: '2032', until: '2038', fees: [{ ...base.levels[0]!.fees[1]!, amount: '20000000' }] };
    expect(() => educationInputsOf({ ...base, levels: [{ ...level, start: '2032,5' }] }, 'IDR')).toThrow(/whole number/);
    expect(() => educationInputsOf({ ...base, levels: [{ ...level, start: '' }] }, 'IDR')).toThrow(/whole number/);
    expect(() => educationInputsOf({ ...base, feeInflation: ',' }, 'IDR')).toThrow(/percentage/);
    expect(() => educationInputsOf({ ...base, feeInflation: '-' }, 'IDR')).toThrow(/percentage/);
    expect(() => educationInputsOf({ ...base, levels: [{ ...level, returnPercent: '-', returnTyped: true }] }, 'IDR')).toThrow(/percentage/);
    // A return below nothing cannot be stored against a stage.
    expect(() => educationInputsOf({ ...base, levels: [{ ...level, returnPercent: '-1', returnTyped: true }] }, 'IDR')).toThrow(/below nothing/);
    // A typed return emptied again goes back to the band rather than reading as 0%.
    expect(educationInputsOf({ ...base, levels: [{ ...level, returnPercent: '', returnTyped: true }] }, 'IDR').levels[0]!.returnBps).toBeNull();
  });
});
