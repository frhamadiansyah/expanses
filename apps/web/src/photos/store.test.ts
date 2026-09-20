import { expenseLines } from '@expanses/core';
import { addPhoto, allPhotoFileNames, createAccount, createDatabase, createWorkspace, listAccounts, migrate, MIGRATIONS, postTransaction } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceShield, makePhotoStore, type PhotoDirectory, type SweepShield } from './store';
import { memoryDirectory } from './memory-directory';
import { sweepPhotosAtStart } from './sweep-at-start';

const bytes = (text: string) => new TextEncoder().encode(text);

/** The device-local hold a restore writes, without a browser to write it in. */
function memoryShield(): SweepShield & { held: () => readonly string[] } {
  let names: readonly string[] = [];
  return { read: () => names, write: (next) => void (names = [...next]), held: () => names };
}

let executor: NodeExecutor | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  /*
   * The two shapes that are not a list of names and are not `null` either.
   *
   * A bare `string` is an `Iterable<string>`, so `sweepOrphanPhotos(row.fileName)` type-checked against the
   * old signature with no cast anywhere, and `new Set('01a0….jpg')` is a set of *characters* — nothing in the
   * directory matches one, so every photo on the device went. `undefined` did the same through a guard that
   * asked `kept === null`. The type forbids both now; these two are the runtime half, for a value that
   * reached here as `any` — a `JSON.parse`, an untyped boundary, a `@ts-expect-error` somebody meant kindly.
   */
  it.each([
    ['a single file name where a list was meant', (name: string): unknown => name],
    ['undefined, which is not null', (): unknown => undefined],
  ])('deletes nothing when it is handed %s', async (_what, argument) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = makePhotoStore(() => memoryDirectory());
    const photo = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');
    const other = await store.savePhotoBytes(bytes('another receipt'), 'image/jpeg');

    expect(await store.sweepOrphanPhotos(argument(photo.fileName) as readonly string[] | null)).toBe(0);

    expect(await store.listPhotoFiles()).toEqual([photo.fileName, other.fileName].sort());
    expect(warn).toHaveBeenCalled();
  });

  /*
   * The count has to be a fact about the directory, not about how many times the loop went round. The sweep's
   * return value is what every other test here asserts on, and it is what a later "nothing left to sweep"
   * check would trust: a read-only directory reporting a deletion that did not happen is the worst kind of
   * wrong, because nothing downstream has any reason to doubt it.
   */
  it('does not count a photo it was refused permission to delete', async () => {
    const files = new Map<string, Uint8Array>();
    const readOnly = (): PhotoDirectory => {
      const directory = memoryDirectory(files);
      return {
        ...directory,
        removeEntry: () => Promise.reject(new Error('NoModificationAllowedError')),
        [Symbol.asyncIterator]: () => directory[Symbol.asyncIterator](),
      };
    };
    const store = makePhotoStore(readOnly);
    const photo = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');

    expect(await store.deletePhotoFile(photo.fileName)).toBe(false);
    expect(await store.sweepOrphanPhotos([])).toBe(0);
    expect(await store.listPhotoFiles()).toEqual([photo.fileName]);
  });

  it('restores a photo the device does not have, and leaves one it already has alone', async () => {
    const store = makePhotoStore(() => memoryDirectory());
    const here = await store.savePhotoBytes(bytes('the original'), 'image/jpeg');
    expect(await store.putPhotoBytes(here.fileName, bytes('from the zip'))).toBe(false);
    expect(new TextDecoder().decode((await store.readPhotoBytes(here.fileName))!)).toBe('the original');
    expect(await store.putPhotoBytes('brought-back.jpg', bytes('from the zip'))).toBe(true);
    expect(new TextDecoder().decode((await store.readPhotoBytes('brought-back.jpg'))!)).toBe('from the zip');
  });

  /*
   * What `ReceiptPage` actually puts in an `<img src>`.
   *
   * The kind has to travel with the bytes: an object URL carries no file name, so a blob handed over as
   * `application/octet-stream` is a picture the browser offers to download instead of drawing. The name is
   * the only thing left to read it off, which is what `mimeForName` is for.
   */
  it('hands back an object URL that says what kind of picture it is, and null when the file is gone', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return `blob:photo-${blobs.length}`;
      },
    });
    const store = makePhotoStore(() => memoryDirectory());

    const png = await store.savePhotoBytes(bytes('a receipt'), 'image/png');
    expect(await store.photoUrl(png.fileName)).toBe('blob:photo-1');
    expect(blobs[0]!.type).toBe('image/png');
    expect(await blobs[0]!.text()).toBe('a receipt');

    // A second kind, so a constant cannot pass: the two names differ only by their extension.
    const pdf = await store.savePhotoBytes(bytes('an invoice'), 'application/pdf');
    expect(await store.photoUrl(pdf.fileName)).toBe('blob:photo-2');
    expect(blobs[1]!.type).toBe('application/pdf');

    expect(await store.photoUrl('nothing-here.jpg')).toBeNull();
    expect(blobs).toHaveLength(2);
  });
});

