import { expect, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';

/*
 * The wide screen's sidebar, option A of the Mac sidebar mockup (2026-11-17): three groups by job, the workspace's
 * accounts with compact balances (folding remembered), Tools and Settings at the foot, and a status line.
 */
test.beforeEach(async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('groups by job, accounts with balances, the fold remembered', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Satu', balance: '142500000' });
  await openCard(page, { name: 'Kartu Biru', owed: '8400000' });
  const side = page.locator('aside');
  const nav = side.getByRole('navigation', { name: 'Sections' });

  await expect(nav.getByRole('link')).toHaveText([/^Overview/, /^Cashflow/, /^Budget/, /^Bills/, /^Review/, /^Wallet/, /^Net worth/, /^Points/, /^Goals/, /^Events/, /^Debt-free plan/]);
  await expect(nav.getByText('Money', { exact: true })).toBeVisible();
  await expect(nav.getByText('Plans', { exact: true })).toBeVisible();
  // Nothing the old sidebar listed below the line is a row any more: Categories, Backup and Account are in Settings.
  for (const gone of ['Transactions', 'Categories', 'Backup', 'Account', 'Calculators', 'Tax report', 'Which card?', 'Import']) {
    await expect(nav.getByRole('link', { name: gone, exact: true })).toHaveCount(0);
  }

  // The end-to-end build starts Accounts folded (other journeys find accounts by name); opened, it stays open.
  await expect(nav.getByRole('button', { name: 'Show accounts' })).toHaveAttribute('aria-expanded', 'false');
  await nav.getByRole('button', { name: 'Show accounts' }).click();
  const bank = nav.getByRole('link', { name: /^Bank Satu/ });
  await expect(bank).toContainText('142,5 jt');
  await expect(nav.getByRole('link', { name: /^Kartu Biru/ })).toContainText('−8,4 jt');
  await bank.click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(bank).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(page.locator('aside').getByRole('link', { name: /^Bank Satu/ })).toBeVisible({ timeout: 30_000 });

  await page.locator('aside').getByRole('button', { name: 'Hide accounts' }).click();
  await expect(page.locator('aside').getByRole('button', { name: 'Show accounts' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('aside').getByRole('link', { name: /^Bank Satu/ })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('aside').getByRole('button', { name: 'Show accounts' })).toBeVisible({ timeout: 30_000 });

  // The status line says what is known: a personal workspace, never backed up.
  await expect(page.getByTestId('sidebar-status')).toHaveText('On this device · not backed up');
});

test('Cashflow is the old Transactions; Tools and Settings reach the rest', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Satu', balance: '1000000' });
  const side = page.locator('aside');
  await side.getByRole('link', { name: 'Cashflow', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(side.getByRole('link', { name: 'Cashflow', exact: true })).toHaveAttribute('aria-current', 'page');

  // Tools › opens the Tools page (Mac Settings and Tools, B); a tool's page keeps Tools lit.
  const tools = side.getByRole('link', { name: 'Tools', exact: true });
  await tools.click();
  await expect(page).toHaveURL(/\/tools$/);
  await expect(tools).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('tools-page').getByRole('link', { name: /^Tax report/ }).click();
  await expect(page).toHaveURL(/\/tax-report$/);
  await expect(tools).toHaveAttribute('aria-current', 'page');

  await tools.click();
  await page.getByRole('button', { name: /^Statement check/ }).click();
  await page.getByRole('menu', { name: /Statement check/ }).getByRole('menuitem', { name: 'Bank Satu' }).click();
  await expect(page).toHaveURL(/\/statement\/list\?account=/);

  await side.getByRole('link', { name: 'App settings', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();
  // What left the sidebar is one step into Settings: a section of its own (Mac Settings A).
  const sections = page.getByRole('navigation', { name: 'Settings sections' });
  for (const name of ['Categories', 'Backup', 'Activity']) await expect(sections.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();

  // The Mac app's cicis › Settings… raises this event; the page opens Settings from anywhere.
  await side.getByRole('link', { name: 'Budget', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cicis:open-settings')));
  await expect(page).toHaveURL(/\/account$/);
});
