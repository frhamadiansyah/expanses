import { sql } from 'drizzle-orm';
import type { Database } from '../database';
import type { CopyManifest } from './engine';

/*
 * Link my devices, Drop 4: receipt photos between the owner's devices. A photo's row (`transaction_photos`) travels
 * with the figures; its file does not — it lives beside the database. So each device sends the files it holds that no
 * device has sent yet (sealed blobs on the relay, `SelfEngine.uploadCopy`), each device fetches the files whose rows
 * it has and whose file it lacks, and says so (`self_photo_have`). When every linked device holds a file its blobs go
 * from the relay. A blob is kept a week at most: a file still missing somewhere after that is sent again by a device
 * that holds it. The app does the file work (the photo store is the app's); these are the database's halves.
 */

/** A blob is sent again once this old if a linked device still lacks the file (the relay keeps blobs a week). */
export const PHOTO_RESEND_AFTER_MS = 6 * 24 * 60 * 60 * 1000;

const activeDevices = sql`SELECT device_id FROM self_devices WHERE removed_at IS NULL`;

/**
 * File names this device should send, oldest first: named by a photo row, never sent, or sent long enough ago that the
 * blobs may be gone while a linked device still lacks the file. The caller sends only those it holds.
 */
export async function photosToSend(database: Database, now: number, deviceId: string, limit = 20): Promise<string[]> {
  const before = new Date(now - PHOTO_RESEND_AFTER_MS).toISOString();
  const lacking = sql`EXISTS (SELECT 1 FROM (${activeDevices}) d WHERE NOT EXISTS (SELECT 1 FROM self_photo_have h WHERE h.file_name = p.file_name AND h.device_id = d.device_id))`;
  // Sent before, and a linked device still lacks it: its blobs may be gone (a week passed), or were let go before
  // that device was known here. The device that sent it sends it again — or any, once that device is unlinked.
  const again = sql`(s.manifest_json IS NULL OR s.sent_at < ${before}) AND (s.sent_by = ${deviceId} OR s.sent_by NOT IN (${activeDevices}))`;
  const rows = await database.db.values<[string]>(sql`
    SELECT DISTINCT p.file_name FROM transaction_photos p
    LEFT JOIN self_photos s ON s.file_name = p.file_name
    WHERE s.file_name IS NULL OR (${again} AND ${lacking})
    ORDER BY p.created_at, p.file_name
    LIMIT ${limit}`);
  return rows.map(([name]) => name);
}

/** This device sent a file (and holds it). */
export async function recordSentPhoto(database: Database, fileName: string, manifest: CopyManifest, deviceId: string, now: number): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.run(sql`INSERT INTO self_photos (file_name, manifest_json, sent_by, sent_at) VALUES (${fileName}, ${JSON.stringify(manifest)}, ${deviceId}, ${new Date(now).toISOString()})
      ON CONFLICT (file_name) DO UPDATE SET manifest_json = excluded.manifest_json, sent_by = excluded.sent_by, sent_at = excluded.sent_at`);
    await tx.run(sql`INSERT OR IGNORE INTO self_photo_have (file_name, device_id) VALUES (${fileName}, ${deviceId})`);
  });
}

/** Files whose row is here, whose blobs are on the relay, and which this device does not hold yet. */
export async function photosToFetch(database: Database, deviceId: string, limit = 20): Promise<{ fileName: string; manifest: CopyManifest }[]> {
  const rows = await database.db.values<[string, string]>(sql`
    SELECT s.file_name, s.manifest_json FROM self_photos s
    WHERE s.manifest_json IS NOT NULL
      AND EXISTS (SELECT 1 FROM transaction_photos p WHERE p.file_name = s.file_name)
      AND NOT EXISTS (SELECT 1 FROM self_photo_have h WHERE h.file_name = s.file_name AND h.device_id = ${deviceId})
    ORDER BY s.sent_at, s.file_name
    LIMIT ${limit}`);
  return rows.map(([fileName, json]) => ({ fileName, manifest: JSON.parse(json) as CopyManifest }));
}

/** This device holds the file (fetched, or found already here). */
export async function markPhotoHeld(database: Database, fileName: string, deviceId: string): Promise<void> {
  await database.db.run(sql`INSERT OR IGNORE INTO self_photo_have (file_name, device_id) VALUES (${fileName}, ${deviceId})`);
}

/**
 * Files this device sent that every linked device now holds: their blobs can go. Answers the manifests; `clearSent`
 * marks each done once its blobs are deleted.
 */
export async function photosEveryoneHolds(database: Database, deviceId: string): Promise<{ fileName: string; manifest: CopyManifest }[]> {
  const rows = await database.db.values<[string, string]>(sql`
    SELECT s.file_name, s.manifest_json FROM self_photos s
    WHERE s.manifest_json IS NOT NULL AND s.sent_by = ${deviceId}
      AND NOT EXISTS (SELECT 1 FROM (${activeDevices}) d WHERE NOT EXISTS (SELECT 1 FROM self_photo_have h WHERE h.file_name = s.file_name AND h.device_id = d.device_id))`);
  return rows.map(([fileName, json]) => ({ fileName, manifest: JSON.parse(json) as CopyManifest }));
}

export async function clearSentPhoto(database: Database, fileName: string): Promise<void> {
  await database.db.run(sql`UPDATE self_photos SET manifest_json = NULL WHERE file_name = ${fileName}`);
}

/** How many photo files this device still lacks, of those named here: the Devices page's line while photos arrive. */
export async function photosMissingHere(database: Database, deviceId: string): Promise<number> {
  const [row] = await database.db.values<[number]>(sql`
    SELECT count(DISTINCT p.file_name) FROM transaction_photos p
    WHERE NOT EXISTS (SELECT 1 FROM self_photo_have h WHERE h.file_name = p.file_name AND h.device_id = ${deviceId})`);
  return Number(row?.[0] ?? 0);
}
