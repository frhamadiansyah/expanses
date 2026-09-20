import { evaluateAmount, minorToMajorString } from '@expanses/core';
import { usePhone } from '../../app/use-phone';
import { cx } from '../../ui';
import { KEYPAD_KEYS, type KeypadKey, keypadPress } from './tx-form';

/**
 * The phone's dock: the only way an amount is typed on a touch screen, so it carries the arithmetic too.
 *
 * DONE runs `evaluateAmount` — the same reader the desktop field runs on blur and on Enter — and a result
 * writes the row and closes the dock. Null leaves both alone: the expression stays on screen to be fixed,
 * rather than the figure being thrown away.
 *
 * There is no Save key and no list of recent amounts. Saving belongs to the screen's own button, where it can
 * be read before it is pressed; a dock that saves is a dock that saves the wrong figure by the width of a thumb.
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
  if (!phone) return null;

  const done = () => {
    const minor = evaluateAmount(value, currency);
    if (minor === null) return;
    onChange(minorToMajorString(minor, currency));
    onClose();
  };

  return (
    <div
      data-testid="keypad"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 gap-px border-t border-slate-300 bg-slate-300 pb-[env(safe-area-inset-bottom)]"
      role="group"
      aria-label="Keypad"
    >
      {KEYPAD_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          // The accessible name is the character on the key: the e2e helper taps digits by name, and Task 18
          // asserts that no key here is called Save.
          aria-label={key}
          onClick={() => (key === 'DONE' ? done() : onChange(keypadPress(value, key as Exclude<KeypadKey, 'DONE'>)))}
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
  );
}
