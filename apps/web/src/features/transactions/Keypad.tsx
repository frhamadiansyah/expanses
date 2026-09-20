import { X } from 'lucide-react';
import { useEffect } from 'react';
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
 * Rendered only on a phone: on a desktop the arithmetic is in the amount field itself, and a keypad there
 * would be a second, weaker way to enter money.
 */
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

  // Declared before the early return, so the hook order is the same whichever screen this is on.
  useEffect(() => {
    if (!phone) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phone, onClose]);

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
      <div
        data-testid="keypad"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-300 bg-slate-300 pb-[env(safe-area-inset-bottom)]"
        role="group"
        aria-label="Keypad"
      >
        <div className="flex items-center justify-between bg-white px-3 py-1">
          <span className="text-xs text-slate-500">{currency}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keypad"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-px">
          {KEYPAD_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              // The accessible name is the character on the key: the e2e helper taps digits by name, and Task 18
              // asserts that no key here is called Save.
              aria-label={key}
              onClick={() => press(key)}
              className={cx(
                'flex h-14 items-center justify-center text-xl font-medium',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900',
                key === 'DONE' ? 'row-span-2 bg-slate-900 text-base font-semibold text-white' : 'bg-white text-slate-900 active:bg-slate-100',
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
