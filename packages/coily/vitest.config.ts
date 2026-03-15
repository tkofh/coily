import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['test/vue/**', 'node_modules/**'],
  },
})