/**
 * Restoring a backup taken before a photograph was attached — the one path that could destroy one outright.
 *
 * `BackupPage` reloads the page the moment a restore lands, and `Layout.tsx` sweeps on the next start. The
 * database it sweeps against is now the restored one, and to a database that predates a picture, that picture
 * is an orphan. The sqlite restore already insists on a safety copy of the data it replaces; the photos, the
 * one thing in this app with no second copy anywhere, used to get nothing at all.
 *
 * The reviewer's reproduction, end to end: newer database names X.jpg, restore an older backup, sweep, then
 * restore the newer backup again and find the row back and the photograph gone.
 */
describe('a restore that hands the app a database older than the photos on the device', () => {
  it('leaves the photographs alone, on that launch and on every launch after it', async () => {
    const shield = memoryShield();
    const store = makePhotoStore(() => memoryDirectory(), shield);
    const photo = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');

    // The database as it stands: the row names the file, so the sweep has nothing to do.
    expect(await store.sweepOrphanPhotos([photo.fileName])).toBe(0);

    // The restore of the older backup. The hold goes down before the database under it changes.
    expect(await store.holdPhotosBeforeRestore()).toEqual([photo.fileName]);

    // The reload, and the sweep against a database that has never heard of this picture.
    expect(await store.sweepOrphanPhotos([])).toBe(0);
    expect(await store.listPhotoFiles()).toEqual([photo.fileName]);

    // And the launch after that, and the one after that: a hold that lasted one start would only move the
    // loss to the second one. The user has as long as they like to work out what went wrong.
    expect(await store.sweepOrphanPhotos([])).toBe(0);
    expect(await store.sweepOrphanPhotos([])).toBe(0);
    expect(new TextDecoder().decode((await store.readPhotoBytes(photo.fileName))!)).toBe('a receipt');

    // Restoring the newer backup puts the row back — and the photograph it names is still here to go with it.
    expect(await store.sweepOrphanPhotos([photo.fileName])).toBe(0);
    expect(await store.listPhotoFiles()).toEqual([photo.fileName]);
  });

  it('lets a held photo go once a live database names it, so the sweep still tidies afterwards', async () => {
    const shield = memoryShield();
    const store = makePhotoStore(() => memoryDirectory(), shield);
    const attached = await store.savePhotoBytes(bytes('kept'), 'image/jpeg');
    const abandoned = await store.savePhotoBytes(bytes('left by a half-filled form'), 'image/jpeg');

    await store.holdPhotosBeforeRestore();
    expect(shield.held()).toEqual([attached.fileName, abandoned.fileName].sort());

    // The newer backup is restored: its rows name the attached one, and the hold on that one is let go —
    // a file a live database names is no longer at risk from the restore that put it there.
    expect(await store.sweepOrphanPhotos([attached.fileName])).toBe(0);
    expect(shield.held()).toEqual([abandoned.fileName]);
    expect(await store.listPhotoFiles()).toEqual([attached.fileName, abandoned.fileName].sort());

    // The one nothing ever named is still held, and stays held: this device cannot tell it from the photo
    // the restored database is simply too old to know about.
    expect(await store.sweepOrphanPhotos([attached.fileName])).toBe(0);

    // A picture written after the restore was never held, so the tidying the sweep exists for still happens.
    const later = await store.savePhotoBytes(bytes('written since'), 'image/jpeg');
    expect(await store.sweepOrphanPhotos([attached.fileName])).toBe(1);
    expect(await store.listPhotoFiles()).toEqual([attached.fileName, abandoned.fileName].sort());
    expect(later.fileName).not.toBe(abandoned.fileName);
  });

  /**
   * The hold built from a read that failed — the one that used to raise nothing at all.
   *
   * `listPhotoFiles` swallows a directory it cannot walk and answers `[]`, which is right for the sweep:
   * nothing can be shown to be unused, so nothing goes. Built the hold out of the same `[]` and it means the
   * opposite — *hold nothing* — and it **resolved**, so neither call site had anything to catch. The restore
   * went ahead, the next sweep read every picture as an orphan, and a photograph has no second copy anywhere.
   *
   * The directory here is the exact shape `listPhotoFiles`'s catch exists for: it refuses one walk and is
   * perfectly fine on the next, which is what a storage permission prompt or a busy OPFS looks like.
   */
  it('refuses to build a hold from a directory it could not read, rather than holding nothing', async () => {
    const files = new Map<string, Uint8Array>();
    let refuseWalk = false;
    const flaky = (): PhotoDirectory => {
      const inner = memoryDirectory(files);
      return {
        ...inner,
        [Symbol.asyncIterator]: () => {
          if (refuseWalk) throw new Error('NotReadableError');
          return inner[Symbol.asyncIterator]();
        },
      };
    };
    const shield = memoryShield();
    const store = makePhotoStore(flaky, shield);
    const photo = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');

    refuseWalk = true;
    // The sweep's reading of the same failure is unchanged: it answers empty and therefore deletes nothing.
    expect(await store.listPhotoFiles()).toEqual([]);
    // The hold's reading of it is a rejection, because an empty hold is a promise it cannot keep.
    await expect(store.holdPhotosBeforeRestore()).rejects.toThrow();
    expect(shield.held()).toEqual([]);

    // And the restore that rejection stops never happens, so the photograph is still there afterwards.
    refuseWalk = false;
    expect(await store.listPhotoFiles()).toEqual([photo.fileName]);
  });

  /**
   * The hold that could not be written down — a full origin, or an iOS Safari private window.
   *
   * `write` raises, and the hold has to raise with it: a hold nobody recorded protects nothing, and the
   * caller is about to run the one operation that deletes photographs.
   */
  it('refuses when the device will not keep the list of held photos', async () => {
    const unwritable: SweepShield = {
      read: () => [],
      write: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = makePhotoStore(() => memoryDirectory(), unwritable);
    const photo = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');

    await expect(store.holdPhotosBeforeRestore()).rejects.toThrow();
    expect(await store.listPhotoFiles()).toEqual([photo.fileName]);
  });

  it('deletes nothing when this device cannot say which photos a restore is holding', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unreadable: SweepShield = {
      read: () => {
        throw new Error('storage is not available in this window');
      },
      write: () => undefined,
    };
    const store = makePhotoStore(() => memoryDirectory(), unreadable);
    const photo = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');

    expect(await store.sweepOrphanPhotos([])).toBe(0);
    expect(await store.listPhotoFiles()).toEqual([photo.fileName]);
    expect(warn).toHaveBeenCalled();
  });
});

