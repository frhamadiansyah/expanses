import type { OwnableFlow } from '@expanses/core';
import type { ReactNode } from 'react';
import { Field, Select } from '../../ui';
import { type CodeChoiceGroup, choiceForCode, codeChoices } from './catalogue-view';

/**
 * Changing what a thing files as, in the words it was chosen with.
 *
 * The picker never shows a code, because nobody owns a "0503". Afterwards the thing has a page of its own, the
 * code is printed on it, and the question turns round: not "what do you own" but "which of these is it really?".
 * So the same list is offered again — the thing's own table, then the rest of that table under *Something else*.
 *
 * *Type a code instead* is the way out, and is the state a code no table names already sits in. It changes
 * nothing by itself: the caller keeps a four-digit box beside this list, because DJP's own guidance is to pick
 * the code that matches your situation, and a list the app wrote can never be the last word on that.
 */
export function CodePicker({
  flow,
  code,
  onChange,
  label = 'What it is',
  hint,
  disabled,
}: {
  flow: OwnableFlow;
  /** The code the thing files under today. Empty opens every table, since there is nothing to narrow by. */
  code: string;
  onChange: (code: string) => void;
  label?: string;
  /** What to say under the list. The default points at the box that takes a code this list does not name. */
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const groups = codeChoices(flow, code);
  const chosen = choiceForCode(groups, code);
  return (
    <Field label={label} hint={hint ?? 'For anything this list does not name, type the four digits below.'}>
      <Select
        value={chosen?.value ?? TYPE_A_CODE}
        disabled={disabled}
        onChange={(event) => {
          const picked = codeOf(groups, event.target.value);
          if (picked !== null) onChange(picked);
        }}
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={TYPE_A_CODE}>Type a code instead</option>
      </Select>
    </Field>
  );
}

/** Not a code: the row that says the answer is in the box, not in the list. */
const TYPE_A_CODE = '__type';

/** The code behind a chosen row, or null for the row that stands for typing one. */
function codeOf(groups: readonly CodeChoiceGroup[], value: string): string | null {
  for (const group of groups) {
    const hit = group.choices.find((choice) => choice.value === value);
    if (hit) return hit.code;
  }
  return null;
}
