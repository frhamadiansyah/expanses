import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { setBudget } from './budget';
import { expectNeed, markNeed } from './categories';

/**
 * Essential · Lifestyle · Debts & savings, walked once for both shapes. Invented month: Rp 20.000.000 in; Rp 9.000.000
 * on groceries (never marked, so essential) and Rp 5.000.000 at restaurants (Food and beverage marked lifestyle) —
 * 45 / 25 / 30.
 */
export async function seedMonth(page: Page) {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'Bank Satu', balance: '30000000' });
  await page.goto('/transactions');
  await addTransaction(page, { mode: 'Income', description: 'Monthly pay', paidWith: 'Bank Satu', category: 'Salary', amount: '20000000' });
  await addTransaction(page, { description: 'Market run', paidWith: 'Bank Satu', category: 'Groceries', amount: '9000000' });
  await addTransaction(page, { description: 'Dinner out', paidWith: 'Bank Satu', category: 'Restaurants', amount: '5000000' });
  await markNeed(page, 'Food and beverage', 'Lifestyle');
}

/** Cashflow, turned to Income and to its last page. */
export async function openIncomeSplit(page: Page) {
  await page.goto('/transactions');
  await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Income' }).click();
  await page.getByRole('button', { name: 'Essential, lifestyle, debts and savings' }).click();
  const split = page.getByTestId('income-split');
  await expect(split).toBeInViewport();
  return split;
}

const money = (figure: string) => new RegExp(`Rp\\s?${figure.replace(/\./g, '\\.')}`);

export async function checkIncomePage(page: Page, shot?: string) {
  const split = await openIncomeSplit(page);
  await expect(split.getByTestId('income-split-headline')).toHaveText(/Where Rp\s?20\.000\.000 went/);
  await expect(split.getByTestId('split-row-essential')).toContainText('45%');
  await expect(split.getByTestId('split-row-essential')).toContainText(money('9.000.000'));
  await expect(split.getByTestId('split-row-lifestyle')).toContainText('25%');
  await expect(split.getByTestId('split-row-lifestyle')).toContainText(money('5.000.000'));
  await expect(split.getByTestId('split-row-debtsSavings')).toContainText('30%');
  await expect(split.getByTestId('split-row-debtsSavings')).toContainText(money('6.000.000'));
  await expect(split.getByTestId('split-guide')).toHaveText('Guide: 50 / 30 / 20');
  // Debts & savings is what was not spent: nothing to list, so it is no button.
  await expect(split.getByRole('button', { name: /Debts & savings/ })).toHaveCount(0);
  if (shot) await page.screenshot({ path: shot });

  // Essential narrows the list to essential spending; the row stays lit, the others fade, and no chip is drawn.
  await split.getByTestId('split-row-essential').click();
  await expect(split.getByTestId('split-row-essential')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/need=essential/);
  await expect(page.getByText('Market run')).toBeVisible();
  await expect(page.getByText('Dinner out')).toHaveCount(0);
  await expect(page.getByText('Monthly pay')).toHaveCount(0);
  await expect(page.getByText(/^Only (Essential|Lifestyle)/i)).toHaveCount(0);
  if (shot) await page.screenshot({ path: shot.replace('.png', '-essential.png') });

  // Lifestyle swaps it; the same row again lets go.
  await split.getByTestId('split-row-lifestyle').click();
  await expect(page.getByText('Dinner out')).toBeVisible();
  await expect(page.getByText('Market run')).toHaveCount(0);
  await split.getByTestId('split-row-lifestyle').click();
  await expect(split.getByTestId('split-row-lifestyle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page).not.toHaveURL(/need=/);
  await expect(page.getByText('Dinner out')).toBeVisible();
  await expect(page.getByText('Market run')).toBeVisible();
  await expect(page.getByText('Monthly pay')).toBeVisible();
}

export async function checkGuideSheet(page: Page, shot?: string) {
  let split = await openIncomeSplit(page);
  await split.getByTestId('split-guide').click();
  const sheet = page.getByRole('dialog', { name: 'Guide' });
  const save = sheet.getByRole('button', { name: 'Save guide' });
  await expect(sheet.getByTestId('guide-footer')).toHaveText('Adds up to 100%.');

  // Three percents that must add up to 100: Save waits until they do, and the footer says what is left.
  await sheet.getByLabel('Essential percent').fill('60');
  await expect(sheet.getByTestId('guide-footer')).toHaveText('10% over 100.');
  await expect(save).toBeDisabled();
  await sheet.getByLabel('Lifestyle percent').fill('15');
  await expect(sheet.getByTestId('guide-footer')).toHaveText('5% left to place.');
  await expect(save).toBeDisabled();
  await sheet.getByLabel('Debts & savings percent').fill('25');
  await expect(sheet.getByTestId('guide-footer')).toHaveText('Adds up to 100%.');
  await expect(sheet.getByTestId('guide-categories')).toBeVisible();
  if (shot) await page.screenshot({ path: shot });
  await save.click();
  await expect(sheet).toHaveCount(0);
  await expect(split.getByTestId('split-guide')).toHaveText('Guide: 60 / 15 / 25');

  // Kept: after a reload the guide is still the workspace's own.
  await page.reload();
  split = await openIncomeSplit(page);
  await expect(split.getByTestId('split-guide')).toHaveText('Guide: 60 / 15 / 25');

  // The Health card reads the same guide: its line and its grade (30% kept against 25 is on track).
  await page.goto('/net-worth/health');
  const card = page.getByTestId('split-card');
  await expect(card.getByTestId('split-card-guide')).toHaveText('Guide: 60 · 15 · 25');
  await expect(card.getByTestId('split-card-status')).toHaveText(/on track/i);

  // Which categories are Essential leads to the categories list, where each mark is set.
  split = await openIncomeSplit(page);
  await split.getByTestId('split-guide').click();
  await page.getByRole('dialog', { name: 'Guide' }).getByTestId('guide-categories').click();
  await expect(page).toHaveURL(/\/categories$/);

  // Reset puts 50 / 30 / 20 back.
  split = await openIncomeSplit(page);
  await split.getByTestId('split-guide').click();
  await page.getByRole('dialog', { name: 'Guide' }).getByTestId('guide-reset').click();
  await expect(page.getByRole('dialog', { name: 'Guide' })).toHaveCount(0);
  await expect(split.getByTestId('split-guide')).toHaveText('Guide: 50 / 30 / 20');
}

export async function checkBudgetBox(page: Page, shot?: string) {
  await page.goto('/budget');
  // Caps: groceries (essential) and Food and beverage (lifestyle). No take-home typed, so Debts & savings plans the
  // income so far less both.
  await setBudget(page, 'Groceries', '8000000');
  await setBudget(page, 'Food and beverage', '6000000');
  if ((await page.getByTestId('budget-page').getAttribute('data-desk')) === 'true') {
    // A wide screen's box is the month's split as shares of what was bought (the phone's ⋯ Essential and lifestyle).
    const split = page.getByTestId('split-box');
    await expect(split.getByTestId('essential-spent')).toContainText('64%');
    await expect(split.getByTestId('essential-spent')).toContainText(money('9.000.000'));
    await expect(split.getByTestId('lifestyle-spent')).toContainText('36%');
    await expect(split.getByTestId('lifestyle-spent')).toContainText(money('5.000.000'));
    await expect(split.getByTestId('debts-savings-spent')).toContainText('0%');
    if (shot) await page.screenshot({ path: shot });
    return;
  }
  const box = page.locator('section', { has: page.getByTestId('needs-essential') });
  await expect(box).toContainText('Essential · Lifestyle · Debts & savings');
  await expect(box.getByTestId('needs-essential-figure')).toHaveText(/Rp\s?9\.000\.000 of Rp\s?8\.000\.000/);
  await expect(box.getByTestId('needs-essential-figure')).toHaveClass(/ph-warn/);
  await expect(box.getByTestId('needs-lifestyle-figure')).toHaveText(/Rp\s?5\.000\.000 of Rp\s?6\.000\.000/);
  await expect(box.getByTestId('needs-lifestyle-figure')).not.toHaveClass(/ph-warn/);
  await expect(box.getByTestId('needs-debtsSavings-figure')).toHaveText(/Rp\s?6\.000\.000 of Rp\s?6\.000\.000/);
  if (shot) {
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot });
  }
}

