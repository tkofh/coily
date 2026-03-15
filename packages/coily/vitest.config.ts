import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/vue/**', 'src/index.ts'],
      reporter: ['text', 'html'],
    },
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/**/*.spec.ts'],
          exclude: ['test/vue/**'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['test/**/*.browser.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'bench',
          include: [],
          benchmark: {
            include: ['test/**/*.bench.ts'],
          },
        },
      },
    ],
  },
})
