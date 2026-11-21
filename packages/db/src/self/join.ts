import { sql } from 'drizzle-orm';
import type { Database } from '../database';
import { receiveHlc } from '../sync/hlc';
import type { DeviceKeys } from '../sync/keys';
import { SelfEngine, type JoinPlan, type SelfDeviceInfo } from './engine';
import { SELF_TABLES, settingsKeyClass } from './tables';
import type { SelfTransport } from './transport';
import { installSelfCapture } from './triggers';

/*
 * Link my devices, the new device's side of replace-on-join (spec §4.2, step 4). By the time this runs the app has
 * saved a backup file of this device's old data and put the linking device's copy in its place. What is left is to
 * make the copy this device's own: everything that belonged to the linking install (its keys sealed for it, what it
 * still had to send, its own clock and settings) goes, and this device's place in the group goes in.
 *
 * It runs only on the copy: a database whose group is not the plan's — the old data, after a replace that did not
 * happen — is refused and left exactly as it is.
 */

export class JoinRefused extends Error {
  constructor(readonly code: 'NOT_THE_COPY' | 'ALREADY_DONE', message: string) {
    super(message);
    this.name = 'JoinRefused';
  }
}

/** The device-only tables whose rows came from the linking install, and go. `schema_migrations` stays: it is the file's. */
const WIPED: readonly string[] = Object.entries(SELF_TABLES)
  .filter(([table, kind]) => kind === 'device' && table !== 'schema_migrations')
  .map(([table]) => table);

/**
 * Whether this database is the plan's copy and not yet made this device's: what the app checks at open. 'not-the-copy'
 * only on a clean read — no group here, or another group's or an unlinked one's. A read that fails throws: the plan is
 * kept and the next open asks again, never dropped on a passing error.
 */
export async function planWaitsHere(database: Database, plan: JoinPlan): Promise<'waiting' | 'done' | 'not-the-copy'> {
  const [row] = await database.db.values<[string, string, string]>(sql`SELECT relay_book_id, device_id, state FROM self_group WHERE id = 1`);
  // An unlinked device's own old data, even from this very group, is never the copy (the copy is of an active device).
  if (!row || row[0] !== plan.relayBookId || row[2] !== 'active') return 'not-the-copy';
  return row[1] === plan.deviceId ? 'done' : 'waiting';
}

/**
 * Makes the copy this device's: the linking install's device-only rows and settings go, this device's keys and place
 * in the group (reading the log from `plan.startSeq`) go in, the clock is brought past every clock in the copy, capture
 * is made again for this schema, and this device writes its own row of the Devices list.
 */
export async function completeLinkedCopy(database: Database, plan: JoinPlan, transport: SelfTransport, device: DeviceKeys, info: SelfDeviceInfo): Promise<SelfEngine> {
  const here = await planWaitsHere(database, plan);
  if (here === 'not-the-copy') throw new JoinRefused('NOT_THE_COPY', "This device's data is not the copy it was to receive; nothing was changed");
  if (here === 'waiting') {
    await database.transaction(async (tx) => {
      // Quiet first: the copy came with the linking device's capture triggers, and nothing done here is a change to send.
      await tx.run(sql`INSERT OR REPLACE INTO self_state (key, value) VALUES ('quiet', '1')`);
      for (const table of WIPED) {
        if (table === 'self_state') continue;
        await tx.run(sql.raw(`DELETE FROM "${table}"`));
      }
      const keys = await tx.values<[string]>(sql`SELECT key FROM settings`);
      for (const [key] of keys) if (settingsKeyClass(key) === 'device') await tx.run(sql`DELETE FROM settings WHERE key = ${key}`);
      for (const { epoch, sealedJson } of plan.keys) {
        await tx.run(sql`INSERT INTO book_epoch_keys (book_id, epoch, key_sealed) VALUES (${`self:${plan.relayBookId}`}, ${epoch}, ${sealedJson})`);
      }
      await tx.run(sql`INSERT INTO self_group (id, device_id, relay_book_id, epoch, cursor, state, joined_at)
        VALUES (1, ${plan.deviceId}, ${plan.relayBookId}, ${plan.epoch}, ${plan.startSeq}, 'active', ${new Date().toISOString()})`);
      // This device's clock starts past every clock the copy holds, so nothing it writes loses to an older edit.
      const latest = (await tx.values<[string | null]>(sql`SELECT max(hlc) FROM self_clocks`))[0]?.[0];
      if (latest) await receiveHlc(tx, latest);
      await tx.run(sql`DELETE FROM self_state`);
    });
  }
  await installSelfCapture(database);
  const engine = new SelfEngine(database, transport, device, info);
  await engine.writeOwnRow(null);
  return engine;
}
