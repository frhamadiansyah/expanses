import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { QUICK_CHECK_LIMIT_BYTES } from '../src/db/size-guard';

// Not a spec: shared by `recovery.spec.ts` (chromium) and `phone-recovery.spec.ts` (phone), because
// breaking a real database is fiddly enough that the two projects must break it exactly the same way.

/** What the recovery screen says when a file would not read: the `corrupt` kind's words, from `recovery-copy.ts`. */
export const CORRUPT_HEADLINE = 'Part of your data would not read';

/** The one place the export button is named, so a copy change moves one line. */
export const EXPORT_BUTTON = 'Download a copy of my data';

/**
 * Every name in `expanses-safety/` right now, whether or not the file behind it holds anything yet.
 *
 * This is the wide answer, and it is the right one for saying a copy is *gone*: a wipe that left a stray
 * empty file behind has not emptied the device, and a check that overlooked it would say it had.
 * For "a copy I can restore", use `restorableCopies` — see it for why the two are not the same.
 */
export function safetyCopies(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('expanses-safety').catch(() => null);
    if (!dir) return [];
    const found: string[] = [];
    for await (const entry of dir.values()) if (entry.name.endsWith('.sqlite3')) found.push(entry.name);
    return found;
  });
}

/**
 * The copies that are really copies: a name *and* a database behind it.
 *
 * The store writes a copy in two steps — `getFileHandle(name, { create: true })`, which puts the name in
 * the directory at once, and then the bytes. Between those two the copy exists by name and holds nothing.
 * A test that waits on the name alone therefore carries on while the copy is still being written, and the
 * very next thing these journeys do is navigate — which tears the page down mid-write and leaves a copy
 * that is empty or half there. Restoring it then hands back nothing, and the failure surfaces as the
 * restore "losing" the data: the flake that makes the one suite guarding against data loss untrustworthy.
 *
 * So the bytes are read and checked for SQLite's own magic. That is the same question the app asks before
 * it records a copy, and it is strictly more than the name was proving.
 */
export function restorableCopies(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('expanses-safety').catch(() => null);
    if (!dir) return [];
    const found: string[] = [];
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.sqlite3')) continue;
      const file = await (entry as FileSystemFileHandle).getFile();
      if (file.size < 16) continue;
      const magic = new TextDecoder().decode(new Uint8Array(await file.slice(0, 15).arrayBuffer()));
      if (magic === 'SQLite format 3') found.push(entry.name);
    }
    return found;
  });
}

/**
 * Waits for the day's copy to land, and answers with its name. It is taken in an idle callback after the
 * first paint, deliberately, so it is never there the instant a screen appears — a test that assumes
 * otherwise is a flake waiting to happen.
 *
 * "Landed" means restorable, not merely named: see `restorableCopies`.
 */
export async function waitForSafetyCopy(page: Page): Promise<string> {
  await expect.poll(() => restorableCopies(page), { timeout: 20_000 }).not.toHaveLength(0);
  return (await restorableCopies(page))[0]!;
}

/**
 * Throws away the copies this origin holds, so the next open takes a fresh one. Only a test needs this:
 * the day's copy is taken once per calendar day, and a test that wants a copy of what it has *just*
 * entered has to look like a device that has not had one today.
 */
export async function forgetSafetyCopies(page: Page) {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('expanses-safety', { recursive: true }).catch(() => undefined);
  });
}

export async function addBank(page: Page, name: string, balance: string) {
  await openAccount(page, { subtype: 'bank', name, balance });
}

/** Where the SAH pool's own header ends and the database's first page begins, in every slot file. */
const DATA_OFFSET = 4096;

/**
 * How large a database has to be before the open stops checking its structure on the way in.
 *
 * Derived from the limit itself rather than restated beside it: `QUICK_CHECK_LIMIT_BYTES` is spec §11.4's
 * size guard, past which a `quick_check` on the path to first paint costs more than it is worth and the
 * structural check happens only after an update. Two megabytes the other side of it is what makes the
 * mid-session journey reachable — a big ledger with a bad page in it opens, and says nothing at all until
 * something actually reads that page — and the day the guard moves, this moves with it.
 */
export const PAST_THE_SIZE_GUARD_BYTES = QUICK_CHECK_LIMIT_BYTES + 2 * 1024 * 1024;

