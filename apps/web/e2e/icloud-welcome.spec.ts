import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { seal } from '../src/features/backup/icloud/envelope';
import { copyName } from '../src/features/backup/icloud/names';

/*
 * The first open of an empty app in the iOS or Mac app, with a copy in iCloud (ICloudWelcome): Restore, Link to another
 * device, or Start fresh. A browser is not the shell, so the page is told it runs on iOS and the app's iCloud plugin
 * answers from here, holding one locked copy with invented figures.
 */

const KEY_ID = 'test-key';
const RAW_KEY = new Uint8Array(32).map((_, i) => (i * 7 + 3) % 256);
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

async function cloudCopy() {
  const takenAt = '2026-11-21T02:15:00.000Z';
  const summary = { takenAt, model: 'iPhone', accounts: 9, transactions: 1274, photos: 0 };
  const bytes = await seal({ database: new TextEncoder().encode('SQLite format 3\0'.padEnd(120, 'x')), summary, photos: [] }, { keyId: KEY_ID, raw: RAW_KEY });
  const name = copyName({ takenAt, model: 'iPhone', device: '9F8E7D6C-0000-4000-8000-000000000002', withPhotos: false, bytes: bytes.length });
  return { name, base64: toBase64(bytes) };
}

async function onIOSWithCopy(page: Page) {
  const copy = await cloudCopy();
  await page.addInitScript(
    ({ copy, keyId, key }) => {
      type Options = Record<string, string | undefined>;
      const files: Record<string, string> = { [copy.name]: copy.base64 };
      const keys = (prefix = '') => Object.keys(localStorage).filter((k) => k.startsWith(prefix));
      // What the shell's plugins answer. The keychain plugin is needed too: on iOS it has no browser half to fall back on.
      const answers: Record<string, Record<string, (options: Options) => unknown>> = {
        ICloudBackup: {
          status: () => ({ available: true, deviceId: '1A2B3C4D-0000-4000-8000-000000000001', model: 'Mac' }),
          list: () => ({ names: Object.keys(files) }),
          read: (options) => ({ base64: files[options.name ?? ''] }),
          key: () => ({ keyId, key }),
        },
        SecureStorage: {
          setSynchronizeKeychain: () => undefined,
          internalGetItem: (options) => ({ data: localStorage.getItem(options.prefixedKey ?? '') }),
          internalSetItem: (options) => void localStorage.setItem(options.prefixedKey ?? '', options.data ?? ''),
          internalRemoveItem: (options) => {
            const had = localStorage.getItem(options.prefixedKey ?? '') !== null;
            localStorage.removeItem(options.prefixedKey ?? '');
            return { success: had };
          },
          internalClearItemsWithPrefix: (options) => keys(options.prefix).forEach((k) => localStorage.removeItem(k)),
          internalGetPrefixedKeys: (options) => ({ keys: keys(options.prefix) }),
        },
      };
      const w = window as unknown as Record<string, unknown>;
      w.CapacitorCustomPlatform = { name: 'ios', plugins: {} };
      w.Capacitor = {
        PluginHeaders: Object.entries(answers).map(([name, methods]) => ({ name, methods: Object.keys(methods).map((m) => ({ name: m, rtype: 'promise' })) })),
        nativePromise: async (plugin: string, method: string, options?: Options) => answers[plugin]![method]!(options ?? {}),
      };
    },
    { copy, keyId: KEY_ID, key: toBase64(RAW_KEY) },
  );
}

async function shot(page: Page, name: string) {
  const dir = process.env.WELCOME_SHOTS;
  if (!dir) return;
  for (const [shape, width, height] of [
    ['phone', 390, 844],
    ['wide', 1280, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: join(dir, `${name}-${shape}.png`) });
  }
}

test('the first screen offers Restore, Link to another device and Start fresh; Link opens the join sheet on Devices', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'one shape is enough: the screenshots take both');
  await onIOSWithCopy(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Backup found in iCloud' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('1.274')).toBeVisible();
  const choices = page.getByRole('button');
  await expect(choices).toHaveText(['Restore', 'Link to another device', 'Start fresh']);
  await expect(page.getByRole('button', { name: 'Restore' })).toBeEnabled();
  await shot(page, 'welcome');
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('button', { name: 'Link to another device' }).click();
  await expect(page).toHaveURL(/\/account\/devices$/);
  const sheet = page.getByRole('dialog', { name: 'Link to another device' });
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('join-link-code')).toBeFocused();
  // An empty device has nothing to back up: Link is the one step, and no warning about replacing anything.
  await expect(page.getByTestId('join-link-backup')).toHaveCount(0);
  await expect(page.getByTestId('join-link-go')).toHaveText('Link');
  await expect(sheet).not.toContainText('replace');
  await shot(page, 'welcome-link-sheet');
  await page.setViewportSize({ width: 1280, height: 720 });

  // Closed without linking: the Devices page as it always is, and the sheet does not come back on its own.
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  // The phone's Devices page, or on a wide screen the Mac Settings at Devices.
  await expect(page.getByTestId('devices-page').or(page.getByTestId('settings-devices'))).toBeVisible();
  await page.goto('/');
  // Not remembered like Start fresh: the app is still empty, so the next open asks again.
  await expect(page.getByRole('heading', { name: 'Backup found in iCloud' })).toBeVisible({ timeout: 30_000 });
});

test('Start fresh still opens the app and is not asked again', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'one shape is enough');
  await onIOSWithCopy(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.getByRole('heading', { name: 'Backup found in iCloud' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Link to another device' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: 'Backup found in iCloud' })).toHaveCount(0);
});
