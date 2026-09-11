import { defineConfig, devices } from '@playwright/test';

// Runs against a production build so source edits during a run cannot hot-reload the page under test.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build && npm run preview', url: 'http://localhost:4173', reuseExistingServer: false, timeout: 180_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
