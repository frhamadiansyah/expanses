import { expenseLines } from '@expanses/core';
import { addPhoto, allPhotoFileNames, createAccount, createDatabase, createWorkspace, listAccounts, migrate, MIGRATIONS, postTransaction } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePhotoStore } from './store';
import { memoryDirectory } from './memory-directory';

const bytes = (text: string) => new TextEncoder().encode(text);

let executor: NodeExecutor | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  executor?.close();
  executor = undefined;
});

describe('photos kept on this device', () => {
  it('writes the bytes under a name of its own and reads them back', async () => {
    const store = makePhotoStore(() => memoryDirectory());
    const saved = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');
    expect(saved.fileName).toMatch(/\.jpg$/);
    expect(saved.byteSize).toBe(9);
    expect(new TextDecoder().decode((await store.readPhotoBytes(saved.fileName))!)).toBe('a receipt');
  });

  it('sweeps a photo no transaction names, and keeps the ones that are named', async () => {
    const store = makePhotoStore(() => memoryDirectory());
    const kept = await store.savePhotoBytes(bytes('kept'), 'image/jpeg');
    const orphan = await store.savePhotoBytes(bytes('abandoned'), 'image/jpeg');
    expect(await store.sweepOrphanPhotos([kept.fileName])).toBe(1);
    expect(await store.listPhotoFiles()).toEqual([kept.fileName]);
    expect(orphan.fileName).not.toBe(kept.fileName);
  });

  it('says nothing and breaks nothing where OPFS is not there', async () => {
    const store = makePhotoStore(() => {
      throw new Error('no OPFS here');
    });
    expect(await store.listPhotoFiles()).toEqual([]);
  });

  /*
   * The half of the sweep that has nothing to do with OPFS: being handed "I cannot tell" instead of a list.
   *
   * The brief's sweep test above only ever covers the case where the list is trustworthy, and a sweep that
   * deletes everything it is not told to keep passes it. This is the case where the same code destroys data.
   */
  it('deletes nothing when it is told the database cannot say which files are in use', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = makePhotoStore(() => memoryDirectory());
    const photo = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');
    expect(await store.sweepOrphanPhotos(null)).toBe(0);
    expect(await store.listPhotoFiles()).toEqual([photo.fileName]);
    expect(warn).toHaveBeenCalled();
  });

  it('restores a photo the device does not have, and leaves one it already has alone', async () => {
    const store = makePhotoStore(() => memoryDirectory());
    const here = await store.savePhotoBytes(bytes('the original'), 'image/jpeg');
    expect(await store.putPhotoBytes(here.fileName, bytes('from the zip'))).toBe(false);
    expect(new TextDecoder().decode((await store.readPhotoBytes(here.fileName))!)).toBe('the original');
    expect(await store.putPhotoBytes('brought-back.jpg', bytes('from the zip'))).toBe(true);
    expect(new TextDecoder().decode((await store.readPhotoBytes('brought-back.jpg'))!)).toBe('from the zip');
  });
});

/**
 * The sweep on a device whose update is blocked — the one place this can cost a user a photograph.
 *
 * `db/open.ts` opens the app at the version below a blocked update on purpose: last month's schema with the
 * whole ledger in it beats no app at all. On such a device `transaction_photos` does not exist, so nothing in
 * the database can name a photo file, while the store itself is perfectly happy to write one — it never asks
 * the database anything. Run the app-start sweep there and every picture on the device is a file no row names.
 *
 * This is the test the task exists for: a real database stopped at 47, a photo taken, the sweep run exactly as
 * `Layout.tsx` runs it, and the photograph still on the device afterwards.
 */
describe('a device sitting below the newest schema, because an update was blocked', () => {
  async function stoppedAt47() {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(
      database,
      MIGRATIONS.filter((m) => m.version <= 47),
    );
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-17',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 250_000, currency: 'IDR' }),
    });
    return { database, ws, id };
  }

  it('keeps the photo the user just took when the app starts and sweeps', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { database, ws, id } = await stoppedAt47();
    const store = makePhotoStore(() => memoryDirectory());

    // What the form does: the bytes to OPFS, then the index row. The row cannot be written here — there is no
    // table for it — and `addPhoto` says nothing about that, which is the other half of the trap.
    const photo = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');
    await addPhoto(database, ws, { transactionId: id, fileName: photo.fileName, mime: 'image/jpeg', byteSize: photo.byteSize });

    // The database is asked, and answers that it cannot say — not that there are no photos.
    const kept = await allPhotoFileNames(database);
    expect(kept).toBeNull();

    // Layout.tsx, exactly.
    expect(await store.sweepOrphanPhotos(kept)).toBe(0);

    expect(await store.listPhotoFiles()).toEqual([photo.fileName]);
    expect(new TextDecoder().decode((await store.readPhotoBytes(photo.fileName))!)).toBe('a receipt');
    expect(warn).toHaveBeenCalled();
  });
});
