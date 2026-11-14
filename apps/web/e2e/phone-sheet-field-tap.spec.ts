import { expect, test } from '@playwright/test';

// The sheet's iOS path (a medium sheet locks its fields read-only until tapped) is chosen by the user agent.
test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });

test('a tap on a field of a medium sheet focuses it inside the tap, so iOS brings the keyboard', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByTestId('new-event').click();
  const name = page.getByLabel('Name', { exact: true });
  await expect(name).toHaveAttribute('readonly', '');
  // The click and the check in one task: a focus a timer makes after the tap does not count on iOS.
  const focusedInTap = await name.evaluate((field: HTMLInputElement) => {
    field.click();
    return document.activeElement === field && !field.readOnly;
  });
  expect(focusedInTap).toBe(true);
  await page.keyboard.type('Bali');
  await expect(name).toHaveValue('Bali');
  await expect(page.getByRole('button', { name: 'Save event' })).toBeEnabled();
});

test('a tap on the label of a locked field focuses the field inside the tap too, its caret at the right', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByTestId('new-event').click();
  const name = page.getByLabel('Name', { exact: true });
  await expect(name).toHaveAttribute('readonly', '');
  const focusedInTap = await page.locator('label', { hasText: /^Name$/ }).evaluate((label: HTMLLabelElement) => {
    label.click();
    const field = label.control as HTMLInputElement;
    return document.activeElement === field && !field.readOnly;
  });
  expect(focusedInTap).toBe(true);
  // No placeholder: the empty field's caret stands at the right edge, where the typing appears.
  await expect(name).toHaveCSS('text-align', 'right');
  // The Currency row reads as a form row: plain label, value in ink.
  await expect(page.getByTestId('event-currency')).toBeVisible();
});
