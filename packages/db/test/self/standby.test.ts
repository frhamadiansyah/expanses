import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase, inBook, listAccounts, migrate, postTransaction, replaceTransaction } from '../../src/index';
import { createNodeExecutor } from '../../src/node';
import { SyncEngine } from '../../src/sync/engine';
import { generateDevice, requestSignerOf } from '../../src/sync/keys';
import { SelfEngine } from '../../src/self/engine';
import { completeLinkedCopy } from '../../src/self/join';
import { becomeSeat, markStandbyDone, offerStandby, standbyBooks, standbyGone, standbyOffers, standbyWanted } from '../../src/self/standby';
import { seatIsElsewhere } from '../../src/sync/capture';
import type { SelfTransport } from '../../src/self/transport';
import { Household, type Device } from '../sync/household';

vi.setConfig({ testTimeout: 180_000 });

/*
 * Link my devices, Drop 5 (spec §3.4, §5): Dewi shares her workspace with Budi from her iPhone (the seat) and links her
 * Mac. The Mac stands by in the shared workspace. Her iPhone is lost with a purchase it never sent to Budi; from the
 * Mac she unlinks it, and the Mac keeps the workspace in step with Budi from then on — that purchase included. Budi's
 * side never changes. Invented names, shops and figures.
 */

async function spend(d: { database: Device['database']; ws: Device['ws'] }, paymentAccountId: string, amountMinor: number, description: string) {
  // The book's own Groceries: in a joined workspace, the owner's category under the owner's id.
  const groceries = d.ws.bookId
    ? (await d.database.db.values<[string]>(sql`SELECT a.id FROM accounts a JOIN book_categories c ON c.category_account_id = a.id WHERE c.book_id = ${d.ws.bookId} AND a.name = 'Groceries'`))[0]![0]
    : (await listAccounts(d.database, d.ws)).find((a) => a.name === 'Groceries')!.id;
  return postTransaction(d.database, d.ws, { occurredOn: '2026-11-20', description, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId, amountMinor, currency: 'IDR' }) });
}

const has = async (database: Device['database'], description: string) =>
  (await database.db.values(sql`SELECT 1 FROM transactions WHERE description = ${description} AND status = 'posted'`)).length > 0;

async function standingBy() {
  const household = new Household();
  const dewi = await household.device('Dewi');
  const budi = await household.device('Budi');
  const bookId = await household.share(dewi);
  await household.join(budi, dewi);
  await household.settle([dewi, budi]);

  // Dewi links her Mac from the iPhone (the iPhone is the seat: it made the group and shares the workspace).
  const phoneSelf = new SelfEngine(dewi.database, dewi.transport as SelfTransport, dewi.keys, { name: 'iPhone', kind: 'phone', appVersion: '0.3.0' });
  const macDatabase = createDatabase(createNodeExecutor());
  await migrate(macDatabase);
  const macKeys = await generateDevice();
  const macTransport = household.relay.as(requestSignerOf(macKeys));
  let macSelf = new SelfEngine(macDatabase, macTransport, macKeys, { name: 'Mac', kind: 'mac', appVersion: '0.3.0' });
  const { sessionId, code } = await phoneSelf.startLinking();
  await macSelf.joinWithCode(code);
  await phoneSelf.checkLinking(sessionId);
  await macSelf.checkJoining(sessionId);
  await phoneSelf.checkLinking(sessionId);
  await phoneSelf.allowLinking(sessionId);
  const plan = await macSelf.acceptLink(sessionId);
  await macDatabase.importBytes(await macSelf.downloadPlanCopy(plan));
  macSelf = await completeLinkedCopy(macDatabase, plan, macTransport, macKeys, { name: 'Mac', kind: 'mac', appVersion: '0.3.0' });
  await macSelf.sync();
  await phoneSelf.sync();

  // The seat invites the Mac into the shared workspace; the Mac claims it as a standby device.
  const wanted = await standbyWanted(dewi.database, dewi.deviceId);
  expect(wanted.map((w) => [w.bookId, w.deviceId])).toEqual([[bookId, macKeys.deviceId]]);
  const invite = await dewi.engine.linkDevice(bookId, { inviterName: 'Dewi' });
  await offerStandby(dewi.database, wanted[0]!.relayBookId, macKeys.deviceId, invite.code, Date.now());
  await phoneSelf.sync();
  await macSelf.sync();
  const macSync = new SyncEngine(macDatabase, macTransport, macKeys, undefined, { appVersion: '0.3.0' });
  for (const offer of await standbyOffers(macDatabase, macKeys.deviceId)) {
    await macSync.claimStandby(offer.code, { deviceName: 'Mac' });
    await markStandbyDone(macDatabase, offer.relayBookId);
  }
  await dewi.engine.syncOnce(bookId); // the seat admits the Mac, as for any device of an owner
  await phoneSelf.sync();
  await macSelf.sync();
  expect(await standbyBooks(macDatabase, macKeys.deviceId)).toEqual([bookId]);
  expect(await standbyWanted(dewi.database, dewi.deviceId)).toEqual([]);
  // Standing by is not syncing: the Mac's household bookkeeping is the seat's, untouched by it.
  expect(await macDatabase.db.values(sql`SELECT state FROM shared_books WHERE book_id = ${bookId}`)).toEqual([['active']]);
  return { household, dewi, budi, bookId, phoneSelf, macDatabase, macKeys, macTransport, macSelf, macSync };
}