/**
 * Writes bytes into the live database's slot file, from the page itself. Recovery mode never opens the
 * VFS, so the pool holds no sync access handles and the slot files can be written here — that is the
 * whole trick, and both the corruption and the from-the-future tests turn on it.
 *
 * Layout, as the running browser actually has it: `.expanses/.opaque/<random>`, each slot file a
 * 4096-byte SAH header followed by the database's own pages. The walk is recursive and the slot is
 * picked by the SQLite magic after that header, so neither the subdirectory nor the names matter.
 * `keepExistingData` leaves that header alone, so the pool still knows which file this is.
 *
 * The payload travels as base64 because a megabyte of database crosses the CDP boundary as a string in
 * one message, where the same bytes as an array of numbers would be a million JSON values.
 */
async function writeOverTheDatabase(page: Page, payload: { position: number; base64: string; minSize: number }) {
  await page.goto('/?recover');
  await expect(page.getByRole('heading', { name: 'Recovery tools', exact: true })).toBeVisible();
  const report = await page.evaluate(async ({ position, base64, minSize, DATA }) => {
    const seen: string[] = [];
    const binary = atob(base64);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);

    const root = await navigator.storage.getDirectory();
    const slots: { name: string; handle: FileSystemFileHandle }[] = [];
    const todo: { dir: FileSystemDirectoryHandle; prefix: string }[] = [{ dir: await root.getDirectoryHandle('.expanses'), prefix: '.expanses/' }];
    while (todo.length) {
      const { dir, prefix } = todo.shift()!;
      // Each directory is drained before any child is opened: no nested iteration over OPFS.
      const entries: FileSystemHandle[] = [];
      for await (const handle of dir.values()) entries.push(handle);
      for (const handle of entries) {
        if (handle.kind === 'file') slots.push({ name: prefix + handle.name, handle: handle as FileSystemFileHandle });
        else todo.push({ dir: handle as FileSystemDirectoryHandle, prefix: `${prefix + handle.name}/` });
      }
    }

    for (const { name, handle } of slots) {
      const file = await handle.getFile();
      seen.push(`${name}:${file.size}`);
      if (file.size < minSize) continue;
      const magic = new Uint8Array(await file.slice(DATA, DATA + 16).arrayBuffer());
      if (new TextDecoder().decode(magic.subarray(0, 15)) !== 'SQLite format 3') continue;
      const writable = await handle.createWritable({ keepExistingData: true });
      await writable.write({ type: 'write', position, data });
      await writable.close();
      return { written: file.size, seen };
    }
    return { written: 0, seen };
  }, { ...payload, DATA: DATA_OFFSET });
  // A test that silently passes on a database it never touched is worse than no test: say what was there.
  expect(report.written, `no database slot in .expanses — files were ${report.seen.join(', ') || '(none)'}`).toBeGreaterThan(0);
}

/** Writes rubbish over the middle of the database, leaving a file SQLite will not read. */
export async function corruptTheDatabase(page: Page) {
  await writeOverTheDatabase(page, {
    position: DATA_OFFSET + 4096 * 10,
    base64: Buffer.alloc(4096 * 20, 0xff).toString('base64'),
    minSize: DATA_OFFSET + 4096 * 40,
  });
}

/**
 * Puts a whole database file into the slot, as the bytes a different build of the app would have left
 * there. The SAH header survives; everything after it is the given file.
 *
 * The replacement is the same size or smaller than what was there (it differs by rows, not by design),
 * so anything left at the tail lies past `pageSize × pageCount` and SQLite never reads it.
 */
export async function replaceTheDatabase(page: Page, bytes: Buffer) {
  await writeOverTheDatabase(page, { position: DATA_OFFSET, base64: bytes.toString('base64'), minSize: DATA_OFFSET + 16 });
}

/**
 * Grows the slot file to `databaseBytes` of database, so the file really is the size its header says.
 *
 * A header that claims more pages than the file holds is not a big database, it is a corrupt one — SQLite
 * checks exactly that when it takes its first lock and refuses the file outright. So the pages have to be
 * there. They are written here rather than shipped: one byte at the far end of the slot, and OPFS fills
 * everything before it with zeros. Thirty-five megabytes of empty pages, for the price of a single write,
 * where sending them through the browser as base64 would be nearly fifty megabytes of string.
 *
 * SQLite never reads those pages — nothing in the database points at them — and only `integrity_check`
 * would have an opinion about them, which is the check this size deliberately puts out of reach.
 */
export async function enlargeTheDatabase(page: Page, databaseBytes: number) {
  await writeOverTheDatabase(page, {
    position: DATA_OFFSET + databaseBytes - 1,
    base64: Buffer.alloc(1).toString('base64'),
    minSize: DATA_OFFSET + 16,
  });
}
