import { type BookSyncStatus, type Database, heldElsewhereOf, type HeldRow, type SharingDiagnostics, sharingDiagnostics } from '@expanses/db';
import pkg from '../../../package.json';
import { describeError, formatSyncLogEntry, shortId, type SyncLogEntry } from '../../sync/sync-log';
import { type SyncService, statusInShort } from '../../sync/sync-service';

/*
 * A workspace's sharing, as the Share page's Details shows it and "Copy details" copies it: what this device holds
 * for the book, what the engine makes of it, this device's own standing in it, and the sync log. Ids are cut to
 * their first eight characters, and no amount, description or key is read. The tables are read as ids, states,
 * counts and times; error messages are kept in their own words, and a sharing error's words can name a workspace, an
 * event or a person (SYNC_DETAILS_FOOTER says so on the page).
 *
 * Read with or without a `shared_books` row: a book whose row went missing (a database lost and restored) shows
 * what is left of it, and the log is kept by the local book id, so its history is still there.
 */

/** What the Details page says the text holds. True of it: error messages can carry names, so it says so. */
export const SYNC_DETAILS_FOOTER =
  'Ids (shortened), states, counts, times and error messages. An error message can name a workspace, an event or a person. No amounts, descriptions or keys are included.';

/** The book's state in one word: `active`, `needs_invite`, `unshared`, `frozen`, `stale`, or `none` without a row. */
export type DetailsState = 'active' | 'needs_invite' | 'unshared' | 'frozen' | 'stale' | 'none';

export interface SyncDetails {
  takenAt: string;
  /** "0.5.0 (108)", or "0.5.0 (web)" outside the shell. */
  app: string;
  bookId: string;
  state: DetailsState;
  /** The engine's status in short (`waiting 3`), or why it could not be read. */
  engineStatus: string;
  diag: SharingDiagnostics;
  deviceId: string | null;
  /** Whether this device holds sharing keys at all. */
  hasKeys: boolean;
  /** This device's own `book_devices` row: `yes`, `removed`, `no`, or `unknown` with no engine. */
  deviceRow: 'yes' | 'removed' | 'no' | 'unknown';
  /** The key of the book's current epoch: `opens`, `held, does not open`, `missing`, or `unknown`. */
  epochKey: 'opens' | 'held, does not open' | 'missing' | 'unknown';
  live: { polled: boolean; running: boolean; failing: boolean; lastSyncedAt: number | null; lastError: string | null };
  log: SyncLogEntry[];
  /** Rows set aside because another copy here holds them (sharing resilience §4.4): entity, id, holder book. */
  held?: HeldRow[];
  /** What the share record said at open (§6.2): `lost`, `behind`, …; none when it was `ok` or there is none. */
  finding?: string | null;
}

export function detailsStateOf(shared: SharingDiagnostics['shared'], status: BookSyncStatus | null): DetailsState {
  if (!shared) return 'none';
  if (shared.state !== 'active') return shared.state;
  if (status?.state === 'frozen' || status?.state === 'stale') return status.state;
  return 'active';
}

const errorText = (error: unknown): string | null => {
  if (error === null || error === undefined) return null;
  const said = describeError(error);
  return `${said.name}${said.status !== null ? ` ${said.status}` : ''}: ${said.message}`;
};

