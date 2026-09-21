import { expect, test } from '@playwright/test';
import { at, automate, confirmEach, expectBalance, openDeposit, settingsSaved, setUp, startReport, typeInto } from './deposit-maturity';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('is off by default and changes nothing', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await expect(page.getByLabel('Automate')).not.toBeChecked();
  await expect(page.getByTestId('maturity-principal')).toHaveCount(0);
  await page.clock.setSystemTime(at(s.matures));
  await page.goto('/net-worth/assets');
  await expect(page.getByRole('link', { name: /^BCA Deposito/ })).not.toContainText('Due');
  await openDeposit(page, s.depositName);
  await expect(page.getByTestId('deposit-proposal')).toHaveCount(0);
  await expectBalance(page, s.payoutName, '1.000.000');
});

test('keeps its settings across a reload, and a typed withholding', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'close', paid: 'monthly', exempt: false });
  await typeInto(page, 'Tax withheld %', '12,5');
  await page.getByLabel('Tax withheld %').press('Tab');
  await settingsSaved(page);
  await page.reload();
  await expect(page.getByLabel('Automate')).toBeChecked();
  await expect(page.getByTestId('maturity-close').getByLabel('Chosen')).toBeVisible();
  await expect(page.getByLabel('Interest paid')).toHaveValue('monthly');
  await expect(page.getByLabel('Term', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Lands in')).toHaveValue(/.+/);
  await expect(page.getByLabel('Tax withheld %')).toHaveValue('12,5');
});

test('proposes on the day and posts what was confirmed, with a new term', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'principal', paid: 'at_maturity', exempt: false });
  await page.clock.setSystemTime(at('2026-10-14'));
  await page.reload();
  await expect(page.getByTestId('deposit-proposal')).toHaveCount(0);
  await page.clock.setSystemTime(at(s.matures));
  await page.reload();
  const card = page.getByTestId('deposit-proposal');
  await expect(card).toContainText('Matured today');
  await expect(card).toContainText('50.000.000');
  await expect(card).toContainText('428.493');
  await expect(card).toContainText('after 20% tax');
  await expect(card).toContainText('Roll over 3 months · interest to BCA Tahapan');
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Matures 15 Jan 2027 · 4,25%')).toBeVisible();
  await expectBalance(page, s.payoutName, '1.428.493');
});

test('posts edited gross and tax as typed, lands their difference, and a new rate that was not kept', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'principal', paid: 'at_maturity', exempt: false });
  await page.getByLabel('Keep the rate when it rolls over').uncheck();
  // The reload must not overtake the save, or the rate comes back kept.
  await settingsSaved(page);
  await page.clock.setSystemTime(at(s.matures));
  await page.reload();
  const card = page.getByTestId('deposit-proposal');
  await card.getByRole('button', { name: 'Edit figures' }).click();
  await typeInto(page, 'Interest before tax', '535.700');
  await typeInto(page, 'Tax withheld', '107.140');
  // What lands is worked out as it is typed: 535.700 − 107.140.
  await expect(card).toContainText('428.560');
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card).toContainText('Type the rate the new term pays');
  await typeInto(page, 'New rate %', '4');
  await page.getByLabel('New term').selectOption('6');
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Matures 15 Apr 2027 · 4%')).toBeVisible();
  await expectBalance(page, s.payoutName, '1.428.560');
});

