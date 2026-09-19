import { expenseLines, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addPhoto,
  allPhotoFileNames,
  allPhotoRows,
  createAccount,
  createWorkspace,
  deletePhoto,
  extrasFor,
  extrasForTx,
  listAccounts,
  listPhotos,
  listTransactions,
  movePhotosTx,
  notExcluded,
  postTransaction,
  replaceTransaction,
  saveEvent,
  writeExtrasTx,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function purchase(extra: { channel?: 'online' | 'offline' | null; excludedFromReport?: boolean } = {}) {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const electronics = (await listAccounts(database, ws)).find((a) => a.systemKey === 'shopping.electronics')!.id;
  const id = await postTransaction(database, ws, {
    occurredOn: '2026-09-17',
    description: 'iPhone for Mama',
    lines: expenseLines({ categoryAccountId: electronics, paymentAccountId: card.id, amountMinor: 18_999_000, currency: 'IDR' }),
    ...extra,
  });
  return { database, ws, card, electronics, id };
}

it('keeps a channel and an exclusion beside the transaction, not on it', async () => {
  const p = await purchase({ channel: 'online', excludedFromReport: true });
  const [tx] = await listTransactions(p.database, p.ws);
  expect(tx).toMatchObject({ id: p.id, channel: 'online', excluded: true });
});

it('says nothing was chosen when nothing was', async () => {
  const p = await purchase();
  const [tx] = await listTransactions(p.database, p.ws);
  expect(tx).toMatchObject({ channel: null, excluded: false, photoCount: 0 });
  // Nothing chosen writes no row at all: a row of null and 0 says nothing a missing row does not.
  const rows = await p.database.db.values<[number]>(sql`SELECT count(*) FROM transaction_flags`);
  expect(Number(rows[0]![0])).toBe(0);
});

it('counts the photos a transaction carries', async () => {
  const p = await purchase();
  await addPhoto(p.database, p.ws, { transactionId: p.id, fileName: '0192f0.jpg', mime: 'image/jpeg', byteSize: 1234 });
  await addPhoto(p.database, p.ws, { transactionId: p.id, fileName: '0192f1.jpg', mime: 'image/jpeg', byteSize: 4321 });
  const [tx] = await listTransactions(p.database, p.ws);
  expect(tx!.photoCount).toBe(2);
  expect((await listPhotos(p.database, p.ws, p.id)).map((row) => row.fileName)).toEqual(['0192f0.jpg', '0192f1.jpg']);
});

it('carries the channel, the exclusion and the photos onto a correction', async () => {
  const p = await purchase({ channel: 'offline', excludedFromReport: true });
  await addPhoto(p.database, p.ws, { transactionId: p.id, fileName: '0192f0.jpg', mime: 'image/jpeg', byteSize: 1234 });
  const replacement = await replaceTransaction(p.database, p.ws, p.id, {
    occurredOn: '2026-09-17',
    description: 'iPhone for Mama',
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 18_499_000, currency: 'IDR' }),
  });
  const [tx] = await listTransactions(p.database, p.ws);
  expect(tx).toMatchObject({ id: replacement, channel: 'offline', excluded: true, photoCount: 1 });
  expect(await listPhotos(p.database, p.ws, p.id)).toEqual([]);
});

it('lets a correction clear what was chosen', async () => {
  const p = await purchase({ channel: 'offline', excludedFromReport: true });
  const replacement = await replaceTransaction(p.database, p.ws, p.id, {
    occurredOn: '2026-09-17',
    description: 'iPhone for Mama',
    channel: null,
    excludedFromReport: false,
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 18_999_000, currency: 'IDR' }),
  });
  const [tx] = await listTransactions(p.database, p.ws);
  expect(tx).toMatchObject({ id: replacement, channel: null, excluded: false });
  // Cleared means no row, not a row of null and 0. The voided original keeps its own row: it says what that
  // transaction was while it stood, and nothing posted reads it.
  const rows = await p.database.db.values<[number]>(sql`SELECT count(*) FROM transaction_flags WHERE transaction_id = ${replacement}`);
  expect(Number(rows[0]![0])).toBe(0);
});

/*
 * A correction that changes only one of the two facts keeps the other. Without this the pair above still passes
 * when the spread carries the flag row wholesale, or when it carries neither and the input happens to name both.
 */
it('changes the one fact a correction names and keeps the other', async () => {
  const p = await purchase({ channel: 'offline', excludedFromReport: true });
  const replacement = await replaceTransaction(p.database, p.ws, p.id, {
    occurredOn: '2026-09-17',
    description: 'iPhone for Mama',
    channel: 'online',
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 18_999_000, currency: 'IDR' }),
  });
  expect((await listTransactions(p.database, p.ws))[0]).toMatchObject({ id: replacement, channel: 'online', excluded: true });
});

