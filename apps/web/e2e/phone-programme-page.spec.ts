import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, cardSettingsPage, saveCardTerms, walletCard } from './card-section';

const SHOTS = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** A card earning 1 point per Rp 2.500 with one purchase on it, then its statement points and on to its programme page. */
async function openProgramme(page: Page) {
  await openCard(page, { name: 'CIMB Octo' });
  await page.goto('/wallet');
  await walletCard(page, 'CIMB Octo').click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await page.getByRole('button', { name: 'Set up rewards' }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('Base');
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByLabel('Per spend (IDR)').fill('2500');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('1 per Rp')).toBeVisible();
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'CIMB Octo', category: 'Groceries', amount: '250000' });
  await page.goto('/wallet');
  await walletCard(page, 'CIMB Octo').click();
  await cardPage(page, 'Points');
  await page.getByTestId('statement-points-programme').click();
  await expect(page.getByTestId('programme-balance')).toBeVisible();
}

test('the programme page keeps the balance, four buttons and History; the rest moved to Worth, Convert and Settings', async ({ page }) => {
  await openProgramme(page);
  const buttons = page.getByRole('group', { name: 'Actions' });
  await expect(buttons.getByRole('button', { name: 'Redeem' })).toBeVisible();
  await expect(buttons.getByRole('button', { name: 'Convert' })).toBeVisible();
  await expect(buttons.getByRole('button', { name: 'Set balance' })).toBeVisible();
  await expect(buttons.getByRole('link', { name: 'Worth' })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByText('Earned by')).toHaveCount(0);
  await expect(main.getByText('If transferred')).toHaveCount(0);
  await expect(main.getByText('Earlier cycles')).toHaveCount(0);
  await expect(main.getByText('Add a value')).toHaveCount(0);
  await expect(main.getByTestId('point-values')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/programme-new-1.png`, fullPage: true });

  // A statement's row in History opens that card's statement points page.
  await page.getByTestId('programme-history').getByTestId('programme-history-row').filter({ hasText: 'CIMB Octo' }).first().click();
  await expect(page.getByTestId('statement-points-balance')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('programme-balance')).toBeVisible();

  // Worth opens the list; the ＋ adds a value in a sheet.
  await buttons.getByRole('link', { name: 'Worth' }).click();
  await expect(page.getByTestId('point-values')).toContainText('No values yet');
  await page.screenshot({ path: `${SHOTS}/programme-new-2.png`, fullPage: true });
  await page.getByRole('button', { name: 'Add a value' }).click();
  await page.getByRole('dialog', { name: 'Add a value' }).getByLabel('Redemption', { exact: true }).fill('Statement credit');
  await page.getByRole('dialog', { name: 'Add a value' }).getByLabel('Points redeemed', { exact: true }).fill('1');
  await page.getByRole('dialog', { name: 'Add a value' }).getByLabel('Worth', { exact: true }).fill('25');
  await page.getByRole('dialog', { name: 'Add a value' }).getByRole('button', { name: 'Add value' }).click();
  await expect(page.getByTestId('point-values')).toContainText(/Statement credit: 1 points = Rp\s25/);
  await page.goBack();
  await expect(page.getByTestId('programme-balance')).toBeVisible();

  // Settings: the cards earning here, the value count, the catch-up and Archive.
  await page.getByRole('button', { name: 'Programme settings' }).click();
  const settings = page.getByRole('dialog');
  await expect(settings.getByText('Cards earning here')).toBeVisible();
  await expect(settings.getByRole('link', { name: /CIMB Octo/ })).toBeVisible();
  await expect(settings.getByRole('link', { name: /What points are worth/ })).toContainText('1 value');
  await expect(settings.getByRole('button', { name: 'Catch up earlier cycles' })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Archive programme' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/programme-new-3.png`, fullPage: true });
  await settings.getByRole('button', { name: 'Catch up earlier cycles' }).click();
  await settings.getByRole('button', { name: 'Catch up CIMB Octo' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('the Convert sheet shows what this statement would convert to at each partner', async ({ page }) => {
  await openCard(page, { name: 'BCA UnionPay Card' });
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^BCA UnionPay Card(,|$)/ }).click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByLabel('Search catalogue').fill('unionpay');
  await page.getByRole('button', { name: 'BCA UnionPay', exact: true }).click();
  await page.getByRole('button', { name: 'Use these terms' }).click();
  await expect(page.getByText('Step 2 of 3')).toHaveCount(0);
  await cardSettingsPage(page, 'Card product');
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi', paidWith: 'BCA UnionPay Card', category: 'Restaurants', amount: '540000' });
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^BCA UnionPay Card(,|$)/ }).click();
  await cardPage(page, 'Points');
  await page.getByTestId('statement-points-programme').click();
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Convert' }).click();
  await expect(page.getByRole('dialog')).toContainText(/If this statement's \d+ points were converted/i);
  await expect(page.getByRole('dialog')).toContainText('KrisFlyer');
});
