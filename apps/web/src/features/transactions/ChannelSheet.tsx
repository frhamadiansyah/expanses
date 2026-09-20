import { Sheet } from '../../app/Sheet';
import { cx } from '../../ui';

/** §4.2's two choices, each with the line that says what it means. */
const CHOICES = [
  { value: 'online', label: 'Online', line: 'Marketplaces, apps, websites' },
  { value: 'offline', label: 'Offline', line: 'In a shop, at the counter' },
] as const;

/**
 * Online or offline — D1, §4.2.
 *
 * Blank by default, never guessed and never required: when it is set the points engine holds a card's rule to it,
 * and when it is blank keyword detection decides exactly as it does today. Choosing the one already chosen clears
 * it again, which is the only way back to blank once something has been picked.
 */
export function ChannelSheet({
  value,
  onPick,
  onClose,
}: {
  value: '' | 'online' | 'offline';
  onPick: (channel: '' | 'online' | 'offline') => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Channel" onClose={onClose}>
      <ul className="-mx-1 divide-y divide-slate-100">
        {CHOICES.map((choice) => (
          <li key={choice.value}>
            <button
              type="button"
              aria-label={choice.label}
              aria-pressed={value === choice.value}
              // The chosen one again is how it is cleared: there is no third row saying "neither".
              onClick={() => {
                onPick(value === choice.value ? '' : choice.value);
                onClose();
              }}
              className="flex min-h-12 w-full items-center gap-3 px-1 py-2 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
            >
              <span className="min-w-0 flex-1">
                <span className={cx('block', value === choice.value && 'font-semibold')}>{choice.label}</span>
                <span className="block text-xs text-slate-500">{choice.line}</span>
              </span>
              {value === choice.value && <span className="shrink-0 text-xs font-semibold text-emerald-700">Chosen</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Some cards earn or spend points only online, or only offline. Optional: leave it blank and nothing is chosen for you. Tap the chosen one again to
        clear it.
      </p>
    </Sheet>
  );
}
