import { expect, test } from '@playwright/test';
import { openCard } from './accounts';
import { showMonthly, showRepeating } from './bill-form';
import { cardPage, saveCardTerms } from './card-section';
import { addFarYearlyBill, addMonthlyBill } from './recurring-slider';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

test('Repeating lists each card’s annual fee, read-only and outside the need; Monthly lists running instalment plans outside every total', async ({ page }) => {
  await addFarYearlyBill(page, 'Domain');
  await addMonthlyBill(page, 'Water');

  // A card whose fee is 100 days away (entered as the date it was charged two years ago), with an instalment plan.
  const next = new Date();
  next.setDate(next.getDate() + 100);
  const entered = new Date(next);
  entered.setFullYear(next.getFullYear() - 2);
  await openCard(page, { name: 'Fee Card', statementDay: '25', dueDay: '12' });
  await cardPage(page, 'Settings');
  await page.getByLabel('Annual fee').fill('777000');
  await page.getByLabel('Charged on').fill(iso(entered));
  await saveCardTerms(page);
  await page.waitForTimeout(800);
  await page.getByRole('main').getByRole('link', { name: /^Instalments/ }).click();
  await page.getByRole('button', { name: 'Add a plan' }).click();
  const sheet = page.getByRole('dialog', { name: 'New instalment plan' });
  await sheet.getByLabel('What it was').fill('Laptop');
  await sheet.getByLabel(/^Total/).fill('9000000');
  await sheet.getByLabel('Months').fill('12');
  await sheet.getByRole('button', { name: 'Save plan' }).click();
  await expect(sheet).toHaveCount(0);
  await page.waitForTimeout(800);

  await page.goto('/bills');
  await showMonthly(page);
  const summaryBefore = await page.getByTestId('bills-summary').innerText();
  // Not 30 days away: no fee under Due soon; the plan has its own group, after the bills.
  await expect(page.getByTestId('annual-fee-row')).toHaveCount(0);
  const plans = page.getByTestId('monthly-instalments');
  await expect(plans).toContainText('Instalments');
  const line = plans.getByTestId('instalment-line');
  await expect(line).toContainText('Laptop · Fee Card');
  await expect(line).toContainText('750.000');
  await expect(line).toContainText('1 of 12 · on the statement');
  // It is in no total: the hero names only the bill.
  expect(summaryBefore).toContain('150.000');
  expect(summaryBefore).not.toContain('750.000');
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad/s7-monthly.png', fullPage: true });
  await line.click();
  await expect(page.getByRole('heading', { name: 'Instalments', exact: true }).first()).toBeVisible();

  await page.goto('/bills');
  await showMonthly(page);
  await expect(page.getByTestId('monthly-instalments')).toBeVisible();
  await showRepeating(page);
  const neededBefore = await page.getByTestId('needed-total').innerText();
  const fees = page.getByTestId('annual-fees');
  await expect(fees).toContainText('Annual fees');
  const fee = fees.getByTestId('annual-fee-row');
  await expect(fee).toContainText('Fee Card');
  await expect(fee).toContainText('777.000');
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad/s8-repeating.png' });
  // A tap opens Fee waived; the need is the bills' alone.
  await fee.click();
  const feeSheet = page.getByRole('dialog', { name: /^Fee waived · \d{4}$/ });
  await expect(feeSheet.getByTestId('fee-charged-as-normal')).toBeVisible();
  await feeSheet.getByRole('button', { name: 'Close' }).click();
  expect(neededBefore).not.toContain('777.000');
  await expect(page.getByTestId('yearly-bill-row')).toHaveCount(1);
});
