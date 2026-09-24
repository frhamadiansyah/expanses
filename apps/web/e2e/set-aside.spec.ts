import { expect, test } from '@playwright/test';
import { addGoal, addMoneyAccount, goalCard, jeniusWithTwoGoals, openAccountPage, openExpense, setAside, transferOutBorrowingFromUmrah, typeAmount } from './set-aside';

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
  const ef = await goalCard(page, 'Emergency fund');
  // The borrow shares the shortfall onto the goal it was taken from: covered 28.200.000, short 1.800.000 — and
  // Umrah, ranked below it, untouched (a rank-order share-out would have put the shortfall on Umrah).
  // Under the figure, the shortfall (the Funded-by row repeats it below).
  await expect(ef.getByText(/^Short by Rp.1\.800\.000$/)).toBeVisible();
  await expect(ef.getByText(/28\.200\.000/).first()).toBeVisible();
  // The fund's target has grown past the 30.000.000 set aside (a holiday goal grows 3% a year), so it was never whole:
  // it must not claim it "stood whole" before the laptop. The next test borrows from a goal that was.
  await expect(ef.getByText(/Fully funded/)).toHaveCount(0);
  await expect(ef.getByText(/went to/)).toHaveCount(0);
  // The Funded-by row says it in the account's own terms.
  await expect(ef.getByTestId('goal-link').filter({ hasText: 'Jenius' })).toContainText(/set aside · short by Rp.1\.800\.000/);
  // And the history keeps the borrow, signed, with what it was for.
  const borrowed = ef.getByTestId('goal-history').filter({ hasText: 'Borrowed' });
  await expect(borrowed).toHaveCount(1);
  await expect(borrowed).toContainText(/Laptop/);
  await expect(borrowed).toContainText(/-Rp.1\.800\.000/);

  const umrah = await goalCard(page, 'Umrah 2027');
  await expect(umrah.getByText(/short by/i)).toHaveCount(0);
  await expect(umrah.getByText(/7\.500\.000/).first()).toBeVisible();
  await expect(umrah.getByText(/went to/)).toHaveCount(0);

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
  // And the list now says so in the account's own terms: the tile is what is left to spend once the goals have had
  // their share, and the working under it names the goal money rather than dropping it silently.
  await page.goto('/accounts');
  await expect(page.getByText('Free to spend')).toBeVisible();
  // The tile's first line is what the rows below already show: money that can be moved, less what goals claimed it.
  // Nothing under it says so in words any more — the account's own page takes a promise apart goal by goal — and the
  // line carries no caption either: an estimate says so with the kit's ≈ on the figure itself.
  await expect(page.getByText('Spending money')).toBeVisible();
  await expect(page.getByText('free of what goals claimed')).toHaveCount(0);
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
  const umrah = await goalCard(page, 'Umrah 2027');
  // Spent, not broken: the whole promise came out, its stage is paid, and nothing reads short.
  await expect(umrah.getByRole('button', { name: /: Paid$/ })).toBeVisible();
  await expect(umrah.getByText(/Nothing yet/)).toBeVisible();
  await expect(umrah.getByText(/short by/i)).toHaveCount(0);
  // Done — and the archive group says what archiving now does.
  await expect(umrah.getByText('Done', { exact: true })).toBeVisible();
  await expect(umrah.getByText('Keeps the history, stops it claiming money.')).toBeVisible();
  const spent = umrah.getByTestId('goal-history').filter({ hasText: 'Spent' });
  await expect(spent).toContainText(/Umrah tickets/);
  await expect(spent).toContainText(/-Rp.7\.500\.000/);
  // The Emergency fund was not asked for a rupiah: 5.000.000 free + 2.500.000 of Umrah's = 7.500.000 — and it was
  // spent from nothing, so it stays open.
  const ef = await goalCard(page, 'Emergency fund');
  await expect(ef.getByText(/30\.000\.000/).first()).toBeVisible();
  await expect(ef.getByText(/short by/i)).toHaveCount(0);
  await expect(ef.getByText('Done', { exact: true })).toHaveCount(0);
  await expect(ef.getByText('Keeps the history, stops it claiming money.')).toHaveCount(0);
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
  const umrah = await goalCard(page, 'Umrah 2027');
  await expect(umrah.getByText('Done', { exact: true })).toHaveCount(0);
  await expect(umrah.getByText('Keeps the history, stops it claiming money.')).toHaveCount(0);
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

