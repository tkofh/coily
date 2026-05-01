# Change Log

## 0.12.2

### Patch Changes

- 872af8f: Fix `SpringConfig` mutation tracking when the class gets duplicated across bundler chunks (observed under Nuxt + Vite).

  The version counter previously used a `#version` ECMAScript private field, accessed through static `SpringConfig.version()` and `SpringConfig.assign()` methods. When Vite inlined `SpringConfig` into multiple chunks, the static methods on one copy could not access private fields on instances of another copy, throwing at runtime. The version counter is now a regular `_version` field (marked `@internal` and stripped from the public `.d.ts`), and `assign` is an instance method — both of which dispatch through whichever copy of the class created the instance, sidestepping the duplication problem.

## 0.12.1

### Patch Changes

- Add `prepublishOnly` script to ensure the package is built before publishing.

## 0.12.0

### Minor Changes

- 0b96dd8: **BREAKING:** `SpringValue` component now takes a single `config` prop instead of individual `mass`/`tension`/`damping`/`precision` props. Accepts `SpringOptions` or a `SpringConfig` from `defineSpring()`.

  - `jumpTo` is now available in the slot scope
  - Component exposes `value`, `velocity`, `isResting`, `timeRemaining`, and `jumpTo` via template ref

- 0b96dd8: **BREAKING:** Rename `resting` to `isResting` across all APIs.

  - `spring.resting` → `spring.isResting`
  - `useSpring().resting` → `useSpring().isResting`
  - `SpringValue` slot prop `resting` → `isResting`

- 0b96dd8: **BREAKING:** `useSpring()` now returns a `SpringRef` instead of an object with separate `value`/`velocity`/`isResting`/`timeRemaining` refs.

  - `spring.value.value` → `spring.value` (the ref _is_ the value)
  - `spring.velocity`, `spring.isResting`, `spring.timeRemaining` are still refs on the object
  - `spring.jumpTo()` is now a method on the ref
  - Auto-unwraps in templates: `<div :style="{ opacity: spring }" />`

- 0b96dd8: Add `timeRemaining` property to springs, exposing the analytically estimated time (in milliseconds) until the spring comes to rest.

  - `spring.timeRemaining` available on the core `Spring` instance
  - `useSpring()` returns a reactive `timeRemaining` ref for Vue apps
  - `SpringConfig.computeTimeRemaining(state)` is available for standalone estimation

- 1f5ba85: Added `Spring2D` and `useSpring2D` for multi-dimensional spring animations. A `Spring2D` bundles two scalar springs behind a `Vector2`-aware API — no changes to the solver, each axis is independent.

  ```ts
  // Core
  const spring = system.createSpring2D({ x: 0, y: 0 });
  spring.target = { x: 100, y: 200 };

  // Vue
  const pos = useSpring2D(mouse, { dampingRatio: 1, duration: 500 });
  ```

  Springs can follow other springs via the `target` setter:

  ```ts
  const a = system.createSpring2D({ x: 0, y: 0 });
  const b = system.createSpring2D({ target: a });
  ```

- 0b96dd8: `useSpring` and `useSpring2D` now accept an array of targets, returning a tuple of refs sharing the same config.

  ```ts
  const [width, height] = useSpring([targetWidth, targetHeight], bouncyOptions);
  ```

## 0.11.0

### Minor Changes

- c99af28: Add `Spring.dispose()` for cleaning up event listeners and removing a spring from the scheduler.
- cc16cba: bring the vue and nuxt integrations into the main package via subpath exports and optional dependencies. vue is available at `coily/vue` and the nuxt module at `coily/nuxt`
- c99af28: Rename the `SpringValue` component's `friction` prop to `damping` to match the core API and `useSpring` options.

### Patch Changes

- 0f89ef6: Fix incorrect velocity computation in the overdamped spring solver. The derivative of `sinh`/`cosh` was using the sign pattern from the underdamped `sin`/`cos` derivative, causing velocity to be significantly overestimated for heavily overdamped springs. This could delay or prevent rest detection and produce incorrect `spring.velocity` values.
- c99af28: Fix springs producing incorrect motion when damping is changed mid-animation across regime boundaries (e.g., underdamped to overdamped). Fix ticker lag compensation being disabled after setting `lagThreshold` or `adjustedLag` at runtime.

## 0.10.1

### Patch Changes

- 3f6c1cc: ensure the initial value is correct regardless of whether `target`, `value`, or both are specified

## 0.10.0

### Minor Changes

- 14a6b8a: build as esm only

### Patch Changes

- 14a6b8a: explicitly export `SpringSystem` as an interface to avoid typescript trying to infer private properties
- 14a6b8a: immediately emit update events when changing value and target

## 0.9.0

### Minor Changes

- 6fbd43a: add `jumpTo` method to springs, which sets target and value and clears velocity

## 0.8.2

### Patch Changes

- 8827939: always emit events, even on synchronous changes

## 0.8.1

### Patch Changes

- 9a5f49c: fix: synchronous updates to both `target` and `value` now work properly

## 0.8.0

### Minor Changes

- 48b49a1: [breaking] replace `onRest` handler with `onStart` and `onStop` handlers

## 0.7.3

### Patch Changes

- 2560306: add component and nuxt module to vue integration

## 0.7.2

### Patch Changes

- update dependencies

## 0.7.1

### Patch Changes

- ensure spring state is updated immediately upon mutating value or target

## 0.7.0

### Minor Changes

- add mutable velocity and onRest handler

## 0.6.0

### Minor Changes

- use proper version for packages

## 0.5.1

### Patch Changes

- fixing build script

## 0.5.0

### Minor Changes

- refactor to improve math and performance

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.4.1](https://github.com/tkofh/coily/compare/coily@0.4.0...coily@0.4.1) (2023-04-09)

### Bug Fixes

- keep obj reference to config to allow updating ([1e5f495](https://github.com/tkofh/coily/commit/1e5f49519be7f58c4806b337096f394048c859ea))

# [0.4.0](https://github.com/tkofh/coily/compare/coily@0.3.0...coily@0.4.0) (2023-04-01)

### Features

- emit on spring system simulate ([d82e57d](https://github.com/tkofh/coily/commit/d82e57d28643fe2b25a5efe8e324da9342eeb84c))

# [0.3.0](https://github.com/tkofh/coily/compare/coily@0.2.0...coily@0.3.0) (2023-03-10)

### Features

- **coily:** jumpTo, function getters for props ([7c5351d](https://github.com/tkofh/coily/commit/7c5351d43bfef32e328c203933c483c52ea740cb))

# [0.2.0](https://github.com/tkofh/coily/compare/coily@0.1.1...coily@0.2.0) (2023-01-16)

### Features

- **@coily/vue:** breaking: factory plugin, simplify frozen api ([b92cc66](https://github.com/tkofh/coily/commit/b92cc66cc47fb905d75954637cbd84d78877ccc0))

## [0.1.1](https://github.com/tkofh/coily/compare/coily@0.1.0...coily@0.1.1) (2022-09-02)

### Bug Fixes

- **coily:** emit state update when target is set ([2bfe7b3](https://github.com/tkofh/coily/commit/2bfe7b340e6a2e2dca9a0c36f9d12580649ce396))

# 0.1.0 (2022-09-02)

**Note:** Version bump only for package coily