/** Everything Details shows, read now. Reads only: it makes no keys and asks the relay nothing. */
export async function collectSyncDetails(input: { database: Database; sync: SyncService; bookId: string; build: string | null; now?: Date }): Promise<SyncDetails> {
  const { database, sync, bookId } = input;
  const diag = await sharingDiagnostics(database, bookId);
  const engine = await sync.madeEngine();
  let status: BookSyncStatus | null = null;
  let engineStatus = 'no engine on this device yet';
  if (engine) {
    try {
      status = await engine.bookSyncStatus(bookId);
      engineStatus = statusInShort(status);
    } catch (error) {
      engineStatus = `could not be read (${errorText(error)})`;
    }
  }
  const deviceId = engine?.deviceId ?? null;
  const own = deviceId ? diag.devices.find((device) => device.deviceId === deviceId) : undefined;
  const deviceRow: SyncDetails['deviceRow'] = !deviceId ? 'unknown' : own ? (own.removed ? 'removed' : 'yes') : 'no';
  let epochKey: SyncDetails['epochKey'] = 'unknown';
  if (engine && diag.shared) {
    if (!diag.epochKeys.includes(diag.shared.epoch)) epochKey = 'missing';
    else epochKey = (await engine.sealer.epochKey(bookId, diag.shared.epoch).catch(() => null)) ? 'opens' : 'held, does not open';
  }
  const live = sync.status(bookId);
  return {
    takenAt: (input.now ?? new Date()).toISOString(),
    app: input.build ?? `${pkg.version} (web)`,
    bookId,
    state: detailsStateOf(diag.shared, status),
    engineStatus,
    diag,
    deviceId,
    hasKeys: await sync.hasKeys(),
    deviceRow,
    epochKey,
    live: { polled: sync.syncing().includes(bookId), running: live.running, failing: live.failing, lastSyncedAt: live.lastSyncedAt, lastError: errorText(live.lastError) },
    log: await sync.log.forBook(bookId),
    held: await heldElsewhereOf(database, bookId).catch(() => []),
    finding: sync.findings().find((f) => f.bookId === bookId)?.kind ?? null,
  };
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

/** Details as plain text, for "Copy details" and for the page itself. */
export function syncDetailsText(d: SyncDetails): string {
  const s = d.diag.shared;
  const owners = d.diag.members.filter((member) => member.role === 'owner').length;
  const removed = d.diag.devices.filter((device) => device.removed).length;
  const lines = [
    'Expanses sync details',
    `Taken ${d.takenAt}`,
    `App ${d.app}`,
    `Workspace ${shortId(d.bookId)}`,
    `State ${d.state} · engine ${d.engineStatus}`,
    s
      ? `Relay book ${shortId(s.relayBookId)} · epoch ${s.epoch} · member ${shortId(s.memberId)} · row ${s.state}`
      : 'Relay book none: no shared_books row on this device',
    s ? `Shared at ${s.sharedAt} · synced at ${s.syncedAt ?? 'never'}` : null,
    s && s.state === 'unshared' ? `Ended ${s.unsharedReason ?? 'unknown'} by ${shortId(s.unsharedBy) ?? 'unknown'}` : null,
    `Outbox ${d.diag.outbox} · cursor ${d.diag.cursor ?? 'none'} · refused ops ${d.diag.skipped.count}${d.diag.skipped.count ? ` (${d.diag.skipped.entities.join(', ')})` : ''}`,
    `Members ${d.diag.members.length} (owners ${owners}) · devices ${d.diag.devices.length} (removed ${removed}) · epoch keys ${d.diag.epochKeys.length ? d.diag.epochKeys.join(', ') : 'none'}`,
    `This device ${shortId(d.deviceId) ?? 'none'} · keys ${yesNo(d.hasKeys)} · device row ${d.deviceRow} · epoch key ${d.epochKey}`,
    `This session: polled ${yesNo(d.live.polled)} · running ${yesNo(d.live.running)} · failing ${yesNo(d.live.failing)} · last run ${d.live.lastSyncedAt ? new Date(d.live.lastSyncedAt).toISOString() : 'none'}`,
    d.live.lastError ? `Last error ${d.live.lastError}` : null,
    d.finding ? `Share record at open: ${d.finding}` : null,
    d.held?.length ? `Held by another copy here ${d.held.length}` : null,
    ...(d.held ?? []).map((row) => `  ${row.entity} ${shortId(row.id)} · holder ${shortId(row.holderBookId)}${row.holderExists ? '' : ' (deleted)'}`),
    '',
    d.log.length ? `Log, newest first (${d.log.length})` : 'Log: nothing recorded on this device',
    ...d.log.map(formatSyncLogEntry),
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}
