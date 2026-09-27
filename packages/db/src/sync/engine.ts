import { uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { Database } from '../database';
import { pullAndApply, sealerOf, type PullResult } from './apply';
import { captureConfigOf, localDeviceId } from './capture';
import { assertShareableTx, seedBookTx } from './seed';
import type { DevicePublic, LogEntry, SyncTransport } from './types';

/*
 * The household-sharing engine: the one thing the app (task 7's SyncScheduler callback) and later tasks call.
 * `shareBook` is §6.5 steps 0–3; `syncOnce` drains the outbox (§9.4) and then pulls and applies (§7.1).
 *
 * Sealing: capture seals each change-set into `sync_outbox` at commit today, through the database's capture config
 * (`configureCapture(database, { sealerFor })`). Task 5 may move sealing to drain time; the only place that changes is
 * `outboxEntry` below, which turns an outbox row into the entry that is appended.
 */

export interface ShareInput {
  memberName: string;
  deviceName: string;
  device: DevicePublic;
  /** This person's member id in the book. A fresh one when omitted. */
  memberId?: string;
}

export interface SyncOnceResult extends PullResult {
  /** Outbox entries appended to the relay by this call. */
  pushed: number;
}

interface OutboxRow {
  id: string;
  entryJson: string;
}

/** An outbox row as the log entry to append. Sealed at capture today; the seam for sealing at drain (task 5). */
async function outboxEntry(row: OutboxRow): Promise<LogEntry> {
  return JSON.parse(row.entryJson) as LogEntry;
}

export class SyncEngine {
  constructor(
    private readonly database: Database,
    private readonly transport: SyncTransport,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Shares a book (§6.5): refuses a book in another currency before anything is made (step 0), creates the relay book
   * (step 1), then in one transaction writes `shared_books`, this member and device, and seeds every row in scope into
   * the outbox (steps 1–3). The caller drains (`syncOnce`) before showing an invite (step 4).
   */
  async shareBook(bookId: string, input: ShareInput): Promise<{ relayBookId: string; memberId: string; changeSets: number }> {
    await this.database.transaction((tx) => assertShareableTx(tx, bookId));
    const { bookId: relayBookId } = await this.transport.createBook(input.device);
    const memberId = input.memberId ?? uuidv7();
    const config = captureConfigOf(this.database);
    const changeSets = await this.database.transaction(async (tx) =>
      seedBookTx(tx, config, {
        bookId,
        relayBookId,
        memberId,
        memberName: input.memberName,
        deviceId: await localDeviceId(tx),
        deviceName: input.deviceName,
        device: input.device,
      }),
    );
    return { relayBookId, memberId, changeSets };
  }

  /** Appends every outbox entry of the book to the relay, in hlc order, each removed once the relay has it (§9.4). */
  async drain(bookId: string): Promise<number> {
    const [shared] = await this.database.db.values<[string]>(sql`SELECT relay_book_id FROM shared_books WHERE book_id = ${bookId} AND state = 'active'`);
    if (!shared) return 0;
    const rows = await this.database.db.values<[string, string]>(sql`SELECT id, entry_json FROM sync_outbox WHERE book_id = ${bookId} ORDER BY hlc`);
    let pushed = 0;
    for (const [id, entryJson] of rows) {
      await this.transport.append(shared[0], await outboxEntry({ id, entryJson }));
      await this.database.db.run(sql`DELETE FROM sync_outbox WHERE id = ${id}`);
      pushed += 1;
    }
    return pushed;
  }

  /** One sync of one book: drain, then pull and apply. A transport failure throws; the outbox and cursor stay put. */
  async syncOnce(bookId: string): Promise<SyncOnceResult> {
    const pushed = await this.drain(bookId);
    const result = await pullAndApply(this.database, this.transport, await sealerOf(this.database), bookId, this.now);
    return { pushed, ...result };
  }
}
