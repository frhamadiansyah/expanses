import { expect, type Page, test } from '@playwright/test';
import { addEvent, addWallet, chooseCategory } from './event-plan';

/*
 * Price each and Estimate on the cost form are one amount design: regular weight, the symbol a space before a number
 * grouped as it is typed — "Rp 9.800.000" — and the value that is saved is the figure typed, grouping or not.
 */

const weightOf = (field: ReturnType<Page['getByLabel']>) => field.evaluate((el) => getComputedStyle(el).fontWeight);

test('Price each groups as it is typed, the Estimate is spaced, both are regular weight, and the saved price is unchanged', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Museum trip');
  await page.getByRole('link', { name: 'Plan what to pay' }).click();
  await page.getByRole('link', { name: 'Add the first cost' }).click();
  await page.getByLabel('What', { exact: true }).fill('Flight');
  const price = page.getByLabel('Price each');
  await price.pressSequentially('9800000');
  await expect(price).toHaveValue('9.800.000');
  const estimate = page.getByLabel('Estimate');
  await expect(estimate).toHaveValue('Rp 9.800.000');
  expect(await weightOf(price)).toBe('400');
  expect(await weightOf(estimate)).toBe('400');
  expect(await price.evaluate((el) => getComputedStyle(el).fontSize)).toBe(await estimate.evaluate((el) => getComputedStyle(el).fontSize));

  // The symbol is still the way to another currency.
  await page.getByRole('button', { name: 'Currency: IDR' }).click();
  await expect(page.getByRole('dialog', { name: 'Currency' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Currency' })).toHaveCount(0);

  // The labels of the two text rows: Remarks is the row, Note its guide; Purchase link holds the address.
  await expect(page.getByLabel('Remarks')).toHaveAttribute('placeholder', 'Note');
  await page.getByLabel('Purchase link').fill('https://example.com/flight');

  await chooseCategory(page, 'Food and beverage');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Flight' })).toContainText('Rp 9.800.000');

  // Editing reads the saved figure back grouped, and saving it untouched keeps the amount.
  await page.getByTestId('plan-item').filter({ hasText: 'Flight' }).getByRole('link').click();
  await expect(page.getByText('Purchase link', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Price each')).toHaveValue('9.800.000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('item-figures')).toContainText(/Rp\s9\.800\.000/);
});
