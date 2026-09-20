import { useState } from 'react';
import { cx } from '../../ui';

/**
 * How one way in draws the question — the words and the classes, never the guards.
 *
 * The guards are the same three everywhere, which is the whole point of this file. What differs between a
 * button standing in a column and a block revealed by a swipe is how much room there is to ask in: "Click
 * again to delete" does not fit in 74 pixels, so the swipe asks "Delete?" and means exactly the same thing.
 */
const LOOKS = {
  /** A button among buttons: the receipt's actions, and the edit sheet's ⋯. */
  inline: {
    idle: 'Delete',
    armed: 'Click again to delete',
    name: (armed: boolean) => (armed ? 'Click again to delete' : 'Delete this transaction'),
    className: (armed: boolean) =>
      cx('min-h-11 rounded-lg px-3 text-sm font-medium disabled:opacity-60', armed ? 'bg-red-700 text-white' : 'text-red-700 hover:bg-red-50'),
  },
  /** The full-height block behind a swiped row, as wide as the reveal makes it. */
  swipe: {
    idle: 'Delete',
    armed: 'Delete?',
    // Named by what is written on it, so "Delete" and "Delete?" are what a reader and a spec both see.
    name: () => undefined,
    className: () => 'w-[74px] bg-red-700 text-sm font-semibold text-white disabled:opacity-60',
  },
} as const;

export type TwoTapLook = keyof typeof LOOKS;

/**
 * Deleting asks twice, in place — the same two taps the list and the table already ask for.
 *
 * Its own file because the receipt, the phone's edit sheet and the phone's **swipe** all draw it, and they have
 * to ask the same question: a second copy is a second chance for one way in to delete on a single tap. The
 * swipe was that second copy, and it did exactly that — it kept `armed` in the row around it, one level above
 * the button, so arming outlived the gesture that made it. Tap Delete, tap the row's face to close it, swipe it
 * open again, and the button was still reading "Delete?": one tap, and the transaction was gone.
 *
 * Three guards, and the third is the reason the state lives **here** rather than in a caller:
 *
 * 1. `onBlur` disarms, so a question asked and walked away from is not still waiting.
 * 2. `disabled={busy}` — a second press while the first is being written deletes nothing twice.
 * 3. The arming dies with the button. A swiped row unmounts this component when it closes (`SwipeRow` draws its
 *    action layer only while the row is open), so the state a caller would have kept alive across the gesture
 *    cannot exist. That is structure rather than a fourth guard, and structure is what a copy cannot lose.
 */
export function TwoTapDelete({
  busy = false,
  onConfirm,
  className,
  look = 'inline',
  title,
}: {
  /** True while a write is already going out. The swipe's list passes its own row-level busy flag. */
  busy?: boolean;
  onConfirm: () => void;
  className?: string;
  look?: TwoTapLook;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  const words = LOOKS[look];
  return (
    <button
      type="button"
      disabled={busy}
      title={title}
      aria-label={words.name(armed)}
      onBlur={() => setArmed(false)}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      className={cx(words.className(armed), className)}
    >
      {armed ? words.armed : words.idle}
    </button>
  );
}
