import { isoDate } from '@expanses/core';
import {
  type EventMode,
  type EventRow,
  eventModeState,
  keepEventModeOn,
  readEventMode,
  type SharedEventSummary,
  startEventMode,
  writeEventMode,
} from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { ToastCard, UndoToast } from '../../ui/UndoToast';
import { InsetGroup, InsetRow, SwitchRow, tapReach, TextRow } from '../../ui/native';
import { CurrencySheet } from '../transactions/CurrencySheet';
import { EVENT_MARK, endedText, eventModeApplies, menuLine, modeFooter, modeHint, sharedWithLine, takesEventMode } from './event-mode';
import { useIsBookShared } from '../../lib/queries';
import { useOpenBookReadOnly } from '../sharing/queries';
import { useEvents } from './queries';
import { useSharedEventSummaries, useSharedEventView } from './shared-queries';

const KEY = ['event-mode'] as const;

/** What is stored on this phone, whichever owner it was turned on under. */
function useStoredEventMode() {
  const { database } = useApp();
  return useQuery({ queryKey: KEY, queryFn: () => readEventMode(database.db) });
}

export interface ActiveEventMode {
  mode: EventMode;
  event: EventRow;
  /** Set when the event is shared: who else is in it. */
  shared: SharedEventSummary | undefined;
}

/**
 * Event mode as the screens read it: on, for this owner, through today, for an event still here — or null. Ended, or an
 * event that has gone, reads as off at once; `EventModeHost` then says so and clears what is stored.
 */
export function useEventMode(): ActiveEventMode | null {
  return useEventModeState().active;
}

/**
 * The same answer, and whether it is settled yet: a form that opens with the event set reads it once, so it waits for
 * the stored mode, the events and which of them are shared.
 */
export function useEventModeState(): { ready: boolean; active: ActiveEventMode | null } {
  const { ws } = useApp();
  const storedRead = useStoredEventMode();
  const eventsRead = useEvents();
  const summariesRead = useSharedEventSummaries();
  const stored = storedRead.data ?? null;
  const mine = !!stored && stored.workspaceId === ws.workspaceId && eventModeState(stored, isoDate()) === 'on';
  const ready = storedRead.isFetched && (!mine || ((eventsRead.isFetched || eventsRead.isError) && (summariesRead.isFetched || summariesRead.isError)));
  if (!mine) return { ready, active: null };
  const event = eventsRead.data?.find((row) => row.id === stored.eventId);
  if (!event) return { ready, active: null };
  return { ready, active: { mode: stored, event, shared: summariesRead.data?.[event.id] } };
}

/**
 * Event mode as the open workspace shows it (fix round 2): a private event never fills in a shared workspace's spending,
 * so there the ✈️ dot and the menu row stay away too.
 */
export function useShownEventMode(): ActiveEventMode | null {
  const active = useEventMode();
  const bookShared = useIsBookShared();
  return eventModeApplies(active, bookShared) ? active : null;
}

/** The writes: on for an event (the one before goes off), off, and the two rows under the switch. */
export function useEventModeWrites() {
  const { database, ws } = useApp();
  const queryClient = useQueryClient();
  const write = async (mode: EventMode | null) => {
    // Shown at once — a switch follows the finger — and read back from the phone's own table once it is written.
    queryClient.setQueryData(KEY, mode);
    try {
      await writeEventMode(database, mode);
    } finally {
      await queryClient.invalidateQueries({ queryKey: KEY });
    }
  };
  return {
    write,
    turnOn: (event: Pick<EventRow, 'id' | 'startsOn' | 'endsOn' | 'currency'>) =>
      write(startEventMode({ workspaceId: ws.workspaceId, event, baseCurrency: ws.baseCurrency, today: isoDate() })),
  };
}

/** The 18 px purple round on a corner of the workspace button (2E). */
export function EventModeDot({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-testid="event-mode-dot"
      className={`pointer-events-none absolute flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--ph-trip)] text-[10px] leading-none text-white shadow-[0_0_0_2px_var(--ph-ground)] ${className}`}
    >
      {EVENT_MARK}
    </span>
  );
}

