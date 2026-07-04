// @ts-check
require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.E2E_BASE_URL || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '';
const launchOptions = chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    launchOptions,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }
  ]
});
