import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { activityOf, createAccount, type Database, listAccounts, postTransaction, renameAccount, type WorkspaceContext } from '../../src/index';
import { generateDevice, requestSignerOf, type DeviceKeys } from '../../src/sync/keys';
import { MemoryTransport } from '../../src/sync/memory-transport';
import { SyncTransportError } from '../../src/sync/types';
import { bytesToBase64Url, sha256Hex } from '../../src/sync/relay-signing';
import { sealKeyFor } from '../../src/sync/crypto';
import { LATEST_VERSION } from '../../src/migrations';
import { SelfEngine, selfBookId, type SelfDeviceInfo, UNFINISHED_JOIN_MS } from '../../src/self/engine';
import type { LinkView } from '../../src/self/link-hub';
import type { SelfTransport } from '../../src/self/transport';
import { dumpForSelf } from '../../src/self/dump';
import { setupDb } from '../helpers';
import { completeLinkedCopy, JoinRefused, planWaitsHere } from '../../src/self/join';
import { configureCapture, seatIsElsewhere } from '../../src/sync/capture';

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
  info: SelfDeviceInfo;
  engine: SelfEngine;
}

async function household(names: { name: string; kind: SelfDeviceInfo['kind'] }[], relay = new MemoryTransport()) {
  const t = await setupDb();
  const bank = (await createAccount(t.database, t.ws, { name: 'Test Bank', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-01-01' })).id;
  const groceries = (await listAccounts(t.database, t.ws)).find((a) => a.name === 'Groceries')!.id;
  const devices: Owned[] = [];
  for (const [i, { name, kind }] of names.entries()) {
    // Every other device holds data of its own, which linking replaces with the first device's.
    let database = t.database;
    if (i > 0) {
      const other = await setupDb();
      await createAccount(other.database, other.ws, { name: `Old ${name} wallet`, kind: 'asset', subtype: 'cash', currency: 'IDR' });
      database = other.database;
    }
    const keys = await generateDevice();
    const transport = relay.as(requestSignerOf(keys));
    const info: SelfDeviceInfo = { name, kind, appVersion: '0.5.7' };
    devices.push({ name, database, ws: t.ws, keys, transport, info, engine: new SelfEngine(database, transport, keys, info) });
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
  expect(await joiner.engine.checkJoining(sessionId)).toEqual({ stage: 'allowed' });
  // What the app does on the new device: take the plan, fetch the copy, replace its data, make the copy its own.
  const plan = await joiner.engine.acceptLink(sessionId);
  const copy = await joiner.engine.downloadPlanCopy(plan);
  await joiner.database.importBytes(copy);
  joiner.engine = await completeLinkedCopy(joiner.database, plan, joiner.transport, joiner.keys, joiner.info);
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

describe('the welcome the new device takes', () => {
  /** The relay hands the new device a welcome of its choosing in place of the linking device's. */
  function welcoming(inner: SelfTransport, swap: (view: LinkView) => Promise<LinkView>): SelfTransport {
    return new Proxy(inner, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop === 'readLink') return async (...args: unknown[]) => swap(await (value as (...a: unknown[]) => Promise<LinkView>).apply(target, args));
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  async function allowedWith(transportOf: (mac: Owned) => SelfTransport) {
    const relay = new MemoryTransport();
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }], relay);
    const macEngine = new SelfEngine(mac!.database, transportOf(mac!), mac!.keys, mac!.info);
    const { sessionId, code } = await phone!.engine.startLinking();
    await macEngine.joinWithCode(code);
    await phone!.engine.checkLinking(sessionId);
    await macEngine.checkJoining(sessionId);
    await phone!.engine.checkLinking(sessionId);
    await phone!.engine.allowLinking(sessionId);
    return { relay, phone: phone!, mac: mac!, macEngine, sessionId };
  }

  it('without the linking device’s signature is refused, nothing claimed', async () => {
    const { relay, phone, macEngine, sessionId } = await allowedWith((mac) =>
      welcoming(mac.transport, async (view) => (view.welcome ? { ...view, welcome: { ...view.welcome, sig: undefined } } : view)),
    );
    await expect(macEngine.acceptLink(sessionId)).rejects.toMatchObject({ code: 'MISMATCH' });
    expect((await phone.engine.devices()).map((d) => d.name)).toEqual(['iPhone']);
    void relay;
  });

  it('made by someone else (sealed for the new device, signed with another key) is refused', async () => {
    const attacker = await generateDevice();
    const { phone, macEngine, sessionId } = await allowedWith((mac) =>
      welcoming(mac.transport, async (view) => {
        if (!view.welcome) return view;
        const forged = await sealKeyFor({ deviceId: mac.keys.deviceId, agreeJwk: mac.keys.public.agreeJwk }, `link:${view.sessionId}`, 1, new TextEncoder().encode('{"relayBookId":"elsewhere"}'));
        const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, attacker.sign.privateKey, new TextEncoder().encode('anything')));
        return { ...view, welcome: { ...forged, sig: bytesToBase64Url(sig) } };
      }),
    );
    await expect(macEngine.acceptLink(sessionId)).rejects.toMatchObject({ code: 'MISMATCH' });
    expect((await phone.engine.devices()).map((d) => d.name)).toEqual(['iPhone']);
  });

  it('from a newer version of the app is refused before anything is claimed or replaced: update this device first', async () => {
    const relay = new MemoryTransport();
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }], relay);
    class NewerEngine extends SelfEngine {
      protected override readonly schema = LATEST_VERSION + 1;
    }
    const newer = new NewerEngine(phone!.database, phone!.transport, phone!.keys, { ...phone!.info, appVersion: '0.6.0' });
    const { sessionId, code } = await newer.startLinking();
    await mac!.engine.joinWithCode(code);
    await newer.checkLinking(sessionId);
    await mac!.engine.checkJoining(sessionId);
    await newer.checkLinking(sessionId);
    await newer.allowLinking(sessionId);
    const before = await dumpForSelf(mac!.database);
    const refused = await mac!.engine.acceptLink(sessionId).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'NEWER_SOURCE' });
    expect(String((refused as Error).message)).toContain('Update cicis on this device first');
    expect((await newer.devices()).map((d) => d.name)).toEqual(['iPhone']);
    expect(await dumpForSelf(mac!.database)).toEqual(before);
  });
});

