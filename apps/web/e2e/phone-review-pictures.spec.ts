import type { RawCapture } from '@expanses/core';
import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { household } from './bill-pause';
import { inject, line, notice, picture, screen } from './capture';
import { statementLines } from './statement';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/*
 * Review's camera corner: the camera for a receipt in hand, the photo library for pictures already taken. The library
 * cannot open in a browser, so the e2e build's `__photoPicks` stands in for what the phone hands back — each picture
 * already read — and everything after it is the app's own: the rule that tells a statement from a draft, the queue,
 * and the card picker. Every figure, shop and date here is invented.
 */

/** A picture chosen from the library, as the phone hands it back: read, and kept under the capture folder. */
function chosen(id: string, over: Partial<RawCapture> = {}): RawCapture {
  return screen({ id, kind: 'shared-image', imageFile: `captures/${id}.png`, ...over });
}

/** What the library hands back on the next "Choose from Photos", with each picture's bytes. */
async function willPick(page: Page, captures: RawCapture[]) {
  const images = Object.assign({}, ...captures.map((capture) => (capture.imageFile ? picture(capture.imageFile) : {})));
  await page.evaluate((pick) => {
    (window.__photoPicks ??= []).push(pick);
  }, { captures, images });
}

async function openCameraMenu(page: Page) {
  await page.getByRole('button', { name: 'Scan a receipt' }).first().click();
  return page.getByRole('menu', { name: 'Scan a receipt' });
}

const STATEMENT_PAGE = statementLines([
  ['03SEP', 'KEDAI LANGIT SORE', '61,500'],
  ['07SEP', 'TOKO ALAT TULIS RIANG', '23,750'],
  ['11SEP', 'BENGKEL SEPEDA MAJU', '142,000'],
]);

test('the camera corner offers the camera and the photo library, and nothing else', async ({ page }) => {
  await page.goto('/review');
  await inject(page, [notice()]);
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  // No line under the title: the queue's rows say what they are.
  await expect(page.getByText(/\d+ waiting\./)).toHaveCount(0);
  const menu = await openCameraMenu(page);
  await expect(menu.getByRole('menuitem')).toHaveText(['Take photo', 'Choose from Photos']);
});

test('one receipt from Photos becomes a draft in Review', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/review');
  await page.waitForFunction(() => typeof window.__captureInject === 'function');
  await willPick(page, [chosen('lib-1')]);
  await (await openCameraMenu(page)).getByRole('menuitem', { name: 'Choose from Photos' }).click();

  await expect(page).toHaveURL(/\/review/);
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(page.getByTestId('draft-row')).toContainText('38.000');
});

test('one statement page from Photos goes to the statement check, asking which card', async ({ page }) => {
  await openCard(page, { name: 'Kartu Biru' });
  await page.goto('/review');
  await page.waitForFunction(() => typeof window.__captureInject === 'function');
  await willPick(page, [chosen('lib-2', { lines: STATEMENT_PAGE })]);
  await (await openCameraMenu(page)).getByRole('menuitem', { name: 'Choose from Photos' }).click();

  await expect(page.getByRole('heading', { name: 'Which card is this statement?' })).toBeVisible();
  await expect(page.getByText('1 screenshot read on this phone')).toBeVisible();
  await page.getByTestId('statement-card').filter({ hasText: 'Kartu Biru' }).click();
  await expect(page).toHaveURL(/\/cards\/[^/]+\/check/);
  // Nothing went to the queue.
  await page.goto('/review');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
});

test('two pictures from Photos are one statement, whatever is on them', async ({ page }) => {
  await openCard(page, { name: 'Kartu Biru' });
  await page.goto('/review');
  await page.waitForFunction(() => typeof window.__captureInject === 'function');
  await willPick(page, [chosen('lib-3', { lines: STATEMENT_PAGE }), chosen('lib-4', { lines: [line('Total Rp12.000', 0.5)] })]);
  await (await openCameraMenu(page)).getByRole('menuitem', { name: 'Choose from Photos' }).click();

  await expect(page.getByRole('heading', { name: 'Which card is this statement?' })).toBeVisible();
  await expect(page.getByText('2 screenshots read on this phone')).toBeVisible();
});

/** The way back a title draws, inside the page rather than the tab bar. */
const backLink = (page: Page, name: string) => page.getByRole('main').getByRole('link', { name, exact: true });

test('Review opened from Cashflow goes back to Cashflow; opened as a section it has no way back', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');
  await inject(page, [notice()]);
  await page.getByTestId('not-recorded-card').click();
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await backLink(page, 'Cashflow').first().click();
  await expect(page).toHaveURL(/\/transactions/);

  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(backLink(page, 'Cashflow')).toHaveCount(0);
});

test('Recurring opened from Cashflow goes back to Cashflow, through a bill too', async ({ page }) => {
  await household(page);
  await page.goto('/transactions');
  await page.getByTestId('recurring-card').click();
  await expect(page.getByRole('heading', { name: 'Recurring' })).toBeVisible();
  await expect(backLink(page, 'Cashflow').first()).toBeVisible();

  // Into a bill and back: Recurring still knows it came from Cashflow.
  await page.getByTestId('bill-row').filter({ hasText: 'Gym' }).first().click();
  await backLink(page, 'Recurring').first().click();
  await expect(page.getByRole('heading', { name: 'Recurring' })).toBeVisible();
  await backLink(page, 'Cashflow').first().click();
  await expect(page).toHaveURL(/\/transactions/);

  await page.goto('/bills');
  await expect(page.getByRole('heading', { name: 'Recurring' })).toBeVisible();
  await expect(backLink(page, 'Cashflow')).toHaveCount(0);
});