test('the goal form says what is free for this goal, and how short a bigger figure leaves the account', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await page.goto('/goals');
  const umrah = await goalCard(page, 'Umrah 2027');
  await umrah.getByRole('button', { name: 'Edit' }).click();
  // 5.000.000 free on Jenius plus Umrah's own 7.500.000 there, which the save replaces: 12.500.000.
  await expect(page.getByText(/^Rp.12\.500\.000 free for this goal$/)).toBeVisible();
  const box = page.getByLabel('Jenius (IDR)');
  await box.clear();
  await box.pressSequentially('12500001');
  await expect(page.getByText(/^That leaves Jenius Rp.1 short$/)).toBeVisible();
  await box.press('Backspace');
  await expect(page.getByText(/^Rp.12\.500\.000 free for this goal$/)).toBeVisible();
});

test('a goal that was whole says when it stood whole and where the money went', async ({ page }) => {
  // 9.000.000 set aside against a 7.500.000 goal (a little more with growth): whole. Jenius holds 42.500.000, so
  // 33.500.000 is free and a 38.000.000 laptop is 4.500.000 over.
  await addMoneyAccount(page, 'Jenius', 'savings', '42500000');
  await addGoal(page, 'Umrah 2027', '7500000');
  await setAside(page, 'Umrah 2027', 'Jenius (IDR)', '9000000');
  const form = await openExpense(page, 'Jenius');
  await typeAmount(page, form, '38000000');
  await expect(form.getByText(/4\.500\.000 more than is free/)).toBeVisible();
  await form.getByRole('button', { name: 'Take from Umrah 2027' }).click();
  await form.getByRole('button', { name: 'No — borrowing from it' }).click();
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').pressSequentially('Laptop');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);

  await page.goto('/goals');
  const umrah = await goalCard(page, 'Umrah 2027');
  await expect(umrah.getByText(/^Short by Rp.4\.500\.000$/)).toBeVisible();
  // Its start is the day it became whole when the records say so, else "until" (ruling Q4); either way it ends today.
  await expect(umrah.getByText(/^Fully funded (on \d+ \w+|until \d+ \w+|\d+ \w+ – \d+ \w+)$/)).toBeVisible();
  // The borrow is the part over what was free, 4.500.000 — not the whole 38.000.000 payment.
  await expect(umrah.getByText(/^Rp.4\.500\.000 went to Laptop\. Put it back and the fund is complete again\.$/)).toBeVisible();
  await expect(umrah.getByTestId('goal-link').filter({ hasText: 'Jenius' })).toContainText(/set aside · short by Rp.4\.500\.000/);
  // A borrow is not a spend: still open.
  await expect(umrah.getByText('Done', { exact: true })).toHaveCount(0);
});

test('the goal form\'s hint reads today\'s balance, as the question does: money dated next month is not free yet', async ({ page }) => {
  // Nothing is promised on BCA, so the hint falls back to the balance — today's, not one counting a future entry.
  await addMoneyAccount(page, 'BCA', 'savings', '10000000');
  await addGoal(page, 'Umrah 2027', '7500000');
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Income' }).click();
  await typeAmount(page, form, '5000000');
  await form.getByRole('button', { name: /^Received into/ }).click();
  await page.getByRole('dialog', { name: 'Received into' }).getByRole('button', { name: 'BCA', exact: true }).click();
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Salary', exact: true }).click();
  await form.getByLabel('Note').pressSequentially('Bonus');
  const next = new Date();
  next.setMonth(next.getMonth() + 1);
  await form.getByLabel('Date').fill(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-15`);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);

  await page.goto('/goals');
  const umrah = await goalCard(page, 'Umrah 2027');
  await umrah.getByRole('button', { name: 'Edit' }).click();
  // 10.000.000 today; counting the 5.000.000 dated next month would say 15.000.000, a figure the question never uses.
  await expect(page.getByText(/^Rp.10\.000\.000 free for this goal$/)).toBeVisible();
  await expect(page.getByText(/15\.000\.000 free for this goal/)).toHaveCount(0);
});
