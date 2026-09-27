import { expect, type Page } from '@playwright/test';

/**
 * A person on Lend & borrow: one row each, their name, what they owe in all, and nothing to press but the row.
 * Repaying, forgiving and changing a loan are on the loan's own page, one tap further in (`openLoan`).
 */
export const personRow = (page: Page, name: string) => page.getByTestId('person-row').filter({ hasText: name });

/**
 * From Lend & borrow, into a person's page and on to one of their loans — the one whose row reads `reason`, or the
 * first open one. Leaves the page on the loan, where Record collection (or repayment) and Forgive rest are.
 */
export async function openLoan(page: Page, name: string, reason?: string) {
  if (!/\/net-worth\/lend-borrow(\?|$)/.test(page.url())) await page.goto('/net-worth/lend-borrow');
  await personRow(page, name).first().click();
  await expect(page.getByTestId('person-hero')).toBeVisible();
  const loans = page.getByTestId('loan-row');
  await (reason ? loans.filter({ hasText: reason }) : loans).first().click();
  await expect(page.getByTestId('loan-hero')).toBeVisible();
}
