import { defineConfig, devices } from '@playwright/test';

// Runs against a production build so source edits during a run cannot hot-reload the page under test.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build && npm run preview', url: 'http://localhost:4173', reuseExistingServer: false, timeout: 180_000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone[.-]/ },
    // The phone shell is a different shape, not a narrower one: its own project, its own specs.
    // Chromium at an iPhone's size, not WebKit: Playwright's WebKit has no OPFS, so the database
    // cannot open there at all. WebKit itself is covered by running the app in the iOS Simulator.
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false, deviceScaleFactor: 3 },
      testMatch: /phone[.-]/,
    },
  ],
});
