import { isSupportedCurrency, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../../context';
import type { Database, Tx } from '../../database';
import { eventOf } from '../../repos/event-scope';
import { voidTransactionTx } from '../../repos/ledger';
import { dropEventLogRowsTx } from './log-rows';
import { eventBookTx, openEventBookTx } from '../../repos/shared-event-records';
import { openSharedEventTx, personRefusalTx, removeEventPerson, SharedEventDbError } from '../../repos/shared-event-writes';
import { clearAuthorityTx, viewActiveDevices, viewDevice, viewMember } from '../authority';
import { captureConfigOf, LastOwnerError, rowUpsertsTx, withCapture, writeChangeSetsTx } from '../capture';
import { randomBytes } from '../crypto';
import type { PreviewedInvite, SyncOnceResult } from '../engine';
import { type EventInviteDetails, inviteAad, inviteKeyOf, type InviteKey, openInviteJson, parseInviteCode } from '../invite';
import type { DeviceKeys } from '../keys';
import { base64UrlToBytes } from '../relay-signing';
import type { Sealer } from '../seal';
import { SharingError } from '../seed';
import { type SyncTransport, SyncTransportError } from '../types';
import { meetsVersion, SHARED_EVENTS_MIN_APP_VERSION } from './version';

/*
 * A shared event's own relay book (shared events §3): a `shared_books` row with no `books` row, made the way
 * `openGroupLog` makes the net-worth group log, but tied to no workspace — so a friend who shares no workspace with
 * anyone here can join. Joining is the household's invite and claim, pointed at this book; the preview carries the
 * event and its people, sealed, so the joiner can say "I'm Budi" before claiming anything.
 *
 * The book's local id is the same on every phone: it is the id the sharer minted, carried in the invite's preview, and
 * it is the `shared_event` row's own key (sync/shared-entities.ts), so a joiner that picked another would refuse every
 * op of the event.
 *
 * A person's id is the member id they join as (ruling R1): claiming Budi is joining as Budi's id, and the authority
 * view refuses a second introduction of the same member in log order, on every phone alike. Every member is an owner of
 * the book (`everyMemberOwns`), so any of them invites, links a new phone or removes a person.
 */

export interface EventLogHost {
  database: Database;
  transport: SyncTransport;
  device: DeviceKeys;
  sealer: Sealer;
  now: () => number;
  appVersion?: string;
  syncOnce(bookId: string): Promise<SyncOnceResult>;
  previewInvite(code: string): Promise<PreviewedInvite>;
  leave(bookId: string): Promise<void>;
  removeDevice(bookId: string, target: string): Promise<void>;
}

/** A sync right after a local change, when the relay can be reached; otherwise the scheduler's next run does it. */
async function quietly(run: Promise<unknown>): Promise<void> {
  try {
    await run;
  } catch (error) {
    if (!(error instanceof SyncTransportError)) throw error;
  }
}

/** Whether this phone holds `bookId` as a shared event's book (`event_books`, written only here). */
export async function isEventBook(database: Database, bookId: string): Promise<boolean> {
  const rows = await database.db.values(sql`SELECT 1 FROM event_books WHERE book_id = ${bookId}`).catch(() => []);
  return rows.length > 0;
}

/** What an invite to this event book shows (the engine's `createInvite` seals it into the preview), or null. */
export async function eventInviteDetails(database: Database, bookId: string): Promise<EventInviteDetails | null> {
  if (!(await isEventBook(database, bookId))) return null;
  const [row] = await database.db.values<[string, string, string, string]>(sql`SELECT name, starts_on, ends_on, currency FROM shared_events WHERE book_id = ${bookId}`);
  if (!row) return null;
  // The log's currency once an expense has locked it (ruling R8), not a change of this phone's the log stripped.
  const [locked] = await database.db.values<[string]>(sql`SELECT currency FROM event_log_currency WHERE book_id = ${bookId} AND locked = 1 AND currency <> ''`);
  const people = await database.db.values<[string, string, string | null]>(sql`SELECT id, name, member_id FROM event_people WHERE book_id = ${bookId} AND removed_at IS NULL ORDER BY name, id`);
  return {
    name: row[0],
    startsOn: row[1],
    endsOn: row[2],
    currency: locked?.[0] ?? row[3],
    people: people.map(([personId, name, memberId]) => ({ personId, name, claimed: memberId !== null })),
    minAppVersion: SHARED_EVENTS_MIN_APP_VERSION,
  };
}

export interface ShareEventInput {
  eventId: string;
  currency: string;
  /** What this person is called in the event. */
  personName: string;
  deviceName: string;
  /** People without the app, by name (D3). */
  names?: readonly string[];
}

/**
 * Shares a local event (§3): the relay book, epoch 1's key, this phone's hold on it (`openEventBookTx`: the trip
 * balance), this member as owner and this device, the event and its people, in one transaction, written into the outbox
 * as the log's first entries — this device's introduction first, so it is the creator's seed. A failure deletes the relay
 * book again, as `shareBook` does. The event's categories, plan and tagged spending are moved in afterwards
 * (`convertEventToShared`, Task 10), as ordinary captured writes.
 */
export async function shareEvent(host: EventLogHost, ws: WorkspaceContext, input: ShareEventInput): Promise<{ bookId: string; personId: string }> {
  const event = await eventOf(host.database, ownerScope(ws), input.eventId);
  if ((await host.database.db.values(sql`SELECT 1 FROM event_books WHERE event_id = ${input.eventId}`)).length > 0) throw new SharingError('ALREADY_SHARED', `${event.name} is already shared`);
  if (!isSupportedCurrency(input.currency)) throw new SharingError('CURRENCY', `Unsupported currency ${input.currency}`);
  const personName = input.personName.trim();
  if (!personName) throw new SharingError('BAD_CODE', 'Enter the name this person goes by');
  // One person per name, matched without case, as adding a name later is (`addEventPerson`).
  const seen = new Set([personName.toLowerCase()]);
  const names: string[] = [];
  for (const raw of input.names ?? []) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  const { bookId: relayBookId } = await host.transport.createBook(host.device.public);
  const bookId = uuidv7();
  const memberId = uuidv7();
  const key = randomBytes(32);
  const now = new Date(host.now()).toISOString();
  try {
    await host.database.transaction(async (tx) => {
      await host.sealer.storeEpochKeyTx(tx, bookId, 1, key);
      await tx.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${relayBookId}, 1, ${memberId}, 'active', ${now})`);
      await openEventBookTx(tx, ws, { bookId, eventId: input.eventId, name: event.name, currency: input.currency });
      await tx.run(sql`INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${bookId}, ${memberId}, ${personName}, 'owner', ${now})`);
      await tx.run(sql`
        INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at, app_version)
        VALUES (${bookId}, ${host.device.deviceId}, ${memberId}, ${input.deviceName}, ${JSON.stringify(host.device.public.signJwk)}, ${JSON.stringify(host.device.public.agreeJwk)}, ${now}, NULL, ${host.appVersion ?? null})`);
      await tx.run(sql`
        INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES (${bookId}, ${event.name}, ${event.startsOn}, ${event.endsOn}, ${input.currency}, ${event.finishedAt})`);
      await tx.run(sql`INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES (${bookId}, ${memberId}, ${personName}, ${memberId}, NULL)`);
      for (const name of names) await tx.run(sql`INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES (${bookId}, ${uuidv7()}, ${name}, NULL, NULL)`);
      const book = { bookId, memberId, epoch: 1 };
      // The device first: the log's first change-set is the creator's seed, which needs no invite (§8.2).
      const ops = [
        ...(await rowUpsertsTx(tx, book, 'device')).filter((op) => op.id === host.device.deviceId),
        ...(await rowUpsertsTx(tx, book, 'member')),
        ...(await rowUpsertsTx(tx, book, 'shared_event')),
        ...(await rowUpsertsTx(tx, book, 'event_person')),
      ];
      await writeChangeSetsTx(tx, captureConfigOf(host.database), book, ops);
    });
  } catch (error) {
    host.sealer.forget();
    await host.transport.deleteBook(relayBookId).catch(() => undefined);
    throw error;
  }
  await quietly(host.syncOnce(bookId));
  return { bookId, personId: memberId };
}

/** Everything this phone holds of an event's log, gone so a rejoin or a refused join starts from nothing (local bookkeeping kept). */
async function dropEventLogTx(tx: Tx, bookId: string): Promise<void> {
  for (const table of ['shared_events', 'event_people', 'event_categories', 'event_expenses', 'event_expense_details', 'event_settlements', 'event_items_shared', 'event_log_currency']) {
    await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId}`);
  }
  for (const table of ['sync_outbox', 'sync_cursor', 'book_epoch_keys', 'sync_field_clocks', 'sync_tombstones', 'sync_skipped', 'book_devices', 'book_members']) {
    await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId}`);
  }
  await clearAuthorityTx(tx, bookId);
  await dropEventLogRowsTx(tx, bookId);
}

/**
 * A join the log refused, taken back out (ruling R1: another phone claimed the same name a moment earlier). Whatever
 * the pull put in this phone's books as that person's share is voided, the trip balance and the share categories go
 * (archived when a voided line still names them), and the event, its log and this phone's hold on it are deleted.
 */
async function undoRefusedJoinTx(tx: Tx, ws: WorkspaceContext, bookId: string, eventId: string): Promise<void> {
  const [hold] = await tx.values<[string]>(sql`SELECT balance_account_id FROM event_books WHERE book_id = ${bookId}`);
  for (const [transactionId] of await tx.values<[string]>(sql`
    SELECT p.transaction_id FROM event_postings p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.book_id = ${bookId} AND t.status = 'posted'`)) {
    await voidTransactionTx(tx, ownerScope(ws), transactionId, {}, undefined, { eventDerivation: true });
  }
  const accounts = [
    ...(hold ? [hold[0]] : []),
    ...(await tx.values<[string]>(sql`SELECT account_id FROM event_category_accounts WHERE book_id = ${bookId}`)).map(([id]) => id),
  ];
  for (const table of ['event_postings', 'event_category_accounts', 'event_books']) await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId}`);
  for (const accountId of accounts) {
    const used = await tx.values(sql`SELECT 1 FROM entries WHERE account_id = ${accountId} LIMIT 1`);
    if (used.length === 0) await tx.run(sql`DELETE FROM accounts WHERE id = ${accountId}`);
    else await tx.run(sql`UPDATE accounts SET archived_at = ${new Date().toISOString()} WHERE id = ${accountId} AND archived_at IS NULL`);
  }
  await dropEventLogTx(tx, bookId);
  await tx.run(sql`DELETE FROM shared_books WHERE book_id = ${bookId}`);
  await tx.run(sql`DELETE FROM events WHERE id = ${eventId}`);
}

