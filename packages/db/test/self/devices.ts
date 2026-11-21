import { createDatabase, type Database, type WorkspaceContext } from '../../src/index';
import { createNodeExecutor } from '../../src/node';
import { applySelfChangeSet, collectSelfChanges, drainSelfOutbox, installSelfCapture, type SelfApplyResult } from '../../src/self/channel';
import { dumpForSelf } from '../../src/self/dump';
import { setupDb, type TestDb } from '../helpers';

/*
 * Two of the owner's devices for the self channel's tests (link my devices, Drop 1): an iPhone with invented data, and
 * a Mac that starts as a byte copy of it (§4), both capturing. No relay: a change-set goes from one to the other by hand.
 */
export const PHONE_ID = 'a1'.repeat(16);
export const MAC_ID = 'b2'.repeat(16);

export interface Device {
  name: string;
  deviceId: string;
  database: Database;
  ws: WorkspaceContext;
}

export async function copyOf(database: Database): Promise<Database> {
  const executor = createNodeExecutor();
  await executor.importBytes(await database.exportBytes());
  return createDatabase(executor);
}

export async function linkedPair(build?: (t: TestDb) => Promise<void>): Promise<{ phone: Device; mac: Device }> {
  const t = await setupDb();
  await build?.(t);
  const mac = await copyOf(t.database);
  await installSelfCapture(t.database);
  await installSelfCapture(mac);
  return { phone: { name: 'phone', deviceId: PHONE_ID, database: t.database, ws: t.ws }, mac: { name: 'mac', deviceId: MAC_ID, database: mac, ws: t.ws } };
}

/** Everything `from` has captured and not sent, applied on `to` in order. Null when there was nothing; a hold stops it. */
export async function send(from: Device, to: Device): Promise<SelfApplyResult | null> {
  await collectSelfChanges(from.database, from.deviceId);
  let last: SelfApplyResult | null = null;
  for (const changeSet of await drainSelfOutbox(from.database)) {
    last = await applySelfChangeSet(to.database, changeSet, to.deviceId);
    if (last.status === 'held') return last;
  }
  return last;
}

/** Both ways, until neither has anything left. */
export async function exchange(a: Device, b: Device): Promise<SelfApplyResult[]> {
  const results: SelfApplyResult[] = [];
  for (let round = 0; round < 4; round += 1) {
    const one = await send(a, b);
    const two = await send(b, a);
    for (const r of [one, two]) if (r) results.push(r);
    if (!one && !two) break;
  }
  return results;
}

export async function sameRows(a: Device, b: Device): Promise<string[]> {
  const [x, y] = [await dumpForSelf(a.database), await dumpForSelf(b.database)];
  return Object.keys(x).filter((table) => JSON.stringify(x[table]) !== JSON.stringify(y[table]));
}
