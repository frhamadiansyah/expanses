import { expect, test } from '@playwright/test';
import { openCard, walletCard } from './accounts';
import { cardPage, saveCardTerms, setUpRewardsByHand } from './card-section';

test('a new card: Settings holds its terms, then its rewards are set up by hand on a page of their own, with a suggested base rule', async ({ page }) => {
  // The card's own page is where a card taken from the catalogue is finished; this one is typed by hand.
  await openCard(page, { name: 'Step Card' });

  await page.getByRole('navigation').getByRole('link', { name: 'Wallet', exact: true }).click();
  const cardRow = page.getByRole('region', { name: 'Cards' });
  await expect(cardRow).toContainText('Add billing date to see points');
  await walletCard(page, 'Step Card').click();
  await cardPage(page, 'Settings');

  // Only the card's own facts: no step caption, no rewards form, no rules.
  await expect(page.getByText(/Step \d of 3/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set up rewards' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Earning rules/ })).toHaveCount(0);

  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);

  // The rewards program, by hand, then the first rule, pre-filled as a base rule.
  await setUpRewardsByHand(page);
  await page.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.getByLabel('Rule name')).toHaveValue('Base');
  await expect(page.getByLabel('Points', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Per spend')).toHaveValue('2.500');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('1 per Rp')).toBeVisible();
});

test('the corner check on a new card needs both dates, keeps what was typed, and stays on the page once they are saved', async ({ page }) => {
  await openCard(page, { name: 'Check Card' });
  await page.getByRole('navigation').getByRole('link', { name: 'Wallet', exact: true }).click();
  await walletCard(page, 'Check Card').click();
  await cardPage(page, 'Settings');
  const heading = page.getByRole('heading', { name: 'Settings', exact: true }).first();
  const check = page.getByRole('button', { name: 'Save', exact: true });

  // One date only: said, kept, and the page stays.
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Credit limit').fill('5000000');
  await check.click();
  await expect(page.getByText('Enter the billing date and the due date')).toBeVisible();
  await expect(page.getByLabel('Billing date')).toHaveValue('25');
  await expect(page.getByLabel('Credit limit')).toHaveValue('5.000.000');
  await expect(heading).toBeVisible();

  // Both dates: saved with the limit, and the page goes back to the card.
  await page.getByLabel('Due date').fill('12');
  await check.click();
  await expect(page.getByText('Enter the billing date and the due date')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Actions' })).toBeVisible();
  await cardPage(page, 'Settings');
  await expect(page.getByLabel('Billing date')).toHaveValue('25');
  await expect(page.getByLabel('Credit limit')).toHaveValue('5.000.000');
});

test('a settled card saves its edited terms with the corner check and goes back to the card', async ({ page }) => {
  await openCard(page, { name: 'Settled Card' });
  await page.getByRole('navigation').getByRole('link', { name: 'Wallet', exact: true }).click();
  await walletCard(page, 'Settled Card').click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await setUpRewardsByHand(page);
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('1 per Rp')).toBeVisible();
  await page.goto('/wallet');
  await walletCard(page, 'Settled Card').click();

  await cardPage(page, 'Settings');
  await page.getByLabel('Credit limit').fill('7000000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Actions' })).toBeVisible();
  await cardPage(page, 'Settings');
  await expect(page.getByLabel('Credit limit')).toHaveValue('7.000.000');
});
