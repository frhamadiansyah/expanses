import {
  activeNetWorthGroup,
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  getShareSetting,
  jointAccountIds,
  listSharedBooks,
  MemoryKeyStore,
  MemoryShareRecordStore,
  MemoryTransport,
  migrate,
  personalBook,
  receivedItems,
  requestSignerOf,
  reviewedFor,
  setJointAccount,
  setNetWorthMarks,
  setShareSetting,
  storedJointAccount,
  type WorkspaceContext,
} from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/pwa', () => ({ isNative: () => false }));

import { SyncService } from '../../sync/sync-service';
import { householdOf, netWorthAutoStepsOnce, OthersStoppedError, rememberSwitch, startNetWorth, switchItemShared } from './household';

/*
 * What the app does by itself for the household's net worth, on two real phones over an in-memory relay (review round
 * 1): nothing is ever shared without a tap on that person's own phone, and an existing household looks exactly the same
 * after updating. Rina and Andi, and every figure, invented.
 */

vi.setConfig({ testTimeout: 60_000 });

interface Phone {
  database: Database;
  ws: WorkspaceContext;
  bank: string;
  cash: string;
  service: SyncService;
}

async function phone(relay: MemoryTransport, name: string): Promise<Phone> {
  const database = createDatabase(createNodeExecutor());
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const bank = await createAccount(database, ws, { name: `${name} Bank`, kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const cash = await createAccount(database, ws, { name: `${name} Cash`, kind: 'asset', subtype: 'cash', currency: 'IDR' });
  const service = new SyncService({
    database,
    keyStore: new MemoryKeyStore(),
    shareRecords: new MemoryShareRecordStore(),
    transportFor: (device) => relay.as(requestSignerOf(device)),
    onApplied: () => {},
    onError: () => {},
    intervalMs: 60 * 60_000,
  });
  return { database, ws, bank: bank.id, cash: cash.id, service };
}

const deps = (p: Phone) => ({ database: p.database, ws: p.ws, sync: p.service });

async function household() {
  const relay = new MemoryTransport();
  const rina = await phone(relay, 'Rina');
  const andi = await phone(relay, 'Andi');
  await rina.service.start();
  await andi.service.start();
  const bookId = (await personalBook(rina.database, rina.ws)).id;
  const invite = await rina.service.share(bookId, { memberName: 'Rina', deviceName: 'Mac' });
  await andi.service.join(invite.code, { ws: andi.ws, memberName: 'Andi', deviceName: 'iPhone' });
  await rina.service.syncNow(bookId);
  const andiMember = (await listSharedBooks(andi.database))[0]!.memberId;
  const rinaMember = (await listSharedBooks(rina.database))[0]!.memberId;
  /** Both phones sync, and each runs what the app does by itself, a few times over. */
  const settle = async (auto = true) => {
    for (let i = 0; i < 3; i += 1) {
      await rina.service.syncNow(bookId);
      await andi.service.syncNow(bookId);
      if (auto) {
        await netWorthAutoStepsOnce(deps(andi));
        await netWorthAutoStepsOnce(deps(rina));
      }
    }
  };
  const stop = () => {
    rina.service.stop();
    andi.service.stop();
  };
  return { rina, andi, bookId, andiMember, rinaMember, settle, stop };
}

/** What Andi's phone received of Rina's: the account ids her summaries name. */
async function receivedNames(p: Phone): Promise<string[]> {
  const group = await activeNetWorthGroup(p.database);
  if (!group) return [];
  return (await receivedItems(p.database, group.groupBookId)).map((item) => item.name).sort();
}

/** A group made the way the app made one before this update: proposed and confirmed by hand, nobody reviewed. */
async function legacyGroup(h: Awaited<ReturnType<typeof household>>, mode: 'joint' | 'separate') {
  await h.rina.service.proposeNetWorth(h.bookId, { mode, members: [h.andiMember] });
  await h.settle(false);
  const asked = await h.andi.service.netWorthGroup(h.bookId);
  await h.andi.service.answerNetWorth(h.bookId, asked!.pending!.proposalId, 'confirm');
  await h.settle(false);
}

describe('the first group, filed separately, forms by itself and shares exactly what was switched on', () => {
  it('Rina switches her bank on; Andi’s phone confirms; Rina’s review shares the bank, never her cash, and nothing of Andi’s', async () => {
    const h = await household();
    await startNetWorth(deps(h.rina), h.bookId, [h.andiMember], { [h.rina.bank]: 'total', [h.rina.cash]: 'hidden' });
    await h.settle();
    expect((await activeNetWorthGroup(h.andi.database))?.mode).toBe('separate');
    expect(await receivedNames(h.andi)).toEqual(['Rina Bank']);
    expect(await receivedNames(h.rina)).toEqual([]);
    // Andi never tapped: no review answered for him, nothing of his set.
    const group = (await activeNetWorthGroup(h.andi.database))!;
    expect(await reviewedFor(h.andi.database, group.groupBookId, group.proposalId)).toBe(false);
    expect(await getShareSetting(h.andi.database, h.andi.bank)).toBeNull();
    h.stop();
  });

  it('switched on while waiting for Andi’s phone: kept, never turned back to private by the app (item 5)', async () => {
    const h = await household();
    await startNetWorth(deps(h.rina), h.bookId, [h.andiMember], { [h.rina.bank]: 'total', [h.rina.cash]: 'hidden' });
    await h.settle(false);
    // The list's switch while waiting: the setting, remembered as Rina's own choice.
    await setShareSetting(h.rina.database, h.rina.cash, 'total');
    await rememberSwitch(h.rina.database, h.bookId, h.rina.cash, true);
    await h.settle();
    expect(await getShareSetting(h.rina.database, h.rina.cash)).toBe('total');
    expect(await receivedNames(h.andi)).toEqual(['Rina Bank', 'Rina Cash']);
    h.stop();
  });
});

describe('an existing household looks the same after updating', () => {
  it('a legacy group filed separately, never reviewed: the app answers nothing, and nothing is sent', async () => {
    const h = await household();
    await setShareSetting(h.andi.database, h.andi.bank, 'total');
    await legacyGroup(h, 'separate');
    await h.settle();
    for (const p of [h.rina, h.andi]) {
      const group = (await activeNetWorthGroup(p.database))!;
      expect(await reviewedFor(p.database, group.groupBookId, group.proposalId)).toBe(false);
    }
    expect(await receivedNames(h.rina)).toEqual([]);
    expect(await receivedNames(h.andi)).toEqual([]);
    h.stop();
  });

  it('a legacy one-tax-ID group Andi confirmed but never shared: none of his items is shared on first launch (item 1)', async () => {
    const h = await household();
    await legacyGroup(h, 'joint');
    await h.settle();
    expect(await getShareSetting(h.andi.database, h.andi.bank)).toBeNull();
    expect(await getShareSetting(h.andi.database, h.andi.cash)).toBeNull();
    expect(await receivedNames(h.rina)).toEqual([]);
    expect((await householdOf(deps(h.andi)))?.reviewDue).toBe(true);
    h.stop();
  });

  it('a change of filing waits for the other phone’s Confirm: to one tax ID, and back (item 2)', async () => {
    const h = await household();
    await startNetWorth(deps(h.rina), h.bookId, [h.andiMember], { [h.rina.bank]: 'total', [h.rina.cash]: 'hidden' });
    await h.settle();
    await h.rina.service.proposeNetWorth(h.bookId, { mode: 'joint', members: [h.andiMember] });
    await h.settle();
    const asked = await h.andi.service.netWorthGroup(h.bookId);
    expect(asked?.active?.mode).toBe('separate');
    expect(asked?.waitingFor).toEqual([h.andiMember]);
    await h.andi.service.answerNetWorth(h.bookId, asked!.pending!.proposalId, 'confirm');
    await h.settle();
    expect((await activeNetWorthGroup(h.andi.database))?.mode).toBe('joint');
    // Neither review of the change is answered by the app: one tax ID shares every item, so it is each person's tap.
    expect(await getShareSetting(h.andi.database, h.andi.bank)).toBeNull();
    await h.rina.service.proposeNetWorth(h.bookId, { mode: 'separate', members: [h.andiMember] });
    await h.settle();
    expect((await h.andi.service.netWorthGroup(h.bookId))?.waitingFor).toEqual([h.andiMember]);
    expect((await activeNetWorthGroup(h.andi.database))?.mode).toBe('joint');
    h.stop();
  });
});

describe('a stop is never overridden', () => {
  it('Andi stops sharing net worth: Rina’s switch starts nothing, and a proposal anyway is never confirmed on his phone (item 3)', async () => {
    const h = await household();
    await startNetWorth(deps(h.rina), h.bookId, [h.andiMember], { [h.rina.bank]: 'total', [h.rina.cash]: 'hidden' });
    await h.settle();
    // What the Tax report's "Stop sharing net worth" does on Andi's phone.
    await h.andi.service.leaveNetWorth(h.bookId);
    await setNetWorthMarks(h.andi.database, h.bookId, { optedOut: true, intent: [] });
    await h.settle();
    const seen = await householdOf(deps(h.rina));
    expect(seen?.stage).toBe('stopped');
    await expect(switchItemShared(deps(h.rina), seen!, h.rina.cash, true)).rejects.toBeInstanceOf(OthersStoppedError);
    // A proposal made all the same (an older phone, say) waits for Andi's own tap.
    await h.rina.service.proposeNetWorth(h.bookId, { mode: 'separate', members: [h.andiMember] });
    await h.settle();
    expect((await h.andi.service.netWorthGroup(h.bookId))?.waitingFor).toEqual([h.andiMember]);
    expect(await activeNetWorthGroup(h.andi.database)).toBeNull();
    h.stop();
  });
});

describe('Owned together never comes back by itself (item 4)', () => {
  it('a group gone: the joint mark reads as nothing, is forgotten, and a new group does not bring it back', async () => {
    const h = await household();
    await startNetWorth(deps(h.rina), h.bookId, [h.andiMember], { [h.rina.bank]: 'total', [h.rina.cash]: 'hidden' });
    await h.settle();
    await setJointAccount(h.rina.database, h.rina.bank, true);
    expect(await jointAccountIds(h.rina.database)).toEqual([h.rina.bank]);
    await h.rina.service.leaveNetWorth(h.bookId);
    await setNetWorthMarks(h.rina.database, h.bookId, { optedOut: true, intent: [] });
    await h.settle();
    expect(await activeNetWorthGroup(h.rina.database)).toBeNull();
    expect(await jointAccountIds(h.rina.database)).toEqual([]);
    expect(await storedJointAccount(h.rina.database, h.rina.bank)).toBe(false);
    // Rina starts again with the same account: shared, not owned together.
    await startNetWorth(deps(h.rina), h.bookId, [h.andiMember], { [h.rina.bank]: 'total', [h.rina.cash]: 'hidden' });
    await h.settle();
    const again = await h.andi.service.netWorthGroup(h.bookId);
    if (again?.pending && again.waitingFor.includes(h.andiMember)) await h.andi.service.answerNetWorth(h.bookId, again.pending.proposalId, 'confirm');
    await h.settle();
    expect(await jointAccountIds(h.rina.database)).toEqual([]);
    h.stop();
  });
});
