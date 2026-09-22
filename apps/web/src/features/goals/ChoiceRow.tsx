import { useState, type ReactNode } from 'react';
import { Sheet } from '../../app/Sheet';
import { type GroupChild, InsetGroup, InsetRow, PickerRow } from '../../ui/native';

export interface Choice {
  value: string;
  label: string;
}

/**
 * A row whose answer is one of a few — chosen in the app's own sheet, not in the platform's picker.
 *
 * A `<select>` is right when the list is long: a year, a category tree, a broker. iOS draws the wheel and a
 * keyboard draws the menu, both for free, and a page of them is what native forms are made of. For two or three
 * answers that trade goes the wrong way: the system's panel is mostly empty, it cannot be styled, and it is the one
 * control on the screen that does not look like the app.
 *
 * So this is the other half of the kit's own pair: the row is `PickerRow` — label left, answer right, chevron —
 * and the sheet behind it is as tall as its answers, with a tick on the one in force. `SelectRow` keeps its place
 * for the long lists; the short ones belong here.
 */
export function ChoiceRow({
  label,
  value,
  options,
  onChoose,
  hint,
  position,
}: {
  label: string;
  /** The chosen value; the label it shows is looked up in `options`. */
  value: string;
  options: readonly Choice[];
  onChoose: (value: string) => void;
  hint?: ReactNode;
} & GroupChild) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value);
  return (
    <>
      <PickerRow label={label} value={chosen?.label ?? null} placeholder="Choose…" hint={hint} position={position} onOpen={() => setOpen(true)} />
      {open && (
        <Sheet title={label} onClose={() => setOpen(false)} grouped compact>
          <InsetGroup>
            {options.map((option) => (
              <InsetRow
                key={option.value}
                title={option.label}
                /* The tick is a selection, so it takes the tint — the one place colour still says something. */
                value={option.value === value ? '✓' : undefined}
                valueTone="tint"
                chevron={false}
                label={option.label}
                onClick={() => {
                  onChoose(option.value);
                  setOpen(false);
                }}
              />
            ))}
          </InsetGroup>
        </Sheet>
      )}
    </>
  );
}
