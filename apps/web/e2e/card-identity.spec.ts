import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addCard(page: Page, name: string, bank: string, last4: string, expectSuccess = true) {
  await openCard(page, { name, bank, last4, expectSuccess });
  // The walk lands on the card's own page; the accounts list is where its line and its digits are read.
  if (expectSuccess) await page.goto('/accounts');
}

test('a card carries its bank and its last four digits', async ({ page }) => {
  await addCard(page, 'Mandiri Bonvoy', 'Mandiri', '1467');
  await expect(page.getByRole('link', { name: 'Mandiri Bonvoy', exact: true })).toBeVisible();

  // The digits are what tell two cards on one statement apart, so they show where the cards are: on the card's
  // own face in the wallet stack, and on the line under it that names the card.
  await page.goto('/cards');
  await expect(page.getByTestId('card-face')).toContainText('1467');
  await expect(page.locator('section', { has: page.getByRole('link', { name: /^Mandiri Bonvoy(,|$)/ }) })).toContainText('···· 1467');
});

test('the same digits are refused at the same bank, and allowed at another', async ({ page }) => {
  await addCard(page, 'Mandiri Bonvoy', 'Mandiri', '1467');
  await expect(page.getByRole('link', { name: 'Mandiri Bonvoy', exact: true })).toBeVisible();

  // A second Mandiri card ending 1467 is the same card typed twice.
  await addCard(page, 'Mandiri Prioritas', 'Mandiri', '1467', false);
  await expect(page.getByText(/already recorded for Mandiri/)).toBeVisible();
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Mandiri Prioritas', exact: true })).toHaveCount(0);

  // Another bank ending 1467 is a different card, and is fine.
  await addCard(page, 'BCA KrisFlyer', 'BCA', '1467');
  await expect(page.getByRole('link', { name: 'BCA KrisFlyer', exact: true })).toBeVisible();
});

test('a card needs neither a bank nor digits', async ({ page }) => {
  await openCard(page, { name: 'Plain Card' });
});
