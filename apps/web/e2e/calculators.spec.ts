import { expect, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('answers what retirement costs a month without saving anything', async ({ page }) => {
  await page.goto('/calculators');
  await page.getByLabel('Yearly spending in retirement (IDR)').fill('120000000');
  await page.getByLabel('Your age now').fill('35');
  await page.getByLabel('Age you retire').fill('55');

  await expect(page.getByTestId('answer-retirement')).toContainText('Save each month');

  // Nothing is stored until it is asked for.
  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Retirement fund' })).toHaveCount(0);
});

test('turns the answer into a goal, which reaches the budget sheet', async ({ page }) => {
  await page.goto('/calculators');
  await page.getByLabel('Yearly spending in retirement (IDR)').fill('120000000');
  await page.getByLabel('Your age now').fill('35');
  await page.getByLabel('Age you retire').fill('55');
  await page.getByRole('button', { name: 'Save Retirement fund as a goal' }).click();
  await expect(page.getByText('Saved Retirement fund as a goal.')).toBeVisible();

  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Retirement fund' })).toBeVisible();
  await expect(page.getByText('Worked out from your figures')).toBeVisible();

  await page.goto('/budget');
  await expect(page.getByTestId('savings-Retirement fund')).toContainText('a month');
});

test('a half-typed or extreme rate never crashes the page', async ({ page }) => {
  await page.goto('/calculators');
  // Give the other two calculators real answers, so the refusal text below can only belong to retirement.
  await page.getByLabel(`What goes out a month (IDR)`).fill('10000000');
  await page.getByLabel('Fee a year today (IDR)').fill('100000000');

  await page.getByLabel('Yearly spending in retirement (IDR)').fill('120000000');
  await page.getByLabel('Your age now').fill('35');
  await page.getByLabel('Age you retire').fill('55');
  const refusal = page.getByText('Fill the figures in and the answer appears here.');

  // The first keystroke of ",5" or "-1" — or a typo such as "5%" — must not throw during render.
  await page.getByLabel('Inflation a year (%)', { exact: true }).fill(',');
  await expect(page.getByRole('heading', { name: 'Calculators' })).toBeVisible();
  await expect(refusal).toBeVisible();
  await expect(page.getByTestId('answer-retirement')).toHaveCount(0);

  await page.getByLabel('Inflation a year (%)', { exact: true }).fill('5');
  await page.getByLabel('Return while retired (%)').fill('-');
  await expect(page.getByRole('heading', { name: 'Calculators' })).toBeVisible();
  await expect(refusal).toBeVisible();
  await expect(page.getByTestId('answer-retirement')).toHaveCount(0);

  // A rate of -100% or below also must not throw.
  await page.getByLabel('Return while retired (%)').fill('-150');
  await expect(page.getByRole('heading', { name: 'Calculators' })).toBeVisible();
  await expect(refusal).toBeVisible();
  await expect(page.getByTestId('answer-retirement')).toHaveCount(0);

  // And a normal rate still answers.
  await page.getByLabel('Return while retired (%)').fill('8');
  await expect(page.getByTestId('answer-retirement')).toContainText('Save each month');
});

test('says what a school year will cost when the time comes', async ({ page }) => {
  await page.goto('/calculators');
  await page.getByLabel('Fee a year today (IDR)').fill('100000000');
  await page.getByLabel('Years until it starts').fill('10');
  await page.getByLabel('Years of study').fill('4');

  // Four years at today's 100 juta, each inflated to its own year, is far more than 400 juta.
  await expect(page.getByTestId('answer-education')).toContainText('You need');
});
