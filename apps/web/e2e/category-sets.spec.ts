import { expect, type Page, test } from '@playwright/test';

const TODAY = new Date().toISOString().slice(0, 10);

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addWallet(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('90000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

async function addEvent(page: Page, name: string, set: string) {
  await page.goto('/events');
  await page.getByRole('button', { name: 'Add an event' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Categories').selectOption({ label: set });
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByTestId('event-row')).toContainText(name);
}

/**
 * The sets UI asks through window.prompt, and the blanket handler above accepts with an empty string,
 * which would answer every prompt with nothing at all. These tests answer in order instead.
 */
function answerPrompts(page: Page, answers: string[]) {
  const queue = [...answers];
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => void dialog.accept(dialog.type() === 'prompt' ? (queue.shift() ?? '') : ''));
}

test('a set of your own can be made, added to, and drawn on by an event', async ({ page }) => {
  await addWallet(page);

  await page.goto('/categories');
  answerPrompts(page, ['Wedding', 'Catering', 'Venue']);
  await page.getByRole('button', { name: 'Add a set' }).click();
  await expect(page.getByTestId('set-Wedding')).toBeVisible();

  await page.getByRole('button', { name: 'Add a category to Wedding' }).click();
  await page.getByRole('button', { name: 'Add a category to Wedding' }).click();
  await expect(page.getByTestId('set-Wedding')).toContainText('Catering');
  await expect(page.getByTestId('set-Wedding')).toContainText('Venue');

  // Made here, usable there: the event draws on the set without any of it reaching the monthly tree.
  await addEvent(page, 'Nikahan', 'Wedding');
  await page.getByRole('link', { name: 'Open' }).click();
  await page.getByLabel('Description').fill('Katering Bu Tuti');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Catering' });
  await page.getByLabel('Amount', { exact: true }).fill('12000000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('event-total')).toContainText('12.000.000');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  // Anchored: the monthly tree has its own Home catering and School catering, which must stay.
  await expect(page.getByLabel('Category').locator('option', { hasText: /^Catering$/ })).toHaveCount(0);
  await expect(page.getByLabel('Category').locator('option', { hasText: /^Home catering$/ })).toHaveCount(1);
});

test('a set category can be renamed, and archiving it leaves the set', async ({ page }) => {
  await page.goto('/categories');
  answerPrompts(page, ['Lodging & stays']);

  await page.getByTestId('set-Holiday').getByRole('button', { name: 'Rename Lodging' }).click();
  await expect(page.getByTestId('set-Holiday')).toContainText('Lodging & stays');

  await page.getByTestId('set-Holiday').getByRole('button', { name: 'Archive Photo' }).click();
  await expect(page.getByTestId('set-Holiday')).not.toContainText('Photo');
});

test('an event can be called done, and put back', async ({ page }) => {
  await addEvent(page, 'Lebaran', 'Holiday');

  await page.getByRole('button', { name: 'Finish Lebaran' }).click();
  // Gone from what is still asking for attention, not gone from the workspace.
  await expect(page.getByTestId('event-row')).toHaveCount(0);

  await page.getByRole('button', { name: /Show finished/ }).click();
  await expect(page.getByTestId('event-row')).toContainText('Lebaran');
  await expect(page.getByTestId('event-row')).toContainText('finished');

  // Reopening empties the finished list, so its toggle goes with it: the row is simply back.
  await page.getByRole('button', { name: 'Reopen Lebaran' }).click();
  await expect(page.getByTestId('event-row')).toContainText('Lebaran');
  await expect(page.getByTestId('event-row')).not.toContainText('finished');
  await expect(page.getByRole('button', { name: /finished/ })).toHaveCount(0);
});

test('a set category can be given a card MCC, so its spending earns the right rate', async ({ page }) => {
  await page.goto('/categories');
  answerPrompts(page, ['4511']);

  const holiday = page.getByTestId('set-Holiday');
  await expect(holiday.getByText('No card MCC').first()).toBeVisible();
  await holiday.getByRole('button', { name: 'Card MCC for Flights' }).click();
  await expect(holiday).toContainText('MCC 4511 (yours)');

  // Clearing puts it back to having none, the same as the monthly categories behave.
  await holiday.getByRole('button', { name: 'Reset card MCC for Flights' }).click();
  await expect(holiday).not.toContainText('MCC 4511');
});

test('an event records its spending in its own categories, from its own page', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Rumah Bintaro', 'Renovation');

  await page.getByRole('link', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Rumah Bintaro' })).toBeVisible();
  await expect(page.getByText('draws on Renovation')).toBeVisible();

  await page.getByLabel('Description').fill('Keramik lantai');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Flooring & Tiles' });
  await page.getByLabel('Amount', { exact: true }).fill('7500000');
  await page.getByRole('button', { name: 'Save' }).click();

  // Tagged to the event as it was written, so the total stands without any hunting afterwards.
  await expect(page.getByTestId('event-total')).toContainText('7.500.000');
  await expect(page.getByTestId('event-detail-sheet')).toContainText('Flooring & Tiles');
});

test('a set stays out of the monthly categories, and its spending out of the monthly caps', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Bayi', 'Newborn');
  await page.getByRole('link', { name: 'Open' }).click();
  await page.getByLabel('Description').fill('Popok');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Diapering' });
  await page.getByLabel('Amount', { exact: true }).fill('900000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('event-total')).toContainText('900.000');

  // The everyday form offers the monthly tree only: a newborn's categories are not what you file the shop under.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByLabel('Category').locator('option', { hasText: 'Diapering' })).toHaveCount(0);
  await expect(page.getByLabel('Category').locator('option', { hasText: 'Groceries' })).toHaveCount(1);

  // And the budget plans the month, not the event.
  await page.goto('/budget');
  await expect(page.getByLabel('Category', { exact: true }).locator('option', { hasText: 'Diapering' })).toHaveCount(0);
  await expect(page.getByTestId('line-Diapering')).toHaveCount(0);

  // Spending still has to be visible somewhere, grouped as the set it belongs to.
  await page.goto('/spending');
  await expect(page.getByTestId('set-group-Newborn')).toContainText('Diapering');
  await expect(page.getByTestId('set-group-Newborn')).toContainText('900.000');
});
