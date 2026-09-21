import { expect, test } from '@playwright/test';
import { goalCard, jeniusWithTwoGoals, openAccountPage, openExpense, transferOutBorrowingFromUmrah, typeAmount } from './set-aside';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('an expense within what is free says nothing; one rupiah more asks', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  const form = await openExpense(page, 'Jenius');
  await typeAmount(page, form, '5000000');
  await expect(form.getByText(/more than is free/)).toHaveCount(0);
  const input = form.getByLabel('Amount', { exact: true });
  await input.click();
  await input.press('End');
  await input.press('Backspace');
  await input.pressSequentially('1');
  await input.press('Tab');
  // 5.000.001: over by Rp 1. formatMinor puts a non-breaking space after "Rp", so match it as any one character.
  await expect(form.getByText(/Rp.1 more than is free/i)).toBeVisible();
});

test('the laptop: pick a goal, say it is borrowing, and the goal and the account both say so', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  const form = await openExpense(page, 'Jenius');
  await typeAmount(page, form, '6800000');
  await expect(form.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'No — borrowing from it' }).click();
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').pressSequentially('Laptop');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);

  await page.goto('/goals');
  const ef = goalCard(page, 'Emergency fund');
  // The borrow shares the shortfall onto the goal it was taken from: covered 28.200.000, short 1.800.000 — and
  // Umrah, ranked below it, untouched (a rank-order share-out would have put the shortfall on Umrah).
  await expect(ef.getByText(/short by Rp.?1\.800\.000/i)).toBeVisible();
  await expect(ef.getByText(/28\.200\.000/).first()).toBeVisible();
  const umrah = goalCard(page, 'Umrah 2027');
  await expect(umrah.getByText(/short by/i)).toHaveCount(0);
  await expect(umrah.getByText(/7\.500\.000/).first()).toBeVisible();
  // The card's own history line ("went to Laptop") and the account page's split are Tasks 13 and 12.

  await openAccountPage(page, 'Jenius');
  // The bank's figure leads, and is the bank's: 42.500.000 − 6.800.000.
  await expect(page.getByText(/35\.700\.000/).first()).toBeVisible();
  // Under it, the split: 37.500.000 still set aside, so free is 35.700.000 − 37.500.000 = −1.800.000, in alarm.
  await expect(page.getByText(/^Rp.37\.500\.000$/).first()).toBeVisible();
  const free = page.getByText(/^-Rp.1\.800\.000$/);
  await expect(free).toBeVisible();
  await expect(free.locator('..')).toHaveClass(/ph-alarm/);
  // The shortfall sits on the goal that lent, not on Umrah below it.
  await expect(page.getByRole('link', { name: /^Emergency fund.*Short by Rp.1\.800\.000.*30\.000\.000/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Umrah 2027.*Covered.*7\.500\.000/ })).toBeVisible();
  // And the list is unchanged: the bank's figure, nothing about goals.
  await page.goto('/accounts');
  await expect(page.getByText(/free to spend/i)).toHaveCount(0);
});

test('Umrah tickets from the Umrah fund: the goal is done, not short', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  const form = await openExpense(page, 'Jenius');
  await typeAmount(page, form, '7500000');
  await form.getByRole('button', { name: 'Take from Umrah 2027' }).click();
  await form.getByRole('button', { name: 'Yes — this is what I saved for' }).click();
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').pressSequentially('Umrah tickets');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  // Saved, not merely pressed: navigating before the card closes loses the save.
  await expect(form).toHaveCount(0);

  await page.goto('/goals');
  const umrah = goalCard(page, 'Umrah 2027');
  // Spent, not broken: the whole promise came out, its stage is paid, and nothing reads short.
  await expect(umrah.getByRole('button', { name: /: Paid$/ })).toBeVisible();
  await expect(umrah.getByText(/Nothing yet/)).toBeVisible();
  await expect(umrah.getByText(/short by/i)).toHaveCount(0);
  // The Emergency fund was not asked for a rupiah: 5.000.000 free + 2.500.000 of Umrah's = 7.500.000.
  await expect(goalCard(page, 'Emergency fund').getByText(/30\.000\.000/).first()).toBeVisible();
  await expect(goalCard(page, 'Emergency fund').getByText(/short by/i)).toHaveCount(0);
  // "Done" and the archive hint are the goal card's own (Task 13).
});

