import { expect, type Page, test } from '@playwright/test';
import { doubleClickInPlace } from './desk-double-click';
import { goalMenu } from './goals';
import { GOALS, goalsHousehold } from './goals-desk';
import { goalCard, goalRow } from './set-aside';

/*
 * Goals on a wide screen (Mac redesign step 10): Saved for goals, Each month and a chart box of two pages — where saving
 * goes and when each goal is due — turned by a two-finger swipe, its dots or its ‹ ›, the page kept on this device; then
 * every goal in one table, compulsory first. A click opens the goal's side peek (its page in brief, with Set aside, Tag a
 * purchase, Use and Monthly), a double-click its page; Done lists the goals finished. The figures are the phone's.
 * Invented household (`goalsHousehold`).
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const peek = (page: Page) => page.getByTestId('goal-peek');
const chart = (page: Page) => page.getByTestId('goals-chart');
const names = (page: Page, section: 'compulsory' | 'additional') => page.getByTestId(`goals-${section}`).getByTestId('goal-row-name');

test('the boxes and the table read the phone’s figures, Wallet’s set-aside line agrees, and the chart box turns by swipe, dots and arrows and keeps its page', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await goalsHousehold(page);
  await expect(page.getByTestId('goals-page')).toHaveAttribute('data-desk', 'true');

  // Saved for goals: everything set aside, 20 + 12 + 10 million; one goal of four has its month set up.
  await expect(page.getByTestId('goals-saved')).toHaveText('Rp 42.000.000');
  await expect(page.getByTestId('goals-on-track')).toHaveText('1 of 4 goals on track');
  await expect(page.getByTestId('goals-saved-monthly')).toHaveText('Rp 5.000.000');
  await expect(page.getByTestId('goals-set-up')).toHaveText('Rp 1.600.000');
  await expect(page.getByTestId('goals-short')).toContainText(/^Short Rp.[\d.]+ a month$/);
  await page.getByRole('button', { name: 'About the shortfall' }).click();
  await expect(page.getByTestId('goals-short-why')).toHaveText('Goals ask for more each month than is saved. In funding order, 2 of 4 fit in full and the rest wait. Move a date, lower a target, or reorder them.');

  // The table: compulsory first, then the others in their order; Saved and Funded by per goal.
  await expect(names(page, 'compulsory')).toHaveText([GOALS.emergency]);
  await expect(names(page, 'additional')).toHaveText([GOALS.hajj, GOALS.trip, GOALS.car]);
  await expect(goalRow(page, GOALS.hajj).getByTestId('goal-row-saved')).toHaveText('Rp 10.000.000');
  await expect(goalRow(page, GOALS.hajj).getByTestId('goal-row-set-up')).toHaveText('Rp 1.600.000');
  await expect(goalRow(page, GOALS.trip).getByTestId('goal-row-set-up')).toContainText(/^Rp\s0 of [\d.]+$/);

  // Where saving goes: Saved a month (Rp 5.000.000) reaches the emergency fund and Hajj in full, part of the trip; the car waits.
  await page.getByRole('tab', { name: 'Where saving goes' }).click();
  await expect(chart(page)).toHaveAttribute('data-page', 'saving');
  await expect(page.getByTestId('goals-saving-row')).toHaveCount(4);
  await expect(page.getByTestId('goals-saving-fit')).toHaveText(['fits in full', 'fits in full', /^gets Rp.[\d.]+ of [\d.]+$/, 'waits']);
  await expect(page.getByTestId('goals-fit-line')).toHaveText('In goal order, 2 fit in full, Japan in spring in part, Car down payment waits.');
  await expect(page.getByTestId('goals-saving-short')).toBeVisible();
  await expect(page.getByTestId('goals-saving-label')).toHaveText('Saved 5 jt');

  // A two-finger swipe left turns to When each goal is due; an up-and-down scroll turns nothing.
  await chart(page).hover();
  await page.mouse.wheel(0, 120);
  await expect(chart(page)).toHaveAttribute('data-page', 'saving');
  await chart(page).hover();
  await page.mouse.wheel(60, 0);
  await expect(chart(page)).toHaveAttribute('data-page', 'due');
  await expect(page.getByTestId('goals-chart-title')).toHaveText('When each goal is due');
  await expect(page.getByRole('tab', { name: 'When each goal is due' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('goals-lane')).toHaveCount(4);
  await expect(page.getByTestId('goals-chart-saving')).toBeHidden();
  // Kept on this device: the page comes back as it was left.
  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-page', 'due');
  await expect(page.getByTestId('goals-chart-due')).toBeVisible();
  // ‹ goes back, and is spent at the first page; the dots go either way; a swipe right turns back.
  await chart(page).getByRole('button', { name: 'Previous chart' }).click();
  await expect(chart(page)).toHaveAttribute('data-page', 'saving');
  await expect(chart(page).getByRole('button', { name: 'Previous chart' })).toBeDisabled();
  await chart(page).getByRole('button', { name: 'Next chart' }).click();
  await expect(chart(page)).toHaveAttribute('data-page', 'due');
  await expect(chart(page).getByRole('button', { name: 'Next chart' })).toBeDisabled();
  await page.getByRole('tab', { name: 'Where saving goes' }).click();
  await expect(chart(page)).toHaveAttribute('data-page', 'saving');
  await page.getByRole('tab', { name: 'When each goal is due' }).click();
  await chart(page).hover();
  await page.mouse.wheel(-60, 0);
  await expect(chart(page)).toHaveAttribute('data-page', 'saving');
  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-page', 'saving');

  // Read off the desk, then the phone's own page on the same data.
  const desk = {
    saved: await page.getByTestId('goals-saved').textContent(),
    onTrack: await page.getByTestId('goals-on-track').textContent(),
    short: await page.getByTestId('goals-short').textContent(),
    needed: await page.getByTestId('goals-needed').textContent(),
    setUp: await page.getByTestId('goals-set-up').textContent(),
    capacity: await page.getByTestId('goals-saved-monthly').textContent(),
  };

  // Wallet's Spending money is net of the same money: every goal's set-aside sits in Jenius and BCA, both for spending.
  await page.goto('/wallet');
  await expect(page.getByTestId('wallet-setaside-line')).toHaveText('after Rp 42.000.000 set aside for goals');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/goals');
  await expect(page.getByTestId('goals-page')).toHaveCount(0);
  await expect(page.getByTestId('goals-saved')).toHaveText(desk.saved!);
  await expect(page.getByTestId('goals-on-track')).toHaveText(desk.onTrack!);
  await expect(page.getByTestId('goals-short')).toHaveText(desk.short!);
  await expect(page.getByTestId('goals-needed')).toContainText(desk.needed!);
  await expect(page.getByTestId('goals-set-up')).toContainText(desk.setUp!);
  await expect(page.getByTestId('goals-saved-monthly')).toContainText(desk.capacity!);
});

test('a click opens the goal’s peek — ↑ ↓ and ⌃ ⌄ step, Esc closes, Set aside saves from it, room is made — a double-click its page, a drag reorders, and Done lists the finished', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await goalsHousehold(page);

  // The peek: the goal page's figures in brief.
  await goalRow(page, GOALS.hajj).click();
  await expect(peek(page).getByTestId('peek-title')).toContainText(GOALS.hajj);
  await expect(goalRow(page, GOALS.hajj)).toHaveAttribute('aria-selected', 'true');
  await expect(peek(page).getByTestId('peek-status')).toHaveText('On track');
  await expect(peek(page).getByTestId('peek-saved')).toHaveText('Saved Rp 10.000.000');
  await expect(peek(page).getByTestId('peek-funded-total')).toHaveText('Rp 10.000.000');
  await expect(peek(page).getByTestId('peek-funding-row')).toHaveText([/^BCA Tahapan\s*Rp\s10\.000\.000$/]);
  await expect(peek(page).getByTestId('peek-history-row')).toHaveCount(1);
  await expect(peek(page).getByTestId('peek-history-row')).toContainText('Set aside');
  await expect(peek(page).getByTestId('peek-each-month')).toContainText('Set up a month');
  await expect(peek(page).getByRole('button', { name: 'Use', exact: true })).toBeVisible();
  // The page made room: the table ends left of the peek at 1280.
  const table = await page.getByTestId('goals-table-box').boundingBox();
  const panel = await peek(page).boundingBox();
  expect(table!.x + table!.width).toBeLessThanOrEqual(panel!.x);

  // ↑ ↓ step through the table's order; ⌃ at the first goal is spent.
  await page.keyboard.press('ArrowDown');
  await expect(peek(page).getByTestId('peek-title')).toContainText(GOALS.trip);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(peek(page).getByTestId('peek-title')).toContainText(GOALS.emergency);
  await expect(peek(page).getByRole('button', { name: 'Previous goal' })).toBeDisabled();
  await peek(page).getByRole('button', { name: 'Next goal' }).click();
  await peek(page).getByRole('button', { name: 'Next goal' }).click();
  await expect(peek(page).getByTestId('peek-title')).toContainText(GOALS.trip);
  await expect(peek(page).getByTestId('peek-short-by')).toBeVisible();

  // Set aside from the peek: the goal page's own sheet, the figures moving on the peek, the row and the box.
  await peek(page).getByRole('button', { name: 'Set aside', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Set aside' });
  const jenius = sheet.getByLabel('Jenius', { exact: true });
  await jenius.clear();
  await jenius.pressSequentially('15000000');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(peek(page).getByTestId('peek-saved')).toHaveText('Saved Rp 15.000.000');
  await expect(goalRow(page, GOALS.trip).getByTestId('goal-row-saved')).toHaveText('Rp 15.000.000');
  await expect(page.getByTestId('goals-saved')).toHaveText('Rp 45.000.000');

  // Esc puts it away.
  await page.keyboard.press('Escape');
  await expect(peek(page)).toHaveCount(0);

  // The title bar's Set aside, with no goal open, asks which goal first.
  await page.locator('header').getByRole('button', { name: 'Set aside', exact: true }).click();
  await page.getByRole('menu', { name: 'Set aside for' }).getByRole('menuitem', { name: GOALS.car }).click();
  const forCar = page.getByRole('dialog', { name: 'Set aside' });
  await forCar.getByLabel('BCA Tahapan', { exact: true }).pressSequentially('1000000');
  await forCar.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(forCar).toHaveCount(0);
  await expect(goalRow(page, GOALS.car).getByTestId('goal-row-saved')).toHaveText('Rp 1.000.000');
  await expect(goalRow(page, GOALS.car).getByTestId('goal-row-funded-by')).toHaveText('BCA Tahapan');

  // A drag within a section reorders it (the car first), and where saving goes follows the new order; a goal cannot be
  // dragged across into the other section.
  await goalRow(page, GOALS.car).dragTo(goalRow(page, GOALS.hajj));
  await expect(names(page, 'additional')).toHaveText([GOALS.car, GOALS.hajj, GOALS.trip]);
  await page.getByRole('tab', { name: 'Where saving goes' }).click();
  await expect(page.getByTestId('goals-saving-row')).toHaveText([new RegExp(GOALS.emergency), new RegExp(GOALS.car), new RegExp(GOALS.hajj), new RegExp(GOALS.trip)]);
  await goalRow(page, GOALS.emergency).dragTo(goalRow(page, GOALS.trip));
  await expect(names(page, 'compulsory')).toHaveText([GOALS.emergency]);
  await expect(names(page, 'additional')).toHaveText([GOALS.car, GOALS.hajj, GOALS.trip]);
  await page.reload();
  await expect(names(page, 'additional')).toHaveText([GOALS.car, GOALS.hajj, GOALS.trip]);

  // A double-click opens the goal's own page, even when making room moved the row from under the pointer.
  await doubleClickInPlace(page, goalRow(page, GOALS.car));
  await expect(page).toHaveURL(/\/goals\/[^/]+$/);
  await expect(page.getByRole('heading', { name: GOALS.car, exact: true })).toBeVisible();

  // Marked paid, the trip is done: off Active (and its chart), on Done.
  const trip = await goalCard(page, GOALS.trip);
  await goalMenu(trip, /^Mark paid$/);
  await expect(page.getByTestId('goal-status')).toHaveText('Done');
  await page.goto('/goals');
  await expect(goalRow(page, GOALS.car)).toBeVisible();
  await expect(goalRow(page, GOALS.trip)).toHaveCount(0);
  await expect(page.getByTestId('goals-saving-row')).toHaveCount(3);
  await page.getByRole('radio', { name: 'Done' }).click();
  await expect(page.getByTestId('goal-row')).toHaveCount(1);
  await expect(goalRow(page, GOALS.trip).getByTestId('goal-row-status')).toHaveText('Done');
  await expect(goalRow(page, GOALS.trip).getByTestId('goal-row-progress')).toHaveText(/^100% of /);
  await expect(page.getByTestId('goals-chart')).toHaveCount(0);
  await goalRow(page, GOALS.trip).click();
  await expect(peek(page).getByTestId('peek-status')).toHaveText('Done');
});
