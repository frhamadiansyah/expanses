import { X } from 'lucide-react';
import { useEscape } from '../../app/use-escape';
import { usePhone } from '../../app/use-phone';
import { cx } from '../../ui';
import { KEYPAD_KEYS, keypadAction } from './tx-form';

/**
 * The phone's dock: the only way an amount is typed on a touch screen, so it carries the arithmetic too.
 *
 * DONE runs `amountAfterDone` — the same reader, through the same `settledAmount`, that the desktop field runs
 * on blur and on Enter. It is called rather than re-implemented on purpose: two lines of `evaluateAmount` plus
 * `minorToMajorString` copied here is how a 100x error lives on the one path a unit test cannot reach.
 *
 * There is no Save key and no list of recent amounts. Saving belongs to the screen's own button, where it can
 * be read before it is pressed; a dock that saves is a dock that saves the wrong figure by the width of a thumb.
 *
 * There are three ways out, as every sheet in the app has: the ✕ in its corner, Escape, and tapping the page
 * behind it. The dock covers the Save button while it is open, so a keypad with no exit is a form with no exit.
 *
 * Escape closes the dock and stops there. The sheet this usually sits in listens for Escape too, and through
 * `useEscape` only the innermost listener answers: one press used to close both and lose the whole draft.
 *
 * Rendered only on a phone: on a desktop the arithmetic is in the amount field itself, and a keypad there
 * would be a second, weaker way to enter money.
 */
/** The keys that are arithmetic rather than digits, drawn in the tint as B1 draws them. */
const OPERATORS = new Set<string>(['C', '÷', '×', '⌫', '−', '+']);

export function Keypad({
  value,
  currency,
  onChange,
  onClose,
}: {
  value: string;
  currency: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const phone = usePhone();

  // Called before the early return, so the hook order is the same whichever screen this is on, and enabled
  // only on a phone: a dock that is not drawn must not take Escape from the sheet it would have sat in.
  useEscape(onClose, phone);

  if (!phone) return null;

  // Every key, DONE included, goes through the one tested decision. Nothing is worked out here.
  const press = (key: (typeof KEYPAD_KEYS)[number]) => {
    const { text, close } = keypadAction(value, currency, key);
    if (text !== value) onChange(text);
    if (close) onClose();
  };

  return (
    <>
      {/* The page behind closes the dock, the way a sheet's backdrop does. */}
      <div className="fixed inset-0 z-30" onClick={onClose} role="presentation" />
      {/* B1's dock: rounded key tiles on the surface, the operators and DONE in the app's green. */}
      <div
        data-testid="keypad"
        className="fixed inset-x-0 bottom-0 z-40 border-t-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-surface)] px-2 pb-[calc(12px+env(safe-area-inset-bottom))]"
        role="group"
        aria-label="Keypad"
      >
        <div className="flex items-center justify-between px-1">
          <span className="text-[12px] text-[var(--ph-ink-3)]">{currency}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keypad"
            className="ph-focus flex h-9 w-9 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-[5px]">
          {KEYPAD_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              // The accessible name is the character on the key: the e2e helper taps digits by name, and Task 18
              // asserts that no key here is called Save.
              aria-label={key}
              onClick={() => press(key)}
              className={cx(
                'ph-focus-inset flex h-12 items-center justify-center rounded-[10px] text-[20px] font-medium',
                key === 'DONE'
                  ? 'row-span-2 h-auto bg-[var(--ph-tint)] text-[15px] font-bold text-[var(--ph-surface)]'
                  : OPERATORS.has(key)
                    ? 'bg-[var(--ph-fill)] text-[var(--ph-tint)] active:bg-[var(--ph-track)]'
                    : 'bg-[var(--ph-fill)] text-[var(--ph-ink)] active:bg-[var(--ph-track)]',
              )}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
