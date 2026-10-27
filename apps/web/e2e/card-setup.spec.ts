import { expect, test } from '@playwright/test';
import { openCard, walletCard } from './accounts';
import { cardPage, saveCardTerms } from './card-section';

test('card setup guides billing date, then rewards, then a suggested base rule', async ({ page }) => {
  // The card's own page is where a card taken from the catalogue is finished; this one is typed by hand.
  await openCard(page, { name: 'Step Card' });

  // The summary says which step the card is at; the step itself is done in the card's Settings.
  await expect(page.getByTestId('card-setup')).toContainText('Step 1 of 3');

  await page.getByRole('navigation').getByRole('link', { name: 'Wallet', exact: true }).click();
  const cardRow = page.getByRole('region', { name: 'Cards' });
  await expect(cardRow).toContainText('Add billing date to see points');
  await walletCard(page, 'Step Card').click();
  await cardPage(page, 'Settings');

  // Step 1: only card terms until the billing date exists.
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up rewards' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(0);

  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);

  // Step 2: rewards program.
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Set up rewards' }).click();

  // Step 3: first rule is pre-filled as a base rule.
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.getByLabel('Rule name')).toHaveValue('Base');
  await expect(page.getByLabel('Points', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Per spend (IDR)')).toHaveValue('2500');
  await page.getByRole('button', { name: 'Save rule' }).click();

  // Set up: the step is gone, and the rule is counted under the card's points settings.
  await expect(page.getByText('Step 3 of 3')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Earning rules/ })).toContainText('1');
  await page.getByRole('link', { name: /^Earning rules/ }).click();
  await expect(page.getByText('1 per Rp')).toBeVisible();

  // Back on the summary there is no step left to finish.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Step Card' }).click();
  await expect(page.getByTestId('this-statement-points')).toBeVisible();
  await expect(page.getByTestId('card-setup')).toHaveCount(0);
});

test('the corner check on a card being set up needs both dates, keeps what was typed, and moves to the next step in place', async ({ page }) => {
  await openCard(page, { name: 'Check Card' });
  await page.getByRole('navigation').getByRole('link', { name: 'Wallet', exact: true }).click();
  await walletCard(page, 'Check Card').click();
  await cardPage(page, 'Settings');
  const heading = page.getByRole('heading', { name: 'Settings', exact: true }).first();
  const check = page.getByRole('button', { name: 'Save', exact: true });

  // One date only: said, kept, and the page stays.
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Credit limit (IDR)').fill('5000000');
  await check.click();
  await expect(page.getByText('Enter the billing date and the due date')).toBeVisible();
  await expect(page.getByLabel('Billing date')).toHaveValue('25');
  await expect(page.getByLabel('Credit limit (IDR)')).toHaveValue('5000000');
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await expect(heading).toBeVisible();

  // Both dates: saved with the limit, and the page stays at step 2.
  await page.getByLabel('Due date').fill('12');
  await check.click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await expect(heading).toBeVisible();
  await expect(page.getByLabel('Billing date')).toHaveValue('25');
  await expect(page.getByLabel('Credit limit (IDR)')).toHaveValue('5000000');
  await expect(page.getByText('Enter the billing date and the due date')).toHaveCount(0);
});

test('a settled card saves its edited terms with the corner check and goes back to the card', async ({ page }) => {
  await openCard(page, { name: 'Settled Card' });
  await page.getByRole('navigation').getByRole('link', { name: 'Wallet', exact: true }).click();
  await walletCard(page, 'Settled Card').click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await page.getByRole('button', { name: 'Set up rewards' }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('Step 3 of 3')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('this-statement-points')).toBeVisible();

  await cardPage(page, 'Settings');
  await page.getByLabel('Credit limit (IDR)').fill('7000000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('this-statement-points')).toBeVisible();
  await cardPage(page, 'Settings');
  await expect(page.getByLabel('Credit limit (IDR)')).toHaveValue('7000000');
});
