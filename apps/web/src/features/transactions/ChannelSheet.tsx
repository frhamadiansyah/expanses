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
    <Sheet grouped title="Channel" onClose={onClose}>
      {/* D1: the two choices in one card, a radio circle each, and the one explanation under it. */}
      <ul className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>li+li>button>.ph-row-body]:border-t-[0.5px] [&>li+li>button>.ph-row-body]:border-[var(--ph-hair)]">
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
              className="ph-focus-inset flex w-full items-center pl-[14px] text-left active:bg-[var(--ph-fill)]"
            >
              <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2 pr-[14px]">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-5 text-[var(--ph-ink)]">{choice.label}</span>
                  <span className="block text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{choice.line}</span>
                </span>
                <span
                  aria-hidden
                  className={cx(
                    'h-5 w-5 shrink-0 rounded-full',
                    value === choice.value ? 'border-[6px] border-[var(--ph-tint)]' : 'border-[1.5px] border-[var(--ph-chevron)]',
                  )}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-[10px] px-1 text-[12px] leading-4 text-[var(--ph-ink-3)]">
        Some cards earn or spend points only online, or only offline. Optional: leave it blank and nothing is chosen for you. Tap the chosen one again to
        clear it.
      </p>
    </Sheet>
  );
}
