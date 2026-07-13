import { describe, expect, test, vi } from 'vitest'
import {
  BRANCH,
  type Coverage,
  ShapeTree,
  ShapeView,
  acceptNumber,
  channelParser,
} from '../src/shape-tree.ts'

interface Leaf {
  path: string
  value: number
}

function createTree(shape: Record<string, unknown> | unknown[]) {
  return new ShapeTree<Leaf>(
    shape,
    channelParser((value, path) => ({ path, value })),
  )
}

describe('shape tree: construction', () => {
  test('collects leaves in depth-first shape order with dot paths', () => {
    const { leaves } = createTree({ position: { x: 1, y: 2 }, color: [3, 4], opacity: 5 })

    expect(leaves.map((leaf) => leaf.path)).toEqual([
      'position.x',
      'position.y',
      'color.0',
      'color.1',
      'opacity',
    ])
    expect(leaves.map((leaf) => leaf.value)).toEqual([1, 2, 3, 4, 5])
  })

  test('throws on non-numeric leaves and empty nodes', () => {
    expect(() => createTree({ x: 'no' })).toThrow("Invalid value at 'x'")
    expect(() => createTree({})).toThrow('at least one channel')
    expect(() => createTree({ nested: [] })).toThrow('at least one channel')
  })
})

describe('shape tree: views', () => {
  test('mirrors the shape and refreshes leaf values in place', () => {
    const { root, leaves } = createTree({ position: { x: 1, y: 2 }, color: [3, 4] })
    const view = new ShapeView(root, (leaf) => leaf.value * 10)

    expect(view.root).toEqual({ position: { x: 10, y: 20 }, color: [30, 40] })

    leaves[0]!.value = 7
    const before = view.root
    view.refresh()

    expect(view.root).toBe(before)
    expect(view.root).toEqual({ position: { x: 70, y: 20 }, color: [30, 40] })
  })
})

describe('shape tree: scatter', () => {
  test('applies only the mentioned channels, skipping undefined and holes', () => {
    const { root } = createTree({ position: { x: 0, y: 0 }, color: [0, 0, 0] })
    const seen: [string, number][] = []

    root.scatter(
      { position: { x: 5, y: undefined }, color: [undefined, 6] },
      acceptNumber,
      (leaf, value) => seen.push([leaf.path, value]),
    )

    expect(seen).toEqual([
      ['position.x', 5],
      ['color.1', 6],
    ])
  })

  test('throws on unknown channels and structure mismatches', () => {
    const { root } = createTree({ position: { x: 0 }, color: [0] })
    const apply = vi.fn()

    expect(() => root.scatter({ z: 1 }, acceptNumber, apply)).toThrow("Unknown channel 'z'")
    expect(() => root.scatter({ color: [1, 2] }, acceptNumber, apply)).toThrow(
      "Unknown channel 'color.1'",
    )
    expect(() => root.scatter({ position: 1 }, acceptNumber, apply)).toThrow(
      "Expected an object at 'position'",
    )
    expect(() => root.scatter({ position: { x: {} } }, acceptNumber, apply)).toThrow(
      "Expected a finite number for channel 'position.x'",
    )
    expect(() => root.scatter({ color: { 0: 1 } }, acceptNumber, apply)).toThrow(
      "Expected an array at 'color'",
    )
  })

  test('accept narrows leaf values for the caller', () => {
    const { root } = createTree({ x: 0, label: 0 })
    const seen: [string, string][] = []

    root.scatter(
      { x: 'wide', label: 'ok' },
      (input, path) => `${String(input)}@${path}`,
      (leaf, value) => seen.push([leaf.path, value]),
    )

    expect(seen).toEqual([
      ['x', 'wide@x'],
      ['label', 'ok@label'],
    ])
  })
})

describe('shape tree: zip', () => {
  test('pairs leaves by position', () => {
    const a = createTree({ position: { x: 1, y: 2 }, opacity: 3 })
    const b = createTree({ position: { x: 4, y: 5 }, opacity: 6 })
    const seen: [number, number][] = []

    a.root.zip(b.root, (mine, theirs) => seen.push([mine.value, theirs.value]))

    expect(seen).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ])
  })

  test('throws on shape mismatches in either direction', () => {
    const wide = createTree({ x: 0, y: 0 })
    const narrow = createTree({ x: 0 })
    const list = createTree({ x: [0, 0], y: 0 })
    const fn = vi.fn()

    expect(() => wide.root.zip(narrow.root, fn)).toThrow('Shape mismatch at the root')
    expect(() => narrow.root.zip(wide.root, fn)).toThrow('Shape mismatch at the root')
    expect(() => wide.root.zip(list.root, fn)).toThrow("Shape mismatch at 'x'")
  })
})

describe('shape tree: broadcast', () => {
  const resolveNumbers = (input: unknown): Coverage<number> =>
    typeof input === 'number' ? input : BRANCH

  test('a value at a subtree covers every leaf below it', () => {
    const { root } = createTree({ position: { x: 0, y: 0 }, opacity: 0 })
    const seen: [string, number][] = []

    root.broadcast(
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
    const { root } = createTree({ position: { x: 0, y: 0 }, color: [0, 0] })
    const seen: [string, number][] = []

    root.broadcast(
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
    const { root } = createTree({ x: 0 })

    expect(() => root.broadcast({ z: 1 }, resolveNumbers, vi.fn(), 'config')).toThrow(
      "Unknown channel 'z' in config",
    )
  })

  test('passes the traversal path to the resolver', () => {
    const { root } = createTree({ position: { x: 0 }, color: [0] })
    const paths: string[] = []

    root.broadcast(
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
