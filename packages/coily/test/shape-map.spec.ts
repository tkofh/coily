import { describe, expect, test, vi } from 'vitest'
import { ShapeMap } from '../src/shape-map.ts'

interface Leaf {
  path: string
  value: number
}

function createMap(shape: object) {
  return new ShapeMap<Leaf>(shape, (value, path) => ({ path, value }))
}

describe('ShapeMap: construction', () => {
  test('collects leaves in depth-first shape order with dot paths', () => {
    const map = createMap({ position: { x: 1, y: 2 }, color: [3, 4], opacity: 5 })

    expect(map.leaves.map((leaf) => leaf.path)).toEqual([
      'position.x',
      'position.y',
      'color.0',
      'color.1',
      'opacity',
    ])
    expect(map.leaves.map((leaf) => leaf.value)).toEqual([1, 2, 3, 4, 5])
  })

  test('throws on non-numeric leaves, empty nodes, and non-shape roots', () => {
    expect(() => createMap({ x: 'no' })).toThrow("Invalid value at 'x'")
    expect(() => createMap({})).toThrow('at least one channel')
    expect(() => createMap({ nested: [] })).toThrow('at least one channel')
    expect(() => createMap(new Date())).toThrow('plain object or an array')
  })
})

describe('ShapeMap: views', () => {
  test('mirrors the shape and refreshes leaf values in place', () => {
    const map = createMap({ position: { x: 1, y: 2 }, color: [3, 4] })
    const view = map.createView((leaf) => leaf.value * 10)

    expect(view.root).toEqual({ position: { x: 10, y: 20 }, color: [30, 40] })

    map.leaves[0]!.value = 7
    const before = view.root
    view.refresh()

    expect(view.root).toBe(before)
    expect(view.root).toEqual({ position: { x: 70, y: 20 }, color: [30, 40] })
  })
})

describe('ShapeMap: applyPartial', () => {
  test('applies only the mentioned channels, skipping undefined and holes', () => {
    const map = createMap({ position: { x: 0, y: 0 }, color: [0, 0, 0] })
    const seen: [string, number][] = []

    map.applyPartial({ position: { x: 5, y: undefined }, color: [undefined, 6] }, (leaf, value) =>
      seen.push([leaf.path, value]),
    )

    expect(seen).toEqual([
      ['position.x', 5],
      ['color.1', 6],
    ])
  })

  test('throws on unknown channels and structure mismatches', () => {
    const map = createMap({ position: { x: 0 }, color: [0] })
    const apply = vi.fn()

    expect(() => map.applyPartial({ z: 1 }, apply)).toThrow("Unknown channel 'z'")
    expect(() => map.applyPartial({ color: [1, 2] }, apply)).toThrow("Unknown channel 'color.1'")
    expect(() => map.applyPartial({ position: 1 }, apply)).toThrow(
      "Expected an object at 'position'",
    )
    expect(() => map.applyPartial({ position: { x: {} } }, apply)).toThrow(
      "Expected a number for channel 'position.x'",
    )
    expect(() => map.applyPartial({ color: { 0: 1 } }, apply)).toThrow(
      "Expected an array at 'color'",
    )
  })
})

describe('ShapeMap: zip', () => {
  test('pairs leaves by position with optional values alongside', () => {
    const a = createMap({ position: { x: 1, y: 2 }, opacity: 3 })
    const b = createMap({ position: { x: 4, y: 5 }, opacity: 6 })
    const seen: [string, number, number, number | undefined][] = []

    a.zip(b, { position: { x: 10 } }, 'offset', (mine, theirs, value, path) =>
      seen.push([path, mine.value, theirs.value, value]),
    )

    expect(seen).toEqual([
      ['position.x', 1, 4, 10],
      ['position.y', 2, 5, undefined],
      ['opacity', 3, 6, undefined],
    ])
  })

  test('throws on shape mismatches in either direction', () => {
    const wide = createMap({ x: 0, y: 0 })
    const narrow = createMap({ x: 0 })
    const list = createMap({ x: [0, 0], y: 0 })
    const fn = vi.fn()

    expect(() => wide.zip(narrow, undefined, 'offset', fn)).toThrow('Shape mismatch at the root')
    expect(() => narrow.zip(wide, undefined, 'offset', fn)).toThrow('Shape mismatch at the root')
    expect(() => wide.zip(list, undefined, 'offset', fn)).toThrow("Shape mismatch at 'x'")
  })

  test('labels unknown value channels', () => {
    const a = createMap({ x: 0 })
    const b = createMap({ x: 0 })
    const fn = vi.fn()

    expect(() => a.zip(b, { z: 1 }, 'offset', fn)).toThrow("Unknown channel 'z' in offset")
  })
})

describe('ShapeMap: applyAnnotation', () => {
  const resolveNumbers = (input: unknown) =>
    typeof input === 'number' ? { value: input } : { branch: true as const }

  test('a value at a subtree covers every leaf below it', () => {
    const map = createMap({ position: { x: 0, y: 0 }, opacity: 0 })
    const seen: [string, number][] = []

    map.applyAnnotation(
      { position: 9 },
      resolveNumbers,
      (leaf, value) => seen.push([leaf.path, value]),
      'annotation',
    )

    expect(seen).toEqual([
      ['position.x', 9],
      ['position.y', 9],
    ])
  })

  test('branches descend and skip undefined entries', () => {
    const map = createMap({ position: { x: 0, y: 0 }, color: [0, 0] })
    const seen: [string, number][] = []

    map.applyAnnotation(
      { position: { y: 1 }, color: [undefined, 2] },
      resolveNumbers,
      (leaf, value) => seen.push([leaf.path, value]),
      'annotation',
    )

    expect(seen).toEqual([
      ['position.y', 1],
      ['color.1', 2],
    ])
  })

  test('reports unknown channels with the given label', () => {
    const map = createMap({ x: 0 })

    expect(() => map.applyAnnotation({ z: 1 }, resolveNumbers, vi.fn(), 'config')).toThrow(
      "Unknown channel 'z' in config",
    )
  })

  test('exposes position and key matching to the resolver', () => {
    const map = createMap({ position: { x: 0 }, color: [0] })
    const contexts: [string, string, boolean][] = []

    map.applyAnnotation(
      { position: { x: 1 }, color: [2] },
      (input, context, path) => {
        contexts.push([path, context.position, context.keysMatch])
        return typeof input === 'number' ? { value: input } : { branch: true as const }
      },
      vi.fn(),
      'annotation',
    )

    expect(contexts).toEqual([
      ['', 'record', true],
      ['position', 'record', true],
      ['position.x', 'leaf', false],
      ['color', 'list', false],
      ['color.0', 'leaf', false],
    ])
  })
})
