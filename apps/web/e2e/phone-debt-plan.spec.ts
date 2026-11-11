import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { at, bank, openPaylater, owedTo, planRows, seedLatePaylater, seedPlan } from './debt-plan';
import { digits } from './debts-page';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('the plan’s header: left to pay, the counts, the order and what to pay next', async ({ page }) => {
  await seedPlan(page);
  await page.goto('/net-worth/plan');
  await expect(page.getByRole('heading', { name: 'Debt-free plan' })).toBeVisible();
  await expect(page.getByTestId('plan-left')).toHaveText('Rp 35.464.300');
  await expect(page.getByTestId('plan-count-active')).toHaveText('3 active');
  await expect(page.getByTestId('plan-count-late')).toHaveText('0 late');
  await expect(page.getByTestId('plan-count-paid-off')).toHaveText('0 paid off');
  // One debt charges interest and Dewi alone is small: no suggestion, so the plan starts on Avalanche.
  await expect(page.getByTestId('plan-row-pay-first')).toContainText('Avalanche');
  await expect(page.getByTestId('plan-pay-next')).toContainText('BCA Visa');
  await expect(page.getByTestId('plan-pay-next')).toContainText('due 18 Nov');
  await expect(page.getByTestId('plan-ring')).toHaveAttribute('aria-label', /^\d+% repaid$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('extra a month: the month it brings forward and the interest it saves, kept in the database', async ({ page }) => {
  await seedLatePaylater(page);
  await page.goto('/net-worth/plan');
  await expect(page.getByTestId('plan-debt-free')).toHaveText('April 2027');

  await page.getByTestId('plan-row-pay-first').click();
  await expect(page).toHaveURL(/\/net-worth\/plan\/pay-first$/);
  const extra = page.getByLabel('Extra a month');
  await expect(extra).toHaveAttribute('placeholder', 'Amount');
  await extra.fill('3000000');
  await extra.press('Enter');
  await expect(page.getByTestId('plan-extra-debt-free')).toContainText('December 2026');
  await expect(page.getByTestId('plan-extra-debt-free')).toContainText('not Apr 2027');
  await expect(page.getByTestId('plan-interest-saved')).toBeVisible();
  expect(digits(await page.getByTestId('plan-interest-saved').innerText())).toBeGreaterThan(0);
  await expect(page.getByText('Goes to Kredit', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Extra a month')).toHaveValue('3.000.000');
  await page.getByRole('link', { name: 'Debt-free plan' }).first().click();
  // The header's month is the plan without the extra (spec §7.5).
  await expect(page.getByTestId('plan-debt-free')).toHaveText('April 2027');
});

test('order and suggestion: Avalanche suggested, Snowball and Avalanche each put the debts in their order', async ({ page }) => {
  await seedPlan(page);
  await openPaylater(page, { name: 'Akulaku', owed: '2105700', perMonth: '2.5', months: '6' });
  await page.goto('/net-worth/plan/pay-first');
  await expect(page.getByTestId('plan-suggestion')).toContainText('Suggested: Avalanche.');
  await expect(page.getByTestId('plan-suggestion')).toContainText('2,5% a month vs 7,5% a year');

  const order = page.getByRole('radiogroup', { name: 'Order' });
  await order.getByRole('radio', { name: 'Snowball' }).click();
  await expect.poll(() => planRows(page)).toEqual(['Dewi', 'Akulaku', 'BCA Visa', 'KPR BCA']);
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Order' }).getByRole('radio', { name: 'Snowball' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => planRows(page)).toEqual(['Dewi', 'Akulaku', 'BCA Visa', 'KPR BCA']);

  await page.getByRole('radiogroup', { name: 'Order' }).getByRole('radio', { name: 'Avalanche' }).click();
  // 0% debts last, the smaller first.
  await expect.poll(() => planRows(page)).toEqual(['Akulaku', 'KPR BCA', 'Dewi', 'BCA Visa']);
  // Each row pays its own debt; a person's is the Lend & borrow repayment.
  await expect(page.getByRole('link', { name: 'Pay Akulaku' })).toHaveAttribute('href', /\/net-worth\/loans\/[^?]+\?pay=due$/);
  await expect(page.getByRole('link', { name: 'Pay BCA Visa' })).toHaveAttribute('href', /\/cards\/[^?]+\?pay=true$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('by hand: a move is kept, and the plan’s Pay first row says By hand', async ({ page }) => {
  await seedPlan(page);
  await openPaylater(page, { name: 'Akulaku', owed: '2105700', perMonth: '2.5', months: '6' });
  await page.goto('/net-worth/plan/pay-first');
  await page.getByRole('radiogroup', { name: 'Order' }).getByRole('radio', { name: 'By hand' }).click();
  await expect.poll(() => planRows(page)).toEqual(['Akulaku', 'KPR BCA', 'Dewi', 'BCA Visa']);

  const down = page.getByRole('button', { name: 'Move Akulaku down' });
  await down.focus();
  await down.press('Enter');
  await expect.poll(() => planRows(page)).toEqual(['KPR BCA', 'Akulaku', 'Dewi', 'BCA Visa']);
  await page.reload();
  await expect.poll(() => planRows(page)).toEqual(['KPR BCA', 'Akulaku', 'Dewi', 'BCA Visa']);

  await page.goto('/net-worth/plan');
  await expect(page.getByTestId('plan-row-pay-first')).toContainText('By hand');
});

test('a loan with no terms makes the debt-free month unknown, named, and has no Pay', async ({ page }) => {
  await page.clock.setSystemTime(at('2026-11-11'));
  await bank(page);
  await openAccount(page, { subtype: 'loan', name: 'Dollar car loan', currency: 'USD', balance: '1000.00', rate: '16250' });
  await page.goto('/net-worth/plan');
  await expect(page.getByTestId('plan-debt-free')).toHaveText('Unknown');
  await expect(page.getByTestId('plan-debt-free-why')).toHaveText('No terms on Dollar car loan yet');
  await page.goto('/net-worth/plan/pay-first');
  const row = page.getByTestId('pay-first-row').filter({ hasText: 'Dollar car loan' });
  await expect(row).toContainText('No terms yet');
  await expect(row.getByRole('link', { name: /^Pay / })).toHaveCount(0);
});

test('late on top: the count, Pay next pays the late instalment and comes back to the plan', async ({ page }) => {
  await seedLatePaylater(page);
  await owedTo(page, 'Dewi', '850000');
  await page.goto('/net-worth/plan');
  await expect(page.getByTestId('plan-count-late')).toHaveText('1 late');
  await expect(page.getByTestId('plan-pay-next')).toContainText('Pay next · Kredit');
  await expect(page.getByTestId('plan-pay-next')).toContainText('3 days late');

  await page.goto('/account');
  await expect(page.getByRole('link', { name: /^Debt-free plan/ })).toContainText('1 late');

  await page.goto('/net-worth/plan/pay-first');
  const first = page.getByTestId('pay-first-row').first();
  await expect(first).toContainText('!');
  await expect(first).toContainText('Kredit');
  await expect(first).toContainText('3 days late');

  await page.goto('/net-worth/plan');
  await page.getByTestId('plan-pay-next').getByRole('link').click();
  await expect(page).toHaveURL(/\/net-worth\/loans\/[^?]+\?pay=due$/);
  const sheet = page.getByRole('dialog', { name: 'Pay' });
  await sheet.getByRole('button', { name: 'Save payment' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan$/);
  await expect(page.getByTestId('plan-count-late')).toHaveText('0 late');
});

test('ways in: the corners of Net worth and Liabilities, and Account → Money', async ({ page }) => {
  await page.clock.setSystemTime(at('2026-11-11'));
  await page.goto('/net-worth');
  await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible();
  // Nothing owed yet: no plan to open from Net worth.
  await expect(page.getByRole('link', { name: 'Debt-free plan' })).toHaveCount(0);

  await bank(page);
  await owedTo(page, 'Dewi', '850000');
  await page.goto('/net-worth');
  await page.getByRole('link', { name: 'Debt-free plan' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan$/);

  await page.goto('/net-worth/loans');
  await expect(page.getByRole('link', { name: 'Add a debt' })).toBeVisible();
  await page.getByRole('link', { name: 'Debt-free plan' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan$/);

  await page.goto('/account');
  await page.getByRole('link', { name: /^Debt-free plan/ }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan$/);
});
