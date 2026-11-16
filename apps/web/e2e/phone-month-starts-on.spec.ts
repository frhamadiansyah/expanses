import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { setBudget } from './budget';
import { eventually } from './shared-events';
import { openWorkspacePage, openWorkspaceSharePage, putOffShareList, shareWorkspace } from './workspace-page';

/*
 * "Month starts on" (owner, 16 Nov 2026): salary on the 25th, so November is 25 Oct – 24 Nov. Set on the workspace's
 * page; Cashflow and Budget then count that month. Every figure and name is invented. The clock is held on 16 Nov 2026.
 */

test.describe.configure({ timeout: 300_000 });

const TODAY = new Date('2026-11-16T10:00:00');
const SHOTS = process.env.MONTH_START_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function secondPhone(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  return context.newPage();
}

/** Workspace page › Month starts on › a day. Returns once the row says it. */
async function setMonthStart(page: Page, day: string, label: string) {
  await openWorkspacePage(page, 'Personal');
  await page.getByTestId('ws-month-start-row').click();
  await expect(page.getByTestId('month-start-grid')).toBeVisible();
  await page.getByTestId(`month-start-${day}`).click();
  await expect(page.getByTestId(`month-start-${day}`)).toHaveAttribute('aria-checked', 'true');
  await openWorkspacePage(page, 'Personal');
  await expect(page.getByTestId('ws-month-start-row')).toContainText(label);
}

const rupiah = (figure: string) => new RegExp(`^Rp\\s?${figure.replace(/\./g, '\\.')}$`);

test('from the 25th: November is 25 Oct – 24 Nov on Cashflow and Budget, and nothing recorded moves', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(TODAY);
  await openAccount(page, { subtype: 'bank', name: 'Bank Sentosa', balance: '20000000' });
  await page.goto('/transactions');
  // 24 Oct is October's, 25 Oct and 24 Nov November's, 25 Nov December's.
  for (const [date, amount] of [
    ['2026-10-24', '110000'],
    ['2026-10-25', '230000'],
    ['2026-11-03', '340000'],
    ['2026-11-24', '470000'],
    ['2026-11-25', '590000'],
  ] as const) {
    await addTransaction(page, { description: `Pasar ${date}`, paidWith: 'Bank Sentosa', category: 'Groceries', amount, date });
  }

  // Until it is set, November is the calendar month: 3, 24 and 25 Nov.
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText(rupiah('1.400.000'));

  // The row is under Currency, with the month's dates under it.
  await openWorkspacePage(page, 'Personal');
  await expect(page.getByTestId('ws-month-start-row')).toContainText('1st');
  await expect(page.getByTestId('month-start-footer')).toHaveText('November is 1 Nov – 30 Nov. Cashflow, Budget, bills and reports all use it.');
  await page.getByTestId('ws-month-start-row').click();
  await page.getByTestId('month-start-25').click();
  await expect(page.getByTestId('month-start-lines')).toContainText('November = 25 Oct – 24 Nov');
  await expect(page.getByTestId('month-start-lines')).toContainText('December = 25 Nov – 24 Dec');
  await expect(page.getByTestId('month-start-lines')).toContainText('“1” = the calendar month, as today.');
  await shot(page, 'month-start-picker-25th');
  await page.getByTestId('month-start-last').click();
  await expect(page.getByTestId('month-start-lines')).toContainText('November = 31 Oct – 29 Nov');
  await shot(page, 'month-start-picker-last-day');
  await page.getByTestId('month-start-25').click();
  await expect(page.getByTestId('month-start-25')).toHaveAttribute('aria-checked', 'true');
  await openWorkspacePage(page, 'Personal');
  await expect(page.getByTestId('ws-month-start-row')).toContainText('25th');
  await expect(page.getByTestId('month-start-footer')).toHaveText('November is 25 Oct – 24 Nov. Cashflow, Budget, bills and reports all use it.');
  await shot(page, 'month-start-workspace-row');
  for (const text of [await page.getByTestId('month-start-footer').textContent()]) expect(text).not.toMatch(/\byou(r)?\b/i);

  // Cashflow: November holds 25 Oct and 24 Nov, not 24 Oct nor 25 Nov. The switcher keeps its look: a month's name.
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText(rupiah('1.040.000'));
  await expect(page.getByText('Pasar 2026-10-25')).toBeVisible();
  await expect(page.getByText('Pasar 2026-11-25')).toHaveCount(0);
  await expect(page.getByText('Pasar 2026-10-24')).toHaveCount(0);
  await shot(page, 'month-start-cashflow-november');
  await page.getByRole('button', { name: 'Later period' }).click();
  await expect(page.getByTestId('period-total')).toHaveText(rupiah('590.000'));
  await page.getByRole('button', { name: 'Earlier period' }).click();
  await page.getByRole('button', { name: 'Earlier period' }).click();
  await expect(page.getByTestId('period-total')).toHaveText(rupiah('110.000'));

  // Budget: the same month, and its days run out on the 24th — nine left, today counted.
  await page.goto('/budget');
  await setBudget(page, 'Groceries', '2000000');
  await expect(page.getByTestId('budget-month')).toHaveText('November 2026');
  await expect(page.getByTestId('spent-of-budget')).toContainText(/Spent Rp\s?1\.040\.000 of Rp\s?2\.000\.000/);
  await expect(page.getByTestId('left-to-spend')).toContainText('9 days left');
  await shot(page, 'month-start-budget-november');

  // Back to the 1st: every figure is the calendar's again — nothing was moved.
  await setMonthStart(page, '1', '1st');
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText(rupiah('1.400.000'));
});

test('a shared workspace: set on one phone, the other counts the same months', async ({ page: bima, browser }, info) => {
  const rina = await secondPhone(browser, info);
  // The real clock here: the relay checks each signed request's time.
  for (const phone of [bima, rina]) phone.on('dialog', (dialog) => void dialog.accept());
  await openAccount(bima, { subtype: 'bank', name: 'Main Account', balance: '10000000' });
  await openAccount(rina, { subtype: 'bank', name: 'Partner Account', balance: '10000000' });

  await openWorkspaceSharePage(bima, 'Personal');
  const code = await shareWorkspace(bima, 'Bima');
  await rina.goto(`/join#${code}`);
  const join = rina.getByTestId('join-workspace');
  await expect(join).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Name').fill('Rina');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });
  await putOffShareList(bima);

  await setMonthStart(bima, '25', '25th');

  // Rina's phone: the joined workspace (after her own Personal) says 25th, with the same dates.
  await eventually(rina, async () => {
    await rina.goto('/account');
    const line = rina.getByTestId('account-workspace').filter({ hasText: 'Personal' }).last();
    await line.getByTestId('workspace-open').click();
    await expect(rina.getByTestId('ws-month-start-row')).toContainText('25th', { timeout: 1_000 });
  });
  await expect(rina.getByTestId('month-start-footer')).toHaveText(/^\w+ is 25 \w{3} – 24 \w{3}\. Cashflow, Budget, bills and reports all use it\.$/);
  await shot(rina, 'month-start-shared-second-phone');
});
