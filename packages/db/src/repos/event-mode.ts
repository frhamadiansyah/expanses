import { sql } from 'drizzle-orm';
import type { Database, Db } from '../database';
import { settings } from '../schema';

/**
 * Event mode (owner, 12 Nov 2026): while it is on, every new transaction goes to one event by itself — the Add form, One
 * line, Paste a list, and a capture dated inside its range. One event at a time.
 *
 * It is this phone's alone: kept in the device's own `settings` table (as the hold's choice and One line's look are),
 * never in a synced table, so each person in a household turns it on for themselves. `workspaceId` is the owner it was
 * turned on under, so a phone reading another owner's books never applies it there.
 */
export interface EventMode {
  workspaceId: string;
  eventId: string;
  /** The last day it is on; the day after, it is off by itself. */
  until: string;
  /** The currency the Add form's amount opens in ("Add in"). */
  currency: string;
  /** The first day a capture is tagged for: the event's start or the day it was turned on, whichever is earlier. */
  from: string;
}

export const EVENT_MODE_KEY = 'event_mode';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function addDaysTo(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A stored value as a mode: anything unreadable, or missing a field, is no mode at all. */
export function parseEventMode(value: string | null | undefined): EventMode | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Partial<EventMode>;
    if (typeof raw.workspaceId !== 'string' || typeof raw.eventId !== 'string' || !raw.eventId) return null;
    if (typeof raw.until !== 'string' || !ISO.test(raw.until)) return null;
    if (typeof raw.currency !== 'string' || !raw.currency) return null;
    const from = typeof raw.from === 'string' && ISO.test(raw.from) ? raw.from : raw.until;
    return { workspaceId: raw.workspaceId, eventId: raw.eventId, until: raw.until, currency: raw.currency, from };
  } catch {
    return null;
  }
}

/** On through its last day; ended from the day after. */
export function eventModeState(mode: Pick<EventMode, 'until'>, today: string): 'on' | 'ended' {
  return today > mode.until ? 'ended' : 'on';
}

/** Whether a transaction dated `occurredOn` falls inside the mode's range. */
export function eventModeCovers(mode: Pick<EventMode, 'from' | 'until'>, occurredOn: string): boolean {
  return occurredOn >= mode.from && occurredOn <= mode.until;
}

/**
 * "Until" as it opens: the event's own end date, or — for an event with no end date, or one that has already ended —
 * a week from today (today and six more days).
 */
export function defaultUntil(endsOn: string | null | undefined, today: string): string {
  return endsOn && ISO.test(endsOn) && endsOn >= today ? endsOn : addDaysTo(today, 6);
}

/** The mode as it is turned on for an event: until its end, in its own currency (else the base). */
export function startEventMode(input: {
  workspaceId: string;
  event: { id: string; startsOn?: string | null; endsOn?: string | null; currency?: string | null };
  baseCurrency: string;
  today: string;
}): EventMode {
  const { event, today } = input;
  const starts = event.startsOn && ISO.test(event.startsOn) ? event.startsOn : today;
  return {
    workspaceId: input.workspaceId,
    eventId: event.id,
    until: defaultUntil(event.endsOn, today),
    currency: event.currency || input.baseCurrency,
    from: starts < today ? starts : today,
  };
}

/**
 * "Keep on", on the toast that says it ended: one more day, as often as it is pressed. A toast seen days late keeps it on
 * through today rather than adding a day that is already past.
 */
export function keepEventModeOn(mode: EventMode, today: string): EventMode {
  const next = addDaysTo(mode.until, 1);
  return { ...mode, until: next > today ? next : today };
}

export async function readEventMode(db: Db): Promise<EventMode | null> {
  const [row] = await db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${EVENT_MODE_KEY}`);
  return parseEventMode(row?.[0]);
}

/** Turns it on (one event at a time: the row is replaced), or off with null. */
export async function writeEventMode(database: Database, mode: EventMode | null): Promise<void> {
  if (mode === null) {
    await database.db.run(sql`DELETE FROM settings WHERE key = ${EVENT_MODE_KEY}`);
    return;
  }
  const value = JSON.stringify(mode);
  await database.db.insert(settings).values({ key: EVENT_MODE_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/**
 * The event a capture is tagged with: the mode's, when it is on today for this workspace, the capture is dated inside
 * its range, and the event is still here (not deleted). Null otherwise. Only an expense is tagged — an event is spending.
 */
export async function eventModeForCaptureTx(
  tx: Db,
  workspaceId: string,
  capture: { occurredOn: string; kind: 'expense' | 'income' | 'transfer' },
  today: string,
): Promise<string | null> {
  if (capture.kind !== 'expense') return null;
  const mode = await readEventMode(tx);
  if (!mode || mode.workspaceId !== workspaceId) return null;
  if (eventModeState(mode, today) !== 'on' || !eventModeCovers(mode, capture.occurredOn)) return null;
  const [live] = await tx.values<[number]>(
    sql`SELECT 1 FROM events WHERE id = ${mode.eventId} AND workspace_id = ${workspaceId} AND archived_at IS NULL`,
  );
  return live ? mode.eventId : null;
}
