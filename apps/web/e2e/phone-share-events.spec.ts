import { expect, test } from '@playwright/test';
import { newEvent } from './shared-events';
import { openWorkspaceSharePage } from './workspace-page';

test.describe.configure({ timeout: 120_000 });

test('by thumb: events are no longer at the bottom of the Share page (redesign A1): they are in Shared with, once someone joined', async ({ page }) => {
  await page.goto('/account');
  await newEvent(page, 'Coast week');
  await openWorkspaceSharePage(page, 'Personal');
  await expect(page.getByTestId('share-button')).toBeVisible();
  await expect(page.getByTestId('share-event-row')).toHaveCount(0);
  await expect(page.getByText('Coast week')).toHaveCount(0);
});
