import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { postTransaction } from '../../src/index';
import { pullAndApply } from '../../src/sync/apply';
import { MissingEpochKeyError, type ChangeLogEntry } from '../../src/sync/seal';
import { encodeHlc } from '../../src/sync/hlc';
import type { LogEntry } from '../../src/sync/types';
import { categoryOf, Household, projectBook, type Device } from './household';

/*
 * Removal and rotation (spec §8.4, §13 `rotation.test.ts`): a device removed at epoch n cannot open n+1 while every
 * remaining device opens both; two devices rotating at once end with one epoch (one 201, one 409); the leaving device
 * never seals; and the outbox, sealed at drain, goes out under the newest key.
 */

async function spend(d: Device, bookId: string, description: string): Promise<string> {
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-09-10',
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: d.bank, amountMinor: 12_000, currency: 'IDR' }),
  });
}

async function threeDevices() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const budi = await home.device('Budi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.join(budi, fandri);
  await home.settle();
  return { home, fandri, dewi, budi, bookId };
}

const log = (home: Household): (LogEntry & { seq: number })[] =>
  [...home.relay.peek(home.relayBookId)!.log.entries()].map(([seq, entry]) => ({ ...entry, seq }));
const epochOf = async (d: Device, bookId: string) => (await d.database.db.values<[number]>(sql`SELECT epoch FROM shared_books WHERE book_id = ${bookId}`))[0]![0];

describe('rotation (§8.4)', () => {
  it('a device removed at epoch n cannot open n+1; every remaining device opens both', async () => {
    const { home, fandri, dewi, budi, bookId } = await threeDevices();
    await spend(fandri, bookId, 'before');
    await fandri.engine.syncOnce(bookId);
    await fandri.engine.removeDevice(bookId, budi.deviceId);
    expect(await epochOf(fandri, bookId)).toBe(2);
    await spend(fandri, bookId, 'after');
    await home.settle([fandri, dewi]);

    const rotation = log(home).find((e) => e.kind === 'rotation') as Extract<LogEntry, { kind: 'rotation' }>;
    expect(rotation).toMatchObject({ deviceId: fandri.deviceId, epoch: 2 });
    expect(rotation.sealed.map((s) => s.deviceId).sort()).toEqual([fandri.deviceId, dewi.deviceId].sort());

    const changes = log(home).filter((e): e is ChangeLogEntry & { seq: number } => e.kind === 'change');
    const before = changes.find((e) => e.deviceId === fandri.deviceId && e.epoch === 1)!;
    const after = changes.find((e) => e.deviceId === fandri.deviceId && e.epoch === 2)!;
    // The removed device, handed the log by some other means, still opens epoch 1 and cannot open epoch 2.
    await expect(budi.engine.sealer.open(bookId, before)).resolves.toBeTruthy();
    await expect(budi.engine.sealer.open(bookId, after)).rejects.toBeInstanceOf(MissingEpochKeyError);
    // And the relay no longer lets it pull at all.
    await expect(budi.transport.pull(home.relayBookId, 0)).rejects.toMatchObject({ status: 401 });
    // The remaining device opens both.
    await expect(dewi.engine.sealer.open(bookId, before)).resolves.toBeTruthy();
    await expect(dewi.engine.sealer.open(bookId, after)).resolves.toBeTruthy();
    expect(await epochOf(dewi, bookId)).toBe(2);
    expect(await projectBook(dewi.database, bookId)).toEqual(await projectBook(fandri.database, bookId));
  });

  it('two devices rotating at once: one 201, one 409, one epoch, and both end on the same key', async () => {
    // The removal goes in by hand (not `removeDevice`, which rotates straight away), so both remaining devices apply
    // it at epoch 1 and both decide to rotate before either sees the other's rotation.
    const { home: home2, fandri: a, dewi: b, budi: c, bookId: book2 } = await threeDevices();
    const removal = await a.engine.sealer.sign({ kind: 'removal' as const, deviceId: a.deviceId, epoch: 1, hlc: encodeHlc(Date.now(), 0, a.deviceId), target: c.deviceId });
    await a.transport.append(home2.relayBookId, removal);
    await a.transport.removeDevice(home2.relayBookId, c.deviceId);
    for (const d of [a, b]) await pullAndApply(d.database, d.transport, d.engine.sealer, book2);
    const outcomes = await Promise.all([a.engine.maybeRotate(book2, 1), b.engine.maybeRotate(book2, 1)]);
    expect(outcomes.filter((o) => o === 2)).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(1);
    expect(home2.relay.peek(home2.relayBookId)!.epoch).toBe(2);
    expect(log(home2).filter((e) => e.kind === 'rotation')).toHaveLength(1);

    await home2.settle([a, b]);
    expect(await epochOf(a, book2)).toBe(2);
    expect(await epochOf(b, book2)).toBe(2);
    expect(await a.engine.sealer.epochKey(book2, 2)).toEqual(await b.engine.sealer.epochKey(book2, 2));
    await spend(b, book2, 'after the race');
    await home2.settle([a, b]);
    expect(await projectBook(a.database, book2)).toEqual(await projectBook(b.database, book2));
  });

  it('the leaving device never seals: a remaining device rotates when it applies the removal', async () => {
    const { home, fandri, dewi, budi, bookId } = await threeDevices();
    await budi.engine.removeDevice(bookId, budi.deviceId);
    expect(log(home).filter((e) => e.kind === 'rotation')).toHaveLength(0);
    await dewi.engine.syncOnce(bookId);
    const rotations = log(home).filter((e): e is Extract<LogEntry, { kind: 'rotation' }> & { seq: number } => e.kind === 'rotation');
    expect(rotations).toHaveLength(1);
    expect(rotations[0]!.deviceId).toBe(dewi.deviceId);
    expect(rotations[0]!.sealed.map((s) => s.deviceId)).not.toContain(budi.deviceId);
    await fandri.engine.syncOnce(bookId);
    expect(await epochOf(fandri, bookId)).toBe(2);
    // Fandri applied the same removal after Dewi's rotation: nothing more to rotate.
    expect(log(home).filter((e) => e.kind === 'rotation')).toHaveLength(1);
  });

  it('a change captured before a rotation is sealed under the newer key when it drains (seal at drain)', async () => {
    const { home, fandri, dewi, budi, bookId } = await threeDevices();
    await spend(dewi, bookId, 'waiting in the outbox');
    await fandri.engine.removeDevice(bookId, budi.deviceId);
    await pullAndApply(dewi.database, dewi.transport, dewi.engine.sealer, bookId); // takes the rotation in; drains nothing
    expect(await epochOf(dewi, bookId)).toBe(2);
    await dewi.engine.drain(bookId);
    const drained = log(home).filter((e) => e.deviceId === dewi.deviceId && e.kind === 'change').at(-1)!;
    expect(drained.epoch).toBe(2);
    await fandri.engine.syncOnce(bookId);
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
  });
});
