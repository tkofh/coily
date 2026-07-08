# Proposal: first-class imperative access to the provided SpringSystem

*From dogfooding coily 0.12 on the wedding site (2026-07-05). Portable — written to be dropped into the coily repo.*

## Motivation

Building the CTA confetti effect (`useConfettiBurst` in the wedding repo) needed the imperative layer of coily, not the declarative one: a dynamic pool of springs created and disposed per-particle at arbitrary times, velocity impulses on `Spring2D`, config swaps mid-flight, and `onUpdate`/`onStop` callbacks driving direct DOM writes outside Vue reactivity. `useSpring`/`useSpring2D` can't express this — they're setup-scoped refs with fixed cardinality.

The raw `SpringSystem` expresses it perfectly, but `coily/vue` gives no public way to reach the system the Nuxt plugin provides. The workaround in production today:

```ts
const SPRING_SYSTEM = Symbol.for('coily/spring-system') as InjectionKey<SpringSystem>
const system = inject(SPRING_SYSTEM, null)
```

This works (and the `Symbol.for` registered key is worth keeping — see below) but it's a reach into a private contract, and it leaves a second problem unsolved: springs created imperatively from a component are tied to nothing. The confetti composable hand-tracks every live spring in a `Set` so unmount can dispose them; forget that bookkeeping and motions leak into the shared `MotionSet` forever.

Two-tier proposal: bless the injection, then make imperative creation leak-proof.

## Tier 1 — bless the injection

### 1a. Repurpose `useSpringSystem()` as the accessor

The current `useSpringSystem(options?): void` *creates + provides + starts/stops* a system. Those are provider semantics under a getter name, and the name is exactly what an accessor wants to be called (`useRouter`, `useStore` convention). Proposed:

```ts
// coily/vue
export function useSpringSystem(): SpringSystem
```

- Injects the provided system and returns it.
- **Throws** when nothing is provided, with a pointed message:
  `"[coily] no SpringSystem provided — install the coily/nuxt module or call provideSpringSystem() in an ancestor"`.
  Deliberately no silent local-system fallback: fallbacks multiply rAF tickers and hide misconfiguration. (The wedding composable currently falls back; it would drop that branch.)

### 1b. Fold the old creator semantics into `provideSpringSystem`

```ts
// existing signature stays
export function provideSpringSystem(system: SpringSystem, app?: App): void
// new convenience overload: create + provide + start/stop with the component lifecycle
export function provideSpringSystem(options?: SpringSystemOptions): SpringSystem
```

Returning the created system (the old `useSpringSystem` returned void) costs nothing and helps tests.

### 1c. Export the typed key as the low-level escape hatch

```ts
export const SpringSystemKey: InjectionKey<SpringSystem> = Symbol.for('coily/spring-system') as ...
```

Keep `Symbol.for` (not a plain `Symbol`) as the value: the registered-symbol trick means duplicated module instances (pnpm/dev/HMR/monorepo double-install) still resolve to the same key. That behavior saved the workaround; it should survive the blessing.

## Tier 2 — `useSpringPool()`: scope-tied imperative creation

The actual footgun isn't injection, it's lifecycle. Proposed:

```ts
// coily/vue
export interface SpringPool {
  createSpring(position: SpringPosition, config?: SpringConfig): Spring
  createSpring2D(position: Spring2DPosition, config?: SpringConfig): Spring2D
}
export function useSpringPool(): SpringPool
```

Semantics:

- Delegates creation to the injected system (throws like `useSpringSystem` if absent).
- Every spring created through the pool is registered against the **current effect scope** and auto-disposed via `onScopeDispose`.
- Early manual `spring.dispose()` still works and unregisters it from the pool — which requires **double-dispose to be a documented no-op** on `Spring`/`Spring2D`/`Motion` (verify `MotionSet.remove` of an absent motion is safe; make it so if not).
- SSR: springs created during server setup are inert (system never `start()`ed on the server) and are disposed with the scope; no special casing needed, but a test should pin this.

With this, the confetti composable becomes: `const pool = useSpringPool()` — injection invisible, full imperative flexibility, and a leaked motion is structurally impossible (its remaining `Set` exists only to remove DOM nodes).

## Nuxt module changes

Add to `addImports` in `coily/nuxt`: `useSpringSystem`, `useSpringPool` (both from `coily/vue`), and export `SpringSystemKey` for manual setups. The plugin template is unchanged — it already provides via `provideSpringSystem(system, vueApp)`.

## Breaking-change notes (0.x minor)

- `useSpringSystem(options)` (creator, returns void) → `provideSpringSystem(options)` (returns the system). One-line migration; old call sites get the accessor's throw-or-return behavior, which will fail loudly in dev rather than silently double-providing.
- No changes to `coily` core — everything here is `coily/vue` + `coily/nuxt`.

## Non-goals / considered and skipped

- **Declarative pool API** (react-spring's `useSprings(n)` style): the confetti case has per-particle lifecycle and mid-flight retargeting; fixed-cardinality declarative arrays don't fit and `useSpring` already covers the declarative side.
- **`disposeOnRest` option on springs**: the confetti pattern (`fade.onStop(() => destroy(p))`) is easy to compose in userland and coupling disposal to rest state has too many edge cases (config swaps re-arm motion, chained targets).
- **README refresh** is needed regardless — it still documents the pre-0.12 `createSpring(initial, config)` API. Worth folding into the same release.

## Reference sketch

```ts
// coily/vue/system.ts
export const SpringSystemKey = Symbol.for('coily/spring-system') as InjectionKey<SpringSystem>

export function useSpringSystem(): SpringSystem {
  const system = inject(SpringSystemKey, null)
  if (!system) throw new Error('[coily] no SpringSystem provided — install coily/nuxt or call provideSpringSystem()')
  return system
}

export function useSpringPool(): SpringPool {
  const system = useSpringSystem()
  const live = new Set<Spring | Spring2D>()
  const adopt = <T extends Spring | Spring2D>(spring: T): T => {
    live.add(spring)
    // wrap dispose so early manual disposal unregisters itself
    const dispose = spring.dispose.bind(spring)
    spring.dispose = () => { live.delete(spring); dispose() }
    return spring
  }
  onScopeDispose(() => {
    for (const s of live) s.dispose()
    live.clear()
  })
  return {
    createSpring: (p, c) => adopt(system.createSpring(p, c)),
    createSpring2D: (p, c) => adopt(system.createSpring2D(p, c)),
  }
}
```

(Sketch only — the dispose-wrapping might be cleaner as a first-class `onDispose` hook on springs, or pool-side tracking via the existing `onStop`. Author's call.)
