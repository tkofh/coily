# Change Log

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
