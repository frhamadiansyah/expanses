import { expect, type Page, test } from '@playwright/test';
import { addEvent } from './event-plan';

// The 390 px picture of the page, kept next to the mockup it was built from.
const SHOT = new URL('../../../docs/mockups/2026-11-14-event-settings-built-390.png', import.meta.url).pathname;
const SHOT_DONE = new URL('../../../docs/mockups/2026-11-14-event-settings-built-done-390.png', import.meta.url).pathname;

/** The whole page as the owner reviews it: the browser's install note dismissed and the tab bar left out of the way. */
async function shoot(page: Page, path: string) {
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  if ((await dismiss.count()) > 0) await dismiss.click();
  await page.screenshot({ path, fullPage: true, style: 'nav[aria-label="Main"] { display: none !important; }' });
}

/** The event's corner is a ＋ and a gear; everything done to the event itself is on the settings page. */
test('a private event has only Add spending and Settings in its corner, and the settings page holds the rest', async ({ page }) => {
  await addEvent(page, 'Bali trip');
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add spending', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/events\/[^/]+\/settings$/);
  const settings = page.getByTestId('event-settings');
  await expect(settings.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Event', exact: true })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Money', exact: true })).toBeVisible();
  await expect(settings.getByTestId('settings-name')).toHaveValue('Bali trip');
  await expect(settings.getByTestId('settings-starts')).toBeVisible();
  await expect(settings.getByTestId('settings-ends')).toBeVisible();
  await expect(settings.getByTestId('settings-categories')).toContainText('The monthly categories');
  await expect(settings.getByTestId('settings-currency')).toBeVisible();
  await expect(settings).toContainText('Categories stay once something is tagged or planned. Currency stays once something is bought.');
  await expect(settings.getByRole('checkbox', { name: 'Plan' })).toBeChecked();
  await expect(settings.getByTestId('settings-done')).toHaveText('Mark as done');
  await expect(settings).toContainText('Moves Bali trip to Past. It can be reopened.');
  await expect(settings.getByTestId('settings-share')).toContainText('Share this event');
  await expect(settings.getByRole('button', { name: 'Delete event' })).toBeVisible();
  await expect(settings).toContainText('Its transactions stay where they are.');
  // No edit mode: nothing on the page saves or cancels.
  await expect(settings.getByRole('button', { name: /Save|Cancel/ })).toHaveCount(0);
  await shoot(page, SHOT);

  // Back goes to the event, named by it.
  await settings.getByRole('link', { name: 'Bali trip', exact: true }).click();
  await expect(page).toHaveURL(/\/events\/[^/]+$/);
});

test('the name is typed in place and saved; an empty name is not', async ({ page }) => {
  await addEvent(page, 'Bali trip');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const name = page.getByTestId('settings-name');

  await name.fill('Bali and Lombok');
  await name.press('Enter');
  // Saved: the way back is named by the new name.
  await expect(page.getByRole('link', { name: 'Bali and Lombok', exact: true })).toBeVisible();

  await name.fill('');
  await name.blur();
  await expect(name).toHaveValue('Bali and Lombok');

  // A pause in the typing saves too, with no blur.
  await name.fill('Lombok');
  await expect(page.getByRole('link', { name: 'Lombok', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Lombok', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lombok', exact: true })).toBeVisible();
});

test('dates save as they change, and an end before the start is refused', async ({ page }) => {
  await addEvent(page, 'Bali trip');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const starts = page.getByTestId('settings-starts');
  const ends = page.getByTestId('settings-ends');
  const start = await starts.inputValue();

  await ends.fill('2000-01-01');
  await expect(page.getByText('An event cannot end before it starts')).toBeVisible();

  const later = new Date(`${start}T00:00:00`);
  later.setDate(later.getDate() + 3);
  const laterIso = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}-${String(later.getDate()).padStart(2, '0')}`;
  await ends.fill(laterIso);
  await expect(page.getByText('An event cannot end before it starts')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('settings-ends')).toHaveValue(laterIso);
  await expect(page.getByTestId('settings-starts')).toHaveValue(start);
});

test('Currency and Categories open their lists and save the pick', async ({ page }) => {
  await addEvent(page, 'Bali trip');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();

  await page.getByTestId('settings-currency').click();
  await page.getByRole('dialog').getByRole('button', { name: 'JPY Japanese Yen', exact: true }).first().click();
  await expect(page.getByTestId('settings-currency')).toContainText('Japanese Yen');

  await page.getByTestId('settings-categories').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: 'The monthly categories' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Holiday', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('settings-categories')).toContainText('Holiday');

  await page.reload();
  await expect(page.getByTestId('settings-categories')).toContainText('Holiday');
  await expect(page.getByTestId('settings-currency')).toContainText('Japanese Yen');
});

test('Plan is a switch, and Mark as done moves the event to Past until it is reopened', async ({ page }) => {
  await addEvent(page, 'Bali trip');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();

  await page.getByRole('checkbox', { name: 'Plan' }).click();
  await expect(page.getByRole('checkbox', { name: 'Plan' })).not.toBeChecked();
  await page.getByRole('link', { name: 'Bali trip', exact: true }).click();
  await expect(page.getByTestId('event-sheet')).toContainText('Nothing spent on it yet.');
  await expect(page.getByRole('link', { name: 'Plan what to pay' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Plan' }).click();
  await page.getByTestId('settings-done').click();
  await expect(page.getByTestId('settings-done')).toHaveText('Reopen');
  await expect(page.getByTestId('event-settings')).toContainText(/Done on \d{1,2} \w{3}\. Reopening moves it back to Now and next\./);
  await shoot(page, SHOT_DONE);

  await page.goto('/events');
  const past = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Past' }) });
  await expect(past.getByTestId('event-row')).toContainText('Bali trip');

  await past.getByTestId('event-row').click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings-done').click();
  await expect(page.getByTestId('settings-done')).toHaveText('Mark as done');
  await page.goto('/events');
  const now = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Now and next' }) });
  await expect(now.getByTestId('event-row')).toContainText('Bali trip');
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
