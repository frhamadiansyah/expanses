import { Check } from 'lucide-react';
import { Sheet } from '../../app/Sheet';
import { useEvents } from '../events/queries';

/**
 * Which event this spending belongs to — §4's Event row, as its own screen.
 *
 * "No event" is a row rather than a cross in the corner: taking a transaction back out of an event is as ordinary
 * as putting it in, and a choice that can only be made and never unmade is a trap.
 *
 * `useEvents` is read rather than a second query of its own: an event spans workspaces, and `useEvents` is the one
 * place that knows to read it owner-wide. A local `useQuery(['events', …])` would answer from the same cache key
 * with different rows, and the two screens would then disagree about which events exist.
 */
export function EventSheet({ value, onPick, onClose }: { value: string; onPick: (eventId: string) => void; onClose: () => void }) {
  const events = useEvents().data ?? [];
  // Newest first: the trip you are on is the one you are recording against, and it is the last one opened.
  const newestFirst = [...events].sort((a, b) => (a.startsOn < b.startsOn ? 1 : a.startsOn > b.startsOn ? -1 : 0));
  const choose = (eventId: string) => {
    onPick(eventId);
    onClose();
  };
  return (
    <Sheet grouped title="Event" onClose={onClose}>
      <ul className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>li+li>button>.ph-row-body]:border-t-[0.5px] [&>li+li>button>.ph-row-body]:border-[var(--ph-hair)]">
        {[{ id: '', name: 'No event', startsOn: '' }, ...newestFirst].map((event) => (
          <li key={event.id || 'none'}>
            <button
              type="button"
              aria-label={event.name}
              aria-pressed={value === event.id}
              onClick={() => choose(event.id)}
              className="ph-focus-inset flex w-full items-center pl-[14px] text-left active:bg-[var(--ph-fill)]"
            >
              <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-3 pr-[14px]">
                <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">{event.name}</span>
                {event.startsOn && (
                  <span aria-hidden className="shrink-0 text-[12.5px] text-[var(--ph-ink-3)]">
                    {event.startsOn}
                  </span>
                )}
                {value === event.id && <Check size={18} aria-label="Chosen" className="shrink-0 text-[var(--ph-tint)]" />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