it('files the transaction under the event it was tagged to when it was recorded', async () => {
  const p = await purchase();
  const eventId = await saveEvent(p.database, p.ws, { name: 'Singapore holiday', startsOn: '2026-09-01', endsOn: '2026-09-30' });
  const id = await postTransaction(p.database, p.ws, {
    occurredOn: '2026-09-18',
    description: 'Hotpot',
    eventId,
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 250_000, currency: 'IDR' }),
  });
  expect((await listTransactions(p.database, p.ws, { eventId })).map((tx) => tx.id)).toEqual([id]);
});

/*
 * The event is the one fact `replaceTransaction` already carried before this project, and it carried it with an
 * unconditional update after the posting — so it could be kept but never taken off. The two tests are a pair: the
 * first is the behaviour that must not change, the second is the one that was impossible.
 */
it('keeps the event on a correction that does not mention it', async () => {
  const p = await purchase();
  const eventId = await saveEvent(p.database, p.ws, { name: 'Singapore holiday', startsOn: '2026-09-01', endsOn: '2026-09-30' });
  const id = await postTransaction(p.database, p.ws, {
    occurredOn: '2026-09-18',
    description: 'Hotpot',
    eventId,
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 250_000, currency: 'IDR' }),
  });
  const replacement = await replaceTransaction(p.database, p.ws, id, {
    occurredOn: '2026-09-18',
    description: 'Hotpot for four',
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 320_000, currency: 'IDR' }),
  });
  expect((await listTransactions(p.database, p.ws, { eventId })).map((tx) => tx.id)).toEqual([replacement]);
});

it('takes the event off when the correction says to', async () => {
  const p = await purchase();
  const eventId = await saveEvent(p.database, p.ws, { name: 'Singapore holiday', startsOn: '2026-09-01', endsOn: '2026-09-30' });
  const id = await postTransaction(p.database, p.ws, {
    occurredOn: '2026-09-18',
    description: 'Hotpot',
    eventId,
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 250_000, currency: 'IDR' }),
  });
  const replacement = await replaceTransaction(p.database, p.ws, id, {
    occurredOn: '2026-09-18',
    description: 'Hotpot',
    eventId: null,
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 250_000, currency: 'IDR' }),
  });
  expect(await listTransactions(p.database, p.ws, { eventId })).toEqual([]);
  expect((await listTransactions(p.database, p.ws)).map((tx) => tx.id)).toContain(replacement);
});

it('keeps the pictures in the order they were picked, whatever SQLite feels like returning', async () => {
  const p = await purchase();
  for (const fileName of ['0192f2.jpg', '0192f0.jpg', '0192f1.jpg']) {
    await addPhoto(p.database, p.ws, { transactionId: p.id, fileName, mime: 'image/jpeg', byteSize: 10 });
  }
  expect((await listPhotos(p.database, p.ws, p.id)).map((row) => [row.fileName, row.sortOrder])).toEqual([
    ['0192f2.jpg', 0],
    ['0192f0.jpg', 1],
    ['0192f1.jpg', 2],
  ]);
});

it('adopts the photos a form wrote before the transaction had an id', async () => {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const electronics = (await listAccounts(database, ws)).find((a) => a.systemKey === 'shopping.electronics')!.id;
  // What PhotosSheet does while the form is still open: the file is written, the row is written, nothing owns it yet.
  const photoId = await addPhoto(database, ws, { transactionId: '', fileName: '0192f9.jpg', mime: 'image/jpeg', byteSize: 77 });
  const id = await postTransaction(database, ws, {
    occurredOn: '2026-09-17',
    description: 'iPhone for Mama',
    photoIds: [photoId],
    lines: expenseLines({ categoryAccountId: electronics, paymentAccountId: card.id, amountMinor: 18_999_000, currency: 'IDR' }),
  });
  expect((await listPhotos(database, ws, id)).map((row) => row.id)).toEqual([photoId]);
  expect((await listTransactions(database, ws))[0]).toMatchObject({ id, photoCount: 1 });
});

it('takes a picture off a transaction when it is deleted', async () => {
  const p = await purchase();
  const keep = await addPhoto(p.database, p.ws, { transactionId: p.id, fileName: '0192f0.jpg', mime: 'image/jpeg', byteSize: 10 });
  const drop = await addPhoto(p.database, p.ws, { transactionId: p.id, fileName: '0192f1.jpg', mime: 'image/jpeg', byteSize: 10 });
  await deletePhoto(p.database, p.ws, drop);
  expect((await listPhotos(p.database, p.ws, p.id)).map((row) => row.id)).toEqual([keep]);
  expect((await listTransactions(p.database, p.ws))[0]!.photoCount).toBe(1);
});

