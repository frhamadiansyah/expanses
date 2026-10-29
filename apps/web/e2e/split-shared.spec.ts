import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { openAccount } from './accounts';
import { choosePayment, saveButton } from './add-transaction';
import { addPart, fillPart, openSplit, pickPartCategory } from './split-row';
import { openSharePage, openWorkspacePage, renameWorkspace, shareWorkspace } from './workspace-page';

/*
 * A purchase split between a workspace shared with a household and a private one (0084, household sharing): Fandri
 * shares Home with Dewi and keeps Business to himself. One charge of Rp 1.247.000 on his bank account, split Rp 830.000
 * of groceries for Home and Rp 417.000 of restaurants for Business. Dewi's phone gets the Home part alone, paid by
 * Fandri from his account; the Business part and the whole charge never reach it. Her correction of the Home part comes
 * back to his split, leaving Business's part as it was. Two browser contexts, two devices, through the local relay.
 * Invented figures.
 */

test.describe.configure({ timeout: 300_000 });

async function secondDevice(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  return page;
}

/** Waits until `check` passes, bringing the app to the foreground between tries so it pulls (spec §9.4). */
async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await check();
  }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
}

async function newWorkspace(page: Page, name: string, startsWith: string) {
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByLabel('Starts with').selectOption({ label: startsWith });
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText(name);
}

async function openWorkspace(page: Page, name: string) {
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: name }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText(name);
}

/** Fandri renames Personal to Home and shares it; Dewi joins by the link. */
async function shareHome(page: Page, dewi: Page) {
  await openWorkspacePage(page, 'Personal');
  await renameWorkspace(page, 'Home');
  await expect(page.getByText('Now called Home.')).toBeVisible();
  await openSharePage(page);
  const code = await shareWorkspace(page, 'Fandri');
  await dewi.goto(`/join#${code}`);
  const join = dewi.getByTestId('join-workspace');
  await expect(join.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Name').fill('Dewi');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });
}

const rowOf = (page: Page, description: string) => page.getByTestId('transaction-row').filter({ hasText: description });

test('a purchase split between a shared workspace and a private one reaches the partner as the shared part alone', async ({ page, browser }, info) => {
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);

  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await newWorkspace(page, 'Business', 'Copy from Personal');
  await openWorkspace(page, 'Personal');
  await shareHome(page, dewi);

  // Fandri, in Home: one charge, split with Business under the Split sheet.
  await page.goto('/transactions');
  await openWorkspace(page, 'Home');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Tahapan');
  await form.getByLabel('Note').fill('Toko Sumber Rejeki');
  await openSplit(page);
  const split = page.getByRole('dialog', { name: 'Split' });
  await addPart(page);
  await pickPartCategory(page, 1, 'Groceries');
  await fillPart(page, 1, '830000');
  // A shared workspace offers the private ones' categories, under each one's name.
  await pickPartCategory(page, 2, 'Restaurants', 'Business');
  await fillPart(page, 2, '417000');
  // A part in the open workspace (Home) says nothing of workspaces; one in another names it under its category.
  await expect(split.getByTestId('split-row').nth(0)).not.toContainText('Business');
  await expect(split.getByTestId('split-row').nth(1)).toContainText('Business');
  await split.getByRole('button', { name: 'Close' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // On Fandri's phone, as built: Home counts its part, the receipt the whole charge.
  await expect(rowOf(page, 'Toko Sumber Rejeki')).toContainText('830.000');
  await expect(rowOf(page, 'Toko Sumber Rejeki')).toContainText('⑂ split');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 830.000');

  // On Dewi's: the Home part alone, paid by Fandri from his account, nothing of Business or of the whole.
  await dewi.goto('/transactions');
  await eventually(dewi, () => expect(rowOf(dewi, 'Toko Sumber Rejeki')).toContainText('830.000', { timeout: 1_000 }));
  const theirs = rowOf(dewi, 'Toko Sumber Rejeki');
  await expect(theirs).toContainText('Groceries');
  await expect(theirs).toContainText('BCA Tahapan · paid by Fandri');
  await expect(theirs).not.toContainText('Restaurants');
  await expect(theirs).not.toContainText('⑂ split');
  await expect(dewi.getByTestId('period-total')).toHaveText('Rp 830.000');
  await dewi.getByRole('link', { name: 'Receipt for Toko Sumber Rejeki' }).click();
  await expect(dewi.getByTestId('hero-amount')).toContainText('830.000');
  await expect(dewi.locator('main')).not.toContainText('1.247.000');
  await expect(dewi.locator('main')).not.toContainText('417.000');
  await expect(dewi.locator('main')).not.toContainText('Business');
  await expect(dewi.getByTestId('split-part')).toHaveCount(0);

  // Dewi corrects the Home part: it comes back to Fandri's split, Business's part untouched, the charge their sum.
  await dewi.getByRole('button', { name: 'Edit this transaction' }).click();
  const sheet = dewi.getByRole('dialog', { name: 'Edit transaction' });
  await sheet.getByLabel('Amount', { exact: true }).fill('702000');
  await saveButton(sheet).click();
  await expect(sheet).toHaveCount(0);

  await page.goto('/transactions');
  await eventually(page, () => expect(rowOf(page, 'Toko Sumber Rejeki')).toContainText('702.000', { timeout: 1_000 }));
  await expect(page.getByTestId('period-total')).toHaveText('Rp 702.000');
  await page.getByRole('link', { name: 'Receipt for Toko Sumber Rejeki' }).click();
  await expect(page.getByTestId('hero-amount')).toContainText('1.119.000');
  const parts = page.getByTestId('split-part');
  await expect(parts).toHaveCount(2);
  await expect(parts.filter({ hasText: 'Business' })).toContainText('417.000');
  await expect(parts.filter({ hasText: 'Home' })).toContainText('702.000');

  await openWorkspace(page, 'Business');
  await page.goto('/transactions');
  await expect(rowOf(page, 'Toko Sumber Rejeki')).toContainText('417.000');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 417.000');
});
