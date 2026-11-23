import type { Locator, Page } from '@playwright/test';

/**
 * Where a form's own rows and buttons are. On a wide screen an add or edit form floats in the Mac's panel over the page
 * it was opened from, and that page can carry the same words (a drawer named for the kind, a bar's Add debt); the panel
 * is the form. A phone draws the form as the page.
 */
export const formArea = (page: Page): Page | Locator => ((page.viewportSize()?.width ?? 0) >= 768 ? page.getByTestId('form-panel') : page);
