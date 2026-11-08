import { afterEach, describe, expect, test, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { type ReducedMotionMode, createSpringSystem } from '../../src/index.ts'
import { provideSpringSystem, useRamp } from '../../src/vue/index.ts'

// A ramp with an explicit `from` renders a value reduced motion would move.
const App = defineComponent({
  setup() {
    const ramp = useRamp(100, 100, { from: 0 })
    return () => h('p', `${ramp.value}`)
  },
})

function preferReduced(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaQueryList)
}

async function serverRender(): Promise<string> {
  // The server has no preference to read.
  const app = createSSRApp(App)
  provideSpringSystem(createSpringSystem({ reducedMotion: 'never' }), app)
  return renderToString(app)
}

function hydrate(html: string, mode: ReducedMotionMode) {
  const container = document.createElement('div')
  container.innerHTML = html
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const system = createSpringSystem({ reducedMotion: mode })
  const app = createSSRApp(App)
  provideSpringSystem(system, app)
  app.mount(container)
  const mismatched = warn.mock.calls.some((call) => String(call[0]).includes('Hydration'))
  return { container, system, mismatched }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('server rendering and hydration', () => {
  for (const reduced of [true, false]) {
    test(`hydrating with 'never' matches the server, then 'user' applies (reduced ${reduced})`, async () => {
      const html = await serverRender()
      expect(html).toBe('<p>0</p>')

      preferReduced(reduced)
      const { container, system, mismatched } = hydrate(html, 'never')
      expect(mismatched).toBe(false)

      system.reducedMotion = 'user'
      expect(system.reducedMotion).toBe(reduced)
      await Promise.resolve()
      expect(container.textContent).toBe(reduced ? '100' : '0')
      system.dispose()
    })
  }

  test("hydrating with 'user' under reduced motion would mismatch", async () => {
    const html = await serverRender()
    preferReduced(true)
    const { system, mismatched } = hydrate(html, 'user')
    expect(mismatched).toBe(true)
    system.dispose()
  })
})
