import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './native-tests', workers: 1, timeout: 60000, reporter: 'list', outputDir: 'native-test-results' });
