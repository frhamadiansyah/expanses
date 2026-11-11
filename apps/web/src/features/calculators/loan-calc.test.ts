import { calculatorSchedule } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { emptyLoanCalcDraft, emptyLoanKindDraft, type LoanKindDraft, loanCalcDraftFrom, loanWorking } from './loan-calc-form';
import {
  debtPrefill,
  feeLine,
  flatNote,
  halfRepaidText,
  incomeShare,
  interestOfLoan,
  jumpWarning,
  kindOfItem,
  loanResult,
  priceVsPaid,
  principalLabel,
  stageRate,
  stageTitle,
  totalCaption,
  yearlyCostWarning,
} from './loan-calc-view';

const TODAY = '2026-11-11';
/** Money is formatted with a no-break space after the symbol; the expectations are written with a plain one. */
const plain = (text: string | null | undefined) => text?.replace(/\u00a0/g, ' ');
const homeDraft = (patch: Partial<LoanKindDraft> = {}): LoanKindDraft => ({
  ...emptyLoanKindDraft('home'),
  price: '900.000.000',
  down: '20',
  years: '20',
  stages: [
    { kind: 'fixed', years: '3', rate: '5,5' },
    { kind: 'floating', years: '', rate: '11' },
  ],
  income: '30.000.000',
  ...patch,
});

