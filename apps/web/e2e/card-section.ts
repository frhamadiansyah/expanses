import { expect, type Page } from '@playwright/test';

/** The segmented control's name for each section, and the ⋯ menu item that opens it from Wallet's summary. */
const MENU = { Activity: 'Statement', Points: 'Points', 'Rewards rules': 'Rewards rules', Card: 'Card details' } as const;

/**
 * Open one section of the card on screen.
 *
 * A card opened from the Wallet stack shows Wallet's summary first, with its sections behind ⋯; a card still being
 * set up, or already in one of its sections, has the segmented control. Either way this lands on the section.
 */
export async function cardSection(page: Page, section: keyof typeof MENU) {
  const tabs = page.getByRole('radiogroup', { name: 'Card sections' });
  await expect(tabs.or(page.getByTestId('latest-transactions')).first()).toBeVisible();
  if (!(await tabs.isVisible())) {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: MENU[section], exact: true }).click();
  }
  await page.getByRole('radio', { name: section, exact: true }).click();
  await expect(page.getByRole('radio', { name: section, exact: true })).toHaveAttribute('aria-checked', 'true');
}
