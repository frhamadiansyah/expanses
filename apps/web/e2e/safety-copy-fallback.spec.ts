import { expect, test } from '@playwright/test';
import { walletCard } from './accounts';
import { addBank, forgetSafetyCopies, restorableCopies, waitForSafetyCopy } from './recovery-fixture';

/*
 * WebKit on older iOS may have no `FileSystemFileHandle.createWritable` on the main thread. The safety copies
 * then go through a worker of their own and a sync access handle (`safety-write.ts`). Chromium has both, so
 * the method is taken away before the page loads, and the whole round trip is proved through the fallback:
 * written, listed, and put back.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (FileSystemFileHandle.prototype as { createWritable?: unknown }).createWritable;
  });
});

test('safety copies are written, listed and restorable without createWritable', async ({ page }) => {
  await addBank(page, 'Kept by the fallback', '1000000');
  await forgetSafetyCopies(page);
  await page.goto('/');
  const copy = await waitForSafetyCopy(page);
  expect(copy).toMatch(/^snapshot-.+-daily\.sqlite3$/);
  // The manifest went the same way, and names the copy.
  const manifest = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('expanses-safety');
    return (await (await dir.getFileHandle('manifest.json')).getFile()).text();
  });
  expect(manifest).toContain(copy);

  // Something entered after the copy, so the restore below is seen to put the copy back rather than do nothing.
  await addBank(page, 'After the copy', '5000');

  await page.goto('/?recover');
  const restore = page.getByRole('button', { name: /Restore the last good copy/ });
  await expect(restore).toContainText(/From .+ · [\d.]+ (KB|MB)/);
  await Promise.all([page.waitForEvent('load'), restore.click()]);

  await page.goto('/wallet');
  await expect(walletCard(page, 'Kept by the fallback')).toBeVisible();
  await expect(walletCard(page, 'After the copy')).toHaveCount(0);
  // And the restore's own copy of what it replaced was written through the fallback too.
  await expect.poll(async () => (await restorableCopies(page)).some((name) => name.endsWith('-before-restore.sqlite3'))).toBe(true);
});