describe('reading the loan calculator’s boxes', () => {
  it('works a home loan out from its price, down payment, years and stages, first paid next month', () => {
    const working = loanWorking('home', homeDraft(), 'IDR', TODAY);
    expect(working.problems).toEqual({});
    expect(working.input).toEqual({
      principalMinor: 720_000_000,
      method: 'annuity',
      stages: [
        { months: 36, rateBps: 550, kind: 'fixed' },
        { months: 204, rateBps: 1100, kind: 'floating' },
      ],
      firstPaymentOn: '2026-12-11',
      paymentDay: 11,
    });
    expect(working.facts).toMatchObject({ priceMinor: 900_000_000, downMinor: 180_000_000, loanMinor: 720_000_000, incomeMinor: 30_000_000 });
  });

  it('takes the down payment as an amount too, and the loan typed when no price is given', () => {
    expect(loanWorking('home', homeDraft({ down: '180.000.000', downAs: 'amount' }), 'IDR', TODAY).input?.principalMinor).toBe(720_000_000);
    expect(loanWorking('home', homeDraft({ price: '', amount: '500.000.000' }), 'IDR', TODAY).input?.principalMinor).toBe(500_000_000);
  });

  it('waits quietly for empty boxes, and names a box that does not read', () => {
    const empty = loanWorking('home', emptyLoanKindDraft('home'), 'IDR', TODAY);
    expect(empty).toEqual({ problems: {}, input: null, facts: null, loanMinor: null });
    expect(loanWorking('home', homeDraft({ years: '' }), 'IDR', TODAY)).toMatchObject({ input: null, loanMinor: 720_000_000 });
    const bad = loanWorking('home', homeDraft({ down: '120', years: '2,5' }), 'IDR', TODAY);
    expect(bad.input).toBeNull();
    expect(bad.problems).toMatchObject({ down: 'Less than the price', years: expect.any(String) });
    const tooLong = loanWorking('home', homeDraft({ years: '3' }), 'IDR', TODAY);
    expect(tooLong.problems['stage2.years']).toMatch(/fill the whole loan/);
  });

  it('reads a vehicle as flat, an online loan as flat a month with its fee, and any other by its switch', () => {
    const vehicle = loanWorking('vehicle', { ...emptyLoanKindDraft('vehicle'), price: '350.000.000', down: '25', months: '48', rate: '4,5' }, 'IDR', TODAY);
    expect(vehicle.input).toMatchObject({ principalMinor: 262_500_000, method: 'flat', stages: [{ months: 48, rateBps: 450, kind: 'fixed' }] });
    const online = loanWorking('online', { ...emptyLoanKindDraft('online'), amount: '6.000.000', months: '6', rate: '2,95', fee: '3' }, 'IDR', TODAY);
    expect(online.input).toMatchObject({ method: 'flat', stages: [{ months: 6, rateBps: 3540 }] });
    expect(online.facts?.feeMinor).toBe(180_000);
    const other = (flat: boolean) => loanWorking('other', { ...emptyLoanKindDraft('other'), amount: '50.000.000', months: '24', rate: '9', flat }, 'IDR', TODAY).input?.method;
    expect(other(true)).toBe('flat');
    expect(other(false)).toBe('annuity');
    expect(loanWorking('other', { ...emptyLoanKindDraft('other'), amount: '50.000.000', months: '24', rate: '0' }, 'IDR', TODAY).input?.method).toBe('zero');
  });

  it('refuses a length over fifty years and a rate over 100% a year, in plain words', () => {
    expect(loanWorking('home', homeDraft({ years: '51' }), 'IDR', TODAY)).toMatchObject({ input: null, problems: { years: 'At most 50 years' } });
    expect(loanWorking('home', homeDraft({ years: '50' }), 'IDR', TODAY).input).not.toBeNull();
    const other = (patch: Partial<LoanKindDraft>) => loanWorking('other', { ...emptyLoanKindDraft('other'), amount: '50.000.000', months: '24', rate: '9', ...patch }, 'IDR', TODAY);
    expect(other({ months: '601' })).toMatchObject({ input: null, problems: { months: 'At most 600 months' } });
    expect(other({ months: '99999999', rate: '0' })).toMatchObject({ input: null, problems: { months: 'At most 600 months' } });
    expect(other({ rate: '100,01' })).toMatchObject({ input: null, problems: { rate: 'At most 100% a year' } });
    expect(other({ rate: '100' }).input).not.toBeNull();
    expect(loanWorking('home', homeDraft({ stages: [{ kind: 'fixed', years: '3', rate: '5,5' }, { kind: 'floating', years: '', rate: '1000' }] }), 'IDR', TODAY).problems).toMatchObject({ 'stage2.rate': 'At most 100% a year' });
    const online = (rate: string) => loanWorking('online', { ...emptyLoanKindDraft('online'), amount: '6.000.000', months: '6', rate }, 'IDR', TODAY);
    expect(online('8,34')).toMatchObject({ input: null, problems: { rate: 'At most 8,33% a month' } });
    expect(online('8,33').input).not.toBeNull();
  });

  it('says a length that is not whole in its own unit, with no sample figure', () => {
    expect(loanWorking('other', { ...emptyLoanKindDraft('other'), amount: '50.000.000', months: '1,5', rate: '9' }, 'IDR', TODAY).problems.months).toBe('Whole months only');
    expect(loanWorking('home', homeDraft({ years: '2,5' }), 'IDR', TODAY).problems.years).toBe('Whole years only');
  });

  it('keeps a rate a month as typed to the third decimal, as Add debt does', () => {
    const online = loanWorking('online', { ...emptyLoanKindDraft('online'), amount: '6.000.000', months: '6', rate: '1,555' }, 'IDR', TODAY);
    expect(online.input?.stages[0]?.rateBps).toBe(1866);
  });

  it('reads what was kept back, and anything it cannot read as the empty box', () => {
    const kept = { ...emptyLoanCalcDraft(), kind: 'vehicle' as const };
    kept.drafts.home = homeDraft();
    expect(loanCalcDraftFrom(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(loanCalcDraftFrom(null)).toEqual(emptyLoanCalcDraft());
    expect(loanCalcDraftFrom({ kind: 'boat', drafts: { home: { price: 5, stages: 'x' } } })).toEqual({
      ...emptyLoanCalcDraft(),
      drafts: { ...emptyLoanCalcDraft().drafts, home: { ...emptyLoanKindDraft('home'), price: '' } },
    });
  });
});

describe('the loan calculator’s result', () => {
  const working = loanWorking('home', homeDraft(), 'IDR', TODAY);
  const result = loanResult(working.input!);

  it('totals the schedule and splits it into principal and interest that add up to 100%', () => {
    expect(result.rows).toEqual(calculatorSchedule(working.input!));
    expect(result.totalPaidMinor).toBe(1_629_625_844);
    expect(result.interestMinor).toBe(909_625_844);
    expect([result.principalPercent, result.interestPercent]).toEqual([44, 56]);
    expect(totalCaption('home', 240)).toBe('Total paid over 20 years');
    expect(totalCaption('vehicle', 48)).toBe('Total paid over 48 months');
    expect(principalLabel('home', 44)).toBe('Principal (loan) · 44%');
    expect(principalLabel('online', 85)).toBe('Principal · 85%');
    expect(interestOfLoan(result)).toBe('Interest is 126% of the loan.');
  });

  it('names each stage and warns when the fixed rate ends', () => {
    expect(stageTitle(result.lines[0]!, 'home')).toEqual({ months: 'Months 1–36', years: 'years 1–3' });
    expect(stageTitle(result.lines[1]!, 'home')).toEqual({ months: 'Months 37–240', years: 'years 4–20' });
    expect(stageTitle(result.lines[0]!, 'vehicle').years).toBeNull();
    expect(stageRate(result.lines[0]!, 'home', 'annuity')).toBe('5,5% a year · fixed');
    expect(stageRate(result.lines[1]!, 'home', 'annuity')).toBe('11% a year · floating');
    expect(result.lines.map((line) => line.paymentMinor)).toEqual([4_952_789, 7_114_340]);
    expect(plain(jumpWarning(result.jump, 'IDR'))).toBe('Up Rp 2.161.551 a month (+43,6%) when the fixed rate ends. A floating rate can move again later.');
    expect(jumpWarning(null, 'IDR')).toBeNull();
  });

  it('sets the price against everything paid, and the month half the loan is repaid', () => {
    const paid = priceVsPaid('home', working.facts!, result.interestMinor, 'IDR')!;
    expect(paid.caption).toBe('House price vs everything paid');
    expect(paid.parts.map((part) => [part.label, part.minor])).toEqual([
      ['Down payment', 180_000_000],
      ['Loan', 720_000_000],
      ['Interest', 909_625_844],
    ]);
    expect(plain(paid.total)).toBe('Total Rp 1.809.625.844 for a Rp 900.000.000 house');
    expect(priceVsPaid('home', { ...working.facts!, priceMinor: 0 }, 1, 'IDR')).toBeNull();
    expect(halfRepaidText(result.halfMonth)).toEqual({ month: 'month 172', year: '(year 15)' });
  });

  it('bands the share of income on the highest payment', () => {
    expect(incomeShare(result.lines, 30_000_000)).toEqual({ tag: '17% → 24%', widthPercent: 24, band: 'comfortable', note: 'Under 30% stays comfortable.' });
    expect(incomeShare(result.lines, 20_000_000)).toMatchObject({ tag: '25% → 36%', band: 'stretched', note: 'Between 30% and 40% is stretched.' });
    expect(incomeShare(result.lines, 15_000_000)).toMatchObject({ band: 'heavy', note: 'Over 40% leaves little room.' });
    expect(incomeShare(result.lines.slice(0, 1), 30_000_000)?.tag).toBe('17%');
    expect(incomeShare(result.lines, 0)).toBeNull();
    // The tag and the band agree at the edges: a share shown as 30% is not called under 30%, one shown as 40% not over 40%.
    const line = (paymentMinor: number) => [{ ...result.lines[0]!, paymentMinor }];
    expect(incomeShare(line(2_960), 10_000)).toMatchObject({ tag: '30%', band: 'stretched' });
    expect(incomeShare(line(2_940), 10_000)).toMatchObject({ tag: '29%', band: 'comfortable' });
    expect(incomeShare(line(4_040), 10_000)).toMatchObject({ tag: '40%', band: 'stretched' });
    expect(incomeShare(line(4_060), 10_000)).toMatchObject({ tag: '41%', band: 'heavy' });
  });

  it('says what a flat rate a year really costs', () => {
    const vehicle = loanWorking('vehicle', { ...emptyLoanKindDraft('vehicle'), price: '350.000.000', down: '25', months: '48', rate: '4,5' }, 'IDR', TODAY);
    const note = flatNote(vehicle.input!, 'vehicle')!;
    expect(`${note.lead}${note.figure}${note.tail}`).toBe(
      'Flat 4,5% a year works out to about 8,36% a year on what is still owed, because flat interest stays on the full loan the whole time.',
    );
    expect(stageRate(loanResult(vehicle.input!).lines[0]!, 'vehicle', 'flat')).toBe('4,5% a year · flat');
    expect(flatNote(working.input!, 'home')).toBeNull();
  });

  it('shows an online loan’s fee, its cost of borrowing, and what it adds up to a year', () => {
    const online = loanWorking('online', { ...emptyLoanKindDraft('online'), amount: '6.000.000', months: '6', rate: '2,95', fee: '3' }, 'IDR', TODAY);
    const res = loanResult(online.input!);
    expect(res.totalPaidMinor).toBe(7_062_000);
    expect(stageRate(res.lines[0]!, 'online', 'flat')).toBe('2,95% a month');
    expect(plain(feeLine(online.facts!, res.interestMinor, 'IDR'))).toBe('Fee at the start Rp 180.000 · cost of borrowing Rp 1.242.000 (20,7%)');
    const warning = yearlyCostWarning(online.facts!, res.rows, 'IDR')!;
    expect(plain(`${warning.lead}${warning.figure}${warning.tail}`)).toBe(
      'Adds up to about 97% a year. Only Rp 5.820.000 arrives after the fee, and the payments are on the full Rp 6.000.000.',
    );
    expect(feeLine({ ...online.facts!, feeMinor: 0 }, res.interestMinor, 'IDR')).toBeNull();
    // A figure in the thousands is grouped, and an absurd one is capped rather than written in exponents.
    const steep = { ...online.facts!, loanMinor: 10_000_000, feeMinor: 1_000_000 };
    expect(yearlyCostWarning(steep, [{ onDate: '2026-12-11', paymentMinor: 10_000_000, principalMinor: 10_000_000, interestMinor: 0, balanceMinor: 0 }], 'IDR')?.figure).toBe('254% a year');
    const huge = yearlyCostWarning({ ...steep, feeMinor: 9_999_999 }, [{ onDate: '2026-12-11', paymentMinor: 10_000_000, principalMinor: 10_000_000, interestMinor: 0, balanceMinor: 0 }], 'IDR')!;
    expect(huge.figure).toBe('over 1.000% a year');
    const thousands = yearlyCostWarning({ ...steep, feeMinor: 4_000_000 }, Array.from({ length: 6 }, () => ({ onDate: '2026-12-11', paymentMinor: 1_666_667, principalMinor: 1_666_667, interestMinor: 0, balanceMinor: 0 })), 'IDR')!;
    expect(thousands.figure).not.toMatch(/e\+/);
  });

  it('hands Add debt the debt, its figures and the loan’s shape', () => {
    expect(debtPrefill('home', working.input!, 'IDR')).toEqual({
      item: 'home_mortgage',
      name: 'Home loan',
      owed: '720.000.000',
      months: 240,
      firstPaymentOn: '2026-12-11',
      method: 'annuity',
      stages: working.input!.stages,
    });
    expect(debtPrefill('home', working.input!, 'IDR', 'apartment_mortgage').item).toBe('apartment_mortgage');
    // A debt brought from Add debt is kept only while the kind still matches it: switching kinds files it as the new kind.
    expect(debtPrefill('home', working.input!, 'IDR', 'online_loan').item).toBe('home_mortgage');
    expect(debtPrefill('vehicle', working.input!, 'IDR', 'apartment_mortgage').item).toBe('vehicle_leasing');
    expect(debtPrefill('other', working.input!, 'IDR', 'multi_purpose_loan').item).toBe('multi_purpose_loan');
    expect(kindOfItem('apartment_mortgage')).toBe('home');
    expect(kindOfItem('online_loan')).toBe('online');
    expect(kindOfItem('multi_purpose_loan')).toBe('other');
  });

  it('says nothing with “you” in it', () => {
    const lines = [jumpWarning(result.jump, 'IDR'), interestOfLoan(result), incomeShare(result.lines, 15_000_000)?.note, priceVsPaid('home', working.facts!, 1, 'IDR')?.total];
    for (const line of lines) expect(line).not.toMatch(/\byou(r)?\b/i);
  });
});
