import { describe, expect, test, vi } from 'vitest'
import { BRANCH, ChannelTree, type Coverage } from '../src/channel-tree.ts'

interface Leaf {
  path: string
  value: number
}

function createMap(shape: object) {
  return new ChannelTree<Leaf>(shape, (value, path) => ({ path, value }))
}

describe('ChannelTree: construction', () => {
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

describe('ChannelTree: views', () => {
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

describe('ChannelTree: scatter', () => {
  test('applies only the mentioned channels, skipping undefined and holes', () => {
    const map = createMap({ position: { x: 0, y: 0 }, color: [0, 0, 0] })
    const seen: [string, number][] = []

    map.scatter({ position: { x: 5, y: undefined }, color: [undefined, 6] }, (leaf, value) =>
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

    expect(() => map.scatter({ z: 1 }, apply)).toThrow("Unknown channel 'z'")
    expect(() => map.scatter({ color: [1, 2] }, apply)).toThrow("Unknown channel 'color.1'")
    expect(() => map.scatter({ position: 1 }, apply)).toThrow("Expected an object at 'position'")
    expect(() => map.scatter({ position: { x: {} } }, apply)).toThrow(
      "Expected a number for channel 'position.x'",
    )
    expect(() => map.scatter({ color: { 0: 1 } }, apply)).toThrow("Expected an array at 'color'")
  })
})

describe('ChannelTree: zip', () => {
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

describe('ChannelTree: broadcast', () => {
  const resolveNumbers = (input: unknown): Coverage<number> =>
    typeof input === 'number' ? input : BRANCH

  test('a value at a subtree covers every leaf below it', () => {
    const map = createMap({ position: { x: 0, y: 0 }, opacity: 0 })
    const seen: [string, number][] = []

    map.broadcast(
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

    map.broadcast(
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

    expect(() => map.broadcast({ z: 1 }, resolveNumbers, vi.fn(), 'config')).toThrow(
      "Unknown channel 'z' in config",
    )
  })

  test('passes the traversal path to the resolver', () => {
    const map = createMap({ position: { x: 0 }, color: [0] })
    const paths: string[] = []

    map.broadcast(
      { position: { x: 1 }, color: [2] },
      (input, path): Coverage<number> => {
        paths.push(path)
        return typeof input === 'number' ? input : BRANCH
      },
      vi.fn(),
      'annotation',
    )

    expect(paths).toEqual(['', 'position', 'position.x', 'color', 'color.0'])
  })
})
