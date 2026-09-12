import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addBank(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('50000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

async function addGold(page: Page) {
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('gold');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await page.getByLabel('Bought on').fill('2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost (IDR)').fill('18000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();
  // A price, so a goal funded with gold is worth something today.
  await page.getByRole('button', { name: 'Update prices' }).click();
  await page.getByLabel(/Antam gold bars/).fill('1800000');
  await page.getByRole('button', { name: 'Save prices' }).click();
  await expect(page.getByText(/18\.000\.000/).first()).toBeVisible();
}

async function addGoal(page: Page, kind: string, name: string, amount: string, dueOn: string) {
  await page.goto('/net-worth/goals');
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByLabel('What kind of goal').selectOption(kind);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel(/Cost in today's money/).first().fill(amount);
  await page.getByLabel('Needed by').first().fill(dueOn);
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function buyGold(page: Page, grams: string, cost: string, goalName: string) {
  await page.goto('/net-worth/trades');
  await page.getByLabel('Units, shares or grams').fill(grams);
  await page.getByLabel('What it cost, before fees (IDR)').fill(cost);
  await page.getByLabel('For goal').selectOption({ label: goalName });
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/Recorded\./)).toBeVisible();
}

test('a goal funded by a tagged gold buy shows progress and what it needs each month', async ({ page }) => {
  await addBank(page);
  await addGold(page);
  await addGoal(page, 'hajj', 'Hajj for two', '50000000', '2028-06-30');

  await buyGold(page, '5', '9000000', 'Hajj for two');

  await page.goto('/net-worth/goals');
  await expect(page.getByText('Antam gold bars').first()).toBeVisible();
  await expect(page.getByText(/9\.000\.000/).first()).toBeVisible();
  await expect(page.getByText('Needed a month').first()).toBeVisible();
});

test('one holding funds two goals, by the tag on each buy', async ({ page }) => {
  await addBank(page);
  await addGold(page);
  await addGoal(page, 'hajj', 'Hajj for two', '50000000', '2028-06-30');
  await addGoal(page, 'education', 'University for Aisyah', '350000000', '2038-07-31');

  await buyGold(page, '2', '3600000', 'Hajj for two');
  await buyGold(page, '1', '1800000', 'University for Aisyah');

  await page.goto('/net-worth/goals');
  const hajj = page.locator('section', { hasText: 'Hajj for two' }).first();
  const education = page.locator('section', { hasText: 'University for Aisyah' }).first();
  await expect(hajj.getByText(/3\.600\.000/).first()).toBeVisible();
  await expect(education.getByText(/1\.800\.000/).first()).toBeVisible();
});

test('retagging a buy moves it between goals without touching the ledger', async ({ page }) => {
  await addBank(page);
  await addGold(page);
  await addGoal(page, 'hajj', 'Hajj for two', '50000000', '2028-06-30');
  await addGoal(page, 'education', 'University for Aisyah', '350000000', '2038-07-31');
  await buyGold(page, '2', '3600000', 'Hajj for two');

  await page.goto('/net-worth/assets');
  const valueBefore = await page.getByText(/21\.600\.000/).first().textContent();

  await page.goto('/net-worth/trades');
  await page.locator('select[aria-label="Goal for this buy"]').first().selectOption({ label: 'University for Aisyah' });
  await expect(page.getByText(/University for Aisyah/).first()).toBeVisible();

  await page.goto('/net-worth/goals');
  const education = page.locator('section', { hasText: 'University for Aisyah' }).first();
  await expect(education.getByText(/3\.600\.000/).first()).toBeVisible();

  await page.goto('/net-worth/assets');
  await expect(page.getByText(/21\.600\.000/).first()).toHaveText(valueBefore ?? '');
});

test('refuses a sell the goal cannot cover', async ({ page }) => {
  await addBank(page);
  await addGold(page);
  await addGoal(page, 'hajj', 'Hajj for two', '50000000', '2028-06-30');
  await buyGold(page, '2', '3600000', 'Hajj for two');

  await page.goto('/net-worth/trades');
  await page.getByLabel('What happened').selectOption('sell');
  await page.getByLabel('Units, shares or grams').fill('5');
  await page.getByLabel('Proceeds, before fees (IDR)').fill('9500000');
  await page.getByLabel('Sell from goal').selectOption({ label: 'Hajj for two' });
  await page.getByRole('button', { name: 'Record', exact: true }).click();

  await expect(page.getByText(/Hajj for two holds/)).toBeVisible();
});

test('a template button opens that template, not the first one', async ({ page }) => {
  await page.goto('/net-worth/goals');
  await page.getByRole('button', { name: 'Hajj or umrah' }).click();

  await expect(page.getByLabel('What kind of goal')).toHaveValue('hajj');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Hajj or umrah');
});
