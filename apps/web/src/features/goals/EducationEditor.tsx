import { groupTypedAmount, levelStartsOn, monthsUntil, type ReturnBand, returnBandFor } from '@expanses/core';
import { type ReactElement, useState } from 'react';
import { DestructiveRow, InsetGroup, InsetRow, TextRow } from '../../ui/native';
import { readPercent, readWhole } from '../calculators/fields';
import { addFee, addLevel, type EducationDraft, educationInputsOf, type FeeDraft, type LevelDraft, type YearField, yearProblem } from './education-model';
import { CostRow, YearsRow } from './EducationRows';

/**
 * The education fund's levels: a birthday asked once, then each level the user names, with its costs (paid once at
 * entry or every year) and a return of its own. One controlled component; the goal's calculator and the Calculators
 * page both hold the draft and read it with `educationInputsOf`.
 */
export function EducationEditor({
  value,
  onChange,
  currency,
  today,
  name,
  onName,
  attempted = false,
}: {
  /** True once saving has been tried: a start or end still blank is said then, not before. */
  attempted?: boolean;
  /** The child's name, when the page holds more than one child; the goal's own editor leaves both out. */
  name?: string;
  onName?: (next: string) => void;
  value: EducationDraft;
  onChange: (next: EducationDraft) => void;
  currency: string;
  today: string;
}) {
  const byAge = value.birthday.trim() !== '';
  // A box that does not read says so on its own row; an empty one is only not filled in yet.
  const percentProblem = (typed: string) => {
    if (typed.trim() === '') return undefined;
    const read = readPercent(typed);
    if (!read.ok) return read.problem;
    return read.value < 0 ? 'Not below nothing' : undefined;
  };
  // A start or end typed in that does not read says so at once; one still blank keeps quiet until it is touched or saving is tried.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const touch = (level: LevelDraft, field: YearField) => setTouched((was) => new Set(was).add(`${level.id}:${field}`));
  const yearsHint = (level: LevelDraft) => {
    for (const field of ['start', 'until'] as const) {
      const problem = yearProblem(level, field, byAge);
      if (problem && (!problem.empty || attempted || touched.has(`${level.id}:${field}`))) return problem.text;
      if (!problem) {
        const read = readWhole(level[field]);
        if (!read.ok) return read.problem.replace('years', byAge ? 'ages' : 'years').replace('like 10', byAge ? 'like 6' : 'like 2032');
      }
    }
    return undefined;
  };
  const setLevel = (id: string, next: LevelDraft) => onChange({ ...value, levels: value.levels.map((level) => (level.id === id ? next : level)) });
  const setFee = (level: LevelDraft, id: string, patch: Partial<FeeDraft>) =>
    setLevel(level.id, { ...level, fees: level.fees.map((fee) => (fee.id === id ? { ...fee, ...patch } : fee)) });

  // The band for the months until the level starts. A level not yet placed in time has no band yet, and says so.
  const bandFor = (level: LevelDraft): ReturnBand | null => {
    try {
      const inputs = educationInputsOf({ ...value, levels: [{ ...level, returnTyped: false }] }, currency);
      return returnBandFor(monthsUntil(today, levelStartsOn(inputs.levels[0]!, inputs.birthday)));
    } catch {
      return null;
    }
  };

  return (
    <>
      <InsetGroup>
        {onName && <TextRow label="Name" value={name ?? ''} onChange={(e) => onName(e.target.value)} placeholder="Name" />}
        <TextRow label="Birthday" type="date" value={value.birthday} onChange={(e) => onChange({ ...value, birthday: e.target.value })} />
        <TextRow
          label="Fee inflation a year (%)"
          hint={value.feeInflation.trim() === '' ? 'Type a percentage, like 10' : percentProblem(value.feeInflation)}
          value={value.feeInflation}
          onChange={(e) => onChange({ ...value, feeInflation: e.target.value })}
          inputMode="decimal"
        />
      </InsetGroup>

      {value.levels.map((level) => {
        const band = bandFor(level);
        const title = level.name.trim() || 'this level';
        // The group places each row it is handed, so the cost rows are a flat list rather than wrappers.
        const feeRows: ReactElement[] = level.fees.map((fee, index) => (
          <CostRow
            key={fee.id}
            index={index}
            fee={fee}
            currency={currency}
            onName={(next) => setFee(level, fee.id, { name: next })}
            onAmount={(typed) => setFee(level, fee.id, { amount: groupTypedAmount(typed, currency) })}
            onCharged={(next) => setFee(level, fee.id, { charged: next })}
            onDelete={() => setLevel(level.id, { ...level, fees: level.fees.filter((each) => each.id !== fee.id) })}
          />
        ));
        return (
          <div key={level.id}>
            <InsetGroup header={level.name.trim() || 'Level'}>
              <TextRow label="Level name" value={level.name} onChange={(e) => setLevel(level.id, { ...level, name: e.target.value })} />
              <YearsRow
                byAge={byAge}
                from={level.start}
                to={level.until}
                onFrom={(next) => {
                  touch(level, 'start');
                  setLevel(level.id, { ...level, start: next });
                }}
                onTo={(next) => {
                  touch(level, 'until');
                  setLevel(level.id, { ...level, until: next });
                }}
                hint={yearsHint(level)}
              />
              {feeRows}
              <InsetRow title="Add a cost" label={`Add a cost to ${title}`} onClick={() => setLevel(level.id, addFee(level))} />
              <TextRow
                label="Assumed return (%)"
                hint={level.returnTyped ? percentProblem(level.returnPercent) : undefined}
                value={level.returnTyped ? level.returnPercent : band ? String(band.returnBps / 100) : ''}
                onChange={(e) => setLevel(level.id, { ...level, returnPercent: e.target.value, returnTyped: true })}
                inputMode="decimal"
              />
            </InsetGroup>
            {/* Its own group: a removal a row away from the return box is the wrong tap to make. */}
            <InsetGroup>
              <DestructiveRow label={`Remove ${title}`} onClick={() => onChange({ ...value, levels: value.levels.filter((l) => l.id !== level.id) })} />
            </InsetGroup>
          </div>
        );
      })}

      <InsetGroup>
        <InsetRow title="Add a level" onClick={() => onChange(addLevel(value))} />
      </InsetGroup>
    </>
  );
}
