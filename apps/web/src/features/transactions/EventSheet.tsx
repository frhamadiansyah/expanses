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
    <Sheet title="Event" onClose={onClose}>
      <ul className="-mx-1 divide-y divide-slate-100">
        {[{ id: '', name: 'No event', startsOn: '' }, ...newestFirst].map((event) => (
          <li key={event.id || 'none'}>
            <button
              type="button"
              aria-label={event.name}
              aria-pressed={value === event.id}
              onClick={() => choose(event.id)}
              className="flex min-h-11 w-full items-center gap-3 px-1 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
            >
              <span className="min-w-0 flex-1 truncate">{event.name}</span>
              {event.startsOn && (
                <span aria-hidden className="shrink-0 text-xs text-slate-400">
                  {event.startsOn}
                </span>
              )}
              {value === event.id && <span className="shrink-0 text-xs font-semibold text-emerald-700">Chosen</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
