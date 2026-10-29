import { expect, test } from '@playwright/test';
import { openCard } from './accounts';
import { iso, openWalletCard, setFee } from './card-spend-bonus';

/** Counts on the fee waiver: a row that says All purchases or the picked categories, and a sheet that picks them. */
test('phone: Counts picks categories on a sheet, the row sums them up, and the choice survives a reload', async ({ page }) => {
  await openCard(page, { name: 'Counts Card', statementDay: '31', dueDay: '15' });
  await openWalletCard(page, 'Counts Card');
  const chargedOn = new Date();
  chargedOn.setFullYear(chargedOn.getFullYear() - 1);
  await setFee(page, '800000', iso(chargedOn));
  await page.getByTestId('fee-waiver-row').click();
  await page.getByTestId('waiver-challenge').click();
  await page.getByLabel('Spend', { exact: true }).fill('1500000');
  await page.getByLabel('Counted from').fill(iso(new Date()));
  const by = new Date();
  by.setDate(by.getDate() + 3);
  await page.getByLabel('Spend by').fill(iso(by));

  const row = page.getByTestId('counts-row');
  await expect(row).toContainText('Counts');
  await expect(row).toContainText('All purchases');
  await expect(page.getByText('Ctrl/⌘-click')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('row.png') });

  await row.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('checkbox', { name: 'All purchases' })).toBeChecked();
  await page.screenshot({ path: test.info().outputPath('sheet.png') });
  await sheet.getByRole('checkbox', { name: 'Shopping', exact: true }).click();
  await expect(sheet.getByRole('checkbox', { name: 'All purchases' })).not.toBeChecked();
  await sheet.getByRole('checkbox', { name: 'Transportation', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('picked.png') });
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(row).toContainText('Shopping, Transport');
  await page.screenshot({ path: test.info().outputPath('back.png') });

  // Closing with the cross discards what was ticked in the sheet.
  await row.click();
  await page.getByRole('checkbox', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(row).toContainText('Shopping, Transport');

  // Reopened, the picks are ticked; a third makes the line carry +1.
  await row.click();
  await expect(page.getByRole('checkbox', { name: 'Shopping', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Utilities', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(row).toContainText('Shopping, Transportation +1');

  // All purchases clears the list.
  await row.click();
  await page.getByRole('checkbox', { name: 'All purchases' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(row).toContainText('All purchases');

  // Saved with two, reloaded: the two come back.
  await row.click();
  await page.getByRole('checkbox', { name: 'Shopping', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Transportation', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('waiver-save').click();
  await page.getByTestId('fee-waiver-row').click();
  await page.reload();
  await expect(page.getByTestId('counts-row')).toContainText('Shopping, Transport');

  // And All purchases, saved, is All purchases after a reload.
  await page.getByTestId('counts-row').click();
  await page.getByRole('checkbox', { name: 'All purchases' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('waiver-save').click();
  await page.getByTestId('fee-waiver-row').click();
  await page.reload();
  await expect(page.getByTestId('counts-row')).toContainText('All purchases');
});
