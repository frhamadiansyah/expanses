import type { Tone } from './row';

/**
 * What a form row shows on its right, and whether it points at anything.
 *
 * The rule this encodes is the one the app breaks most often: a field is a **line**, label left and value
 * right, never a label stacked above an outlined box and never a bare `<select>`. What differs between fields
 * is only what the right-hand side is, so that is all this decides.
 */

export type FormKind =
  /** Opens a picker — a sheet, a list, a native date control. Chevron, value in the tint. */
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
 * An unanswered picker shows its placeholder in the tertiary ink, because a grey word reads as a prompt and a
 * green one reads as a choice already made — the difference between "Category" waiting and "Groceries" chosen
 * is the only state a one-line field has room to show.
 */
export function planFormRow(kind: FormKind, value: string | null | undefined, placeholder = ''): FormRowPlan {
  const answered = value !== null && value !== undefined && value !== '';
  if (!answered) return { text: placeholder, tone: 'ink-3', chevron: kind === 'picker', placeholder: true };
  switch (kind) {
    case 'picker':
      return { text: value, tone: 'tint', chevron: true, placeholder: false };
    case 'typed':
      return { text: value, tone: 'ink', chevron: false, placeholder: false };
    case 'static':
      return { text: value, tone: 'ink-2', chevron: false, placeholder: false };
  }
}