/** The workspace menu's top row while event mode is on (2F): the event, until when, and a tap to its page. */
export function EventModeMenuRow({ active, onClose }: { active: ActiveEventMode; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      role="menuitem"
      data-testid="event-mode-menu-row"
      onClick={() => {
        onClose();
        void navigate({ to: '/events/$eventId', params: { eventId: active.event.id } });
      }}
      className="flex min-h-11 w-full items-center gap-2.5 bg-[var(--ph-trip-panel)] px-3.5 py-2.5 text-left"
    >
      <span aria-hidden className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-trip)] text-[11px] leading-none text-white">
        {EVENT_MARK}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-[20px] font-semibold text-[var(--ph-ink)]">{active.event.name}</span>
        <span className="block truncate text-[12px] leading-[16px] text-[var(--ph-ink-3)]">{menuLine(active.mode.until)}</span>
      </span>
      <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--ph-trip)]" />
    </button>
  );
}

/**
 * The event at the top of the Add form while event mode is on (screen 3): "✈️ <event> ✕", the ✕ leaving this one
 * transaction out. For a shared event, one grey line under it names who will see it.
 */
export function EventChip({ name, sharedWith, onRemove }: { name: string; sharedWith?: readonly string[] | undefined; onRemove: () => void }) {
  return (
    <div className="flex flex-col items-center gap-[4px]" data-testid="event-chip">
      <span className="inline-flex max-w-full items-center gap-[6px] rounded-[14px] bg-[var(--ph-trip-panel)] py-[5px] pr-[6px] pl-[11px] text-[14px] leading-[18px] font-semibold text-[var(--ph-trip)]">
        <span className="min-w-0 truncate">
          {EVENT_MARK} {name}
        </span>
        <button
          type="button"
          aria-label={`Leave this one out of ${name}`}
          onClick={onRemove}
          className="ph-tap flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full font-normal"
          style={{ '--ph-tap-y': `${tapReach(22)}px` } as CSSProperties}
        >
          <X size={14} aria-hidden />
        </button>
      </span>
      {sharedWith && sharedWith.length > 0 && (
        <span className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="event-chip-shared">
          {sharedWithLine(sharedWith)}
        </span>
      )}
    </div>
  );
}

/**
 * The event page's "Event mode" group (screen 1): the switch, Until and Add in, and what happens next under them.
 * Turning it off by hand leaves the light Undo bar.
 */
export function EventModeGroup({ event }: { event: Pick<EventRow, 'id' | 'name' | 'startsOn' | 'endsOn' | 'currency'> }) {
  const { ws } = useApp();
  const stored = useStoredEventMode().data ?? null;
  const { write, turnOn } = useEventModeWrites();
  // Another owner's books, read only here: nothing is added there, so there is no event mode to turn on (fix round 1).
  const readOnly = useOpenBookReadOnly();
  const [picking, setPicking] = useState(false);
  const [undo, setUndo] = useState<EventMode | null>(null);
  const today = isoDate();
  const on = !!stored && stored.workspaceId === ws.workspaceId && stored.eventId === event.id && eventModeState(stored, today) === 'on';
  const mode = on ? stored : null;
  // The switch follows the finger in the same frame; the stored answer takes over once it is read back.
  const [flipped, setFlipped] = useState<boolean | null>(null);
  useEffect(() => {
    if (flipped === on) setFlipped(null);
  }, [on, flipped]);

  if (readOnly) return null;
  return (
    <div data-testid="event-mode-group">
      <InsetGroup footer={mode ? modeFooter(mode.until) : undefined}>
        <SwitchRow
          label="Event mode"
          testId="event-mode-switch"
          hint={modeHint(event.name)}
          checked={flipped ?? on}
          onChange={(checked) => {
            setFlipped(checked);
            if (checked) {
              setUndo(null);
              void turnOn(event);
            } else if (stored) {
              setUndo(stored);
              void write(null);
            }
          }}
        />
        {mode && (
          <TextRow
            label="Until"
            type="date"
            data-testid="event-mode-until"
            min={today}
            value={mode.until}
            onChange={(e) => {
              const until = e.target.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(until) && until >= today) void write({ ...mode, until });
            }}
          />
        )}
        {mode && <InsetRow title="Add in" label={`Add in: ${mode.currency}`} value={mode.currency} testId="event-mode-currency" onClick={() => setPicking(true)} />}
      </InsetGroup>
      {picking && mode && (
        <CurrencySheet
          value={mode.currency}
          accountCurrency={mode.currency}
          baseCurrency={ws.baseCurrency}
          onPick={(currency) => void write({ ...mode, currency })}
          onClose={() => setPicking(false)}
        />
      )}
      {undo && (
        <UndoToast
          testId="event-mode-undo"
          icon="event"
          text="Event mode off"
          onUndo={() => {
            const back = undo;
            setUndo(null);
            void write(back);
          }}
          onDone={() => setUndo(null)}
        />
      )}
    </div>
  );
}

