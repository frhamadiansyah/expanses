import { bandHint, levelStartsOn, monthsUntil, type ReturnBand, returnBandFor } from '@expanses/core';
import type { ReactElement } from 'react';
import { DestructiveRow, InsetGroup, InsetRow, SelectRow, TextRow } from '../../ui/native';
import { addFee, addLevel, type EducationDraft, educationInputsOf, type FeeDraft, type LevelDraft, levelWhen } from './education-model';

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
}: {
  value: EducationDraft;
  onChange: (next: EducationDraft) => void;
  currency: string;
  today: string;
}) {
  const byAge = value.birthday.trim() !== '';
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
      <InsetGroup header="The child" footer="Levels are set by age once a birthday is given; without one, by calendar year.">
        <TextRow label="Birthday" type="date" value={value.birthday} onChange={(e) => onChange({ ...value, birthday: e.target.value })} />
        <TextRow label="Fee inflation a year (%)" value={value.feeInflation} onChange={(e) => onChange({ ...value, feeInflation: e.target.value })} inputMode="decimal" />
      </InsetGroup>

      {value.levels.map((level) => {
        const band = bandFor(level);
        const title = level.name.trim() || 'this level';
        // The group places each row it is handed, so the fee rows are a flat list rather than wrappers.
        const feeRows: ReactElement[] = level.fees.flatMap((fee, index) => {
          const cost = fee.name.trim() || `Cost ${index + 1}`;
          return [
            <TextRow key={`${fee.id}-name`} label="Cost name" value={fee.name} onChange={(e) => setFee(level, fee.id, { name: e.target.value })} />,
            <TextRow
              key={`${fee.id}-amount`}
              label={`${cost} today (${currency})`}
              value={fee.amount}
              onChange={(e) => setFee(level, fee.id, { amount: e.target.value })}
              inputMode="decimal"
            />,
            <SelectRow
              key={`${fee.id}-charged`}
              label={`${cost} is paid`}
              value={fee.charged}
              onChange={(e) => setFee(level, fee.id, { charged: e.target.value as FeeDraft['charged'] })}
            >
              <option value="once">Once, at entry</option>
              <option value="yearly">Every year</option>
            </SelectRow>,
          ];
        });
        return (
          <div key={level.id}>
            <InsetGroup
              header={level.name.trim() || 'Level'}
              footer={level.start.trim() && level.until.trim() ? levelWhen(level, value.birthday) : undefined}
            >
              <TextRow label="Level name" value={level.name} onChange={(e) => setLevel(level.id, { ...level, name: e.target.value })} />
              <TextRow
                label={byAge ? 'Starts at age' : 'Starts in year'}
                value={level.start}
                onChange={(e) => setLevel(level.id, { ...level, start: e.target.value })}
                inputMode="numeric"
              />
              <TextRow
                label={byAge ? 'Until age' : 'Until year'}
                value={level.until}
                onChange={(e) => setLevel(level.id, { ...level, until: e.target.value })}
                inputMode="numeric"
              />
              {feeRows}
              <InsetRow title="Add a cost" label={`Add a cost to ${title}`} onClick={() => setLevel(level.id, addFee(level))} />
              <TextRow
                label="Assumed return (%)"
                hint={band ? bandHint(band) : 'Set when it starts to see its band.'}
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

      <InsetGroup footer="Monthly fees belong in the budget beside groceries; only the lumpy charges belong here.">
        <InsetRow title="Add a level" onClick={() => onChange(addLevel(value))} />
      </InsetGroup>
    </>
  );
}
