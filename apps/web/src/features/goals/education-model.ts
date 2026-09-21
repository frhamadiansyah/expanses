import { DEFAULT_FEES, EDUCATION_INFLATION_BPS, type EducationPlanInputs, type FeeCharge, minorToMajorString, OFFERED_LEVELS, parseMajor, uuidv7 } from '@expanses/core';

/** One cost of a level as typed: its name, today's amount, and whether it is paid once or every year. */
export interface FeeDraft {
  id: string;
  name: string;
  amount: string;
  charged: FeeCharge;
}

/** A level as typed. `start`/`until` are ages when the child's birthday is given, calendar years when it is not. */
export interface LevelDraft {
  id: string;
  name: string;
  start: string;
  until: string;
  fees: FeeDraft[];
  returnPercent: string;
  /** False while the return follows the band for the months until the level starts. */
  returnTyped: boolean;
}

export interface EducationDraft {
  birthday: string;
  feeInflation: string;
  levels: LevelDraft[];
}

const percent = (bps: number) => String(bps / 100);

/** A saved working as the form shows it — or, with none, the form's own start: no levels, 10% fee inflation. */
export function educationDraftFrom(inputs: EducationPlanInputs | undefined, currency: string): EducationDraft {
  if (!inputs) return { birthday: '', feeInflation: percent(EDUCATION_INFLATION_BPS), levels: [] };
  const byAge = inputs.birthday !== null;
  return {
    birthday: inputs.birthday ?? '',
    feeInflation: percent(inputs.feeInflationBps),
    levels: inputs.levels.map((level) => ({
      id: level.id,
      name: level.name,
      start: String((byAge ? level.startAge : level.startYear) ?? ''),
      until: String((byAge ? level.untilAge : level.untilYear) ?? ''),
      fees: level.fees.map((fee) => ({ id: fee.id, name: fee.name, amount: minorToMajorString(fee.amountTodayMinor, currency), charged: fee.charged })),
      returnPercent: level.returnBps === null ? '' : percent(level.returnBps),
      returnTyped: level.returnBps !== null,
    })),
  };
}

/** The next offered level not yet used, with Enrollment (once), Academic (every year) and Other (once) to fill in. */
export function addLevel(draft: EducationDraft): EducationDraft {
  const used = new Set(draft.levels.map((level) => level.name));
  const name = OFFERED_LEVELS.find((offered) => !used.has(offered)) ?? 'Another level';
  const level: LevelDraft = {
    id: uuidv7(),
    name,
    start: '',
    until: '',
    returnPercent: '',
    returnTyped: false,
    fees: DEFAULT_FEES.map((fee) => ({ id: uuidv7(), name: fee.name, amount: '', charged: fee.charged })),
  };
  return { ...draft, levels: [...draft.levels, level] };
}

export function addFee(level: LevelDraft): LevelDraft {
  return { ...level, fees: [...level.fees, { id: uuidv7(), name: '', amount: '', charged: 'once' }] };
}

const whole = (value: string, what: string) => {
  const trimmed = value.trim();
  const number = trimmed === '' ? Number.NaN : Number(trimmed);
  if (!Number.isInteger(number)) throw new Error(`${what} must be a whole number`);
  return number;
};

/** "4,5" or "4.5" as basis points; anything that is not a number is refused, never read as NaN or 0. */
const percentBps = (value: string, what: string) => {
  const trimmed = value.trim().replace(',', '.');
  const number = trimmed === '' ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(number)) throw new Error(`${what} must be a percentage`);
  return Math.round(number * 100);
};

/** Every typed figure read once, by `parseMajor`; a fee left empty is not a fee. Throws a sentence on anything half-typed. */
export function educationInputsOf(draft: EducationDraft, currency: string): EducationPlanInputs {
  const byAge = draft.birthday.trim() !== '';
  return {
    version: 2,
    birthday: byAge ? draft.birthday.trim() : null,
    feeInflationBps: percentBps(draft.feeInflation, 'Fee inflation'),
    levels: draft.levels.map((level) => {
      const name = level.name.trim() || 'Level';
      const start = whole(level.start, `${name}'s start`);
      const until = whole(level.until, `${name}'s end`);
      // A typed return emptied again follows the band once more.
      const typed = level.returnTyped && level.returnPercent.trim() !== '';
      const returnBps = typed ? percentBps(level.returnPercent, `${name}'s return`) : null;
      if (returnBps !== null && returnBps < 0) throw new Error(`${name}'s return cannot be below nothing`);
      return {
        id: level.id,
        name,
        startAge: byAge ? start : null,
        untilAge: byAge ? until : null,
        startYear: byAge ? null : start,
        untilYear: byAge ? null : until,
        returnBps,
        fees: level.fees
          .filter((fee) => fee.amount.trim() !== '')
          .map((fee) => ({ id: fee.id, name: fee.name.trim() || 'Fee', amountTodayMinor: parseMajor(fee.amount, currency), charged: fee.charged })),
      };
    }),
  };
}

/** "Ages 6 to 12 · 2032 to 2038", or "2032 to 2038 · due 1 January each year" with no birthday. */
export function levelWhen(level: Pick<LevelDraft, 'start' | 'until'>, birthday: string): string {
  if (birthday.trim()) {
    const born = Number(birthday.slice(0, 4));
    return `Ages ${level.start} to ${level.until} · ${born + Number(level.start)} to ${born + Number(level.until)}`;
  }
  return `${level.start} to ${level.until} · due 1 January each year`;
}