test('deleting the purchase gives the promise back', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  const form = await openExpense(page, 'Jenius');
  await typeAmount(page, form, '7500000');
  await form.getByRole('button', { name: 'Take from Umrah 2027' }).click();
  await form.getByRole('button', { name: 'Yes — this is what I saved for' }).click();
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.goto('/transactions');
  // Rows are <li data-testid="transaction-row">, not ARIA rows; the two taps are TwoTapDelete's own names
  // (the armed one has a lower-case "d"), the pattern card-statements.spec.ts already uses.
  await page.locator('li', { hasText: /7\.500\.000/ }).first().click();
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page.getByRole('button', { name: 'Click again to delete' })).toHaveCount(0);
  await page.goto('/goals');
  const umrah = goalCard(page, 'Umrah 2027');
  await expect(umrah.getByText('Done')).toHaveCount(0);
  // The promise came back whole: the figure, not only the missing label.
  await expect(umrah.getByText(/7\.500\.000/).first()).toBeVisible();
});

test('an account that promised more than it holds says so on its page, and Net worth names it once', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await transferOutBorrowingFromUmrah(page);

  await openAccountPage(page, 'Jenius');
  await expect(page.getByText('You have promised more than this account holds.', { exact: false })).toBeVisible();
  await expect(page.getByText(/Rp.37\.500\.000 is set aside but only Rp.21\.000\.000 is here/)).toBeVisible();
  // 21.000.000 held − 37.500.000 promised, signed and in alarm.
  const free = page.getByText(/^-Rp.16\.500\.000$/);
  await expect(free).toBeVisible();
  await expect(free.locator('..')).toHaveClass(/ph-alarm/);
  // Umrah borrowed 16.500.000 but can be short no more than its own 7.500.000; the other 9.000.000 is the fund's.
  // (Capping each goal at the balance on its own would leave Umrah's 7.500.000 covered.)
  await expect(page.getByRole('link', { name: /^Umrah 2027.*Short by Rp.7\.500\.000/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Emergency fund.*Short by Rp.9\.000\.000/ })).toBeVisible();

  await page.goto('/net-worth');
  const jeniusRows = page.getByRole('link', { name: /Jenius/ });
  await expect(jeniusRows).toHaveCount(1);
  await expect(jeniusRows).toHaveAccessibleName(/^Jenius: Rp.37\.500\.000 set aside, Rp.21\.000\.000 here/);
  await jeniusRows.click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/]+$/);
  await expect(page.getByText('You have promised more than this account holds.', { exact: false })).toBeVisible();

  // Already short, so a small expense asks nothing: the account's own state says it, not every transaction.
  const form = await openExpense(page, 'Jenius');
  await typeAmount(page, form, '100000');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await expect(form.getByText(/more than is free/)).toHaveCount(0);
  await expect(form.getByRole('button', { name: /^Take from/ })).toHaveCount(0);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);

  // The extra 100.000 is not a borrow, so it lands by rank, lowest priority first — but Umrah is already short all
  // it promised, so it can only go to the Emergency fund: 9.100.000, and free now −16.600.000.
  await openAccountPage(page, 'Jenius');
  await expect(page.getByText(/^-Rp.16\.600\.000$/)).toBeVisible();
  await expect(page.getByRole('link', { name: /^Umrah 2027.*Short by Rp.7\.500\.000/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Emergency fund.*Short by Rp.9\.100\.000/ })).toBeVisible();
});