it('reads one transaction by its id, the way a receipt opens', async () => {
  const p = await purchase();
  const other = await postTransaction(p.database, p.ws, {
    occurredOn: '2026-09-18',
    description: 'Kopi',
    lines: expenseLines({ categoryAccountId: p.electronics, paymentAccountId: p.card.id, amountMinor: 35_000, currency: 'IDR' }),
  });
  expect((await listTransactions(p.database, p.ws, { id: p.id })).map((tx) => tx.id)).toEqual([p.id]);
  expect((await listTransactions(p.database, p.ws, { id: other })).map((tx) => tx.id)).toEqual([other]);
});

/*
 * The exclusion belongs to the workspace that made it. An unscoped `NOT IN` would read every workspace's rows,
 * so one person's excluded purchase would quietly take another person's transaction out of their own figures.
 * The two workspaces here share a database, as a shared install does.
 */
it('leaves out only the exclusions the workspace itself made', async () => {
  current = await setupDb();
  const { database, ws } = current;
  const mine = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const myCategory = (await listAccounts(database, ws)).find((a) => a.systemKey === 'shopping.electronics')!.id;
  const kept = await postTransaction(database, ws, {
    occurredOn: '2026-09-17',
    description: 'Counts',
    lines: expenseLines({ categoryAccountId: myCategory, paymentAccountId: mine.id, amountMinor: 100_000, currency: 'IDR' }),
  });
  const left = await postTransaction(database, ws, {
    occurredOn: '2026-09-17',
    description: 'Does not count',
    excludedFromReport: true,
    lines: expenseLines({ categoryAccountId: myCategory, paymentAccountId: mine.id, amountMinor: 900_000, currency: 'IDR' }),
  });

  const other = await createWorkspace(database, { name: 'Office', type: 'personal', baseCurrency: 'IDR' });
  const theirCard = await createAccount(database, other, { name: 'Mandiri', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const theirCategory = (await listAccounts(database, other)).find((a) => a.systemKey === 'shopping.electronics')!.id;
  const theirs = await postTransaction(database, other, {
    occurredOn: '2026-09-17',
    description: 'Theirs, excluded in their own books',
    excludedFromReport: true,
    lines: expenseLines({ categoryAccountId: theirCategory, paymentAccountId: theirCard.id, amountMinor: 700_000, currency: 'IDR' }),
  });

  const idsIn = async (context: typeof ws) =>
    (
      await database.db.values<[string]>(sql`SELECT id FROM transactions WHERE workspace_id = ${context.workspaceId} AND ${notExcluded(context)} ORDER BY description`)
    ).map((row) => String(row[0]));
  expect(await idsIn(ws)).toEqual([kept]);
  expect(await idsIn(ws)).not.toContain(left);
  // Their exclusion is theirs; read in my workspace's terms it takes nothing of mine away, and read in theirs it
  // takes their own row out.
  expect(await idsIn(other)).toEqual([]);
  const unscopedWouldHide = await database.db.values<[string]>(
    sql`SELECT id FROM transactions WHERE workspace_id = ${ws.workspaceId} AND ${notExcluded(other)} ORDER BY description`,
  );
  expect(unscopedWouldHide.map((row) => String(row[0]))).toEqual([kept, left]);
  expect(theirs).toBeTruthy();
});

/*
 * The orphan sweep deletes every file no row names. Scoping that read to one workspace would hand it the other
 * workspace's pictures as orphans — user data with no second copy — so this one read is deliberately global.
 */
it('names every photo file in the database for the sweep, and one workspace of rows for the backup', async () => {
  current = await setupDb();
  const { database, ws } = current;
  const other = await createWorkspace(database, { name: 'Office', type: 'personal', baseCurrency: 'IDR' });
  await addPhoto(database, ws, { transactionId: '', fileName: 'mine.jpg', mime: 'image/jpeg', byteSize: 1 });
  await addPhoto(database, other, { transactionId: '', fileName: 'theirs.jpg', mime: 'image/jpeg', byteSize: 2 });
  expect((await allPhotoFileNames(database)).sort()).toEqual(['mine.jpg', 'theirs.jpg']);
  expect((await allPhotoRows(database, ws)).map((row) => row.fileName)).toEqual(['mine.jpg']);
  expect((await allPhotoRows(database, other)).map((row) => row.fileName)).toEqual(['theirs.jpg']);
});

/*
 * `notExcluded` and `allPhotoRows` each have a test that bites if their workspace scope is dropped (above). The
 * rest of the repository does not: an id-by-id read (extrasForTx, extrasFor, listPhotos) returns the same row
 * whether it is scoped or not, because uuidv7 ids never collide across workspaces — so the only way to make the
 * scope observable is to call the function with the WRONG workspace for a row that really exists, and check that
 * nothing is read back or moved. That is what every test below does.
 */
describe('workspace scope elsewhere in the repository', () => {
  async function twoWorkspaces() {
    current = await setupDb();
    const { database, ws: mine } = current;
    const theirs = await createWorkspace(database, { name: 'Office', type: 'personal', baseCurrency: 'IDR' });
    return { database, mine, theirs };
  }

  async function post(database: TestDb['database'], ws: TestDb['ws'], extra: { channel?: 'online' | 'offline' | null; excludedFromReport?: boolean } = {}) {
    const card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const electronics = (await listAccounts(database, ws)).find((a) => a.systemKey === 'shopping.electronics')!.id;
    return postTransaction(database, ws, {
      occurredOn: '2026-09-17',
      description: 'Something',
      lines: expenseLines({ categoryAccountId: electronics, paymentAccountId: card.id, amountMinor: 100_000, currency: 'IDR' }),
      ...extra,
    });
  }

  it('extrasForTx reads nothing for a transaction filed under another workspace', async () => {
    const { database, mine, theirs } = await twoWorkspaces();
    const id = await post(database, mine, { channel: 'online', excludedFromReport: true });
    expect(await database.transaction((tx) => extrasForTx(tx, mine, id))).toEqual({ channel: 'online', excluded: true });
    expect(await database.transaction((tx) => extrasForTx(tx, theirs, id))).toBeNull();
  });

  it('writeExtrasTx does not delete another workspace\'s flag row', async () => {
    const { database, mine, theirs } = await twoWorkspaces();
    const id = await post(database, mine, { channel: 'online', excludedFromReport: true });
    // Nothing was named, so this hits the delete branch — scoped to `theirs`, which owns no such row.
    await database.transaction((tx) => writeExtrasTx(tx, theirs, id, {}));
    expect(await database.transaction((tx) => extrasForTx(tx, mine, id))).toEqual({ channel: 'online', excluded: true });
  });

  it('extrasFor reads nothing for a transaction filed under another workspace', async () => {
    const { database, mine, theirs } = await twoWorkspaces();
    const id = await post(database, mine, { channel: 'online', excludedFromReport: true });
    await addPhoto(database, mine, { transactionId: id, fileName: 'a.jpg', mime: 'image/jpeg', byteSize: 1 });
    expect((await extrasFor(database.db, theirs, [id])).size).toBe(0);
    expect((await extrasFor(database.db, mine, [id])).get(id)).toMatchObject({ channel: 'online', excluded: true, photoCount: 1 });
  });

  it('movePhotosTx does not move another workspace\'s photo', async () => {
    const { database, mine, theirs } = await twoWorkspaces();
    const id = await post(database, mine);
    const photoId = await addPhoto(database, mine, { transactionId: id, fileName: 'a.jpg', mime: 'image/jpeg', byteSize: 1 });
    const bogusTarget = uuidv7();
    await database.transaction((tx) => movePhotosTx(tx, theirs, id, bogusTarget));
    expect((await listPhotos(database, mine, id)).map((row) => row.id)).toEqual([photoId]);
    expect(await listPhotos(database, mine, bogusTarget)).toEqual([]);
  });

  it('writeExtrasTx does not re-key another workspace\'s unowned photo', async () => {
    const { database, mine, theirs } = await twoWorkspaces();
    const photoId = await addPhoto(database, mine, { transactionId: '', fileName: 'a.jpg', mime: 'image/jpeg', byteSize: 1 });
    const bogusTarget = uuidv7();
    await database.transaction((tx) => writeExtrasTx(tx, theirs, bogusTarget, { photoIds: [photoId] }));
    expect((await listPhotos(database, mine, '')).map((row) => row.id)).toEqual([photoId]);
    expect(await listPhotos(database, mine, bogusTarget)).toEqual([]);
  });

  it('listPhotos returns nothing for a transaction filed under another workspace', async () => {
    const { database, mine, theirs } = await twoWorkspaces();
    const id = await post(database, mine);
    await addPhoto(database, mine, { transactionId: id, fileName: 'a.jpg', mime: 'image/jpeg', byteSize: 1 });
    expect(await listPhotos(database, theirs, id)).toEqual([]);
  });
});
