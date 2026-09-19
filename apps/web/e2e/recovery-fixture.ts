import { expect, type Page } from '@playwright/test';

// Not a spec: shared by `recovery.spec.ts` (chromium) and `phone-recovery.spec.ts` (phone), because
// breaking a real database is fiddly enough that the two projects must break it exactly the same way.

/** What the recovery screen says when a file would not read: the `corrupt` kind's words, from `recovery-copy.ts`. */
export const CORRUPT_HEADLINE = 'Part of your data would not read';

/** The one place the export button is named, so a copy change moves one line. */
export const EXPORT_BUTTON = 'Download a copy of my data';

/** The safety copies sitting in `expanses-safety/` right now, by name, read from the page itself. */
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
 * Waits for the day's copy to land, and answers with its name. It is taken in an idle callback after the
 * first paint, deliberately, so it is never there the instant a screen appears — a test that assumes
 * otherwise is a flake waiting to happen.
 */
export async function waitForSafetyCopy(page: Page): Promise<string> {
  await expect.poll(() => safetyCopies(page), { timeout: 20_000 }).not.toHaveLength(0);
  return (await safetyCopies(page))[0]!;
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
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill(balance);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
}

/** Where the SAH pool's own header ends and the database's first page begins, in every slot file. */
const DATA_OFFSET = 4096;

/**
 * How large a database has to be before the open stops checking its structure on the way in.
 *
 * `QUICK_CHECK_LIMIT_BYTES` in `src/db/open.ts` is 32 MiB (spec §11.4's size guard): past that, a
 * `quick_check` on the path to first paint costs more than it is worth, and the structural check happens
 * only after an update. 34 MiB is comfortably the other side of that line, and it is what makes the
 * mid-session journey reachable: a big ledger with a bad page in it opens, and says nothing at all until
 * something actually reads that page.
 */
export const PAST_THE_SIZE_GUARD_BYTES = 34 * 1024 * 1024;

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