export interface JoinEventInput {
  ws: WorkspaceContext;
  /** The name claimed ("I'm Budi"), by its person id; null to join under a new name. */
  personId: string | null;
  name: string;
  deviceName: string;
}

/**
 * Joins an event (§6 Joining): every refusal before the claim; then the claim, the keys, this phone's hold on the book
 * (a local `events` row and a trip balance), the introduction as an owner — as the claimed person's member (R1), or a
 * new one — and a pull of the whole log; then the claim of the name, or the new name, as a captured write. A phone
 * whose introduction the log refused (another phone claimed the same name a moment earlier) is taken back out and told
 * so. A phone that held the book before (a restored phone, or one whose person left) joins again only as the person
 * its invite names (§7 Lost phone), keeping its own event, trip balance and postings.
 */
export async function joinEvent(host: EventLogHost, code: string, input: JoinEventInput): Promise<{ bookId: string; eventId: string; personId: string; result: SyncOnceResult }> {
  const preview = await host.previewInvite(code);
  const event = preview.event;
  if (!event) throw new SharingError('BAD_CODE', 'That invite is to a workspace, not an event');
  if (preview.claimed) throw new SharingError('INVITE_CLAIMED', 'Someone has already used this invite');
  if (preview.expired) throw new SharingError('INVITE_EXPIRED', 'This invite has expired');
  if (!meetsVersion(host.appVersion ?? null, event.minAppVersion)) throw new SharingError('APP_OUTDATED', `Update cicis to join ${event.name}`);
  const terms = preview.terms;
  if (!terms || terms.inviteId !== preview.inviteId) throw new SharingError('BAD_CODE', 'That invite is not complete');
  const bookId = preview.bookId;
  const [held] = await host.database.db.values<[string, string | null, string | null]>(sql`
    SELECT e.event_id, s.state, s.member_id FROM event_books e LEFT JOIN shared_books s ON s.book_id = e.book_id WHERE e.book_id = ${bookId}`);
  if (held && held[1] === 'active') throw new SharingError('ALREADY_SHARED', `${event.name} is already on this device`);
  if (held && !(terms.sameMember && (held[2] === null || held[2] === terms.memberId))) {
    throw new SharingError('INVITE_MISMATCH', `This invite is for someone else: ask for an invite for this phone's person in ${event.name}`);
  }
  let memberId: string;
  if (terms.sameMember) memberId = terms.memberId!;
  else if (input.personId) {
    const named = event.people.find((p) => p.personId === input.personId);
    if (!named) throw new SharingError('NOT_FOUND', `That name is no longer in ${event.name}`);
    if (named.claimed) throw new SharingError('NAME_TAKEN', `${named.name} already has the app`);
    memberId = input.personId;
  } else memberId = uuidv7();
  const name = (terms.sameMember ? (preview.memberName ?? input.name) : input.name).trim();
  if (!name) throw new SharingError('BAD_CODE', 'Enter the name this person goes by');
  if (!terms.sameMember && !input.personId) {
    // A new name is not one already in the event: that person picks their name instead, or this one goes by another.
    const same = event.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (same) throw new SharingError('NAME_TAKEN', same.claimed ? `${same.name} is already in ${event.name}: pick another name` : `${same.name} is already in ${event.name}: pick ${same.name} to join under that name`);
  }

  const { inviteId, secret } = parseInviteCode(code);
  const claim = await host.transport.claimInvite(inviteId, host.device.public);
  const keys = await openInviteJson<InviteKey[]>(await inviteKeyOf(secret, inviteId), claim.keys, inviteAad('keys', inviteId));
  if (keys.length === 0) throw new SharingError('NO_KEYS', 'That invite carries no keys; ask for a new one');
  const epochs = new Set(keys.map((k) => k.epoch));
  const epoch = epochs.has(claim.epoch) ? claim.epoch : Math.max(...epochs);
  const now = new Date(host.now()).toISOString();
  host.sealer.forget();
  let eventId = held?.[0] ?? '';
  await host.database.transaction(async (tx) => {
    if (held) {
      // The log is pulled again from its first entry; this phone's postings stay, and follow the records as they arrive.
      await dropEventLogTx(tx, bookId);
      await tx.run(sql`
        INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${claim.bookId}, ${epoch}, ${memberId}, 'active', ${now})
        ON CONFLICT (book_id) DO UPDATE SET relay_book_id = excluded.relay_book_id, epoch = excluded.epoch, member_id = excluded.member_id, state = 'active', synced_at = NULL, unshared_by = NULL, unshared_reason = NULL`);
    } else {
      eventId = uuidv7();
      await tx.run(sql`
        INSERT INTO events (id, workspace_id, name, starts_on, ends_on, planned_minor, goal_id, set_id, finished_at, archived_at, created_at)
        VALUES (${eventId}, ${input.ws.workspaceId}, ${event.name}, ${event.startsOn}, ${event.endsOn}, NULL, NULL, NULL, NULL, NULL, ${now})`);
      await tx.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${claim.bookId}, ${epoch}, ${memberId}, 'active', ${now})`);
      await openEventBookTx(tx, input.ws, { bookId, eventId, name: event.name, currency: event.currency });
    }
    for (const k of keys) await host.sealer.storeEpochKeyTx(tx, bookId, k.epoch, base64UrlToBytes(k.key));
  });
  // The introduction, with the signed terms it joins on, as a change-set of its own (§8.2 step 7). Every member owns
  // the event's book, so a new member introduces itself as an owner (`everyMemberOwns` admits it).
  await host.database.transaction(async (tx) => {
    const newMember = !terms.sameMember;
    if (newMember) await tx.run(sql`INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${bookId}, ${memberId}, ${name}, 'owner', ${now}) ON CONFLICT (book_id, member_id) DO NOTHING`);
    await tx.run(sql`
      INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at, app_version)
      VALUES (${bookId}, ${host.device.deviceId}, ${memberId}, ${input.deviceName}, ${JSON.stringify(host.device.public.signJwk)}, ${JSON.stringify(host.device.public.agreeJwk)}, ${now}, NULL, ${host.appVersion ?? null})
      ON CONFLICT (book_id, device_id) DO UPDATE SET member_id = excluded.member_id, name = excluded.name, added_at = excluded.added_at, removed_at = NULL, app_version = excluded.app_version`);
    const book = { bookId, memberId, epoch };
    const ops = [
      ...(await rowUpsertsTx(tx, book, 'device')).filter((op) => op.id === host.device.deviceId),
      ...(newMember ? (await rowUpsertsTx(tx, book, 'member')).filter((op) => op.id === memberId) : []),
    ];
    await writeChangeSetsTx(tx, captureConfigOf(host.database), book, ops, { invite: terms });
  });
  let result = await host.syncOnce(bookId);
  // R1: of two phones claiming one name, the log admitted the other. This one leaves nothing behind.
  if ((await host.database.transaction((tx) => viewDevice(tx, bookId, host.device.deviceId))) === null) {
    // The claim made this device one of the relay book's devices, of which a book has only a few: it takes itself off
    // (any device may remove itself), so a refused claim never holds a place someone else needs.
    await quietly(host.transport.removeDevice(claim.bookId, host.device.deviceId));
    if (held) {
      // A phone that held the event keeps it, read-only, waiting for an invite that names its person again.
      await host.database.transaction(async (tx) => {
        await dropEventLogTx(tx, bookId);
        await tx.run(sql`UPDATE shared_books SET state = 'needs_invite' WHERE book_id = ${bookId}`);
      });
      throw new SharingError('NAME_TAKEN', `Another phone joined ${event.name} on this invite a moment ago. Ask for a new invite.`);
    }
    await host.database.transaction((tx) => undoRefusedJoinTx(tx, input.ws, bookId, eventId));
    host.sealer.forget();
    throw new SharingError('NAME_TAKEN', `${name} was claimed on another phone a moment ago. Ask for a new invite.`);
  }
  if (!terms.sameMember) {
    await host.database.transaction(async (tx) => {
      const [person] = await tx.values<[string | null]>(sql`SELECT member_id FROM event_people WHERE book_id = ${bookId} AND id = ${memberId}`);
      if (person && person[0] !== null) return;
      // Only the row this claim changes is captured: capture judges every row it is pointed at.
      await withCapture(tx, { entity: 'event_person', id: memberId, bookId }, async () => {
        if (!person) await tx.run(sql`INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES (${bookId}, ${memberId}, ${name}, ${memberId}, NULL)`);
        else await tx.run(sql`UPDATE event_people SET member_id = ${memberId} WHERE book_id = ${bookId} AND id = ${memberId}`);
      });
    });
    result = await host.syncOnce(bookId);
  }
  return { bookId, eventId, personId: memberId, result };
}

/**
 * D9, §7 Leave: leaving needs this person's balance at zero — nothing more: their records stay, in any expense, and so
 * do their own derived transactions. Their devices leave the relay book and the others rotate the key on their next
 * sync (`leave`). The last person with the app stays (`LAST_MEMBER`): someone must hold the log.
 */
export async function leaveEvent(host: EventLogHost, bookId: string): Promise<void> {
  const book = await eventBookTx(host.database.db, bookId);
  if (!book || book.state !== 'active') throw new SharingError('NOT_FOUND', 'That event is not shared on this device');
  const refusal = await personRefusalTx(host.database.db, book, book.me);
  if (refusal?.code === 'NOT_SETTLED') throw new SharingError('NOT_SETTLED', refusal.message);
  try {
    await host.leave(bookId);
  } catch (error) {
    if (error instanceof LastOwnerError) throw new SharingError('LAST_MEMBER', `${book.name} needs someone else with the app before the last one leaves`);
    throw error;
  }
}

/** The devices a person with the app has in the event's book, per this phone's view of its log. */
async function personDevices(host: EventLogHost, bookId: string, personId: string): Promise<string[]> {
  return host.database.transaction(async (tx) => {
    const out: string[] = [];
    for (const deviceId of await viewActiveDevices(tx, bookId)) if ((await viewDevice(tx, bookId, deviceId))?.memberId === personId) out.push(deviceId);
    return out;
  });
}

/**
 * Lost phone (§7): removes only a person's phones from the event, keeping the person, their records and their balance.
 * A new phone can then join as them (`mayLinkAsMemberTx`). Any member may, as they may remove a person; this phone's
 * own person never (that is `leaveEvent`).
 */
export async function removeEventMemberPhones(host: EventLogHost, ws: WorkspaceContext, eventId: string, personId: string): Promise<void> {
  const book = await openSharedEventTx(host.database.db, ws, eventId);
  const [person] = await host.database.db.values<[string, string | null]>(sql`SELECT name, member_id FROM event_people WHERE book_id = ${book.bookId} AND id = ${personId}`);
  if (!person || person[1] === null) return;
  if (personId === book.me) throw new SharedEventDbError('INVALID', `${person[0]}'s phone is this one: ${person[0]} leaves from the event's menu instead`);
  for (const deviceId of await personDevices(host, book.bookId, personId)) await host.removeDevice(book.bookId, deviceId);
  await quietly(host.syncOnce(book.bookId));
}

/**
 * Removes a person (D9): at zero balance and in no record, and not while the event is Done (R9). A name without the
 * app is Task 6's `removeEventPerson`; a person with the app has their devices removed from the book first (any member
 * may: every member owns it) — this phone rotates the key at once, the others on their next sync — and then their name
 * is marked removed. A person leaves by `leaveEvent`, never by removing themselves.
 */
export async function removeEventMember(host: EventLogHost, ws: WorkspaceContext, eventId: string, personId: string): Promise<void> {
  const book = await openSharedEventTx(host.database.db, ws, eventId);
  const [person] = await host.database.db.values<[string, string | null, string | null]>(sql`SELECT name, member_id, removed_at FROM event_people WHERE book_id = ${book.bookId} AND id = ${personId}`);
  if (!person || person[2] !== null) return;
  if (person[1] === null) return removeEventPerson(host.database, ws, eventId, personId);
  if (personId === book.me) throw new SharedEventDbError('INVALID', `${person[0]} leaves from the event's menu instead`);
  const refusal = await personRefusalTx(host.database.db, book, personId);
  if (refusal) throw refusal;
  for (const deviceId of await personDevices(host, book.bookId, personId)) await host.removeDevice(book.bookId, deviceId);
  await host.database.transaction((tx) =>
    withCapture(tx, { entity: 'event_person', id: personId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_people SET removed_at = ${new Date(host.now()).toISOString()} WHERE book_id = ${book.bookId} AND id = ${personId}`),
    ),
  );
  await quietly(host.syncOnce(book.bookId));
}

/** Whether `personId` is a member of the event's book per the view: a person with the app, whose new phone may join as them. */
export async function isEventMember(database: Database, bookId: string, personId: string): Promise<boolean> {
  const member = await database.transaction((tx) => viewMember(tx, bookId, personId));
  return member !== null && !member.deleted;
}
