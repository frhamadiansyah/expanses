import { expect, test } from '@playwright/test';
import { addEvent } from './event-plan';

const SHOT = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad/event-settings.png';

/** The event's corner is a ＋ and a gear; everything done to the event itself is on the settings page. */
test('a private event has only Add spending and Settings in its corner, and the settings page holds the rest', async ({ page }) => {
  await addEvent(page, 'Bali trip');
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add spending', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/events\/[^/]+\/settings$/);
  const settings = page.getByTestId('event-settings');
  await expect(settings.getByRole('heading', { name: 'Event settings' })).toBeVisible();
  await expect(settings.getByTestId('settings-name')).toContainText('Bali trip');
  await expect(settings.getByTestId('settings-dates')).toBeVisible();
  await expect(settings.getByTestId('settings-categories')).toContainText('The monthly categories');
  await expect(settings.getByTestId('settings-currency')).toBeVisible();
  await expect(settings.getByRole('checkbox', { name: 'Plan' })).toBeChecked();
  await expect(settings.getByRole('checkbox', { name: 'Done' })).not.toBeChecked();
  await expect(settings.getByTestId('settings-share')).toContainText('Share this event');
  await expect(settings.getByRole('button', { name: 'Delete event' })).toBeVisible();
  await page.screenshot({ path: SHOT, fullPage: true });
});

test('Plan and Done are switches that the event page and the list reflect', async ({ page }) => {
  await addEvent(page, 'Bali trip');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();

  await page.getByRole('checkbox', { name: 'Plan' }).click();
  await expect(page.getByRole('checkbox', { name: 'Plan' })).not.toBeChecked();
  await page.getByRole('link', { name: 'Back to the event' }).click();
  await expect(page.getByTestId('event-sheet')).toContainText('Nothing spent on it yet.');
  await expect(page.getByRole('link', { name: 'Plan what to pay' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Plan' }).click();
  await page.getByRole('checkbox', { name: 'Done' }).click();
  await expect(page.getByRole('checkbox', { name: 'Done' })).toBeChecked();

  await page.goto('/events');
  const past = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Past' }) });
  await expect(past.getByTestId('event-row')).toContainText('Bali trip');
});

test('Delete event asks first and removes the event', async ({ page }) => {
  await addEvent(page, 'Bali trip');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();

  const asked: string[] = [];
  page.once('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Delete event' }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain('Bali trip');
  await expect(page).toHaveURL(/\/settings$/);

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete event' }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByText('Bali trip')).toHaveCount(0);
});

test('Share this event opens the share sheet', async ({ page }) => {
  await addEvent(page, 'Bali trip');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings-share').click();
  await expect(page.getByRole('form', { name: 'Share this event' })).toBeVisible();
});
