// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Pattern Pages is a single static HTML file with no build step.
 * These tests serve the repo root over HTTP and drive index.html directly
 * in a real browser - no mocking, no virtual DOM.
 */
module.exports = defineConfig({
  testDir: './tests',
  // This app has a lot of self-installing setTimeout-based patch scripts left over from its
  // patch-on-patch history (re-renders and re-inits firing anywhere from ~150ms to ~1.6s after
  // load). Running tests in parallel adds CPU contention that shifts exactly when those fire
  // relative to a test's own waits, which was making a couple of timing-sensitive tests flaky.
  // Running serially trades a bit of wall-clock time for a suite that's actually deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8934',
    trace: 'retain-on-failure',
    launchOptions: {
      // This environment's Chromium lives outside Playwright's own cache;
      // point at it directly instead of letting Playwright try to download one.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 1400 } },
    },
  ],
  webServer: {
    command: 'node tests/support/static-server.js',
    url: 'http://127.0.0.1:8934/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
