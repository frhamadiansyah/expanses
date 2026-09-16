import { expect, test } from '@playwright/test';

/** Below this, iOS zooms the page the moment a field takes focus, and often will not zoom back out. */
const NO_ZOOM = 16;

test.describe.configure({ mode: 'parallel' });

test('no field on a phone is small enough to make iOS zoom the page', async ({ page }) => {
  for (const route of ['/transactions', '/accounts', '/cards', '/budget', '/goals']) {
    await page.goto(route);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const field of document.querySelectorAll('input, select, textarea')) {
        const size = Number.parseFloat(getComputedStyle(field).fontSize);
        const type = (field as HTMLInputElement).type;
        // A checkbox or a radio has no text to zoom towards.
        if (type === 'checkbox' || type === 'radio' || type === 'file') continue;
        if (size < 16) out.push(`${field.tagName}${type ? `[${type}]` : ''} at ${size}px — ${(field as HTMLInputElement).ariaLabel ?? field.id}`);
      }
      return out;
    });
    expect(small, `${route} has fields under ${NO_ZOOM}px`).toEqual([]);
  }
});
