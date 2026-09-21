import { expect, type Page, test } from '@playwright/test';
import { localIsoDate } from './today';

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
  await page.goto('/goals');
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

  await page.goto('/goals');
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

  await page.goto('/goals');
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

  await page.goto('/goals');
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
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Hajj or umrah' }).click();

  await expect(page.getByLabel('What kind of goal')).toHaveValue('hajj');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Hajj or umrah');
});

test('a new goal’s return follows when it is needed, until one is typed', async ({ page }) => {
  const yearsAhead = (years: number) => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + years);
    return localIsoDate(date);
  };
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Holiday', exact: true }).click();
  const expectedReturn = page.getByLabel('Expected return a year (%)');
  await expect(expectedReturn).toHaveValue('4');

  await page.getByLabel('Needed by').first().fill(yearsAhead(4));
  await expect(expectedReturn).toHaveValue('6');
  await expect(page.getByText(/^6% · 3 to 5 years/)).toBeVisible();

  await expectedReturn.fill('');
  await expectedReturn.pressSequentially('5');
  await page.getByLabel('Needed by').first().fill(yearsAhead(8));
  await expect(expectedReturn).toHaveValue('5');
});

test('only a new goal’s first payment moves its return: not a later payment, not a saved goal’s dates', async ({ page }) => {
  const yearsAhead = (years: number) => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + years);
    return localIsoDate(date);
  };
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Holiday', exact: true }).click();
  const expectedReturn = page.getByLabel('Expected return a year (%)');
  await expect(expectedReturn).toHaveValue('4');
  await page.getByLabel(/Cost in today's money/).first().fill('10000000');

  await page.getByRole('button', { name: 'Add a payment' }).click();
  await page.getByLabel('What this payment is').nth(1).fill('Balance');
  await page.getByLabel(/Cost in today's money/).nth(1).fill('5000000');
  await page.getByLabel('Needed by').nth(1).fill(yearsAhead(8));
  await expect(expectedReturn).toHaveValue('4');
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('heading', { name: 'Holiday' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(expectedReturn).toHaveValue('4');
  await page.getByLabel('Needed by').first().fill(yearsAhead(4));
  await expect(expectedReturn).toHaveValue('4');
});

test('working a retirement goal out keeps the return its owner typed', async ({ page }) => {
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByLabel('What kind of goal').selectOption('retirement');
  await page.getByLabel('Name', { exact: true }).fill('Retirement');
  await page.getByLabel(/Cost in today's money/).first().fill('1000000000');
  await page.getByLabel('Needed by').first().fill('2046-09-13');
  await page.getByLabel('Expected return a year (%)').fill('9');
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('heading', { name: 'Retirement' })).toBeVisible();

  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await expect(page.getByLabel('Return while saving (%)')).toHaveValue('9');
  await page.getByLabel('Yearly spending in retirement (IDR)').fill('120000000');
  await page.getByLabel('Years until retirement').fill('20');
  await page.getByLabel('Years in retirement').fill('20');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  await expect(page.getByText('Worked out from your figures')).toBeVisible();

  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await expect(page.getByLabel('Return while saving (%)')).toHaveValue('9');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  await expect(page.getByText('Worked out from your figures')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByLabel('Expected return a year (%)')).toHaveValue('9');
});

test('works out a retirement target from your own figures', async ({ page }) => {
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByLabel('What kind of goal').selectOption('retirement');
  await page.getByLabel('Name', { exact: true }).fill('Retirement');
  await page.getByLabel(/Cost in today's money/).first().fill('1000000000');
  await page.getByLabel('Needed by').first().fill('2046-09-13');
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('heading', { name: 'Retirement' })).toBeVisible();

  await page.getByRole('button', { name: 'Work out the amount' }).click();
  // Three rates, opening at the agreed figures: 3.5% inflation, 10% while saving, 5% while retired.
  await expect(page.getByLabel('Inflation a year (%)')).toHaveValue('3.5');
  await expect(page.getByLabel('Return while saving (%)')).toHaveValue('10');
  await expect(page.getByLabel('Return while retired (%)')).toHaveValue('5');
  await page.getByLabel('Yearly spending in retirement (IDR)').fill('120000000');
  await page.getByLabel('Years until retirement').fill('20');
  await page.getByLabel('Years in retirement').fill('20');
  await page.getByLabel('Inflation a year (%)').fill('5');
  await page.getByLabel('Return while retired (%)').fill('8');
  await page.getByRole('button', { name: 'Use this amount' }).click();

  await expect(page.getByText('Worked out from your figures')).toBeVisible();
  // The working reopens as it was saved.
  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await expect(page.getByLabel('Yearly spending in retirement (IDR)')).toHaveValue('120000000');
  await expect(page.getByLabel('Return while retired (%)')).toHaveValue('8');
  await expect(page.getByLabel('Inflation a year (%)')).toHaveValue('5');
});

test('typing an amount by hand stops the goal being worked out', async ({ page }) => {
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByLabel('What kind of goal').selectOption('retirement');
  await page.getByLabel('Name', { exact: true }).fill('Retirement');
  await page.getByLabel(/Cost in today's money/).first().fill('1000000000');
  await page.getByLabel('Needed by').first().fill('2046-09-13');
  await page.getByRole('button', { name: 'Add goal' }).last().click();

  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await page.getByLabel('Yearly spending in retirement (IDR)').fill('120000000');
  await page.getByLabel('Years until retirement').fill('20');
  await page.getByLabel('Years in retirement').fill('20');
  await page.getByLabel('Inflation a year (%)').fill('5');
  await page.getByLabel('Return while retired (%)').fill('8');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  await expect(page.getByText('Worked out from your figures')).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByLabel(/Cost in today's money/).first().fill('3000000000');
  await page.getByRole('button', { name: 'Save goal' }).click();

  await expect(page.getByText('Worked out from your figures')).toHaveCount(0);
});

/**
 * §3.3: a set-aside is in the account's own money, on the way in as well as on the way out.
 *
 * The box was labelled with the account's currency and parsed with the workspace's base one, so typing
 * `100,03` into a dollar box met `IDR allows 0 decimal places` out of core, and a foreign set-aside could
 * not be entered on this form at all. The mirror image of the chip that printed one back under `Rp`.
 */
test('money set aside on a foreign account is typed, saved and read back in that currency', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('Wise USD');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Currency').selectOption('USD');
  await page.getByLabel('Current balance').fill('500');
  await page.getByLabel(/Rate: IDR per 1 USD/).fill('16000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'Wise USD', exact: true })).toBeVisible();

  await addGoal(page, 'education', 'University for Aisyah', '350000000', '2038-07-31');

  await page.goto('/goals');
  await page.getByRole('button', { name: 'Edit' }).first().click();
  // The box says USD, so an amount with cents is what belongs in it.
  const box = page.getByLabel('Wise USD (USD)');
  await box.fill('100,03');
  await page.getByRole('button', { name: 'Save goal' }).click();

  // Saved at all is the first assertion: this used to end in `IDR allows 0 decimal places`.
  await expect(page.getByRole('alert')).toHaveCount(0);
  // The funding line is a row of the goal's group now: the name, what kind of funding it is and the figure are
  // three parts of one row rather than one run of text, so the line is named rather than matched whole.
  const fundedBy = page.getByTestId('goal-link').filter({ hasText: 'Wise USD' }).first();
  await expect(fundedBy).toBeVisible();
  await expect(fundedBy).toContainText('set aside');
  await expect(fundedBy).toContainText('US$100,03');

  // And the form opens on the figure it stored, in the same currency it asked for.
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByLabel('Wise USD (USD)')).toHaveValue('100.03');
});
