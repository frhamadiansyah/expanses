import type { CaptureLine } from '@expanses/core';
import type { Page } from '@playwright/test';

/** One Vision line: its text and box, the way `recognizeImage` hands it back. */
const line = (text: string, x: number, y: number, w = 0.2, h = 0.02): CaptureLine => ({ text, box: [x, y, w, h], height: h });

/**
 * A statement screenshot's rows as Vision reads them: every column its own line on one height — date, description,
 * amount at x 0.05 / 0.25 / 0.85 — one row under the other. The same shape as the reader's corpus.
 */
export function statementLines(rows: readonly (readonly [on: string, description: string, amount: string])[]): CaptureLine[] {
  return rows.flatMap(([on, description, amount], i) => {
    const y = 0.1 + i * 0.05;
    return [line(on, 0.05, y, 0.1), line(description, 0.25, y, 0.5), line(amount, 0.85, y, 0.12)];
  });
}

/** The summary screenshot: a label at the left and its amount at the right, per balance given. */
export function summaryLines(balances: readonly (readonly [label: string, amount: string])[]): CaptureLine[] {
  return balances.flatMap(([label, amount], i) => {
    const y = 0.1 + i * 0.05;
    return [line(label, 0.05, y, 0.3), line(amount, 0.85, y, 0.12)];
  });
}

/**
 * What the phone "reads" from the screenshots about to be checked, one list per picked file in order. The e2e build's
 * `recognizeImage` takes them off the front of `window.__statementLines`, standing in for Vision.
 */
export async function setStatementImages(page: Page, images: CaptureLine[][]): Promise<void> {
  await page.evaluate((lines) => {
    window.__statementLines = lines;
  }, images);
}

/** A 1×1 PNG: what the file input is handed, since only the injected lines are ever read. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export const screenshotFiles = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `statement-${i + 1}.png`, mimeType: 'image/png', buffer: PNG }));
