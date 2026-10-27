import { expect, test } from '@playwright/test';
import { newEvent } from './shared-events';
import { openWorkspaceSharePage } from './workspace-page';

test.describe.configure({ timeout: 120_000 });

test('by thumb: the Share page lists a personal event as Not shared, and tapping it opens the event’s Share sheet', async ({ page }) => {
  await page.goto('/account');
  await openWorkspaceSharePage(page, 'Personal');
  // No events yet: no Events section.
  await expect(page.getByTestId('share-event-row')).toHaveCount(0);

  await newEvent(page, 'Coast week');
  await openWorkspaceSharePage(page, 'Personal');

  const row = page.getByTestId('share-event-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Coast week');
  await expect(row).toContainText('Not shared');
  await expect(row).toHaveAccessibleName('Share Coast week');
  // No sentence under the row.
  await expect(page.getByText(/moves out of/i)).toHaveCount(0);

  await row.tap();
  await expect(page.getByRole('form', { name: 'Share this event' })).toBeVisible();
});
