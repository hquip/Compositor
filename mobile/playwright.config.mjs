import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.mjs', workers: 1, timeout: 45000,
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [ { name: 'android-web', use: { ...devices['Pixel 7'], browserName: 'chromium' } }, { name: 'ios-web', use: { ...devices['iPhone 14'], browserName: 'webkit' } } ],
});
