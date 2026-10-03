import { readFileSync } from 'node:fs';
import type { CaptureLine, RawCapture } from '@expanses/core';
import { expect, type Page } from '@playwright/test';

/*
 * The capture pipeline, walked from the outside.
 *
 * A phone's own doors — Shortcuts, the share sheet, Back Tap, the camera — cannot run in a browser, so a journey
 * hands the queue the captures a phone would have drained, through the e2e build's own hook. Everything after the
 * hook is the real pipeline: the same `ingestCaptures` the drain calls, the same sources, matching and drafts.
 */

/** One line of an image, as the phone's text recognition hands it over: box in 0–1, y from the top. */
export const line = (text: string, y: number, height = 0.03): CaptureLine => ({ text, box: [0.1, y, 0.6, height], height });

/**
 * A wallet app's screen, as a picture.
 *
 * A real image rather than a byte or two, because one journey opens it: the viewer draws its boxes over whatever the
 * bytes are, and a screenshot-shaped picture with a dark band at the top and two blocks below reads in a trace like
 * the screen it stands for.
 */
export const PICTURE = readFileSync(new URL('./picture.png', import.meta.url)).toString('base64');

/** A wallet app's notification: words, no lines, nothing to anchor. */
export function notice(over: Partial<RawCapture> = {}): RawCapture {
  return {
    id: 'note-1',
    kind: 'notification',
    capturedAt: '2026-09-30T10:00:00+07:00',
    app: 'com.example.pay',
    title: 'Pay',
    body: 'Pembayaran Rp38.000 berhasil. Merchant: TOKO KOPI',
    lines: [],
    imageFile: null,
    ...over,
  };
}

/** A screenshot of a payment, which knows its figure but not whose money it was. */
export function screen(over: Partial<RawCapture> = {}): RawCapture {
  return {
    id: 'shot-1',
    kind: 'screen',
    capturedAt: '2026-09-30T10:02:00+07:00',
    app: null,
    title: null,
    body: null,
    lines: [line('Pay', 0.02), line('Transaksi Berhasil', 0.06), line('Total Rp38.000', 0.5, 0.04)],
    imageFile: 'captures/shot-1.png',
    ...over,
  };
}

/** The bytes a picture's `imageFile` resolves to, under that very name. */
export const picture = (file: string) => ({ [file]: { base64: PICTURE, mime: 'image/png' } });

/**
 * Hands the queue these captures, exactly as a drain would have.
 *
 * The hook is installed by the app itself (`src/capture/test-hook.ts`), and only in a build that says `VITE_E2E` —
 * the Playwright build alone — so a journey waits for the app to finish opening before it asks.
 */
export async function inject(
  page: Page,
  captures: RawCapture[],
  images: Record<string, { base64: string; mime: string }> = {},
): Promise<{ drafts: number; merged: number; skipped: number } | undefined> {
  await page.waitForFunction(() => typeof window.__captureInject === 'function');
  return page.evaluate((payload) => window.__captureInject!(payload.captures, payload.images), { captures, images });
}

/** The owner answering "Which account is this?" for a source, in Settings: answered once, and every later capture of it files there. */
export async function answerSource(page: Page, source: string, account: string): Promise<void> {
  await page.goto('/settings/capture');
  await page.getByRole('link', { name: new RegExp(`^${source}`) }).click();
  const select = page.getByLabel('Account');
  await select.selectOption({ label: `${account} (IDR)` });
  // The write is asynchronous; leaving before it lands would answer for nothing.
  await expect(select).not.toHaveValue('');
}
