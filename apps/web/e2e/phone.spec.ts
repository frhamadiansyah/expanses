import { expect, type Page, test } from '@playwright/test';
import { MORE_GROUPS, REACHABLE, TABS } from '../src/app/nav';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

/** Anything a finger is meant to hit must be at least this tall or wide. */
const TAP = 44;

async function settle(page: Page) {
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

test('the tab bar carries the three places, the add button and the account', async ({ page }) => {
  await page.goto('/');
  await settle(page);
  const bar = page.getByRole('navigation', { name: 'Main' });
  for (const tab of TABS) await expect(bar.getByRole('link', { name: tab.label })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Add a transaction' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Account' })).toBeVisible();
  // The ten-item bar is gone: nothing else hides in there.
  await expect(bar.getByRole('link')).toHaveCount(TABS.length);
});

test('every screen is reachable on a phone, through a tab or through More', async ({ page }) => {
  await page.goto('/');
  await settle(page);
  const bar = page.getByRole('navigation', { name: 'Main' });
  const reachable = new Set<string>();
  for (const tab of TABS) reachable.add(await bar.getByRole('link', { name: tab.label }).getAttribute('href') ?? '');

  await bar.getByRole('button', { name: 'Account' }).click();
  const sheet = page.getByRole('dialog', { name: 'Account' });
  for (const group of MORE_GROUPS) {
    for (const item of group.items) {
      // Backup and Review carry a note in their name ("Backup · today"), so match on the label alone.
      const link = sheet.getByRole('link', { name: new RegExp(`^${item.label}`) });
      await expect(link).toBeVisible();
      reachable.add((await link.getAttribute('href')) ?? '');
    }
  }
  for (const route of REACHABLE) expect(reachable).toContain(route);
});

test('the account sheet opens a screen that had no phone route before, and closing it comes back', async ({ page }) => {
  await page.goto('/');
  await settle(page);
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('link', { name: 'Tax report' }).click();
  await expect(page.getByRole('heading', { name: /tax/i }).first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Account' })).toHaveCount(0);

  // And the sheet itself closes without going anywhere.
  await page.getByRole('button', { name: 'Account' }).click();
  await expect(page.getByRole('dialog', { name: 'Account' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: 'Account' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/tax-report$/);
});

test('a purchase is recorded from the add button without leaving the screen', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });

  await page.goto('/cards');
  await settle(page);
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '250000' });
  await expect(page).toHaveURL(/\/cards$/);
  await page.goto('/transactions');
  await expect(page.getByText('Superindo').first()).toBeVisible();
});

test('the phone header adds, searches and filters from three round buttons', async ({ page }) => {
  await page.goto('/transactions');
  await settle(page);
  // At rest the list starts straight after the title: no search field, no filter chips on show.
  await expect(page.getByLabel('Search transactions')).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^Month/ })).not.toBeVisible();

  // Search takes the header over: one field and a way out, until closing it gives the title back.
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByLabel('Search transactions')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Filters' })).toHaveCount(0);
  await page.getByLabel('Search transactions').fill('nothing like it');
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page.getByLabel('Search transactions')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Cashflow' })).toBeVisible();

  // ⋯ is a short menu on a phone: the chart already chooses the period and the category.
  await page.getByRole('button', { name: 'Filters' }).click();
  const menu = page.getByTestId('filters-menu');
  await expect(menu.getByRole('menuitem', { name: /Paid with/ })).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: /Show deleted/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Month/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close filters' }).click();

  // The header's + opens the same form the tab bar's does.
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Add a transaction' }).getByLabel('Note')).toBeVisible();
});

test('the month’s chart leads the list, and a category opens as its own screen', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '9000000' });

  await page.goto('/transactions');
  await settle(page);
  // The tab bar's + opens the form as a sheet over whatever screen you are on.
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '250000' });

  // The chart sits above the list, on the same page: no view to switch to.
  const chart = page.getByTestId('spending-report');
  await expect(chart).toBeVisible();

  // The month is moved from the chart itself, and the list follows it.
  const thisMonth = await chart.getByTestId('chart-month').textContent();
  await chart.getByRole('button', { name: 'Earlier period' }).click();
  await expect(chart.getByTestId('chart-month')).not.toHaveText(thisMonth ?? '');
  await expect(page).toHaveURL(/month=/);
  await expect(chart.getByTestId('chart-month')).toBeVisible();
  await chart.getByRole('button', { name: 'Later period' }).click({ force: true });
  await expect(chart.getByTestId('chart-month')).toHaveText(thisMonth ?? '');
  await expect(page.getByTestId('statement-line')).toHaveCount(0);

  // Its categories are folded away until asked for, and fold back again.
  await chart.getByTestId('see-categories').click();
  await expect(chart.getByTestId('report-row').first()).toBeVisible();
  await chart.getByTestId('hide-categories').click();
  await expect(chart.getByTestId('report-row')).toHaveCount(0);
  await chart.getByTestId('see-categories').click();
  await chart.getByTestId('report-row').first().click();
  await expect(page.getByRole('button', { name: 'All transactions' })).toBeVisible();

  await page.getByRole('button', { name: 'All transactions' }).click();
  await expect(page.getByRole('heading', { name: 'Cashflow' })).toBeVisible();
});

test('no screen scrolls sideways at phone width', async ({ page }) => {
  for (const route of REACHABLE) {
    await page.goto(route);
    await settle(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
  }
});

test('everything in the tab bar is big enough to hit', async ({ page }) => {
  await page.goto('/');
  await settle(page);
  const bar = page.getByRole('navigation', { name: 'Main' });
  const targets = await bar.getByRole('link').all();
  targets.push(...(await bar.getByRole('button').all()));
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.min(box!.width, box!.height), `${await target.textContent()} is ${box!.width}×${box!.height}`).toBeGreaterThanOrEqual(TAP);
  }
});
