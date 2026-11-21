import { expect, type Page, test } from '@playwright/test';
import { addPlastic, editPlastic, openCard, removePlastic, openFace } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage } from './card-section';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addCardAccount(page: Page) {
  await openCard(page, { name: 'Mandiri Bonvoy', bank: 'Mandiri', last4: '1467' });
}

/** The card's Settings, where the cards on its account are listed and added. */
async function openTheCard(page: Page) {
  await page.goto('/wallet');
  await openFace(page.getByRole('link', { name: /^Mandiri Bonvoy(,|$)/ }));
  await expect(page.getByRole('heading', { name: 'Mandiri Bonvoy' })).toBeVisible();
  await cardPage(page, 'Settings');
}

test('a second card joins the same statement, and a purchase records which one', async ({ page }) => {
  await addCardAccount(page);

  // One card, so Paid with is one row and there is nothing left to ask.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Payment method' }).click();
  await page.getByRole('dialog', { name: 'Payment method' }).getByRole('radio', { name: 'Credit cards' }).click();
  await expect(page.getByRole('dialog', { name: 'Payment method' }).getByRole('button', { name: 'Mandiri Bonvoy', exact: true })).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Payment method' }).getByRole('button', { name: /Mandiri Bonvoy ····/ })).toHaveCount(0);

  // The supplementary card: same account, same statement, its own digits.
  await openTheCard(page);
  await addPlastic(page, '8802', 'Spouse');
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);

  // Now each card is its own row, so choosing one answers both questions at once.
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Ranch Market', paidWith: 'Mandiri Bonvoy ···· 8802', category: 'Groceries', amount: '450000' });

  await expect(page.getByText('Ranch Market')).toBeVisible();
});

test('removing a card leaves the account and its statement alone', async ({ page }) => {
  await addCardAccount(page);
  await openTheCard(page);
  await addPlastic(page, '8802');
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);

  await removePlastic(page, '8802');

  await expect(page.getByTestId('card-on-account')).toHaveCount(1);
  await page.getByRole('button', { name: 'Mandiri Bonvoy' }).click();
  await expect(page.getByRole('heading', { name: 'Mandiri Bonvoy' })).toBeVisible();
});

test('a card is edited from its row: new digits and whose card show on the page and in Paid with', async ({ page }) => {
  await addCardAccount(page);
  await openTheCard(page);
  await addPlastic(page, '8802', 'Spouse');

  const sheet = await editPlastic(page, '8802');
  await expect(sheet.getByRole('button', { name: 'Remove card', exact: true })).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Last 4 digits' }).fill('9915');
  await sheet.getByRole('textbox', { name: 'Whose card' }).fill('Partner');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  const rows = page.getByTestId('card-on-account');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Partner' })).toContainText('9915');
  await expect(page.getByRole('button', { name: 'Edit card ending 8802' })).toHaveCount(0);

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Payment method' }).click();
  const paidWith = page.getByRole('dialog', { name: 'Payment method' });
  await paidWith.getByRole('radio', { name: 'Credit cards' }).click();
  await expect(paidWith.getByRole('button', { name: 'Mandiri Bonvoy ···· 9915', exact: true })).toBeVisible();
});

test('a card is refused digits that another card at the bank already has, inside the sheet', async ({ page }) => {
  await addCardAccount(page);
  await openTheCard(page);
  await addPlastic(page, '8802');
  const sheet = await editPlastic(page, '8802');
  await sheet.getByRole('textbox', { name: 'Last 4 digits' }).fill('1467');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('1467');
  await expect(sheet).toBeVisible();
});

test('Add a card is the last row of the Cardholders box, and the old form is gone', async ({ page }) => {
  await addCardAccount(page);
  await openTheCard(page);
  await expect(page.getByRole('button', { name: 'Add card', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Remove card ending/ })).toHaveCount(0);
  await addPlastic(page, '8802', 'Spouse');
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);
});
