import { expect, type Page, test } from '@playwright/test';
import { addPlastic, openAccount, openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage } from './card-section';

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });
const tick = (page: Page, what: string) => page.getByRole('checkbox', { name: `Select ${what}` });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected transactions' });

async function openActions(page: Page) {
  await bar(page).getByRole('button', { name: 'Actions' }).click();
  return page.getByRole('menu', { name: 'Actions' });
}

/**
 * Set card in select mode: purchases recorded before a second card was added name no card, and ticking them sets them
 * all to one. Offered only while every ticked row is on one credit card account carrying more than one card.
 */
test('ticked purchases on one card account are set to one of its cards at once', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await openCard(page, { name: 'Nusa Visa', owed: '0' });

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Sate Klathak', paidWith: 'Nusa Visa', category: 'Restaurants', amount: '65000' });
  await addTransaction(page, { description: 'Toko Roti', paidWith: 'Nusa Visa', category: 'Groceries', amount: '38000' });
  await addTransaction(page, { description: 'Pasar Pagi', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '52000' });

  // Two cards on the account, recorded after the purchases.
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^Nusa Visa(,|$)/ }).click();
  await cardPage(page, 'Settings');
  await addPlastic(page, '1467');
  await expect(page.getByTestId('card-on-account')).toHaveCount(1);
  await addPlastic(page, '8820');
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(bar(page)).toBeVisible();

  // A row off the card among the ticked ones: nothing to set.
  await tick(page, 'Sate Klathak').click();
  await tick(page, 'Pasar Pagi').click();
  let menu = await openActions(page);
  await expect(menu.getByRole('menuitem', { name: 'Set card' })).toHaveCount(0);
  await bar(page).getByRole('button', { name: 'Actions' }).click();

  await tick(page, 'Pasar Pagi').click();
  await tick(page, 'Toko Roti').click();
  menu = await openActions(page);
  await menu.getByRole('menuitem', { name: 'Set card' }).click();
  const sheet = page.getByRole('dialog', { name: 'Set card' });
  await expect(sheet.getByRole('button', { name: 'Primary ···· 1467' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Supplementary ···· 8820' }).click();

  await expect(bar(page)).toHaveCount(0);
  await expect(row(page, 'Sate Klathak')).toContainText('8820');
  await expect(row(page, 'Toko Roti')).toContainText('8820');
  await expect(row(page, 'Pasar Pagi')).not.toContainText('8820');
});
