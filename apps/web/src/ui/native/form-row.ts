import { ROW_PAD_X, rowHeight } from './metrics';
import type { Tone } from './row';

/**
 * What a form row shows on its right, and whether it points at anything.
 *
 * The rule this encodes is the one the app breaks most often: a field is a **line**, label left and value
 * right, never a label stacked above an outlined box and never a bare `<select>`. What differs between fields
 * is only what the right-hand side is, so that is all this decides.
 */

export type FormKind =
  /** Opens a picker — a sheet, a list, a native date control. Chevron, the answer in the secondary ink. */
  | 'picker'
  /** Typed into in place. No chevron: nothing opens, the caret is already there. */
  | 'typed'
  /** Shown, not asked for — a computed total, a workspace name. No chevron, quieter ink. */
  | 'static';

export interface FormRowPlan {
  /** What to draw on the right: the value, or the placeholder when nothing is chosen yet. */
  text: string;
  tone: Tone;
  chevron: boolean;
  /** True when `text` is standing in for an answer rather than being one. */
  placeholder: boolean;
}

/**
 * The right-hand side of a form row.
 *
 * An unanswered picker shows its placeholder in the tertiary ink, and an answered one in the secondary ink — the
 * weight of the grey, with the chevron beside it, is the whole difference a one-line field has room for, and it is
 * what native does: a prompt is a light grey word, an answer a darker one. The tint is not spent here (a value is
 * not an action, and a page of green values reads as a page of links).
 */
export function planFormRow(kind: FormKind, value: string | null | undefined, placeholder = ''): FormRowPlan {
  const answered = value !== null && value !== undefined && value !== '';
  if (!answered) return { text: placeholder, tone: 'ink-3', chevron: kind === 'picker', placeholder: true };
  switch (kind) {
    case 'picker':
      return { text: value, tone: 'ink-2', chevron: true, placeholder: false };
    case 'typed':
      return { text: value, tone: 'ink', chevron: false, placeholder: false };
    case 'static':
      return { text: value, tone: 'ink-2', chevron: false, placeholder: false };
  }
}

export interface SwitchRowPlan {
  /** The row's own line. A hint sits under it and does not stretch it. */
  minHeight: number;
  /** Where the hairline starts: level with the label, since a switch row never carries an icon. */
  separatorInset: number;
  /** The label's ink — quieter when the answer cannot be changed. */
  labelTone: Tone;
  /** Whether a hint is drawn under the row at all. */
  hint: boolean;
  /** What the control is saying, for the row that has to announce it rather than draw it. */
  state: 'on' | 'off';
}

/**
 * A row whose answer is yes or no.
 *
 * The kit's six form rows all put an answer on the right, and a toggle is that shape with a control instead of
 * a word — which is why three checkboxes on the net-worth screens had nowhere in the vocabulary to go and ended
 * up floating loose on the page beside their sentences, the exact shape the kit set out to remove. It decides
 * nothing a form row does not already decide: the same row height, the same separator inset, the same inks.
 */
export function planSwitchRow(row: { checked: boolean; hint?: boolean; disabled?: boolean }): SwitchRowPlan {
  return {
    minHeight: rowHeight(false),
    separatorInset: ROW_PAD_X,
    labelTone: row.disabled === true ? 'ink-3' : 'ink',
    hint: row.hint === true,
    state: row.checked ? 'on' : 'off',
  };
}