/**
 * Mounted once, in the layout. The day after Until, event mode is off: the next time the app is opened (or comes back
 * to the front) it says so, with Keep on for one more day. An event deleted, archived or left turns it off quietly.
 */
export function EventModeHost() {
  const { ws } = useApp();
  const stored = useStoredEventMode();
  const events = useEvents();
  const summaries = useSharedEventSummaries();
  const mode = stored.data && stored.data.workspaceId === ws.workspaceId ? stored.data : null;
  const shared = useSharedEventView(mode && summaries.data?.[mode.eventId] ? mode.eventId : null);
  const { write } = useEventModeWrites();
  const [today, setToday] = useState(isoDate);
  const [ended, setEnded] = useState<{ mode: EventMode; name: string } | null>(null);

  // A phone left on overnight: the day is read again each time the app comes back to the front.
  useEffect(() => {
    const look = () => {
      if (document.visibilityState === 'visible') setToday(isoDate());
    };
    document.addEventListener('visibilitychange', look);
    return () => document.removeEventListener('visibilitychange', look);
  }, []);

  useEffect(() => {
    if (!mode || !events.isSuccess) return;
    const event = events.data.find((row) => row.id === mode.eventId);
    // Deleted or archived: nothing to say, it simply stops.
    if (!event) {
      void write(null);
      return;
    }
    // Done, left, or no longer in it: an event that takes nothing new takes no event mode either (fix round 1, M3).
    if (shared.data && !takesEventMode(shared.data)) {
      void write(null);
      return;
    }
    if (eventModeState(mode, today) === 'ended') {
      setEnded({ mode, name: event.name });
      void write(null);
    }
  }, [mode, events.isSuccess, events.data, shared.data, today]);

  if (!ended) return null;
  return (
    <EndedToast
      text={endedText(ended.name)}
      onKeepOn={() => {
        const back = keepEventModeOn(ended.mode, isoDate());
        setEnded(null);
        void write(back);
      }}
      onDone={() => setEnded(null)}
    />
  );
}

/** "Event mode for <event> ended", with Keep on: the Undo bar's look, its own action. Goes by itself after a while. */
function EndedToast({ text, onKeepOn, onDone }: { text: string; onKeepOn: () => void; onDone: () => void }) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(onDone, 6000);
    return () => window.clearTimeout(timer);
  }, [held, onDone]);
  return (
    <ToastCard
      icon="event"
      text={text}
      data-testid="event-mode-ended"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      action={
        <button
          type="button"
          onClick={onKeepOn}
          className="ph-focus ph-tap shrink-0 rounded-full bg-[var(--ph-fill)] px-[12px] py-[5px] text-[14px] leading-[18px] font-semibold text-[var(--ph-ink)]"
          style={{ '--ph-tap-y': `${tapReach(28)}px` } as CSSProperties}
        >
          Keep on
        </button>
      }
    />
  );
}
