import { expect, type Page, test } from '@playwright/test';
import { addGoal, addMoneyAccount, goalCard, openAccountPage, setAside } from './set-aside';

/*
 * A goal's Monthly that comes due like a bill (mockup 2026-11-12-goal-monthly-like-bill): turned on in the Monthly
 * sheet, the goal shows on Recurring under "Goals this month"; Set aside adds the amount to the account's Set aside,
 * Undo takes it back, Skip shows Skipped. Names and figures are made up.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const thisMonth = () => MONTHS[new Date().getMonth()]!;

/** The account page's Set aside row, whole. */
async function expectSetAside(page: Page, account: string, figure: string) {
  await openAccountPage(page, account);
  await expect(page.getByText('Set aside', { exact: true }).first().locator('xpath=ancestor::div[@style][1]')).toHaveText(new RegExp(`^Set aside\\s*${figure}$`));
}

async function turnOnDue(page: Page, goal: string, monthly: string) {
  const card = await goalCard(page, goal);
  await card.getByRole('button', { name: 'Monthly', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: `Monthly for ${goal}` });
  await sheet.getByLabel('Each month', { exact: true }).fill(monthly);
  await sheet.getByTestId('due-each-month').check();
  await expect(sheet.getByLabel('On the', { exact: true })).toHaveValue('1');
  await sheet.getByLabel('On the', { exact: true }).selectOption({ label: '25th' });
  await expect(sheet.getByRole('radio', { name: 'Set aside' })).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByText(/^Comes due on the 25th, like a bill\. Set aside keeps the money in Bank Mandala, promised to Umrah 2027/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(card.getByTestId('goal-monthly-row')).toContainText('Due on the 25th · Set aside in Bank Mandala');
}

test('Due each month: Recurring shows the goal, Set aside grows the account’s Set aside, Undo restores it, Skip shows Skipped', async ({ page }) => {
  await addMoneyAccount(page, 'Bank Mandala', 'savings', '20000000');
  await addGoal(page, 'Umrah 2027', '30000000');
  await setAside(page, 'Umrah 2027', 'Bank Mandala (IDR)', '1000000');
  await turnOnDue(page, 'Umrah 2027', '1500000');

  await page.goto('/bills');
  const group = page.getByTestId('goals-this-month');
  await expect(group).toBeVisible();
  await expect(group).toContainText('Goals this month');
  await expect(group).toContainText(/Rp\s1\.500\.000/);
  const row = group.getByTestId('goal-due-row').filter({ hasText: 'Umrah 2027' });
  await expect(row).toContainText(/25 \w{3} · Rp\s1\.500\.000/);

  await row.getByRole('button', { name: 'Set aside for Umrah 2027' }).click();
  const sheet = page.getByRole('dialog', { name: `Umrah 2027 · ${thisMonth()}` });
  await expect(sheet.getByLabel('Amount', { exact: true })).toHaveValue('1.500.000');
  await expect(sheet.getByText('Free to spend there')).toBeVisible();
  await expect(sheet.getByText(`Skip ${thisMonth()}`)).toBeVisible();
  await sheet.getByRole('button', { name: 'Set aside', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  await expect(page.getByText(`Set aside for Umrah 2027 · ${thisMonth()}`)).toBeVisible();
  await expect(row.getByTestId('goal-due-status')).toHaveText('✓ Set aside');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row.getByRole('button', { name: 'Set aside for Umrah 2027' })).toBeVisible();
  await expectSetAside(page, 'Bank Mandala', 'Rp\\s1\\.000\\.000');

  // Set aside again, and it stays: the account's Set aside grows by exactly the amount.
  await page.goto('/bills');
  await page.getByTestId('goal-due-row').filter({ hasText: 'Umrah 2027' }).getByRole('button', { name: 'Set aside for Umrah 2027' }).click();
  await page.getByRole('dialog', { name: `Umrah 2027 · ${thisMonth()}` }).getByRole('button', { name: 'Set aside', exact: true }).click();
  await expect(page.getByTestId('goal-due-row').filter({ hasText: 'Umrah 2027' }).getByTestId('goal-due-status')).toHaveText('✓ Set aside');
  await expectSetAside(page, 'Bank Mandala', 'Rp\\s2\\.500\\.000');

  // The goal page's Month history: the month done, and undone from there.
  const card = await goalCard(page, 'Umrah 2027');
  const month = card.getByTestId('due-month').first();
  await expect(month).toContainText(thisMonth());
  await expect(month).toContainText(/Set aside \d+ \w{3} · Bank Mandala/);
  await expect(card.getByText('Tap a month to undo it or change what was set aside.')).toBeVisible();
  await month.click();
  await page.getByRole('dialog', { name: `Umrah 2027 · ${thisMonth()}` }).getByTestId('due-undo').click();
  await expect(card.getByTestId('due-month').first()).toContainText('Open');
  await expectSetAside(page, 'Bank Mandala', 'Rp\\s1\\.000\\.000');

  // Skip, from the month's sheet: the row says Skipped, nothing moves.
  await page.goto('/bills');
  const again = page.getByTestId('goal-due-row').filter({ hasText: 'Umrah 2027' });
  await again.getByRole('button', { name: 'Set aside for Umrah 2027' }).click();
  await page.getByRole('dialog', { name: `Umrah 2027 · ${thisMonth()}` }).getByTestId('due-skip').click();
  await expect(again.getByTestId('goal-due-status')).toHaveText('Skipped');
  await expect(page.getByText(`Skipped Umrah 2027 · ${thisMonth()}`)).toBeVisible();
  await expectSetAside(page, 'Bank Mandala', 'Rp\\s1\\.000\\.000');
});

test('Off, the Monthly sheet is the plan figure only and Recurring shows no goals', async ({ page }) => {
  await addMoneyAccount(page, 'Bank Mandala', 'savings', '20000000');
  await addGoal(page, 'Umrah 2027', '30000000');
  const card = await goalCard(page, 'Umrah 2027');
  await card.getByRole('button', { name: 'Monthly', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Monthly for Umrah 2027' });
  await expect(sheet.getByTestId('due-each-month')).not.toBeChecked();
  await expect(sheet.getByLabel('On the', { exact: true })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(card.getByTestId('goal-monthly-row')).toHaveCount(0);

  await page.goto('/bills');
  await expect(page.getByRole('heading', { name: 'Recurring' })).toBeVisible();
  await expect(page.getByTestId('goals-this-month')).toHaveCount(0);
});
