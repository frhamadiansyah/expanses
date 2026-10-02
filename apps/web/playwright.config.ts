import { defineConfig, devices } from '@playwright/test';

/*
 * The app's port, and the household-sharing relay's (spec §9). The relay runs as the local Worker (`wrangler dev`) on a
 * port of its own — 8799, not the 8787 `npm run relay` uses, so a relay someone already has running is left alone —
 * and the app is built pointing at it. Both can be moved with E2E_PORT / E2E_RELAY_PORT when another run holds them.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);
const RELAY_PORT = Number(process.env.E2E_RELAY_PORT ?? 8799);
const ORIGIN = `http://localhost:${PORT}`;
const RELAY_URL = `http://localhost:${RELAY_PORT}`;

// Runs against a production build so source edits during a run cannot hot-reload the page under test.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: ORIGIN, trace: 'retain-on-failure' },
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${PORT}`,
      url: ORIGIN,
      reuseExistingServer: false,
      timeout: 180_000,
      // The build alone gets VITE_E2E: the test hook exists in what a journey loads and in nothing else.
      env: { VITE_RELAY_URL: RELAY_URL, VITE_E2E: '1' },
    },
    {
      // The relay's allowed origins are this run's, passed as a var rather than written into wrangler.toml.
      command: `npx wrangler dev --port ${RELAY_PORT} --var "ALLOWED_ORIGINS:${ORIGIN},http://127.0.0.1:${PORT}"`,
      cwd: '../relay',
      port: RELAY_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone[.-]/ },
    // The phone shell is a different shape, not a narrower one: its own project, its own specs.
    // Chromium at an iPhone's size, not WebKit: Playwright's WebKit has no OPFS, so the database
    // cannot open there at all. WebKit itself is covered by running the app in the iOS Simulator.
    // Household sharing is the one journey written once for both shapes: sharing.spec.ts runs here too.
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false, deviceScaleFactor: 3 },
      testMatch: [/phone[.-]/, /sharing\.spec\.ts$/],
    },
  ],
});
