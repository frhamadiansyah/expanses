import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { goalMenu } from './goals';
import { addGoal, addMoneyAccount, goalCard, setAside } from './set-aside';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Jenius Rp 42.500.000, Rp 7.500.000 of it set aside for Umrah 2027. */
async function umrahOnJenius(page: Page) {
  await addMoneyAccount(page, 'Jenius', 'savings', '42500000');
  await addGoal(page, 'Umrah 2027', '30000000');
  await setAside(page, 'Umrah 2027', 'Jenius (IDR)', '7500000');
}

const jeniusLink = (page: Page) => page.getByTestId('goal-page').getByTestId('goal-link').filter({ hasText: 'Jenius' }).first();

test('Use records the spending from the account and lowers what is set aside for the goal', async ({ page }) => {
  await umrahOnJenius(page);
  const goal = await goalCard(page, 'Umrah 2027');

  await goal.getByRole('button', { name: 'Use', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Use for Umrah 2027' });
  await sheet.getByLabel('Amount', { exact: true }).fill('2000000');
  await sheet.getByLabel('What for', { exact: true }).fill('Flight to Jeddah');
  await expect(sheet.getByLabel('From', { exact: true })).toHaveValue(/.+/);
  await sheet.getByLabel('Category', { exact: true }).selectOption({ index: 1 });
  await expect(sheet.getByText('Rp 5.500.000')).toBeVisible();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  await expect(jeniusLink(page)).toContainText('5.500.000');
  await expect(page.getByTestId('goal-history').filter({ hasText: 'Spent' }).first()).toContainText('Flight to Jeddah');

  await page.goto('/transactions');
  await expect(page.getByText('Flight to Jeddah').first()).toBeVisible();
});

test('Take back lowers what is set aside, and Move hands it to another goal', async ({ page }) => {
  await umrahOnJenius(page);
  await addGoal(page, 'Holiday', '10000000');
  const umrah = await goalCard(page, 'Umrah 2027');

  await goalMenu(umrah, /^Take back$/);
  const takeBack = page.getByRole('dialog', { name: 'Take back from Umrah 2027' });
  await takeBack.getByLabel('Amount', { exact: true }).fill('1500000');
  await expect(takeBack.getByText('Rp 6.000.000')).toBeVisible();
  await takeBack.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(takeBack).toHaveCount(0);
  await expect(jeniusLink(page)).toContainText('6.000.000');

  await goalMenu(umrah, /^Move to another goal$/);
  const move = page.getByRole('dialog', { name: 'Move from Umrah 2027' });
  await move.getByLabel('Amount', { exact: true }).fill('2000000');
  await move.getByLabel('To goal', { exact: true }).selectOption({ label: 'Holiday' });
  await expect(move.getByText('Rp 4.000.000')).toBeVisible();
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(jeniusLink(page)).toContainText('4.000.000');

  const holiday = await goalCard(page, 'Holiday');
  await expect(holiday.getByTestId('goal-link').filter({ hasText: 'Jenius' }).first()).toContainText('2.000.000');
});

test('Monthly opens on what the goal needs and sets it up', async ({ page }) => {
  await addGoal(page, 'Umrah 2027', '30000000');
  const goal = await goalCard(page, 'Umrah 2027');
  await expect(goal.getByRole('button', { name: 'Use', exact: true })).toHaveCount(0);

  await goal.getByRole('button', { name: 'Monthly', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Monthly for Umrah 2027' });
  await expect(sheet.getByLabel('Each month', { exact: true })).not.toHaveValue('');
  await expect(sheet.getByText(/On track$/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(goal.getByTestId('goal-status')).toHaveText('On track');

  await page.goto('/goals');
  await expect(page.getByTestId('goals-on-track')).toHaveText('1 of 1 goal on track');
});

test('Use from a dollar account asks for the rate when the day has none, and saves with it', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'savings', name: 'Wise USD', currency: 'USD', balance: '500', rate: '16000' });
  await addGoal(page, 'Umrah 2027', '30000000');
  await setAside(page, 'Umrah 2027', 'Wise USD (USD)', '200');
  const goal = await goalCard(page, 'Umrah 2027');

  await goal.getByRole('button', { name: 'Use', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Use for Umrah 2027' });
  await sheet.getByLabel('Amount', { exact: true }).fill('50');
  await sheet.getByLabel('What for', { exact: true }).fill('Visa fee');
  await sheet.getByLabel('Category', { exact: true }).selectOption({ index: 1 });
  // A day with no stored rate, and none to fetch.
  await sheet.getByLabel('Date', { exact: true }).fill('2025-06-02');
  const rate = sheet.getByLabel('Rate: IDR per 1 USD');
  await expect(rate).toBeVisible();
  await rate.fill('16250');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  await expect(page.getByTestId('goal-page').getByTestId('goal-link').filter({ hasText: 'Wise USD' }).first()).toContainText('US$150');
});
