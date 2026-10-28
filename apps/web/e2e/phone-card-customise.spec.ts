import { expect, test } from '@playwright/test';
import { openCard } from './accounts';
import { cardPage, cardSettingsPage, saveCardTerms } from './card-section';

const SHOTS = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('a linked card hides its rules in Settings until Customise rules sets it up by hand', async ({ page }) => {
  await openCard(page, { name: 'BCA KrisFlyer' });
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^BCA KrisFlyer(,|$)/ }).click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await page.getByLabel('Search catalogue').fill('krisflyer');
  await page.getByRole('button', { name: 'BCA KrisFlyer Visa Signature', exact: true }).click();
  await page.getByRole('button', { name: 'Use these terms' }).click();
  await expect(page.getByText('Step 2 of 3')).toHaveCount(0);

  // Some points already earned: a balance typed in on the programme page.
  await page.getByRole('button', { name: 'BCA KrisFlyer', exact: true }).click();
  await cardPage(page, 'Points');
  await page.getByTestId('statement-points-programme').click();
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Adjust' }).click();
  await page.getByLabel('Actual balance').fill('500');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('programme-balance')).toContainText('500');
  await page.goBack();
  await page.getByRole('button', { name: 'BCA KrisFlyer', exact: true }).click();
  await cardPage(page, 'Settings');

  // Linked: Earns into, Bank credits points and Caps reset only.
  const main = page.getByRole('main');
  await expect(main.getByLabel('Earns into')).toBeVisible();
  await expect(main.getByLabel('Bank credits points')).toBeVisible();
  await expect(main.getByText('Caps reset')).toBeVisible();
  await expect(main.getByRole('button', { name: /^Earning rules/ })).toHaveCount(0);
  await expect(main.getByRole('button', { name: /^Spend bonuses/ })).toHaveCount(0);
  await expect(main.getByRole('button', { name: /^Programme/ })).toHaveCount(0);
  await expect(main.getByTestId('points-balance')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/card-customise-1.png`, fullPage: true });

  // Card product: read-only, with the one action row.
  await cardSettingsPage(page, 'Card product');
  await expect(page.getByText('From catalogue · Linked')).toBeVisible();
  await expect(page.getByText('Card terms, welcome bonus, and notes')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/card-customise-2.png`, fullPage: true });
  await page.getByRole('button', { name: 'Customise rules' }).click();

  // Now set up by hand, with nothing to choose from but the catalogue.
  await expect(page.getByText('Set up by hand')).toBeVisible();
  await expect(page.getByText('From catalogue · Linked')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Customise rules' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(main.getByRole('button', { name: /^Earning rules/ })).toContainText('0');
  await expect(main.getByRole('button', { name: /^Spend bonuses/ })).toContainText('0');

  // The points already earned are still in the programme's balance.
  await page.getByRole('button', { name: 'BCA KrisFlyer', exact: true }).click();
  await cardPage(page, 'Points');
  await expect(page.getByTestId('statement-points-balance')).toContainText('500');
});
