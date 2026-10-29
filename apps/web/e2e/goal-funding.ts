import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { fillDay, openNewAsset } from './add-asset';
import { openDrawers } from './drawers';
import { openGoalForm } from './goals';
import { addSetAsideRow, closeSetAsideRows, goalCard, goalRow } from './set-aside';

/** A bank account, and a gold holding bought once for no goal. */
async function bankAndGold(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await fillDay(page, 'Bought', '2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost', { exact: true }).fill('18000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();
  await page.goto('/net-worth/prices');
  await page.getByLabel(/Antam gold bars/).fill('1800000');
  await page.getByRole('button', { name: 'Save prices' }).click();
  await expect(page.getByText(/· Typed/)).toBeVisible();
}

async function newGoal(page: Page, name: string) {
  await page.goto('/goals');
  await openGoalForm(page, 'Hajj or umrah');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel(/Cost today/).first().fill('50000000');
}

/**
 * The Funding sheet on a new goal: cash and a tagged purchase held on the form, written when the check mark creates the
 * goal; and a second goal asked before it takes a purchase another goal already serves.
 */
export async function fundingSheetWalk(page: Page) {
  await bankAndGold(page);

  await newGoal(page, 'Hajj for two');
  const funding = page.getByRole('button', { name: /^Funding/ });
  await expect(funding).toContainText('None');
  await funding.click();
  const sheet = page.getByRole('dialog', { name: 'Funding' });
  await expect(sheet.getByText('Cash and cash equivalents')).toBeVisible();
  await expect(sheet.getByText('Bonds, shares and funds')).toBeVisible();

  // Tag a purchase lists the earlier buys with their date, size and goal.
  await sheet.getByRole('button', { name: 'Tag a purchase' }).click();
  const list = page.getByRole('dialog', { name: 'Tag a purchase' });
  const buy = list.getByTestId('taggable-row').filter({ hasText: 'Antam gold bars' }).first();
  await expect(buy).toContainText('Bought');
  await expect(buy).toContainText('No goal');
  await buy.click();
  await expect(sheet.getByTestId('tagged-row')).toHaveCount(1);
  await expect(sheet.getByTestId('tagged-row')).toContainText('Antam gold bars');

  await addSetAsideRow(page, 'BCA Tahapan');
  await page.getByLabel('BCA Tahapan', { exact: true }).fill('1500000');
  await closeSetAsideRows(page);
  await expect(funding).toContainText('1.500.000 + 1 purchase');

  await page.getByRole('button', { name: 'Save goal' }).last().click();
  await expect(goalRow(page, 'Hajj for two')).toBeVisible();
  const first = await goalCard(page, 'Hajj for two');
  await expect(first.getByTestId('goal-link').filter({ hasText: 'Antam gold bars' })).toBeVisible();
  await expect(first.getByTestId('goal-link').filter({ hasText: 'BCA Tahapan' })).toBeVisible();

  // A second goal: the buy already serves Hajj for two, so tagging it asks first.
  await newGoal(page, 'Umrah');
  await page.getByRole('button', { name: /^Funding/ }).click();
  const second = page.getByRole('dialog', { name: 'Funding' });
  await second.getByRole('button', { name: 'Tag a purchase' }).click();
  const again = page.getByRole('dialog', { name: 'Tag a purchase' }).getByTestId('taggable-row').filter({ hasText: 'Antam gold bars' }).first();
  await expect(again).toContainText('Hajj for two');
  await again.click();
  const ask = page.getByRole('dialog', { name: 'Move this purchase?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep where it is' }).click();
  await expect(second.getByTestId('tagged-row')).toHaveCount(0);
  await again.click();
  await page.getByRole('dialog', { name: 'Move this purchase?' }).getByRole('button', { name: 'Move to this goal' }).click();
  await expect(second.getByTestId('tagged-row')).toHaveCount(1);
  await second.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /^Funding/ })).toContainText('1 purchase');
  await page.getByRole('button', { name: 'Save goal' }).last().click();
  await expect(goalRow(page, 'Umrah')).toBeVisible();
  const umrah = await goalCard(page, 'Umrah');
  await expect(umrah.getByTestId('goal-link').filter({ hasText: 'Antam gold bars' })).toBeVisible();
}
