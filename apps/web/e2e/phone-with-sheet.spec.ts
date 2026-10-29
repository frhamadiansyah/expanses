import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, choosePayment, closeDetails, fillAmount, openAmount, saveButton, shareWith } from './add-transaction';

test('With is one sideways row of people: pick, filter, and add a new name from the row itself', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan' });
  await page.goto('/transactions/new');
  const form = addForm(page);

  // A first person is added by name; the dashed circle is the only add control.
  const { more, sheet } = await shareWith(page, form, [{ name: 'Dewi' }]);
  await expect(sheet.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Dewi', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await closeDetails(more, sheet);
  await openAmount(form);
  await fillAmount(page, form, '90000');
  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Tahapan');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // Dewi is now on the books: a fresh bill offers her in the row, unpicked.
  await page.goto('/transactions/new');
  const again = addForm(page);
  await again.getByRole('button', { name: 'Add more details' }).click();
  await page.getByRole('region', { name: 'More details' }).getByRole('button', { name: 'With', exact: true }).click();
  const withSheet = page.getByRole('dialog', { name: 'With', exact: true });
  const dewi = withSheet.getByRole('button', { name: 'Dewi', exact: true });
  await expect(dewi).toHaveAttribute('aria-pressed', 'false');
  await dewi.click();
  await expect(dewi).toHaveAttribute('aria-pressed', 'true');
  await dewi.click();
  await expect(dewi).toHaveAttribute('aria-pressed', 'false');

  // Typing filters the row; a name nobody has shows nothing extra, and Enter adds it at the end, picked.
  const search = withSheet.getByLabel('Search or add a person');
  await search.fill('Ayu');
  await expect(dewi).toHaveCount(0);
  await expect(withSheet.getByRole('button', { name: /^New person/ })).toHaveCount(0);
  await search.press('Enter');
  await expect(search).toHaveValue('');
  await expect(withSheet.getByRole('button', { name: 'Ayu', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(withSheet.getByRole('status')).toHaveText('Added Ayu');
  await expect(withSheet.getByTestId('with-people').getByRole('button').last()).toHaveAccessibleName('Ayu');
  await withSheet.screenshot({ path: `${process.env.SHOTS ?? test.info().outputDir}/with-after-add.png` });
  // A name already in the row is that person, not a second one.
  await search.fill('dewi');
  await expect(withSheet.getByRole('button', { name: /^New person/ })).toHaveCount(0);
  await search.fill('');
  await expect(dewi).toBeVisible();
});
