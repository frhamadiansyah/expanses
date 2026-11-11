import { expect, type Page, test } from '@playwright/test';
import { openDrawers } from './drawers';

/** A table row's five cells as plain digits: #, payment, principal, interest, left. */
async function rowCells(page: Page, index: number): Promise<string[]> {
  const cells = await page.getByTestId('schedule-row').nth(index).locator('td').allInnerTexts();
  return cells.map((text) => text.replace(/\./g, '').trim());
}

/** The figures of a sheet as text with every grouping dot taken out, so "4.952.789" and "4952789" read alike. */
const digits = (text: string) => text.replace(/(\d)\.(?=\d{3})/g, '$1');

test('by thumb: a home loan worked out, its table, and Save as debt add a loan whose schedule is the table', async ({ page }) => {
  await page.goto('/calculators');
  await page.getByRole('link', { name: /^Loan/ }).tap();
  await expect(page).toHaveURL(/\/calculators\/loan/);

  // Home is the kind the calculator opens on: a price, a down payment, years, and two rate stages.
  await page.getByLabel('House price', { exact: true }).pressSequentially('900000000');
  await page.getByLabel('Down payment', { exact: true }).fill('20');
  await expect(page.getByTestId('loan-amount')).toContainText('720.000.000');
  await page.getByLabel('Years', { exact: true }).fill('20');
  const stages = page.getByTestId('rate-stage');
  await stages.nth(0).tap();
  const sheet = page.getByRole('dialog', { name: 'Rate stage' });
  await sheet.getByLabel('Years', { exact: true }).fill('3');
  await sheet.getByLabel('Rate', { exact: true }).fill('5,5');
  await sheet.getByRole('button', { name: 'Done' }).tap();
  await stages.nth(1).tap();
  await sheet.getByLabel('Rate', { exact: true }).fill('11');
  await sheet.getByRole('button', { name: 'Done' }).tap();
  await expect(stages.nth(0)).toContainText('first 3 years');
  await expect(stages.nth(1)).toContainText('remaining 17 years');
  await page.getByLabel('Monthly income', { exact: true }).pressSequentially('30000000');

  // The result: one card with the totals and both stages, then what it means.
  await page.getByRole('button', { name: 'See result' }).tap();
  await expect(page.getByRole('heading', { name: 'Home loan' })).toBeVisible();
  await expect(page.getByTestId('loan-hero')).toContainText('Total paid over 20 years');
  await expect(page.getByTestId('loan-total')).toContainText('1.629.625.844');
  await expect(page.getByTestId('loan-stage')).toHaveCount(2);
  await expect(page.getByTestId('loan-stage').nth(0)).toContainText('5,5% a year · fixed');
  await expect(page.getByTestId('loan-stage').nth(0)).toContainText('4.952.789');
  await expect(page.getByTestId('loan-stage').nth(1)).toContainText('7.114.340');
  await expect(page.getByTestId('loan-jump')).toContainText('(+43,6%) when the fixed rate ends');
  await expect(page.getByTestId('loan-income')).toContainText('17% → 24%');
  await expect(page.getByTestId('loan-half')).toContainText('month 172');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // The table alone: every month, and every year.
  await page.getByRole('button', { name: 'Table', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByTestId('schedule-row')).toHaveCount(240);
  const first = await rowCells(page, 0);
  const last = await rowCells(page, 239);
  expect(first).toEqual(['1', '4952789', '1652789', '3300000', '718347211']);
  expect(last[0]).toBe('240');
  expect(last[4]).toBe('0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('radio', { name: 'Yearly' }).tap();
  await expect(page.getByTestId('schedule-row')).toHaveCount(20);
  await page.getByRole('radio', { name: 'Monthly' }).tap();

  // Save as debt opens Add debt filled in, the rate stages with it; only the lender is asked.
  await page.getByRole('button', { name: 'Result' }).first().tap();
  await page.getByRole('button', { name: 'Save as debt' }).tap();
  await expect(page).toHaveURL(/\/debts\/new/);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Home loan');
  await expect(page.getByLabel('Owed now')).toHaveValue('720.000.000');
  await expect(page.getByLabel('Months left')).toHaveValue('240');
  await expect(page.getByTestId('calculator-stage')).toHaveCount(2);
  await expect(page.getByTestId('calculator-stage').nth(0)).toContainText('5,5% a year, fixed');
  await expect(page.getByTestId('calculator-stage').nth(1)).toContainText('11% a year, floating');
  await expect(page.getByText('From the calculator. Each figure can still be changed before saving.')).toBeVisible();
  await page.getByLabel('Lender').fill('Bank');
  await page.getByRole('button', { name: 'Add debt' }).tap();

  // The loan's own schedule is the calculator's table: its first and last months, to the unit.
  await openDrawers(page);
  await page.getByText('Home loan', { exact: true }).first().tap();
  await expect(page.getByTestId('loan-line')).toContainText('5,5% fixed · Home mortgage');
  await page.getByRole('button', { name: 'Schedule' }).tap();
  const schedule = page.getByRole('dialog', { name: 'Schedule' });
  await expect(schedule).toContainText('What is still to come');
  await expect(schedule.getByText('240', { exact: true }).first()).toBeVisible();
  await schedule.getByRole('button', { name: 'Show every month' }).tap();
  const text = digits(await schedule.innerText());
  for (const figure of first.slice(1)) expect(text).toMatch(new RegExp(`(^|\\D)${figure}(\\D|$)`));
  for (const figure of last.slice(1, 4)) expect(text).toMatch(new RegExp(`(^|\\D)${figure}(\\D|$)`));
});

test('by thumb: an online loan says what it adds up to a year, and a vehicle what its flat rate really costs', async ({ page }) => {
  await page.goto('/calculators/loan');
  await page.getByRole('radio', { name: 'Online' }).tap();
  await page.getByLabel('Amount', { exact: true }).pressSequentially('6000000');
  await page.getByLabel('Months', { exact: true }).fill('6');
  await page.getByLabel('Interest', { exact: true }).fill('2,95');
  await page.getByLabel('Fee at the start', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'See result' }).tap();
  await expect(page.getByTestId('loan-total')).toContainText('7.062.000');
  await expect(page.getByTestId('loan-fee')).toContainText('cost of borrowing');
  await expect(page.getByTestId('loan-yearly-cost')).toContainText('Adds up to about 97% a year');

  await page.getByRole('button', { name: 'Inputs' }).first().tap();
  await page.getByRole('radio', { name: 'Vehicle' }).tap();
  await page.getByLabel('Vehicle price', { exact: true }).pressSequentially('350000000');
  await page.getByLabel('Down payment', { exact: true }).fill('25');
  await page.getByLabel('Months', { exact: true }).fill('48');
  await page.getByLabel('Rate', { exact: true }).fill('4,5');
  await page.getByRole('button', { name: 'See result' }).tap();
  await expect(page.getByTestId('loan-total')).toContainText('309.750.000');
  await expect(page.getByTestId('loan-flat')).toContainText('about 8,36% a year on what is still owed');

  // The boxes are kept: leaving and coming back finds the vehicle as typed, and so does opening the app again.
  await page.getByRole('button', { name: 'Inputs' }).first().tap();
  await page.getByRole('link', { name: 'Calculators' }).first().tap();
  await page.getByRole('link', { name: /^Loan/ }).tap();
  await expect(page.getByRole('radio', { name: 'Vehicle' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Vehicle price', { exact: true })).toHaveValue('350.000.000');
  await expect(async () => {
    await page.reload();
    await expect(page.getByLabel('Vehicle price', { exact: true })).toHaveValue('350.000.000', { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole('radio', { name: 'Online' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('radio', { name: 'Online' }).tap();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('6.000.000');
});
