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

  await expect(nav.getByRole('link')).toHaveText([/^Cashflow/, /^Budget/, /^Bills/, /^Review/, /^Wallet/, /^Net worth/, /^Points/, /^Goals/, /^Events/, /^Debt-free plan/]);
  await expect(nav.getByText('Money', { exact: true })).toBeVisible();
  await expect(nav.getByText('Plans', { exact: true })).toBeVisible();
  // Nothing the old sidebar listed below the line is a row any more: Categories, Backup and Account are in Settings.
  for (const gone of ['Transactions', 'Categories', 'Backup', 'Account', 'Calculators', 'Tax report', 'Which card?', 'Import']) {
    await expect(nav.getByRole('link', { name: gone, exact: true })).toHaveCount(0);
  }

  // The end-to-end build starts Accounts folded (other journeys find accounts by name); opened, it stays open.
  const accounts = nav.getByRole('button', { name: 'Accounts' });
  await expect(accounts).toHaveAttribute('aria-expanded', 'false');
  await accounts.click();
  const bank = nav.getByRole('link', { name: /^Bank Satu/ });
  await expect(bank).toContainText('142,5 jt');
  await expect(nav.getByRole('link', { name: /^Kartu Biru/ })).toContainText('−8,4 jt');
  await bank.click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(bank).toHaveAttribute('aria-current', 'page');

  await accounts.click();
  await expect(accounts).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('link', { name: /^Bank Satu/ })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('aside').getByRole('button', { name: 'Accounts' })).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 });
  await page.locator('aside').getByRole('button', { name: 'Accounts' }).click();
  await expect(page.locator('aside').getByRole('link', { name: /^Bank Satu/ })).toBeVisible();

  // The status line says what is known: a personal workspace, never backed up.
  await expect(page.getByTestId('sidebar-status')).toHaveText('On this device · not backed up');
});

test('Cashflow is the old Transactions; Tools and Settings reach the rest', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Satu', balance: '1000000' });
  const side = page.locator('aside');
  await side.getByRole('link', { name: 'Cashflow', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(side.getByRole('link', { name: 'Cashflow', exact: true })).toHaveAttribute('aria-current', 'page');

  const tools = side.getByRole('button', { name: 'Tools' });
  await tools.click();
  const menu = page.getByRole('menu', { name: 'Tools' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Calculators', 'Which card?', 'Tax report', 'Import', /^Statement check/]);
  await menu.getByRole('menuitem', { name: 'Tax report' }).click();
  await expect(page).toHaveURL(/\/tax-report$/);
  await expect(menu).toHaveCount(0);

  await tools.click();
  await menu.getByRole('menuitem', { name: /^Statement check/ }).click();
  await menu.getByRole('menuitem', { name: 'Bank Satu' }).click();
  await expect(page).toHaveURL(/\/statement\/list\?account=/);

  await tools.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await side.getByRole('link', { name: 'App settings', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();
  // What left the sidebar is one step into Settings.
  for (const name of ['Categories', 'Backup', 'Activity']) await expect(page.getByRole('main').getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();

  // The Mac app's cicis › Settings… raises this event; the page opens Settings from anywhere.
  await side.getByRole('link', { name: 'Budget', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cicis:open-settings')));
  await expect(page).toHaveURL(/\/account$/);
});
