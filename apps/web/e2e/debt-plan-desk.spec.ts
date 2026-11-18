import { expect, type Page, test } from '@playwright/test';
import { planRows } from './debt-plan';
import { DESK, seedDesk, tableNames } from './debt-plan-desk';
import { doubleClickInPlace } from './desk-double-click';

/*
 * The Debt-free plan on a wide screen (Mac redesign step 12): Plan, Schedule and Report under one title bar. Plan has
 * Left to pay, Pay first (with Extra a month typed in place) and the payoff line with and without the extra, then every
 * debt in the phone's pay-first order with a side peek; Schedule groups a loan's late instalments into one row with Pay
 * all, and ticked instalments pay together, with Undo. Every figure is the phone's. Invented household (`seedDesk`).
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const row = (page: Page, name: string) => page.getByTestId('plan-table-row').filter({ has: page.getByTestId('plan-table-name').getByText(name, { exact: true }) });
const peek = (page: Page) => page.getByTestId('debt-peek');
const sidebarPlan = (page: Page) => page.locator('aside').getByRole('link', { name: /^Debt-free plan/ });
const ORDER = [DESK.paylater, DESK.kta, DESK.card, DESK.car, DESK.kpr, DESK.person];

test('Plan: the debts in the phone’s pay order, late first; the late count is the sidebar’s, Overview’s and the phone’s', async ({ page }) => {
  test.setTimeout(240_000);
  await seedDesk(page);
  await expect.poll(() => tableNames(page)).toEqual(ORDER);
  // Late ones wear "!" and say how many payments; the rest are numbered.
  await expect(row(page, DESK.paylater).getByTestId('plan-table-late')).toContainText('3 payments late');
  await expect(row(page, DESK.kta).getByTestId('plan-table-late')).toContainText('1 payment late');
  await expect(row(page, DESK.card).getByTestId('plan-table-late')).toContainText('1 payment late');
  await expect(row(page, DESK.car).getByTestId('plan-table-late')).toHaveText('—');
  await expect(row(page, DESK.car).getByTestId('plan-table-next')).toContainText('20 Nov');
  // The late month is never the next one: Kredivo's next is December's.
  await expect(row(page, DESK.paylater).getByTestId('plan-table-next')).toContainText('1 Dec');
  await expect(row(page, DESK.person).getByTestId('plan-table-next')).toHaveText('no fixed months');

  await expect(page.getByTestId('plan-count-late')).toContainText('3');
  await expect(page.getByTestId('plan-count-active')).toContainText('6');
  await expect(sidebarPlan(page)).toContainText('3 late');
  const left = (await page.getByTestId('plan-left').innerText()).trim().replace(/\s/g, ' ');
  const debtFree = (await page.getByTestId('plan-debt-free').innerText()).trim();
  expect(left).toBe('Rp 637.064.300');

  await page.goto('/overview');
  await expect(page.getByText('3 debts late')).toBeVisible();

  // The phone: the same Left to pay, Debt-free month, late count and order.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/net-worth/plan');
  await expect(page.getByTestId('plan-left')).toHaveText(left);
  await expect(page.getByTestId('plan-debt-free')).toHaveText(debtFree);
  await expect(page.getByTestId('plan-count-late')).toContainText('3');
  await page.goto('/net-worth/plan/pay-first');
  expect(await planRows(page)).toEqual(ORDER);
});

test('Extra a month moves the chart’s end month, both lines shown; with none set, one line', async ({ page }) => {
  test.setTimeout(240_000);
  await seedDesk(page);
  const debtFree = (await page.getByTestId('plan-debt-free').innerText()).trim();
  const short = debtFree.slice(0, 3) + debtFree.slice(debtFree.indexOf(' '));
  await expect(page.getByTestId('plan-chart-with')).toHaveText(`━ debt-free ${short}`);
  await expect(page.getByTestId('plan-chart-without')).toHaveCount(0);
  await expect(page.getByTestId('plan-line-without')).toHaveCount(0);

  const extra = page.getByLabel('Extra a month');
  await extra.fill('2000000');
  await extra.press('Enter');
  await expect(page.getByTestId('plan-chart-without')).toHaveText(`┅ without · ${short}`);
  await expect(page.getByTestId('plan-line-without')).toHaveCount(1);
  await expect(page.getByTestId('plan-chart-with')).toHaveText(/^━ with extra · debt-free \w{3} \d{4}$/);
  const withTwo = await page.getByTestId('plan-chart-with').innerText();
  // The box's own Debt-free is the phone's header: the order with no extra.
  await expect(page.getByTestId('plan-debt-free')).toHaveText(debtFree);

  await extra.fill('8000000');
  await extra.press('Enter');
  await expect(page.getByTestId('plan-chart-with')).not.toHaveText(withTwo);
  const year = async () => Number((await page.getByTestId('plan-chart-with').innerText()).slice(-4));
  expect(await year()).toBeLessThanOrEqual(Number(withTwo.slice(-4)));
  await page.reload();
  await expect(page.getByLabel('Extra a month')).toHaveValue('8.000.000');

  await extra.fill('');
  await extra.press('Enter');
  await expect(page.getByTestId('plan-chart-without')).toHaveCount(0);
  await expect(page.getByTestId('plan-chart-with')).toHaveText(`━ debt-free ${short}`);
});

test('the peek: a click opens it with room made, ↑ ↓ step, Full schedule narrows the Schedule, Esc closes, a double-click opens the loan', async ({ page }) => {
  test.setTimeout(240_000);
  await seedDesk(page);
  await row(page, DESK.kta).getByTestId('plan-table-left').click();
  await expect(peek(page)).toBeVisible();
  await expect(page.getByTestId('debt-peek-name')).toHaveText(DESK.kta);
  await expect(page.getByTestId('debt-peek-left')).toHaveText('Rp 24.000.000');
  await expect(page.getByTestId('debt-peek-rate')).toHaveText('10,8% a year');
  await expect(page.getByTestId('debt-peek-instalment')).toContainText('1 of 24');
  await expect(page.getByTestId('debt-peek-payment').first()).toContainText('6 days late');
  await expect(page.getByTestId('debt-peek-payment').nth(1)).toContainText('5 Dec · 2/24');
  // Room is made: no figure of the table sits under the peek.
  const peekLeft = (await peek(page).boundingBox())!.x;
  const table = (await page.getByTestId('plan-debts').boundingBox())!;
  expect(table.x + table.width).toBeLessThanOrEqual(peekLeft);

  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('debt-peek-name')).toHaveText(DESK.card);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('debt-peek-name')).toHaveText(DESK.paylater);
  await page.keyboard.press('Escape');
  await expect(peek(page)).toHaveCount(0);

  await row(page, DESK.kta).getByTestId('plan-table-left').click();
  await page.getByTestId('debt-peek-schedule').click();
  await expect(page).toHaveURL(/\/net-worth\/plan\/schedule\?debt=/);
  await expect(page.getByTestId('schedule-only')).toContainText(DESK.kta);
  await expect(page.getByTestId('schedule-row').first()).toHaveAttribute('data-title', `${DESK.kta} · 1/24`);
  await expect(page.getByTestId('schedule-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(page.getByTestId('schedule-only')).toHaveCount(0);

  await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Plan' }).click();
  await doubleClickInPlace(page, row(page, DESK.car).getByTestId('plan-table-left'));
  await expect(page).toHaveURL(/\/net-worth\/loans\/[^/?]+$/);
});

test('views: Plan, Schedule and Report each at its own address; ?tab=report still opens the Report', async ({ page }) => {
  test.setTimeout(240_000);
  await seedDesk(page);
  const view = page.getByRole('radiogroup', { name: 'View' });
  await view.getByRole('radio', { name: 'Schedule' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan\/schedule$/);
  await expect(page.getByTestId('schedule-month')).toHaveText('November');
  await expect(page.getByRole('button', { name: 'Show', exact: true })).toBeVisible();
  await view.getByRole('radio', { name: 'Report' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan\/report$/);
  await expect(page.getByTestId('report-left')).toHaveText('Rp 637.064.300');
  await page.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', { name: 'This month' }).click();
  await expect(page).toHaveURL(/period=month/);
  await expect(page.getByTestId('report-month')).toHaveCount(1);
  await view.getByRole('radio', { name: 'Plan' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan$/);
  await expect(page.getByTestId('plan-table')).toBeVisible();
  await page.goto('/net-worth/plan?tab=report');
  await expect(page.getByTestId('report-borrowed')).toBeVisible();
});

test('Schedule: a loan’s late instalments are one row — Pay all pays them, Undo brings them back', async ({ page }) => {
  test.setTimeout(240_000);
  await seedDesk(page);
  await page.goto('/net-worth/plan/schedule');
  const late = (await page.getByTestId('schedule-tile-late').locator('div').nth(1).innerText()).trim().replace(/\s/g, ' ');
  await expect(page.getByTestId('schedule-late-head')).toHaveText(`Late · 3 debts · ${late}`, { ignoreCase: true });
  const group = page.getByTestId('schedule-group');
  await expect(group).toHaveCount(1);
  await expect(group).toHaveAttribute('data-name', DESK.paylater);
  await expect(group).toContainText('3 instalments late');
  await expect(group.getByTestId('schedule-group-range')).toHaveText('Sep 2026 – Nov 2026');
  await group.getByRole('button', { name: `Show ${DESK.paylater}'s late instalments` }).click();
  const titles = page.getByTestId('schedule-late').getByTestId('schedule-row');
  await expect(titles.first()).toHaveAttribute('data-title', `${DESK.paylater} · 1/6`);
  await expect(page.getByTestId('schedule-late').locator(`[data-title^="${DESK.paylater} · "]`)).toHaveCount(3);
  // The group's total is its three instalments'.
  const amounts = await page.getByTestId('schedule-late').locator(`[data-title^="${DESK.paylater} · "] td:nth-child(4)`).allInnerTexts();
  const sum = amounts.reduce((total, text) => total + Number(text.replace(/\D/g, '')), 0);
  expect(Number((await group.getByTestId('schedule-group-total').innerText()).replace(/\D/g, ''))).toBe(sum);

  await group.getByRole('button', { name: `Pay all ${DESK.paylater}` }).click();
  const sheet = page.getByRole('dialog', { name: `Pay all · ${DESK.paylater}` });
  await expect(sheet).toContainText('3 instalments');
  await sheet.getByRole('button', { name: 'Save payments' }).click();
  await expect(page.getByTestId('paid-toast')).toContainText(`Paid 3 instalments of ${DESK.paylater}`);
  await expect(page.getByTestId('schedule-group')).toHaveCount(0);
  await expect(page.getByTestId('schedule-late-head')).toContainText('2 debts', { ignoreCase: true });
  await expect(sidebarPlan(page)).toContainText('2 late');

  await page.getByTestId('paid-toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('schedule-group')).toContainText('3 instalments late');
  await expect(sidebarPlan(page)).toContainText('3 late');
});

test('Schedule: ticked instalments pay together — a later tick takes the earlier ones of its loan — with Undo', async ({ page }) => {
  test.setTimeout(240_000);
  await seedDesk(page);
  await page.goto('/net-worth/plan/schedule');
  // A tick on Kredivo's third late instalment ticks its first two with it: a payment settles the oldest first.
  await page.getByTestId('schedule-group').getByRole('button', { name: `Show ${DESK.paylater}'s late instalments` }).click();
  await page.getByRole('checkbox', { name: `Select ${DESK.paylater} · 3/6` }).click();
  await expect(page.getByRole('checkbox', { name: `Select ${DESK.paylater} · 1/6` })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('checkbox', { name: `Select every late instalment of ${DESK.paylater}` })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('checkbox', { name: `Select ${DESK.paylater} · 2/6` }).click();
  await expect(page.getByRole('checkbox', { name: `Select ${DESK.paylater} · 3/6` })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('checkbox', { name: `Select every late instalment of ${DESK.paylater}` })).toHaveAttribute('aria-checked', 'mixed');
  await page.getByRole('button', { name: 'Clear' }).click();

  // KTA Mandiri's late one and the car loan's first, coming up.
  await page.getByRole('checkbox', { name: `Select ${DESK.kta} · 1/24` }).click();
  await page.getByRole('checkbox', { name: `Select ${DESK.car} · 1/48` }).click();
  const bar = page.getByTestId('select-bar');
  await expect(bar).toContainText('2 selected');
  await expect(page.getByTestId('select-total')).toHaveText('Rp 4.701.343');
  await bar.getByRole('button', { name: 'Pay 2' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay 2' });
  await expect(sheet.getByLabel('Paid from')).toHaveValue(/.+/);
  await sheet.getByRole('button', { name: 'Save payments' }).click();
  await expect(page.getByTestId('paid-toast')).toContainText(`Paid 1 instalment of ${DESK.kta} and 1 of ${DESK.car}`);
  await expect(page.getByTestId('schedule-late').locator(`[data-title="${DESK.kta} · 1/24"]`)).toHaveCount(0);
  await expect(sidebarPlan(page)).toContainText('2 late');
  await page.getByTestId('paid-toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('schedule-late').locator(`[data-title="${DESK.kta} · 1/24"]`)).toHaveCount(1);
  await expect(sidebarPlan(page)).toContainText('3 late');
});

test('By hand: drag a debt to reorder (late ones stay on top); the order holds after a reload and on the phone', async ({ page }) => {
  test.setTimeout(240_000);
  await seedDesk(page);
  await page.getByRole('radiogroup', { name: 'Order' }).getByRole('radio', { name: 'By hand' }).click();
  await expect(page.getByTestId('plan-method-lines')).toContainText('By hand:');
  await expect.poll(() => tableNames(page)).toEqual(ORDER);
  await row(page, DESK.kpr).dragTo(row(page, DESK.car));
  const moved = [DESK.paylater, DESK.kta, DESK.card, DESK.kpr, DESK.car, DESK.person];
  await expect.poll(() => tableNames(page)).toEqual(moved);
  // A keyboard: the handle's ↓ moves it back down.
  await page.getByRole('button', { name: `Reorder ${DESK.kpr}` }).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => tableNames(page)).toEqual(ORDER);
  await row(page, DESK.person).dragTo(row(page, DESK.car));
  const again = [DESK.paylater, DESK.kta, DESK.card, DESK.person, DESK.car, DESK.kpr];
  await expect.poll(() => tableNames(page)).toEqual(again);
  await page.reload();
  await expect.poll(() => tableNames(page)).toEqual(again);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/net-worth/plan/pay-first');
  expect(await planRows(page)).toEqual(again);
});
