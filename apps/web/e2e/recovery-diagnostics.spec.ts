import { expect, test } from '@playwright/test';
import { addBank, corruptTheDatabase, CORRUPT_HEADLINE } from './recovery-fixture';

/*
 * The recovery screen keeps what really happened on the device, and shows it under Details: the engine's
 * own words, the slot files and the safety copies. On a phone with no console this is the bug report.
 */
test('a failure is recorded on the device and shown under Details', async ({ page }) => {
  await addBank(page, 'Recorded', '1000000');
  await corruptTheDatabase(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CORRUPT_HEADLINE, exact: true })).toBeVisible();
  await page.getByText('Details', { exact: true }).click();
  await expect(page.getByText('Recorded on this device')).toBeVisible();
  const record = page.locator('pre');
  await expect(record).toContainText(/· corrupt/);
  await expect(record).toContainText(/Slot files: .*bytes, SQLite/);

  const saved = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('expanses-safety');
    return JSON.parse(await (await (await dir.getFileHandle('last-failure.json')).getFile()).text()) as { kind: string }[];
  });
  expect(saved[0]?.kind).toBe('corrupt');

  // Asked-for recovery tools show the record but do not add to it.
  await page.goto('/?recover');
  await page.getByText('Details', { exact: true }).click();
  await expect(page.locator('pre')).toContainText(/· corrupt/);
  const after = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('expanses-safety');
    return (JSON.parse(await (await (await dir.getFileHandle('last-failure.json')).getFile()).text()) as unknown[]).length;
  });
  expect(after).toBe(saved.length);
});