describe('a join that does not finish', () => {
  async function allowed(now?: () => number) {
    const relay = new MemoryTransport();
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }], relay);
    const phoneEngine = now ? new SelfEngine(phone!.database, phone!.transport, phone!.keys, phone!.info, now) : phone!.engine;
    const { sessionId, code } = await phoneEngine.startLinking();
    await mac!.engine.joinWithCode(code);
    await phoneEngine.checkLinking(sessionId);
    await mac!.engine.checkJoining(sessionId);
    await phoneEngine.checkLinking(sessionId);
    await phoneEngine.allowLinking(sessionId);
    const plan = await mac!.engine.acceptLink(sessionId); // claimed: the Mac holds a place on the relay
    return { relay, phone: phone!, phoneEngine, mac: mac!, plan };
  }
  const activeOn = (relay: MemoryTransport, book: string) => [...relay.peek(book)!.devices.entries()].filter(([, d]) => d.removedAt === undefined).map(([id]) => id);

  it('is taken back by the new device: it leaves the relay, and the log is pruned past it again', async () => {
    const { relay, phone, phoneEngine, mac, plan } = await allowed();
    expect(activeOn(relay, plan.relayBookId)).toContain(mac.keys.deviceId);
    await phoneEngine.sync();
    await phoneEngine.sync();
    await renameAccount(phone.database, phone.ws, (await listAccounts(phone.database, phone.ws)).find((a) => a.name === 'Test Bank')!.id, 'Test Bank (renamed)');
    await phoneEngine.sync();
    expect(relay.peek(plan.relayBookId)!.seq).toBeGreaterThan(plan.startSeq);
    expect(relay.peek(plan.relayBookId)!.prunedThrough).toBe(plan.startSeq); // held for the Mac
    await mac.engine.abandonJoin(plan.relayBookId);
    expect(activeOn(relay, plan.relayBookId)).toEqual([phone.keys.deviceId]);
    await phoneEngine.sync();
    await phoneEngine.sync();
    expect(relay.peek(plan.relayBookId)!.prunedThrough).toBe(relay.peek(plan.relayBookId)!.seq);
  });

  it('is taken off the relay by the linking device once three days pass without the new device’s row', async () => {
    let now = Date.parse('2026-11-21T08:00:00Z');
    const { relay, phone, phoneEngine, mac, plan } = await allowed(() => now);
    await phoneEngine.sync();
    expect(activeOn(relay, plan.relayBookId)).toContain(mac.keys.deviceId);
    now += UNFINISHED_JOIN_MS + 60_000;
    await phoneEngine.sync();
    expect(activeOn(relay, plan.relayBookId)).toEqual([phone.keys.deviceId]);
    expect(await phone.database.db.values(sql`SELECT key FROM self_state WHERE key LIKE 'joining:%'`)).toEqual([]);
  });

  it('one that did finish is simply forgotten by the linking device', async () => {
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    await link(phone!, mac!);
    await mac!.engine.sync();
    await phone!.engine.sync();
    expect(await phone!.database.db.values(sql`SELECT key FROM self_state WHERE key LIKE 'joining:%'`)).toEqual([]);
    expect((await phone!.engine.devices()).filter((d) => d.removedAt === null)).toHaveLength(2);
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

  it('the unlinked Mac stops capturing for the group — nothing piles up — and can be linked again, its data replaced', async () => {
    const { devices: [phone, mac], spend } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    await link(phone!, mac!);
    await mac!.engine.sync();
    await phone!.engine.unlink(mac!.keys.deviceId);
    expect(await mac!.engine.sync()).toMatchObject({ unlinked: true });
    expect(await seatIsElsewhere(mac!.database.db)).toBe(false);
    await spend(mac!, 5_000, 'Test stall (after the unlink)');
    expect(await mac!.database.db.values(sql`SELECT COUNT(*) FROM self_pending`)).toEqual([[0]]);
    expect(await mac!.database.db.values(sql`SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'self_cap_%'`)).toEqual([[0]]);

    // Linked again from the iPhone: the Mac takes a code, and ends with the iPhone's data and a place of its own.
    const id = await spend(phone!, 61_000, 'Test kiosk (before linking again)');
    await phone!.engine.sync();
    await link(phone!, mac!);
    expect((await mac!.engine.group())!.state).toBe('active');
    expect(await mac!.database.db.values(sql`SELECT description FROM transactions WHERE id = ${id}`)).toEqual([['Test kiosk (before linking again)']]);
    expect(await sameRows(phone!, mac!)).toEqual([]);
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

describe('replacing the new device’s data', () => {
  it('leaves the new device holding the linking device’s data, its own old data gone; the linking device unchanged', async () => {
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    // What linking itself adds on the iPhone: the Devices list and the seat. Everything else is as it was.
    const without = (dump: Record<string, unknown[][]>) =>
      Object.fromEntries(Object.entries(dump).filter(([t]) => t !== 'self_devices').map(([t, rows]) => [t, t === 'settings' ? rows.filter((r) => r[0] !== 'self.seat') : rows]));
    const before = without(await dumpForSelf(phone!.database));
    await link(phone!, mac!);
    expect(without(await dumpForSelf(phone!.database))).toEqual(before);
    expect(await mac!.database.db.values(sql`SELECT name FROM accounts WHERE name = 'Old MacBook Air wallet'`)).toEqual([]);
    expect(without(await dumpForSelf(mac!.database))).toEqual(before);
    // Nothing of the Mac's old data ever reaches the iPhone.
    await mac!.engine.sync();
    await phone!.engine.sync();
    expect(await phone!.database.db.values(sql`SELECT name FROM accounts WHERE name = 'Old MacBook Air wallet'`)).toEqual([]);
    expect(await sameRows(phone!, mac!)).toEqual([]);
  });

  it('the linking install’s own rows and keys are not kept: the new device has its own place and keys', async () => {
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    await link(phone!, mac!);
    expect(await mac!.database.db.values(sql`SELECT device_id, state FROM self_group`)).toEqual([[mac!.keys.deviceId, 'active']]);
    expect(await mac!.database.db.values(sql`SELECT count(*) FROM self_outbox`)).toEqual([[0]]);
    expect(await mac!.database.db.values(sql`SELECT value FROM settings WHERE key = 'self.seat'`)).toEqual([[phone!.keys.deviceId]]);
    expect(await mac!.database.db.values(sql`SELECT count(*) FROM settings WHERE key = 'sync.hlc'`)).toEqual([[1]]); // its own clock
  });

  it('a copy that never arrived (the old data still here) is refused and left exactly as it was', async () => {
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    const { sessionId, code } = await phone!.engine.startLinking();
    await mac!.engine.joinWithCode(code);
    await phone!.engine.checkLinking(sessionId);
    await mac!.engine.checkJoining(sessionId);
    await phone!.engine.checkLinking(sessionId);
    await phone!.engine.allowLinking(sessionId);
    const plan = await mac!.engine.acceptLink(sessionId);
    const before = await dumpForSelf(mac!.database);
    expect(await planWaitsHere(mac!.database, plan)).toBe('not-the-copy');
    await expect(completeLinkedCopy(mac!.database, plan, mac!.transport, mac!.keys, mac!.info)).rejects.toBeInstanceOf(JoinRefused);
    expect(await dumpForSelf(mac!.database)).toEqual(before);
  });

  it('done twice (the app closed before it forgot the plan) changes nothing the second time', async () => {
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    await link(phone!, mac!);
    const once = await dumpForSelf(mac!.database);
    const group = await mac!.engine.group();
    const plan = { deviceId: mac!.keys.deviceId, relayBookId: group!.relayBookId, epoch: 1, startSeq: 0, keys: [], copy: { hashes: [], key: '', bytes: 0, sha256: '' } };
    expect(await planWaitsHere(mac!.database, plan)).toBe('done');
    await completeLinkedCopy(mac!.database, plan, mac!.transport, mac!.keys, mac!.info);
    expect(await dumpForSelf(mac!.database)).toEqual(once);
  });

  it('what the iPhone writes while the Mac fetches its copy still reaches the Mac', async () => {
    const { devices: [phone, mac], spend } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    const { sessionId, code } = await phone!.engine.startLinking();
    await mac!.engine.joinWithCode(code);
    await phone!.engine.checkLinking(sessionId);
    await mac!.engine.checkJoining(sessionId);
    await phone!.engine.checkLinking(sessionId);
    await phone!.engine.allowLinking(sessionId);
    const meanwhile = await spend(phone!, 33_000, 'While the Mac was fetching');
    await phone!.engine.sync(); // sent and acked: the relay keeps it for the Mac all the same
    const plan = await mac!.engine.acceptLink(sessionId);
    await mac!.database.importBytes(await mac!.engine.downloadPlanCopy(plan));
    mac!.engine = await completeLinkedCopy(mac!.database, plan, mac!.transport, mac!.keys, mac!.info);
    await mac!.engine.sync();
    expect(await mac!.database.db.values(sql`SELECT description FROM transactions WHERE id = ${meanwhile}`)).toEqual([['While the Mac was fetching']]);
  });
});

describe('the seat', () => {
  it('a workspace shared with someone else changes on the linked Mac too, and nothing of it goes to the household from the Mac', async () => {
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    // The iPhone shares Personal with another person (as household sharing leaves it: an active shared_books row).
    const bookId = (await phone!.database.db.values<[string]>(sql`SELECT id FROM books ORDER BY created_at LIMIT 1`))[0]![0];
    await phone!.database.db.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, 'test-relay', 1, 'test-member', 'active', '2026-11-01T00:00:00Z')`);
    await link(phone!, mac!);
    // The iPhone's household engine, as the app makes it before anything else (its device id for capture).
    configureCapture(phone!.database, { deviceId: phone!.keys.deviceId });
    const groceries = (await listAccounts(mac!.database, mac!.ws)).find((a) => a.name === 'Groceries')!.id;
    const bank = (await listAccounts(mac!.database, mac!.ws)).find((a) => a.name === 'Test Bank')!.id;
    await postTransaction(mac!.database, mac!.ws, { occurredOn: '2026-11-19', description: 'Test shop (Mac)', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank, amountMinor: 12_000, currency: 'IDR' }) });
    expect(await mac!.database.db.values(sql`SELECT count(*) FROM sync_outbox`)).toEqual([[0]]);
    await mac!.engine.sync();
    await phone!.engine.sync();
    expect(await phone!.database.db.values(sql`SELECT description FROM transactions WHERE description = 'Test shop (Mac)'`)).toEqual([['Test shop (Mac)']]);
    // On the seat it went into the household's outbox, as if it had been recorded there.
    expect(Number((await phone!.database.db.values<[number]>(sql`SELECT count(*) FROM sync_outbox WHERE book_id = ${bookId}`))[0]![0])).toBeGreaterThan(0);
  });

  it('a change the household will not take (the workspace stopped being shared meanwhile) stays on both devices and is said in Activity', async () => {
    const { devices: [phone, mac] } = await household([{ name: 'iPhone', kind: 'phone' }, { name: 'MacBook Air', kind: 'mac' }]);
    const bookId = (await phone!.database.db.values<[string]>(sql`SELECT id FROM books ORDER BY created_at LIMIT 1`))[0]![0];
    await phone!.database.db.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, 'test-relay', 1, 'test-member', 'active', '2026-11-01T00:00:00Z')`);
    await link(phone!, mac!);
    configureCapture(phone!.database, { deviceId: phone!.keys.deviceId });
    const groceries = (await listAccounts(mac!.database, mac!.ws)).find((a) => a.name === 'Groceries')!.id;
    const bank = (await listAccounts(mac!.database, mac!.ws)).find((a) => a.name === 'Test Bank')!.id;
    await postTransaction(mac!.database, mac!.ws, { occurredOn: '2026-11-19', description: 'Test shop (late)', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank, amountMinor: 7_000, currency: 'IDR' }) });
    await mac!.engine.sync();
    // Meanwhile the iPhone's share ended (as Stop sharing leaves it): read-only there.
    await phone!.database.db.run(sql`UPDATE shared_books SET state = 'unshared' WHERE book_id = ${bookId}`);
    await phone!.engine.sync();
    expect(await phone!.database.db.values(sql`SELECT description FROM transactions WHERE description = 'Test shop (late)'`)).toEqual([['Test shop (late)']]);
    expect(await phone!.database.db.values(sql`SELECT count(*) FROM sync_outbox`)).toEqual([[0]]);
    expect((await activityOf(phone!.database, phone!.ws)).map((line) => line.title)).toContain('A change made on another device was not shared');
    await phone!.engine.sync();
    await mac!.engine.sync();
    expect((await activityOf(mac!.database, mac!.ws)).map((line) => line.title)).toContain('A change made on another device was not shared');
  });
});
