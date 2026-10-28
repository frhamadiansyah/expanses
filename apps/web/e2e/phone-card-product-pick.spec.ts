import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { cardPage } from './card-section';

const SHOTS = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function openSettings(page: Page, name: string) {
  await openCard(page, { name });
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: new RegExp(`^${name}(,|$)`) }).click();
  await cardPage(page, 'Settings');
}

test('a new card without a product: Settings holds its own facts, the product is chosen on pages of its own', async ({ page }) => {
  await openSettings(page, 'Visa Gold');
  const main = page.getByRole('main');

  // Only the card's facts: no catalogue list, no manual form, no step caption, no Points group.
  await expect(main.getByRole('button', { name: /^Card product\s*Choose/ })).toBeVisible();
  await expect(main.getByText('Is this card in the catalogue?')).toHaveCount(0);
  await expect(main.getByLabel('Search catalogue')).toHaveCount(0);
  await expect(main.getByText('Or set up manually')).toHaveCount(0);
  await expect(main.getByText(/Step \d of 3/)).toHaveCount(0);
  await expect(main.getByText('Points', { exact: true })).toHaveCount(0);
  await expect(main.getByText('The billing date decides which purchases count toward each points cycle.')).toBeVisible();
  await expect(main.getByText('Rewards, earning rules and spend bonuses appear here once a card product is chosen.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/product-pick-1-settings.png`, fullPage: true });

  // The list, with its search and the way out.
  await main.getByRole('button', { name: /^Card product/ }).click();
  await expect(page.getByRole('heading', { name: 'Card product', exact: true }).first()).toBeVisible();
  await expect(main.getByText(/^\d+ cards$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'My card is not listed' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/product-pick-2-list.png`, fullPage: true });
  await page.getByLabel('Search card or bank').fill('krisflyer');
  await expect(main.getByText(/^\d+ cards?$/)).toBeVisible();
  await main.getByRole('button', { name: /^BCA KrisFlyer Visa Signature/ }).click();

  // The preview: what it earns, with one button to use it.
  await expect(page.getByRole('heading', { name: 'BCA KrisFlyer Visa Signature', exact: true }).first()).toBeVisible();
  await expect(main.getByText('This card', { exact: true })).toBeVisible();
  await expect(main.getByText('What it earns', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: /^Earning rules/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/product-pick-3-preview.png`, fullPage: true });
  await page.getByRole('button', { name: 'Use this card' }).click();

  // Back on Settings with the product filled and the Points group there.
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).first()).toBeVisible();
  await expect(main.getByRole('button', { name: /^Card product\s*BCA Singapore Airlines KrisFlyer/ })).toBeVisible();
  await expect(main.getByText('Points', { exact: true })).toBeVisible();
  await expect(main.getByLabel('Bank credits points')).toBeVisible();
  await expect(main.getByText('Rewards, earning rules and spend bonuses appear here once a card product is chosen.')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/product-pick-5-done.png`, fullPage: true });
});

test('a card that is not listed is set up by hand on a page of its own, with its rules rows under it', async ({ page }) => {
  await openSettings(page, 'Home Card');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: /^Card product/ }).click();
  await page.getByRole('button', { name: 'My card is not listed' }).click();
  await expect(page.getByRole('heading', { name: 'Set up by hand', exact: true }).first()).toBeVisible();
  await expect(main.getByRole('button', { name: /^Earning rules/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/product-pick-4-by-hand.png`, fullPage: true });
  await page.getByLabel('Earns').selectOption({ label: 'Miles' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(main.getByRole('button', { name: /^Earning rules/ })).toContainText('0');
  await expect(main.getByRole('button', { name: /^Spend bonuses/ })).toContainText('0');

  // Settings now names the product and holds the Points group.
  await page.getByRole('button', { name: 'Card product' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(main.getByRole('button', { name: /^Card product\s*Home Card rewards/ })).toBeVisible();
  await expect(main.getByRole('button', { name: /^Earning rules/ })).toBeVisible();
});