export async function checkHealthCard(page: Page, shot?: string) {
  await page.goto('/net-worth/health');
  const card = page.getByTestId('split-card');
  await expect(card).toContainText('Essential · Lifestyle · Debts & savings');
  await expect(card.getByTestId('split-card-value')).toHaveText('45 · 25 · 30');
  await expect(card.getByTestId('split-card-guide')).toHaveText('Guide: 50 · 30 · 20');
  await expect(card.getByTestId('split-card-status')).toHaveText(/on track/i);
  // Right after Savings ratio.
  const names = await page.locator('h3').allInnerTexts();
  expect(names[names.indexOf('Savings ratio') + 1]).toBe('Essential · Lifestyle · Debts & savings');
  if (shot) {
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot });
  }
}

/**
 * The third mark: Groceries given Debts & savings on its page leaves Essential on Cashflow's Income page 2 and is
 * counted in what was kept — 0 / 25 / 75 — and the Essential filter no longer lists it.
 */
export async function checkThirdMark(page: Page, shot?: string) {
  await markNeed(page, 'Groceries', 'Debts & savings');
  await expectNeed(page, 'Groceries', 'Debts & savings', 'Custom');
  const split = await openIncomeSplit(page);
  await expect(split.getByTestId('split-row-essential')).toContainText('0%');
  await expect(split.getByTestId('split-row-lifestyle')).toContainText('25%');
  await expect(split.getByTestId('split-row-lifestyle')).toContainText(money('5.000.000'));
  await expect(split.getByTestId('split-row-debtsSavings')).toContainText('75%');
  await expect(split.getByTestId('split-row-debtsSavings')).toContainText(money('15.000.000'));
  // Still no button: what was kept lists nothing.
  await expect(split.getByRole('button', { name: /Debts & savings/ })).toHaveCount(0);
  if (shot) await page.screenshot({ path: shot });
  await split.getByTestId('split-row-essential').click();
  await expect(page).toHaveURL(/need=essential/);
  await expect(page.getByText('Market run')).toHaveCount(0);
  await expect(page.getByText('Dinner out')).toHaveCount(0);
}
