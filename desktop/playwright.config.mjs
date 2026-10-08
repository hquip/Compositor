import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure' },
});
