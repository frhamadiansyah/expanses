import { expect, test } from '@playwright/test';
import { corner, newEvent, openTrip } from './shared-events';

/*
 * A shared event's categories page (shared events §6): reached from the ⋯ menu, it lists the event's categories with
 * their icons; one is added (wearing the Travel icon its name suggests), renamed, given another icon, and archived.
 * Once the event is Done the rows no longer open. Invented names; one phone, a trip shared in lira.
 */

test.describe.configure({ timeout: 180_000 });

test('categories of a shared event: add, rename, change the icon, archive; read-only once Done', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await newEvent(page, 'Coast week');
  await corner(page, 'Share this event');
  const share = page.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByLabel('Currency').selectOption('TRY');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByTestId('invite-link')).toBeVisible({ timeout: 60_000 });
  await openTrip(page);

  await corner(page, 'Categories');
  const rows = page.getByTestId('event-category');
  await expect(rows).toHaveCount(0);

  // A new one: the icon follows its name until another is picked.
  await page.getByTestId('event-category-add').click();
  const sheet = page.getByRole('dialog', { name: 'New category' });
  await sheet.getByLabel('Name', { exact: true }).fill('Stay');
  await expect(sheet.getByRole('button', { name: 'bed' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Save category' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Stay');

  // Renamed, with another icon.
  await rows.first().click();
  const edit = page.getByRole('dialog', { name: 'Category' });
  await edit.getByLabel('Name', { exact: true }).fill('Ferries');
  await edit.getByRole('button', { name: 'ship', exact: true }).click();
  await expect(edit.getByRole('button', { name: 'ship', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await edit.getByRole('button', { name: 'Save category' }).click();
  await expect(rows.first()).toContainText('Ferries');

  // Archived, asked twice.
  await rows.first().click();
  await page.getByTestId('event-category-archive').click();
  await page.getByTestId('event-category-archive').click();
  await expect(rows).toHaveCount(0);

  // Done locks it: a row, were there one, would not open, and nothing can be added.
  await page.goBack();
  await corner(page, 'Done');
  await corner(page, 'Categories');
  await expect(page.getByTestId('event-category-add')).toHaveCount(0);
});
