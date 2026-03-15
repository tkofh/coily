import { describe, expect, test } from 'vitest'
import { render } from 'vitest-browser-vue'
import Parent from './fixtures/initial-state/Parent.vue'

describe('initial state', () => {
  test('springs start with the correct value', async () => {
    const { getByText } = render(Parent)

    await expect.element(getByText('1')).toBeInTheDocument()
  })
})
