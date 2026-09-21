import type { Page } from '@playwright/test';

/**
 * Today as the app reads it: the browser's local calendar date, built the way `isoDate` in `@expanses/core` builds
 * it — never `toISOString()`, which is UTC and names yesterday between 00:00 and 07:00 in Jakarta. Read from the page
 * rather than from Node, so a spec that pins the browser's clock or timezone gets the day the app itself sees.
 */
export function todayIn(page: Page, daysAgo = 0): Promise<string> {
  return page.evaluate((back) => {
    const date = new Date();
    date.setDate(date.getDate() - back);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }, daysAgo);
}

/** A Node-side date as the app would name it: the local calendar day, for figures counted from today (years ahead). */
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
