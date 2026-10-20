import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: '../..',
  testMatch: '**/*.spec.ts',
  outputDir: path.resolve('.artifacts/frontend/playwright'),
  reporter: 'list',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    timezoneId: 'America/Los_Angeles',
    reducedMotion: 'reduce',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: 'pnpm --filter @ryadom/web dev --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    cwd: path.resolve('.'),
  },
});
