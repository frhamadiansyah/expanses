import type { Locator } from '@playwright/test';

/** Sets a Currency field, whichever the form draws: the typed three-letter row, or a list to choose from. */
export async function setCurrency(field: Locator, code: string) {
  if ((await field.evaluate((el) => el.tagName)) === 'SELECT') await field.selectOption(code);
  else await field.fill(code);
}