describe('a linked Mac standing by in a shared workspace', () => {
  it('changes it through the iPhone, then takes over from the lost iPhone: Budi gets what the iPhone never sent, and the Mac and Budi go on in step', async () => {
    const { household: _h, dewi, budi, bookId, phoneSelf, macDatabase, macKeys, macSelf, macSync } = await standingBy();
    void _h;

    // Drop 6: a purchase recorded on the Mac in the shared workspace reaches Budi through the iPhone, the seat.
    const macBankEarly = (await listAccounts(macDatabase, dewi.ws)).find((a) => a.name === 'Dewi Bank')!.id;
    await spend({ database: macDatabase, ws: dewi.ws }, macBankEarly, 23_000, 'Test cafe (Mac, via the iPhone)');
    await macSelf.sync();
    await phoneSelf.sync();
    await dewi.engine.syncOnce(bookId);
    await budi.engine.syncOnce(bookId);
    expect(await has(budi.database, 'Test cafe (Mac, via the iPhone)')).toBe(true);
    // An edit of it on the Mac reaches Budi the same way.
    const [[cafe]] = (await macDatabase.db.values<[string]>(sql`SELECT id FROM transactions WHERE description = 'Test cafe (Mac, via the iPhone)' AND status = 'posted'`)) as [[string]];
    const groceriesHere = (await listAccounts(macDatabase, dewi.ws)).find((a) => a.name === 'Groceries')!.id;
    await replaceTransaction(macDatabase, dewi.ws, cafe, {
      occurredOn: '2026-11-20',
      description: 'Test cafe (renamed on Mac)',
      lines: expenseLines({ categoryAccountId: groceriesHere, paymentAccountId: macBankEarly, amountMinor: 23_000, currency: 'IDR' }),
    });
    await macSelf.sync();
    await phoneSelf.sync();
    await dewi.engine.syncOnce(bookId);
    await budi.engine.syncOnce(bookId);
    expect(await has(budi.database, 'Test cafe (renamed on Mac)')).toBe(true);

    // The iPhone records a purchase, sends it to the Mac through the owner's channel, and is lost before Budi hears.
    await spend(dewi, dewi.bank, 88_000, 'Test bakery (never sent)');
    await phoneSelf.sync();
    await macSelf.sync();
    expect(await has(macDatabase, 'Test bakery (never sent)')).toBe(true);
    await budi.engine.syncOnce(bookId);
    expect(await has(budi.database, 'Test bakery (never sent)')).toBe(false);

    // From the Mac: Unlink the iPhone. The Mac becomes the seat and takes the shared workspace over.
    await macSelf.unlink(dewi.deviceId);
    await becomeSeat(macDatabase, macKeys.deviceId);
    await macSync.takeOverAsSeat(bookId, dewi.deviceId);

    await budi.engine.syncOnce(bookId);
    expect(await has(budi.database, 'Test bakery (never sent)')).toBe(true);
    expect(await budi.database.db.values(sql`SELECT removed_at IS NOT NULL FROM book_devices WHERE book_id = ${bookId} AND device_id = ${dewi.deviceId}`)).toEqual([[1]]);

    // Budi and the Mac go on in step, both ways.
    // In the shared workspace, as Budi holds it.
    await spend({ database: budi.database, ws: inBook(budi.ws, bookId) }, budi.bank, 42_000, 'Test fruit stall (Budi)');
    await budi.engine.syncOnce(bookId);
    await macSync.syncOnce(bookId);
    expect(await has(macDatabase, 'Test fruit stall (Budi)')).toBe(true);
    const macBank = (await listAccounts(macDatabase, dewi.ws)).find((a) => a.name === 'Dewi Bank')!.id;
    await spend({ database: macDatabase, ws: dewi.ws }, macBank, 15_000, 'Test kiosk (Mac)');
    await macSync.syncOnce(bookId);
    await budi.engine.syncOnce(bookId);
    expect(await has(budi.database, 'Test kiosk (Mac)')).toBe(true);
    // The lost iPhone reads nothing new: it was removed from Budi's book too.
    await expect(dewi.engine.syncOnce(bookId)).resolves.toMatchObject({ ended: 'removed' });
  });

  it('unlinked from the iPhone, the Mac is taken out of the shared workspace, stops capturing for the group, and is no longer kept from sharing', async () => {
    const { dewi, budi, bookId, phoneSelf, macDatabase, macKeys, macSelf, macSync } = await standingBy();
    expect(await seatIsElsewhere(macDatabase.db)).toBe(true);
    await phoneSelf.unlink(macKeys.deviceId);
    expect(await standbyGone(dewi.database, dewi.deviceId)).toEqual([{ bookId, deviceId: macKeys.deviceId }]);
    // What the seat's step does after each run of the owner's channel.
    for (const gone of await standbyGone(dewi.database, dewi.deviceId)) await dewi.engine.removeDevice(gone.bookId, gone.deviceId);
    expect(await standbyGone(dewi.database, dewi.deviceId)).toEqual([]);
    await budi.engine.syncOnce(bookId);
    expect(await budi.database.db.values(sql`SELECT removed_at IS NOT NULL FROM book_devices WHERE book_id = ${bookId} AND device_id = ${macKeys.deviceId}`)).toEqual([[1]]);

    // The Mac hears it was unlinked: nothing it writes waits for the group, and the seat is no longer elsewhere.
    expect(await macSelf.sync()).toMatchObject({ unlinked: true });
    expect(await seatIsElsewhere(macDatabase.db)).toBe(false);
    const macBank = (await listAccounts(macDatabase, dewi.ws)).find((a) => a.name === 'Dewi Bank')!.id;
    await spend({ database: macDatabase, ws: dewi.ws }, macBank, 12_000, 'Test stall (Mac, after unlink)');
    expect(await macDatabase.db.values(sql`SELECT COUNT(*) FROM self_pending`)).toEqual([[0]]);
    // It reads nothing new of the shared workspace either.
    await expect(macSync.syncOnce(bookId)).resolves.toMatchObject({ ended: 'removed' });
  });
});
