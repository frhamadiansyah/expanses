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
  // The method and its sources are named; no link is fetched.
  await expect(page.getByText(/^Capital needs analysis:.*CFP Board.*Insurance Information Institute/)).toBeVisible();

  await type(page, 'Yearly amount your family needs (IDR)', '120000000');
  await type(page, 'Debts to clear (IDR)', '300000000');
  await type(page, 'Education still to fund (IDR)', '150000000');
  await type(page, 'Final expenses (IDR)', '25000000');
  await type(page, 'Liquid assets (IDR)', '200000000');
  await type(page, 'Cover already in force (IDR)', '500000000');
  await expect(page.getByTestId('answer-life-cover')).toContainText('884.641.927');

  await type(page, 'Liquid assets (IDR)', '2000000000');
  await expect(page.getByTestId('answer-life-cover')).toContainText('No further cover needed');
  await expect(page.getByTestId('answer-life-cover')).toContainText('915.358.073');

  // Kept, and back after a reload.
  await page.getByRole('button', { name: 'Keep these figures' }).click();
  await expect(page.getByText('Kept the life cover figures.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Liquid assets (IDR)', { exact: true })).toHaveValue('2000000000');
  await expect(page.getByLabel('Yearly amount your family needs (IDR)', { exact: true })).toHaveValue('120000000');
  await expect(page.getByTestId('answer-life-cover')).toContainText('915.358.073');
});

test('a half-typed rate is refused on its own row, and the page stays up', async ({ page }) => {
  await page.goto('/calculators/life-cover');
  await type(page, 'Yearly amount your family needs (IDR)', '120000000');
  await type(page, 'Debts to clear (IDR)', '300000000');
  await type(page, 'Education still to fund (IDR)', '150000000');
  await type(page, 'Final expenses (IDR)', '25000000');
  await type(page, 'Liquid assets (IDR)', '200000000');
  await type(page, 'Cover already in force (IDR)', '500000000');
  await expect(page.getByTestId('answer-life-cover')).toContainText('884.641.927');

  await type(page, 'Return on the payout (%)', '-');
  await expect(page.getByText('Type a percentage, like 3,5')).toBeVisible();
  await expect(page.getByTestId('answer-life-cover')).toHaveCount(0);
  await type(page, 'Return on the payout (%)', '-100');
  await expect(page.getByText('A rate cannot take away everything')).toBeVisible();
  await type(page, 'Return on the payout (%)', '5');
  await expect(page.getByTestId('answer-life-cover')).toContainText('884.641.927');
});