test('once the editor is closed, the card shows exactly what Confirm posts', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'principal', paid: 'at_maturity', exempt: false });
  await page.clock.setSystemTime(at(s.matures));
  await page.reload();
  const card = page.getByTestId('deposit-proposal');
  await card.getByRole('button', { name: 'Edit figures' }).click();
  await typeInto(page, 'Interest before tax', '535.700');
  await typeInto(page, 'Tax withheld', '107.140');
  await typeInto(page, 'New rate %', '4,1');
  await page.getByLabel('New term').selectOption('6');
  await card.getByRole('button', { name: 'Done editing' }).click();
  await expect(card.getByLabel('Interest before tax')).toHaveCount(0);
  // The typed figures, not the estimate (535.616 before tax, 428.493 after 20% tax, a 3-month roll-over).
  await expect(card).toContainText('535.700');
  await expect(card).toContainText('428.560 after tax');
  await expect(card).toContainText('Roll over 6 months · interest to BCA Tahapan');
  await expect(card).toContainText('4,1%');
  await expect(card).not.toContainText('535.616');
  await expect(card).not.toContainText('428.493');
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Matures 15 Apr 2027 · 4,1%')).toBeVisible();
  await expectBalance(page, s.payoutName, '1.428.560');
});

test('records it by hand: nothing posts, and the next one is proposed', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'principal', paid: 'monthly', exempt: false });
  await page.clock.setSystemTime(at(s.matures));
  await page.reload();
  const card = page.getByTestId('deposit-proposal');
  await expect(card).toContainText('Interest due 15 Aug 2026');
  await card.getByRole('button', { name: 'Recorded it myself' }).click();
  // Chromium's en-GB spells September "Sept"; the day is what this checks.
  await expect(card).toContainText(/Interest due 15 Sept? 2026/);
  await expect(card).toContainText('1 more waiting');
  await expectBalance(page, s.payoutName, '1.000.000');
});

test('records it by hand with the figures typed on screen, and the tax report reads those', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'principal', paid: 'at_maturity', exempt: false });
  await page.clock.setSystemTime(at(s.matures));
  await page.reload();
  const card = page.getByTestId('deposit-proposal');
  await card.getByRole('button', { name: 'Edit figures' }).click();
  // What the bank credited, typed over the estimate (535.616 and 107.123).
  await typeInto(page, 'Interest before tax', '535.700');
  await typeInto(page, 'Tax withheld', '107.140');
  await card.getByRole('button', { name: 'Recorded it myself' }).click();
  await expect(card).toHaveCount(0);
  await expectBalance(page, s.payoutName, '1.000.000'); // nothing posted
  await startReport(page, 2026);
  const row = page.getByTestId('income-row').filter({ hasText: s.depositName });
  await expect(row).toContainText('interest');
  await expect(row).toContainText('535.700');
  const finalBand = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Final tax' }) }).last();
  await expect(finalBand).toContainText('107.140');
  await expect(finalBand).not.toContainText('107.123');
});

test('proposes queued payouts one after another, never on their own', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'principal', paid: 'monthly', exempt: false });
  await page.clock.setSystemTime(at(s.matures));
  await page.reload();
  await expect(page.getByTestId('deposit-proposal')).toContainText('Interest due 15 Aug 2026');
  await expectBalance(page, s.payoutName, '1.000.000'); // nothing moved by itself
  await openDeposit(page, s.depositName);
  await confirmEach(page, ['144.384', '144.384', '139.726']);
});

test('refuses on screen to void a payout from before a logged roll-over, and says which to void first', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'principal', paid: 'monthly', exempt: false });
  await page.clock.setSystemTime(at(s.matures));
  await page.reload();
  await confirmEach(page, ['144.384', '144.384', '139.726']);
  await expect(page.getByTestId('deposit-proposal')).toHaveCount(0);
  // The oldest of the three interest postings: the August payout, logged before the October roll-over.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Earlier period' }).click();
  await page.getByRole('button', { name: 'Earlier period' }).click();
  await expect(page.getByRole('button', { name: /^August 2026/ })).toBeVisible();
  await page.getByRole('link', { name: 'Receipt for Interest: BCA Deposito' }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-zA-Z-]{20,}$/);
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page.getByText('A later payout of this deposit is recorded. Void that one first, then this one.')).toBeVisible();
  // Refused whole: nothing moved.
  await expectBalance(page, s.payoutName, '1.428.494');
});
