import { cx } from '../../ui';
import { useTwoTap } from '../../ui/two-tap';

/**
 * How one way in draws the question — the words and the classes, never the guards.
 *
 * The guards are the same three everywhere, which is the whole point of this file. The phone's swipe no longer asks
 * twice (owner, 25 Oct): its Delete acts at once and the list's Undo toast is the way back, holding the delete until
 * the toast has gone (`deferred-delete.ts`).
 */
const LOOKS = {
  /** A button among buttons: the receipt's actions. */
  inline: {
    idle: 'Delete',
    armed: 'Click again to delete',
    name: (armed: boolean) => (armed ? 'Click again to delete' : 'Delete this transaction'),
    className: (armed: boolean) =>
      cx('min-h-11 rounded-lg px-3 text-sm font-medium disabled:opacity-60', armed ? 'bg-red-700 text-white' : 'text-red-700 hover:bg-red-50'),
  },
} as const;

export type TwoTapLook = keyof typeof LOOKS;

/**
 * Deleting asks twice, in place — the same two taps the list and the table already ask for.
 *
 * The receipt draws it, through `useTwoTap`. A second copy is a second chance for one way in to delete on a single
 * tap. The old swipe was that second copy, and it did exactly that — it kept `armed` in the row around it, one level above
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
  /** True while a write is already going out. */
  busy?: boolean;
  onConfirm: () => void;
  className?: string;
  look?: TwoTapLook;
  title?: string;
}) {
  const { armed, onBlur, onClick } = useTwoTap(onConfirm);
  const words = LOOKS[look];
  return (
    <button
      type="button"
      disabled={busy}
      title={title}
      aria-label={words.name(armed)}
      onBlur={onBlur}
      onClick={onClick}
      className={cx(words.className(armed), className)}
    >
      {armed ? words.armed : words.idle}
    </button>
  );
}
