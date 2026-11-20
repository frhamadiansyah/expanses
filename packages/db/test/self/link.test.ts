import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createAccount, type Database, listAccounts, postTransaction, renameAccount, type WorkspaceContext } from '../../src/index';
import { generateDevice, requestSignerOf, type DeviceKeys } from '../../src/sync/keys';
import { MemoryTransport } from '../../src/sync/memory-transport';
import { SyncTransportError } from '../../src/sync/types';
import { sha256Hex } from '../../src/sync/relay-signing';
import { SelfEngine, selfBookId, type SelfDeviceInfo } from '../../src/self/engine';
import type { LinkView } from '../../src/self/link-hub';
import type { SelfTransport } from '../../src/self/transport';
import { dumpForSelf } from '../../src/self/dump';
import { setupDb } from '../helpers';
import { copyOf } from './devices';

vi.setConfig({ testTimeout: 60_000 });

/*
 * Link my devices, Drop 2 (spec §3.5, §5): linking the owner's own devices over the relay — code, check digits, Allow —
 * then syncing, unlinking and the copy as blobs, between devices in memory. The new devices start as byte copies taken
 * before linking: that copy is Drop 3's to hand over. Invented data: made-up bank, shop and figures.
 */

interface Owned {
  name: string;
  database: Database;
  ws: WorkspaceContext;
  keys: DeviceKeys;
  transport: SelfTransport;
  engine: SelfEngine;
}

