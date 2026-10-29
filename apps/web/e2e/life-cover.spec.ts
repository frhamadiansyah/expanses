import { expect, type Page, test } from '@playwright/test';

async function type(page: Page, label: string, text: string) {
  const box = page.getByLabel(label, { exact: true });
  await box.click();
  await box.press('ControlOrMeta+a');
  await box.pressSequentially(text, { delay: 30 });
}

test('life cover adds every need once and takes off what is already there', async ({ page }) => {
  await page.goto('/calculators/life-cover');
  // The agreed prefills: 3.5% inflation, 5% on the payout, ten years.
  await expect(page.getByLabel('Inflation during support (%)', { exact: true })).toHaveValue('3.5');
  await expect(page.getByLabel('Return on the payout (%)', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('Years of support', { exact: true })).toHaveValue('10');
  // Nothing is said outside the boxes.
  await expect(page.getByText(/Capital needs analysis/)).toHaveCount(0);
  await expect(page.getByText(/Kept on this device/)).toHaveCount(0);
  await expect(page.getByText('Fill the figures in')).toHaveCount(0);

  await type(page, 'Yearly amount the family needs', '120000000');
  await type(page, 'Debts to clear', '300000000');
  await type(page, 'Education still to fund', '150000000');
  await type(page, 'Final expenses', '25000000');
  await type(page, 'Liquid assets', '200000000');
  await type(page, 'Cover already in force', '500000000');
  await expect(page.getByTestId('answer-life-cover')).toContainText('884.641.927');

  await type(page, 'Liquid assets', '2000000000');
  await expect(page.getByTestId('answer-life-cover')).toContainText('No further cover needed');
  await expect(page.getByTestId('answer-life-cover')).toContainText('915.358.073');

  // Kept on its own as the figures change, and back after a reload. No row to tap.
  await expect(page.getByRole('button', { name: 'Keep these figures' })).toHaveCount(0);
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.getByLabel('Liquid assets', { exact: true })).toHaveValue('2.000.000.000');
  await expect(page.getByLabel('Yearly amount the family needs', { exact: true })).toHaveValue('120.000.000');
  await expect(page.getByTestId('answer-life-cover')).toContainText('915.358.073');
});

test('the answer leads with the cover to hold, and the three figures sit under it', async ({ page }) => {
  await page.goto('/calculators/life-cover');
  await type(page, 'Yearly amount the family needs', '120000000');
  await type(page, 'Debts to clear', '300000000');
  await type(page, 'Education still to fund', '150000000');
  await type(page, 'Final expenses', '25000000');
  await type(page, 'Liquid assets', '200000000');
  await type(page, 'Cover already in force', '500000000');
  const answer = page.getByTestId('answer-life-cover');
  await expect(answer).toContainText('Cover to hold');
  for (const caption of ['Income replacement, today', 'Everything needed', 'Already there']) await expect(answer).toContainText(caption);
});

test('the rows that carried a grey hint explain themselves behind an i', async ({ page }) => {
  await page.goto('/calculators/life-cover');
  await expect(page.getByText('The money is spent down, so a cautious figure.')).toHaveCount(0);
  await page.getByRole('button', { name: 'About Return on the payout (%)' }).click();
  await expect(page.getByText('The money is spent down, so a cautious figure.')).toBeVisible();
});

test('a half-typed rate is refused on its own row, and the page stays up', async ({ page }) => {
  await page.goto('/calculators/life-cover');
  await type(page, 'Yearly amount the family needs', '120000000');
  await type(page, 'Debts to clear', '300000000');
  await type(page, 'Education still to fund', '150000000');
  await type(page, 'Final expenses', '25000000');
  await type(page, 'Liquid assets', '200000000');
  await type(page, 'Cover already in force', '500000000');
  await expect(page.getByTestId('answer-life-cover')).toContainText('884.641.927');

  await type(page, 'Return on the payout (%)', '-');
  await expect(page.getByText('Type a percentage, like 3,5')).toBeVisible();
  await expect(page.getByTestId('answer-life-cover')).toHaveCount(0);
  await type(page, 'Return on the payout (%)', '-100');
  await expect(page.getByText('A rate cannot take away everything')).toBeVisible();
  await type(page, 'Return on the payout (%)', '5');
  await expect(page.getByTestId('answer-life-cover')).toContainText('884.641.927');
});
