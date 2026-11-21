import { join } from 'node:path';
import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { openAccount } from './accounts';
import { openWorkspacePage, renameWorkspace } from './workspace-page';

/*
 * Link my devices, end to end (spec 2026-11-19 §3.5, §4.2): an iPhone with data and a Mac with data of its own, each a
 * browser context with its own database and keys, through the local relay Worker. The iPhone shows a code, the Mac
 * types it and saves its backup file, both show the same 4 digits, the iPhone allows; the Mac's data is replaced by
 * the iPhone's and, after its reload, both list both devices and the iPhone's change reaches the Mac. Invented data.
 */

test.describe.configure({ timeout: 300_000 });

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko)';

async function device(browser: Browser, info: TestInfo, userAgent: string, width: number): Promise<Page> {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: 900 }, userAgent, acceptDownloads: true });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  return page;
}

async function shot(page: Page, name: string) {
  const dir = process.env.LINK_SHOTS;
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

test('an iPhone links a Mac: same digits on both, the Mac takes the iPhone’s data after its backup, both list both', async ({ browser }, info) => {
  test.skip(info.project.name !== 'chromium', 'one run is enough: two shapes in one journey');
  const phone = await device(browser, info, IPHONE, 390);
  const mac = await device(browser, info, MAC, 1280);

  await phone.goto('/account');
  await openWorkspacePage(phone, 'Personal');
  await renameWorkspace(phone, 'Test Household');
  await openAccount(phone, { subtype: 'bank', name: 'Test Phone Bank', balance: '2500000' });
  await mac.goto('/account');
  await openAccount(mac, { subtype: 'cash', name: 'Old Mac Wallet', balance: '10000' });

  // iPhone: Account › Devices › Link another device.
  await phone.goto('/account');
  await phone.getByRole('link', { name: /^Devices/ }).click();
  await expect(phone.getByTestId('devices-page')).toBeVisible();
  await shot(phone, '1-phone-devices');
  await phone.getByTestId('link-another').click();
  const codeBox = phone.getByTestId('link-code');
  await expect(codeBox).toBeVisible({ timeout: 30_000 });
  const code = ((await codeBox.getAttribute('aria-label')) ?? '').replace(/\s/g, '');
  expect(code).toMatch(/^\d{6}$/);
  await shot(phone, '2-phone-code');

  // Mac: Settings › Devices › Link to another device, the code, Save backup and link.
  await mac.goto('/account/devices');
  await mac.getByTestId('link-to-another').click();
  // The code field is focused on opening, wide enough for the 6 digits, and the warning counts one of each in the singular.
  await expect(mac.getByTestId('join-link-code')).toBeFocused();
  expect((await mac.getByTestId('join-link-code').boundingBox())?.width ?? 0).toBeGreaterThan(55);
  await expect(mac.getByTestId('join-link-sheet')).toContainText('(1 workspace, 1 transaction)');
  await mac.getByTestId('join-link-code').fill(code);
  await expect(mac.getByTestId('join-link-go')).toHaveText(/Save backup and link/);
  await shot(mac, '3-mac-code');
  const backup = mac.waitForEvent('download');
  await mac.getByTestId('join-link-go').click();
  expect((await backup).suggestedFilename()).toMatch(/^cicis-mac-before-link-\d{4}-\d{2}-\d{2}\.sqlite3$/);

  // Both screens show the same 4 digits; the iPhone asks to link the Mac.
  await expect(phone.getByTestId('link-check-digits')).toBeVisible({ timeout: 30_000 });
  await expect(mac.getByTestId('join-check-digits')).toBeVisible({ timeout: 30_000 });
  const phoneDigits = await phone.getByTestId('link-check-digits').getAttribute('aria-label');
  expect(await mac.getByTestId('join-check-digits').getAttribute('aria-label')).toBe(phoneDigits);
  await expect(phone.getByText('Link Mac?')).toBeVisible();
  await shot(phone, '4-phone-allow');
  await shot(mac, '5-mac-check');
  const reopened = mac.waitForEvent('load', { timeout: 180_000 });
  await phone.getByTestId('link-allow').click();
  await expect(phone.getByTestId('link-done')).toBeVisible({ timeout: 60_000 });

  // The Mac fetches the copy, replaces its data and opens again on the iPhone's: nothing navigates it meanwhile.
  await reopened;
  await expect(async () => {
    await mac.goto('/account/devices');
    await expect(mac.getByTestId('device-other')).toHaveText(/iPhone/);
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000] });
  await shot(mac, '6-mac-devices');
  await mac.goto('/account');
  await expect(mac.getByTestId('account-workspace').filter({ hasText: 'Test Household' })).toBeVisible();
  await mac.goto('/accounts');
  await expect(mac.getByText('Test Phone Bank').first()).toBeVisible();
  await expect(mac.getByText('Old Mac Wallet')).toHaveCount(0);

  // The iPhone lists the Mac once it has synced.
  await expect(async () => {
    await phone.goto('/account/devices');
    await expect(phone.getByTestId('device-other')).toHaveText(/Mac/);
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000] });
  await shot(phone, '7-phone-devices-after');
});
