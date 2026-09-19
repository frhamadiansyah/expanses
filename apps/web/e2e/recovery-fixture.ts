import { expect, type Page } from '@playwright/test';

// Not a spec: shared by `recovery.spec.ts` (chromium) and `phone-recovery.spec.ts` (phone), because
// breaking a real database is fiddly enough that the two projects must break it exactly the same way.

/** What the recovery screen says when a file would not read: the `corrupt` kind's words, from `recovery-copy.ts`. */
export const CORRUPT_HEADLINE = 'Part of your data would not read';

/** The one place the export button is named, so a copy change moves one line. */
export const EXPORT_BUTTON = 'Download a copy of my data';

export async function addBank(page: Page, name: string, balance: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill(balance);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
}

/**
 * Writes rubbish over the middle of the database, from the page itself. Recovery mode never opens the
 * VFS, so the pool holds no sync access handles and the slot files can be written here.
 *
 * Layout, as the running browser actually has it: `.expanses/.opaque/<random>`, each slot file a
 * 4096-byte SAH header followed by the database's own pages. The walk is recursive and the slot is
 * picked by the SQLite magic after that header, so neither the subdirectory nor the names matter.
 */
export async function corruptTheDatabase(page: Page) {
  await page.goto('/?recover');
  await expect(page.getByRole('heading', { name: 'Recovery tools', exact: true })).toBeVisible();
  const report = await page.evaluate(async () => {
    const DATA = 4096;
    const seen: string[] = [];
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
      if (file.size < DATA + 4096 * 40) continue;
      const magic = new Uint8Array(await file.slice(DATA, DATA + 16).arrayBuffer());
      if (new TextDecoder().decode(magic.subarray(0, 15)) !== 'SQLite format 3') continue;
      const writable = await handle.createWritable({ keepExistingData: true });
      await writable.write({ type: 'write', position: DATA + 4096 * 10, data: new Uint8Array(4096 * 20).fill(0xff) });
      await writable.close();
      return { wrecked: file.size, seen };
    }
    return { wrecked: 0, seen };
  });
  // A test that silently passes on a database it never broke is worse than no test: say what was there.
  expect(report.wrecked, `no database slot in .expanses — files were ${report.seen.join(', ') || '(none)'}`).toBeGreaterThan(0);
}
