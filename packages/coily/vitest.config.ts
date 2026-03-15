import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['test/vue/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/vue/**', 'src/index.ts'],
      reporter: ['text', 'html'],
    },
  },
})
