import { expect, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { openDrawers } from './drawers';

test('card purchase counts once as spending; the statement is paid from the card', async ({ page }) => {
  await page.goto('/accounts');

  await openAccount(page, { subtype: 'bank', name: 'BCA Checking', balance: '20000000' });
  await openCard(page, { name: 'BCA Visa' });

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Visa', category: 'Groceries', amount: '500000' });
  await expect(page.getByText('Superindo')).toBeVisible();

  // The statement is paid from the card's own Pay, not a transfer: a card is never somewhere a transfer lands.
  await page.goto('/net-worth/loans');
  await openDrawers(page);
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  const tile = page.getByTestId('tile-left-to-pay');
  await tile.getByRole('button', { name: 'Pay', exact: true }).click();
  await tile.getByLabel('Amount (IDR)').fill('500000');
  await tile.getByRole('button', { name: 'Record payment' }).click();
  await expect(tile.getByTestId('tile-unpaid-balance')).toHaveText('Rp 0');

  await page.goto('/spending');
  await expect(page.getByTestId('period-total')).toContainText('500.000');

  await page.goto('/');
  await expect(page.getByTestId('net-worth')).toContainText('19.500.000');
});
