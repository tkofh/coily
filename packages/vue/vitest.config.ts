import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: {
    pool: 'forks',
    testTimeout: 10000,
    browser: {
      screenshotFailures: false,
      enabled: true,
      headless: true,
      name: 'chromium',
      provider: 'playwright',
    },
  },
})
