import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { cardPage, saveCardTerms, showCardBack, startPlan, setUpRewardsByHand } from './card-section';

const SHOTS = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad';

/** A credit card with a billing date, a fee, a points programme and a base rule: set up, so it opens on the summary. */
async function addEarningCard(page: Page, name: string) {
  await openCard(page, { name });
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: new RegExp(`^${name}(,|$)`) }).click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByLabel('Annual fee').fill('750000');
  await saveCardTerms(page);
  await setUpRewardsByHand(page);
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
}

test('the card page keeps the tile, the buttons and the latest; fee, rewards and points moved behind the buttons and the cog', async ({ page }) => {
  await addEarningCard(page, 'Simple Card');
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^Simple Card(,|$)/ }).click();

  // The card page: no fee, rewards or points rows (the points are on the card's back); no Instalments box while there is no plan.
  await showCardBack(page);
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('Outstanding');
  await expect(page.getByTestId('card-annual-fee')).toHaveCount(0);
  await expect(page.getByTestId('card-rewards-setup')).toHaveCount(0);
  await expect(page.getByTestId('this-statement-points')).toHaveCount(0);
  await expect(page.getByTestId('card-instalments')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a plan' })).toHaveCount(0);
  await expect(page.getByTestId('latest-transactions')).toBeVisible();

  // Card settings: the fee is in the terms (its status row needs a Charged on date), the programme in Points, and
  // Instalments is a small group of its own, saying None.
  await cardPage(page, 'Settings');
  const main = page.getByRole('main');
  await expect(page.getByRole('heading', { name: 'Annual fee', exact: true })).toBeVisible();
  await expect(page.getByLabel('Annual fee')).toHaveValue('750.000');
  await expect(main.getByTestId('card-annual-fee')).toHaveCount(0);
  await expect(main.getByLabel('Earns into')).toContainText('Simple Card rewards');
  await expect(main.getByTestId('card-instalments-row')).toContainText('None');
  await page.screenshot({ path: `${SHOTS}/card-page-new-3.png`, fullPage: true });

  // The first plan: Instalments, then the plus.
  await main.getByTestId('card-instalments-row').click();
  await expect(page.getByRole('heading', { name: 'Instalments', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Add a plan' }).click();
  const sheet = page.getByRole('dialog', { name: 'New instalment plan' });
  await sheet.getByLabel('What it was').fill('Laptop');
  await sheet.getByLabel(/^Total/).fill('9000000');
  await sheet.getByLabel('Months').fill('12');
  await sheet.getByRole('button', { name: 'Save plan' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('card-instalment')).toContainText('Laptop');
  await page.screenshot({ path: `${SHOTS}/card-page-new-4.png`, fullPage: true });

  // Settings now counts it; the card page shows the box, with no Add a plan row (plans are added from Settings).
  await page.goBack();
  await expect(page.getByTestId('card-instalments-row')).toContainText('1 plan');
  await page.goBack();
  await expect(page.getByTestId('card-instalments')).toBeVisible();
  await expect(page.getByTestId('card-instalments').getByRole('button', { name: 'Add a plan' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/card-page-new-1.png`, fullPage: true });

  // The Points button opens the statement points page, with the programme's row on top.
  await page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Points', exact: true }).click();
  await expect(page.getByRole('heading', { name: "This statement's points", exact: true }).first()).toBeVisible();
  const row = page.getByTestId('statement-points-programme');
  await expect(row).toContainText('Simple Card rewards');
  await expect(row).toContainText('0 points');
  await page.screenshot({ path: `${SHOTS}/card-page-new-2.png`, fullPage: true });

  // The row opens the programme page; back returns to the statement points page.
  await row.click();
  await expect(page.getByTestId('programme-hero')).toBeVisible();
  const buttons = page.getByRole('group', { name: 'Actions' });
  await expect(buttons.getByText('Convert')).toBeVisible();
  await expect(buttons.getByText('Adjust')).toBeVisible();
  await expect(buttons.getByText('Expiry')).toBeVisible();
  await expect(buttons.getByText('Settings')).toBeVisible();
  await expect(buttons.getByText('Redeem')).toHaveCount(0);
  await expect(buttons.getByText('Worth')).toHaveCount(0);
  await page.getByRole('button', { name: 'Points', exact: true }).click();
  await expect(page.getByRole('heading', { name: "This statement's points", exact: true }).first()).toBeVisible();
});

test('a plan added and removed from the Instalments page shows and hides the box on the card page', async ({ page }) => {
  await addEarningCard(page, 'Plan Card');
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^Plan Card(,|$)/ }).click();
  await expect(page.getByTestId('card-instalments')).toHaveCount(0);

  await startPlan(page);
  const sheet = page.getByRole('dialog', { name: 'New instalment plan' });
  await sheet.getByLabel('What it was').fill('Sofa');
  await sheet.getByLabel(/^Total/).fill('12000000');
  await sheet.getByLabel('Months').fill('12');
  await sheet.getByRole('button', { name: 'Save plan' }).click();
  await expect(sheet).toHaveCount(0);

  // Removed from the plan's own page: back to the Instalments page saying None, and the card page loses the box.
  await page.getByRole('button', { name: 'Open Sofa' }).click();
  await page.getByRole('button', { name: 'Edit plan' }).click();
  await page.getByRole('dialog', { name: 'Edit instalment plan' }).getByRole('button', { name: 'Remove plan' }).click();
  await page.getByRole('alertdialog', { name: 'Remove plan' }).getByRole('button', { name: 'Remove plan' }).click();
  await expect(page.getByTestId('card-instalment')).toHaveCount(0);
  await page.goBack();
  await page.goBack();
  await showCardBack(page);
  await expect(page.getByTestId('tile-left-to-pay')).toBeVisible();
  await expect(page.getByTestId('card-instalments')).toHaveCount(0);
});