/**
 * The shield the app actually ships — fifteen lines of `localStorage`, every one of them a decision about
 * what "empty" means.
 *
 * Everything else in this file runs against `memoryShield()` or a shield written to throw, so until now the
 * only thing that exercised these lines was the happy path of an end-to-end test. All three ways the hold
 * used to fail open lived here: a write nobody checked, a stored list quietly filtered down to nothing, and
 * a parse that could only be trusted because it had never been given anything odd.
 */
describe('the hold as a real device keeps it', () => {
  /** A `localStorage` that can be told to misbehave the way a full origin or a private window does. */
  function stubStorage(initial: string | null, behaviour: { readThrows?: boolean; writeThrows?: boolean } = {}) {
    let value = initial;
    vi.stubGlobal('localStorage', {
      getItem: () => {
        if (behaviour.readThrows) throw new Error('SecurityError: storage is not available in this window');
        return value;
      },
      setItem: (_key: string, next: string) => {
        if (behaviour.writeThrows) throw new Error('QuotaExceededError');
        value = next;
      },
    });
    return { stored: () => value };
  }

  it('writes the names down under a key of its own and reads them back', () => {
    const storage = stubStorage(null);
    deviceShield.write(['b.jpg', 'a.jpg']);
    expect(storage.stored()).toBe('["b.jpg","a.jpg"]');
    expect(deviceShield.read()).toEqual(['b.jpg', 'a.jpg']);
  });

  it('holds nothing where there is no web storage at all, and does not fail trying to write there', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(deviceShield.read()).toEqual([]);
    expect(() => deviceShield.write(['a.jpg'])).not.toThrow();
  });

  /*
   * The stored list that is not a list of names. Filtering the odd entries out turned `[null, 0, {}]` into
   * `[]` — "nothing is held" — which is a sentence the sweep acts on. "This device cannot say" is the truth,
   * and the sweep already knows what to do with it.
   */
  it('throws rather than answering empty when the stored list holds something that is not a name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubStorage('[null,0,{}]');
    expect(() => deviceShield.read()).toThrow();

    // And the consequence, through the real store: nothing is deleted on the strength of a list like that.
    const store = makePhotoStore(() => memoryDirectory(), deviceShield);
    const photo = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');
    expect(await store.sweepOrphanPhotos([])).toBe(0);
    expect(await store.listPhotoFiles()).toEqual([photo.fileName]);
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    ['a stored value that is not a list', '{"held":"a.jpg"}'],
    ['a stored value that is not JSON at all', 'a.jpg'],
  ])('throws on %s', (_what, stored) => {
    stubStorage(stored);
    expect(() => deviceShield.read()).toThrow();
  });

  it('lets a storage that will not take the write say so, instead of losing the hold quietly', () => {
    stubStorage(null, { writeThrows: true });
    expect(() => deviceShield.write(['a.jpg'])).toThrow();
  });

  it('lets a storage that will not be read say so', () => {
    stubStorage('["a.jpg"]', { readThrows: true });
    expect(() => deviceShield.read()).toThrow();
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
 * This is the test the task exists for: a real database stopped at 47, a photo taken, and the photograph still
 * on the device afterwards. It calls `sweepPhotosAtStart` — the function `Layout.tsx`'s effect is now nothing
 * but a call to — rather than re-typing that effect here. A test that copies its subject cannot regress when
 * the subject does, and this one used to: putting `kept ?? []` back in the component left the suite green.
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
    // table for it — and `addPhoto` refuses rather than answering an id for a row it did not write, so the form
    // learns the truth. The bytes are on the device either way, which is what the sweep must not touch.
    const photo = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');
    await expect(addPhoto(database, ws, { transactionId: id, fileName: photo.fileName, mime: 'image/jpeg', byteSize: photo.byteSize })).rejects.toThrow();

    // The database is asked, and answers that it cannot say — not that there are no photos.
    expect(await allPhotoFileNames(database)).toBeNull();

    // What the app runs at start, on the real database, with nothing retyped in between.
    expect(await sweepPhotosAtStart(database, store)).toBe(0);

    expect(await store.listPhotoFiles()).toEqual([photo.fileName]);
    expect(new TextDecoder().decode((await store.readPhotoBytes(photo.fileName))!)).toBe('a receipt');
    expect(warn).toHaveBeenCalled();
  });

  /*
   * The control, so the case above cannot pass by doing nothing at all.
   *
   * The same function on a database that *can* say: it reads the real rows, keeps the picture one of them
   * names, and takes the one nothing names. A sweep that always refused would fail this; a sweep that ignored
   * the database and swept everything would fail the case above.
   */
  it('takes the picture nothing names once the database is high enough to be asked', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS);
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-17',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 250_000, currency: 'IDR' }),
    });

    const store = makePhotoStore(() => memoryDirectory());
    const attached = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');
    await addPhoto(database, ws, { transactionId: id, fileName: attached.fileName, mime: 'image/jpeg', byteSize: attached.byteSize });
    const abandoned = await store.savePhotoBytes(bytes('left by a half-filled form'), 'image/jpeg');

    expect(await sweepPhotosAtStart(database, store)).toBe(1);
    expect(await store.listPhotoFiles()).toEqual([attached.fileName]);
    expect(abandoned.fileName).not.toBe(attached.fileName);
  });
});