async function household(names: { name: string; kind: SelfDeviceInfo['kind'] }[], relay = new MemoryTransport()) {
  const t = await setupDb();
  const bank = (await createAccount(t.database, t.ws, { name: 'Test Bank', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-01-01' })).id;
  const groceries = (await listAccounts(t.database, t.ws)).find((a) => a.name === 'Groceries')!.id;
  const devices: Owned[] = [];
  for (const [i, { name, kind }] of names.entries()) {
    const database = i === 0 ? t.database : await copyOf(t.database);
    const keys = await generateDevice();
    const transport = relay.as(requestSignerOf(keys));
    devices.push({ name, database, ws: t.ws, keys, transport, engine: new SelfEngine(database, transport, keys, { name, kind, appVersion: '0.5.7' }) });
  }
  const spend = (d: Owned, amountMinor: number, description = 'Test shop') =>
    postTransaction(d.database, d.ws, { occurredOn: '2026-11-18', description, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank, amountMinor, currency: 'IDR' }) });
  return { relay, devices, bank, spend };
}

/** The whole link, as the two screens drive it: code, digits on both, Allow. Answers both screens' digits. */
async function link(source: Owned, joiner: Owned): Promise<{ sourceDigits: string; joinerDigits: string; deviceName: string }> {
  const { sessionId, code } = await source.engine.startLinking();
  await joiner.engine.joinWithCode(code);
  expect((await source.engine.checkLinking(sessionId)).stage).toBe('waiting'); // reveals its nonce
  const joinerSide = await joiner.engine.checkJoining(sessionId);
  const sourceSide = await source.engine.checkLinking(sessionId);
  if (joinerSide.stage !== 'confirm' || sourceSide.stage !== 'confirm') throw new Error(`not confirming: ${joinerSide.stage} / ${sourceSide.stage}`);
  await source.engine.allowLinking(sessionId);
  expect(await joiner.engine.checkJoining(sessionId)).toMatchObject({ stage: 'linked' });
  return { sourceDigits: sourceSide.digits, joinerDigits: joinerSide.digits, deviceName: sourceSide.deviceName };
}

const sameRows = async (a: Owned, b: Owned) => {
  const [x, y] = [await dumpForSelf(a.database), await dumpForSelf(b.database)];
  return Object.keys(x).filter((t) => JSON.stringify(x[t]) !== JSON.stringify(y[t]));
};

describe('linking a device', () => {
  it('shows the same 4 digits on both screens, names the new device, and links it on Allow', async () => {
    const { relay, devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    const { sourceDigits, joinerDigits, deviceName } = await link(phone!, mac!);
    expect(sourceDigits).toMatch(/^\d{4}$/);
    expect(joinerDigits).toBe(sourceDigits);
    expect(deviceName).toBe('MacBook Air');
    const [p, m] = [await phone!.engine.group(), await mac!.engine.group()];
    expect(m).toMatchObject({ relayBookId: p!.relayBookId, state: 'active', epoch: 1 });
    expect(relay.peek(p!.relayBookId)!.owners.has(mac!.keys.deviceId)).toBe(true);
  });

  it('then each device’s changes reach the other, and both list both devices', async () => {
    const { devices: [phone, mac], spend } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    await link(phone!, mac!);
    const id = await spend(phone!, 120_000);
    await phone!.engine.sync();
    await mac!.engine.sync();
    expect(await mac!.database.db.values(sql`SELECT description FROM transactions WHERE id = ${id}`)).toEqual([['Test shop']]);
    await renameAccount(mac!.database, mac!.ws, (await listAccounts(mac!.database, mac!.ws)).find((a) => a.name === 'Test Bank')!.id, 'Test Bank Gold');
    await mac!.engine.sync();
    await phone!.engine.sync();
    expect(await sameRows(phone!, mac!)).toEqual([]);
    for (const d of [phone!, mac!]) expect((await d.engine.devices()).map((row) => [row.name, row.kind])).toEqual([['iPhone', 'phone'], ['MacBook Air', 'mac']]);
  });

  it('a device already linked cannot take a code; a mistyped code is said so', async () => {
    const { devices: [phone, mac, ipad] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }, { name: 'iPad', kind: 'tablet' }]);
    await link(phone!, mac!);
    const { code } = await ipad!.engine.startLinking();
    // Linked already, or showing a code itself (it holds a group then): it gives its data, it never takes another's.
    await expect(phone!.engine.joinWithCode(code)).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
    await expect(ipad!.engine.joinWithCode(code)).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
    const { devices: [fresh] } = await household([{ name: 'Test iPad', kind: 'tablet' }]);
    await expect(fresh!.engine.joinWithCode('12 34')).rejects.toMatchObject({ code: 'BAD_CODE' });
  });

  it('a code is good for 10 minutes', async () => {
    let now = Date.now();
    const relay = new MemoryTransport({ now: () => now });
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }], relay);
    const { sessionId, code } = await phone!.engine.startLinking();
    now += 10 * 60 * 1000 + 1;
    await expect(mac!.engine.joinWithCode(code)).rejects.toMatchObject({ status: 410 });
    expect(await phone!.engine.checkLinking(sessionId)).toEqual({ stage: 'ended', why: 'expired' });
  });

  it('Don’t allow ends it on both screens', async () => {
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    const { sessionId, code } = await phone!.engine.startLinking();
    await mac!.engine.joinWithCode(code);
    await phone!.engine.checkLinking(sessionId);
    await mac!.engine.checkJoining(sessionId);
    await phone!.engine.declineLinking(sessionId);
    expect(await mac!.engine.checkJoining(sessionId)).toEqual({ stage: 'ended', why: 'declined' });
    expect(await mac!.engine.group()).toBeNull();
  });
});

describe('a relay that swaps keys', () => {
  /** The new device's relay hands it an attacker's keys in place of the source's, as a relay in the middle would. */
  function swapping(inner: SelfTransport, attacker: DeviceKeys): SelfTransport {
    const swap = (view: LinkView): LinkView => ({ ...view, source: { ...attacker.public, deviceId: attacker.deviceId } });
    return new Proxy(inner, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop === 'claimLink' || prop === 'readLink' || prop === 'revealLink') {
          return async (...args: unknown[]) => swap(await (value as (...a: unknown[]) => Promise<LinkView>).apply(target, args));
        }
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  it('shows different digits on the two screens, so the owner does not allow it', async () => {
    const relay = new MemoryTransport();
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }], relay);
    const attacker = await generateDevice();
    const macEngine = new SelfEngine(mac!.database, swapping(mac!.transport, attacker), mac!.keys, { name: 'MacBook Air', kind: 'mac', appVersion: '0.5.7' });
    const { sessionId, code } = await phone!.engine.startLinking();
    await macEngine.joinWithCode(code);
    await phone!.engine.checkLinking(sessionId);
    const macSide = await macEngine.checkJoining(sessionId);
    const phoneSide = await phone!.engine.checkLinking(sessionId);
    expect(macSide.stage === 'confirm' && phoneSide.stage === 'confirm' && macSide.digits !== phoneSide.digits).toBe(true);
  });

  it('a new device whose revealed nonce is not the one it committed to is refused before Allow', async () => {
    const relay = new MemoryTransport();
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }], relay);
    const { sessionId, code } = await phone!.engine.startLinking();
    await mac!.transport.claimLink(code, mac!.keys.public, 'ab'.repeat(32));
    await phone!.engine.checkLinking(sessionId);
    await mac!.transport.revealLink(sessionId, 'x'.repeat(43));
    expect(await phone!.engine.checkLinking(sessionId)).toEqual({ stage: 'ended', why: 'mismatch' });
  });
});

