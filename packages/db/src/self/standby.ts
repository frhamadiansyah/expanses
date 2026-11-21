import { sql } from 'drizzle-orm';
import type { Database } from '../database';

/*
 * Link my devices, Drop 5 (spec §3.4): every linked device stands by in each workspace shared with someone else, so
 * that losing the seat never loses the household. The seat invites each other device of the group into each shared
 * book as a device of the owner's own member; the invite travels in the owner's channel (`self_standby`); the device
 * claims it (`SyncEngine.claimStandby`). These are the database's halves; the app runs them after each sync.
 */

export interface StandbyWanted {
  bookId: string;
  relayBookId: string;
  deviceId: string;
  deviceName: string;
}

/**
 * On the seat: each (shared book, other linked device) that has no device row in the book and no invite waiting. Only
 * active workspace books this device writes (not a net-worth group log or an event's book, which follow their own
 * rules): their invites are an owner's, and a book where this device's member is no owner is left out.
 */
export async function standbyWanted(database: Database, seatId: string): Promise<StandbyWanted[]> {
  const rows = await database.db.values<[string, string, string, string]>(sql`
    SELECT s.book_id, s.relay_book_id, d.device_id, d.name
    FROM shared_books s JOIN books b ON b.id = s.book_id
    CROSS JOIN self_devices d
    WHERE s.state = 'active' AND d.removed_at IS NULL AND d.device_id <> ${seatId}
      AND EXISTS (SELECT 1 FROM sync_authority a WHERE a.book_id = s.book_id AND a.member_id = s.member_id AND a.role = 'owner' AND a.deleted = 0)
      AND NOT EXISTS (SELECT 1 FROM book_devices bd WHERE bd.book_id = s.book_id AND bd.device_id = d.device_id AND bd.removed_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM self_standby x WHERE x.relay_book_id = s.relay_book_id AND x.device_id = d.device_id)
    ORDER BY s.book_id, d.device_id`);
  return rows.map(([bookId, relayBookId, deviceId, deviceName]) => ({ bookId, relayBookId, deviceId, deviceName }));
}

export async function offerStandby(database: Database, relayBookId: string, deviceId: string, code: string, now: number): Promise<void> {
  await database.db.run(sql`INSERT INTO self_standby (relay_book_id, device_id, code, made_at) VALUES (${relayBookId}, ${deviceId}, ${code}, ${new Date(now).toISOString()})
    ON CONFLICT (relay_book_id, device_id) DO UPDATE SET code = excluded.code, made_at = excluded.made_at`);
}

/** On another linked device: the seat's invites for it not claimed yet. */
export async function standbyOffers(database: Database, deviceId: string): Promise<{ relayBookId: string; code: string }[]> {
  const rows = await database.db.values<[string, string]>(sql`
    SELECT x.relay_book_id, x.code FROM self_standby x
    WHERE x.device_id = ${deviceId}
      AND NOT EXISTS (SELECT 1 FROM self_state st WHERE st.key = 'standby:' || x.relay_book_id)`);
  return rows.map(([relayBookId, code]) => ({ relayBookId, code }));
}

/** Claimed (or found used): never tried again on this device. */
export async function markStandbyDone(database: Database, relayBookId: string): Promise<void> {
  await database.db.run(sql`INSERT OR REPLACE INTO self_state (key, value) VALUES (${`standby:${relayBookId}`}, '1')`);
}

/** An invite that could not be claimed goes, so the seat offers a fresh one. */
export async function dropStandbyOffer(database: Database, relayBookId: string, deviceId: string): Promise<void> {
  await database.db.run(sql`DELETE FROM self_standby WHERE relay_book_id = ${relayBookId} AND device_id = ${deviceId}`);
}

/** The shared books this device stands by in (has a device row and keys), for a takeover. */
export async function standbyBooks(database: Database, deviceId: string): Promise<string[]> {
  const rows = await database.db.values<[string]>(sql`
    SELECT s.book_id FROM shared_books s JOIN books b ON b.id = s.book_id
    WHERE s.state = 'active' AND EXISTS (SELECT 1 FROM book_devices bd WHERE bd.book_id = s.book_id AND bd.device_id = ${deviceId} AND bd.removed_at IS NULL)`);
  return rows.map(([bookId]) => bookId);
}

/** This device keeps shared workspaces in step from now on (the seat was unlinked from here). */
export async function becomeSeat(database: Database, deviceId: string): Promise<void> {
  await database.db.run(sql`INSERT INTO settings (key, value) VALUES ('self.seat', ${deviceId}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
}
