import { expect, type Page, test } from '@playwright/test';
import { MORE_GROUPS, REACHABLE, TABS } from '../src/app/nav';
import { openAccount } from './accounts';
import { addTransaction, addForm } from './add-transaction';
import { setBudget } from './budget';

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
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('link', { name: 'Tax report' }).click();
  await expect(page.getByRole('heading', { name: /tax/i }).first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Account' })).toHaveCount(0);

  // And the sheet itself closes without going anywhere.
  await page.getByRole('button', { name: 'Account', exact: true }).click();
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
  const header = page.locator('header').first();
  const restHeader = (await header.boundingBox())!;
  const titleAt = (await page.getByRole('heading', { name: 'Cashflow' }).boundingBox())!;
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByLabel('Search transactions')).toBeFocused();
  // The field is drawn in the title's own row rather than in place of the header, so nothing below it moves: the
  // header keeps its height and the row its top, which is what keeps the chart and the list where the thumb left
  // them. (The input's own box is centred inside its 44 px capsule, so the capsule is what is measured.)
  const openHeader = (await header.boundingBox())!;
  const fieldAt = (await page.getByLabel('Search transactions').locator('..').boundingBox())!;
  expect(Math.round(openHeader.height)).toBe(Math.round(restHeader.height));
  expect(Math.abs(fieldAt.y - titleAt.y)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Filters' })).toHaveCount(0);
  await page.getByLabel('Search transactions').fill('nothing like it');
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page.getByLabel('Search transactions')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Cashflow' })).toBeVisible();

  // ⋯ is a short menu on a phone, and it is no longer a filter menu: the chart chooses the period, what paid is a
  // filter beside the list's own Sort, what is not recorded has the review box above the rows, and revealing
  // deleted rows is a wide screen's business. What is left is the one thing only this menu can do.
  await page.getByRole('button', { name: 'Filters' }).click();
  const menu = page.getByTestId('filters-menu');
  await expect(menu.getByTestId('workspace-row')).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: /Show deleted/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /Paid with/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /Not recorded/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Month/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close filters' }).click();

  // The header's + opens the same form the tab bar's does.
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  await expect(addForm(page).getByLabel('Note')).toBeVisible();
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

/**
 * The chart card is one height whichever side of the ledger it is showing.
 *
 * What moved was never the ring — it is drawn from a fixed shape and comes out the same size either way — but the pager's
 * own strip, which exists because the budget gauge does, and the gauge only exists for money going out over a month. The
 * strip is furniture now, kept whether there is a second page to turn to or not, so the list under the chart stays put
 * and nothing is resized to fit.
 */
test('the chart card keeps its height when the month is read the other way', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '500000' });
  await addTransaction(page, { mode: 'Income', description: 'Gaji', paidWith: 'BCA Tahapan', category: 'Salary', amount: '30000000' });

  // A budget, so the outgoing side really does have a second page to turn to — which is the difference being measured.
  await page.goto('/budget');
  await setBudget(page, 'Food and beverage', '300000');
  await page.goto('/transactions');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  const card = page.getByTestId('spending-report').locator('section').first();
  const ring = card.locator('svg[role="img"]').first();
  await expect(ring).toBeVisible();
  const expense = (await card.boundingBox())!;
  const expenseRing = (await ring.boundingBox())!;

  await page.getByRole('button', { name: 'Show income' }).click();
  await expect(page.getByRole('button', { name: 'Show income' })).toHaveAttribute('aria-pressed', 'true');
  const income = (await card.boundingBox())!;
  const incomeRing = (await ring.boundingBox())!;

  // The card, to the pixel — and the ring itself untouched, which is the whole point of it: nothing is resized to fit.
  expect(Math.abs(income.height - expense.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(incomeRing.height - expenseRing.height)).toBeLessThanOrEqual(1);
});

/**
 * The list under the chart ends where the card's own padding begins.
 *
 * A row is floored at 48 so a thumb can find it, and that floor is not all content: the few pixels it has over are a
 * row's business *between* rows, not under the last one, where they stack on top of the card's padding and leave a strip
 * of white wider than the one above the month pill. The last row hands back both, so the two strips are the same.
 */
test('the list under the chart is padded like the top of the card', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '250000' });
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '40000' });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  const chart = page.getByTestId('spending-report');
  await chart.getByTestId('see-categories').click();
  await expect(chart.getByTestId('report-row').first()).toBeVisible();

  const gaps = await chart.evaluate((report) => {
    const card = report.querySelector('section');
    const pill = report.querySelector('[data-testid="chart-month"]');
    const rows = [...report.querySelectorAll('[data-testid="report-row"]')];
    if (!card || !pill || rows.length < 2) throw new Error('the card is not showing a list');
    const cardBox = card.getBoundingClientRect();
    // A row's content, not the row's box: the box carries the floor and the thumb's padding around it.
    const content = (row: Element) => row.firstElementChild!.getBoundingClientRect();
    const lastContent = content(rows[rows.length - 1]!);
    return {
      above: Math.round(pill.getBoundingClientRect().top - cardBox.top),
      below: Math.round(cardBox.bottom - lastContent.bottom),
      between: Math.round(content(rows[1]!).top - content(rows[0]!).bottom),
    };
  });

  expect(Math.abs(gaps.below - gaps.above), `the strip under the list is ${gaps.below} against the card's ${gaps.above}`).toBeLessThanOrEqual(1);
  // And the rows keep their own spacing, so the last one handing its floor back changed nothing above it.
  expect(gaps.between).toBeGreaterThan(gaps.above);
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