describe('unlinking', () => {
  it('a lost Mac reads nothing new: it is told it was unlinked, and the iPad carries on under a new key', async () => {
    const { relay, devices: [phone, mac, ipad], spend } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }, { name: 'iPad', kind: 'tablet' }]);
    await link(phone!, mac!);
    await link(phone!, ipad!);
    await phone!.engine.sync();
    await mac!.engine.sync();
    await ipad!.engine.sync();

    await phone!.engine.unlink(mac!.keys.deviceId);
    const book = (await phone!.engine.group())!.relayBookId;
    expect((await phone!.engine.group())!.epoch).toBe(2);
    const id = await spend(phone!, 77_000, 'After the unlink');
    await phone!.engine.sync();

    expect(await mac!.engine.sync()).toMatchObject({ unlinked: true });
    expect((await mac!.engine.group())!.state).toBe('unlinked');
    expect(await mac!.database.db.values(sql`SELECT 1 FROM transactions WHERE id = ${id}`)).toEqual([]);
    // Its own data stays where it is.
    expect((await mac!.database.db.values(sql`SELECT count(*) FROM transactions`))[0]![0]).toBeGreaterThan(0);
    await expect(mac!.transport.pull(book, 0)).rejects.toMatchObject({ status: 403 });

    await ipad!.engine.sync();
    expect(await ipad!.database.db.values(sql`SELECT description FROM transactions WHERE id = ${id}`)).toEqual([['After the unlink']]);
    expect((await ipad!.engine.group())!.epoch).toBe(2);
    expect((await ipad!.engine.devices()).find((d) => d.name === 'MacBook Air')!.removedAt).not.toBeNull();
    expect(relay.peek(book)!.epoch).toBe(2);
  });
});

describe('the copy as blobs', () => {
  it('goes up in parts of at most 700 KB and comes back whole; an altered part is refused', async () => {
    const { relay, devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    await link(phone!, mac!);
    const bytes = await phone!.database.exportBytes();
    const padded = new Uint8Array(Math.max(bytes.length, 800 * 1024));
    padded.set(bytes);
    const manifest = await phone!.engine.uploadCopy(padded);
    expect(manifest.hashes.length).toBe(Math.ceil(padded.length / (700 * 1024 - 28)));
    expect(manifest.hashes.length).toBeGreaterThan(1);
    const back = await mac!.engine.downloadCopy(manifest);
    expect([back.length, await sha256Hex(back)]).toEqual([padded.length, await sha256Hex(padded)]);

    const book = (await phone!.engine.group())!.relayBookId;
    const stored = relay.peek(book)!.blobs.get(manifest.hashes[0]!)!;
    relay.peek(book)!.blobs.set(manifest.hashes[0]!, { ...stored, data: stored.data.slice(0, -4) + 'AAAA' });
    await expect(mac!.engine.downloadCopy(manifest)).rejects.toMatchObject({ code: 'MISMATCH' });

    await phone!.engine.deleteCopy(manifest);
    await expect(mac!.transport.getBlob(book, manifest.hashes[1]!)).rejects.toBeInstanceOf(SyncTransportError);
  });
});

describe('the relay’s log of the group', () => {
  it('drops what both devices have read', async () => {
    const { relay, devices: [phone, mac], spend } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    await link(phone!, mac!);
    for (let i = 0; i < 3; i += 1) {
      await spend(phone!, 10_000 + i);
      await phone!.engine.sync();
    }
    await mac!.engine.sync();
    await phone!.engine.sync();
    const book = relay.peek((await phone!.engine.group())!.relayBookId)!;
    expect(book.log.size).toBe(0);
    expect(book.prunedThrough).toBe(book.seq);
    expect(selfBookId('x')).toBe('self:x');
  });
});
