import { invariant } from './util.ts'

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function isRecordOrArray(value: unknown): value is Record<string, unknown> | unknown[] {
  return isRecord(value) || Array.isArray(value)
}

function joinPath(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key)
}

export function describePath(path: string): string {
  return path ? `'${path}'` : 'the root'
}

/** A resolver's verdict at a node: cover the whole subtree with a value, or branch deeper. */
export type Coverage<V> = { branch: true } | { value: V }

/** A broadcast traversal's moving parts, bundled so recursion threads one value. */
export interface BroadcastOp<L, V> {
  resolve(input: unknown, path: string): Coverage<V>
  apply(leaf: L, value: V): void
  /** Names the input shape (`config`, …) in error messages. */
  label: string
}

/** A zip traversal's moving parts. */
export interface ZipOp<L> {
  fn(mine: L, theirs: L, value: number | undefined, path: string): void
  /** Names the values shape (`offset`, …) in error messages. */
  label: string
}

type Read<L> = (leaf: L) => number

/** One mirror position a view rewrites on refresh: `holder[key] = read(leaf)`. */
interface ViewSlot<L> {
  leaf: L
  key: string | number
  holder: Record<string | number, unknown>
}

/**
 * One node of a shape's tree: a `LeafNode` wraps a single channel's leaf
 * object, `ListNode` and `RecordNode` carry the nesting. Every traversal is
 * an ordinary method each kind implements for itself, so call sites dispatch
 * without inspecting nodes; errors keep their dot paths because each method
 * threads the path it was reached by.
 */
export abstract class ShapeNode<L> {
  /** Parses a numeric shape into a node tree, appending each created leaf to `leaves`. */
  static build<L>(
    shape: Record<string, unknown> | unknown[],
    path: string,
    factory: (value: number, path: string) => L,
    leaves: L[],
  ): ShapeNode<L> {
    if (Array.isArray(shape)) {
      invariant(shape.length > 0, emptyShape(path))
      return new ListNode(
        shape.map((child, i) => ShapeNode.#child(child, joinPath(path, i), factory, leaves)),
      )
    }
    const keys = Object.keys(shape)
    invariant(keys.length > 0, emptyShape(path))
    const children = new Map<string, ShapeNode<L>>()
    for (const key of keys) {
      children.set(key, ShapeNode.#child(shape[key], joinPath(path, key), factory, leaves))
    }
    return new RecordNode(children)
  }

  static #child<L>(
    value: unknown,
    path: string,
    factory: (value: number, path: string) => L,
    leaves: L[],
  ): ShapeNode<L> {
    if (typeof value === 'number') {
      const leaf = factory(value, path)
      leaves.push(leaf)
      return new LeafNode(leaf)
    }
    invariant(
      isRecordOrArray(value),
      `Invalid value at '${path}': expected a number or a nested shape of numbers`,
    )
    return ShapeNode.build(value, path, factory, leaves)
  }

  /** Writes this node's mirror into `holder[key]`, recording a slot per leaf for refresh. */
  abstract mirror(
    read: Read<L>,
    slots: ViewSlot<L>[],
    holder: Record<string | number, unknown>,
    key: string | number,
  ): void

  /** Scatters a partial numeric shape into the leaves the input mentions. */
  abstract scatter(input: unknown, path: string, apply: (leaf: L, value: number) => void): void

  /** Pairs this subtree's leaves with a structurally identical one's. */
  abstract zip(theirs: ShapeNode<L>, values: unknown, path: string, op: ZipOp<L>): void

  /** Broadcasts a covering shape: `op.resolve` decides value-for-subtree vs descend. */
  abstract broadcast<V>(input: unknown, path: string, op: BroadcastOp<L, V>): void

  /** Applies one value to every leaf at or below this node. */
  abstract cover<V>(value: V, apply: (leaf: L, value: V) => void): void
}

function emptyShape(path: string): string {
  return `Invalid value at ${describePath(path)}: a shape must contain at least one channel`
}

export class LeafNode<L> extends ShapeNode<L> {
  readonly leaf: L

  constructor(leaf: L) {
    super()
    this.leaf = leaf
  }

  mirror(
    read: Read<L>,
    slots: ViewSlot<L>[],
    holder: Record<string | number, unknown>,
    key: string | number,
  ): void {
    holder[key] = read(this.leaf)
    slots.push({ leaf: this.leaf, key, holder })
  }

  scatter(input: unknown, path: string, apply: (leaf: L, value: number) => void): void {
    invariant(typeof input === 'number', `Expected a number for channel '${path}'`)
    apply(this.leaf, input)
  }

  zip(theirs: ShapeNode<L>, values: unknown, path: string, op: ZipOp<L>): void {
    invariant(theirs instanceof LeafNode, `Shape mismatch at ${describePath(path)}`)
    let value: number | undefined
    if (values !== undefined) {
      invariant(typeof values === 'number', `Expected a number at '${path}' in ${op.label}`)
      value = values
    }
    op.fn(this.leaf, theirs.leaf, value, path)
  }

  broadcast<V>(input: unknown, path: string, op: BroadcastOp<L, V>): void {
    const resolved = op.resolve(input, path)
    invariant('value' in resolved, `Cannot descend into channel '${path}'`)
    op.apply(this.leaf, resolved.value)
  }

  cover<V>(value: V, apply: (leaf: L, value: V) => void): void {
    apply(this.leaf, value)
  }
}

export class ListNode<L> extends ShapeNode<L> {
  readonly children: readonly ShapeNode<L>[]

  constructor(children: readonly ShapeNode<L>[]) {
    super()
    this.children = children
  }

  mirror(
    read: Read<L>,
    slots: ViewSlot<L>[],
    holder: Record<string | number, unknown>,
    key: string | number,
  ): void {
    const mine: unknown[] = []
    holder[key] = mine
    // Arrays index soundly with numbers alone, which the slot's holder type
    // cannot express — every key written through this holder is a number.
    const slotHolder = mine as unknown as Record<string | number, unknown>
    for (let i = 0; i < this.children.length; i++) {
      this.children[i]!.mirror(read, slots, slotHolder, i)
    }
  }

  scatter(input: unknown, path: string, apply: (leaf: L, value: number) => void): void {
    invariant(Array.isArray(input), `Expected an array at ${describePath(path)}`)
    invariant(
      input.length <= this.children.length,
      `Unknown channel '${joinPath(path, this.children.length)}'`,
    )
    for (let i = 0; i < input.length; i++) {
      if (input[i] === undefined) continue
      this.children[i]!.scatter(input[i], joinPath(path, i), apply)
    }
  }

  zip(theirs: ShapeNode<L>, values: unknown, path: string, op: ZipOp<L>): void {
    invariant(
      theirs instanceof ListNode && theirs.children.length === this.children.length,
      `Shape mismatch at ${describePath(path)}`,
    )
    let list: readonly unknown[] | undefined
    if (values !== undefined) {
      invariant(Array.isArray(values), `Expected an array at ${describePath(path)} in ${op.label}`)
      invariant(
        values.length <= this.children.length,
        `Unknown channel '${joinPath(path, this.children.length)}' in ${op.label}`,
      )
      list = values
    }
    for (let i = 0; i < this.children.length; i++) {
      this.children[i]!.zip(theirs.children[i]!, list?.[i], joinPath(path, i), op)
    }
  }

  broadcast<V>(input: unknown, path: string, op: BroadcastOp<L, V>): void {
    const resolved = op.resolve(input, path)
    if ('value' in resolved) {
      this.cover(resolved.value, op.apply)
      return
    }
    invariant(Array.isArray(input), `Expected an array at ${describePath(path)} in ${op.label}`)
    invariant(
      input.length <= this.children.length,
      `Unknown channel '${joinPath(path, this.children.length)}' in ${op.label}`,
    )
    for (let i = 0; i < input.length; i++) {
      if (input[i] === undefined) continue
      this.children[i]!.broadcast(input[i], joinPath(path, i), op)
    }
  }

  cover<V>(value: V, apply: (leaf: L, value: V) => void): void {
    for (const child of this.children) child.cover(value, apply)
  }
}

export class RecordNode<L> extends ShapeNode<L> {
  readonly children: ReadonlyMap<string, ShapeNode<L>>

  constructor(children: ReadonlyMap<string, ShapeNode<L>>) {
    super()
    this.children = children
  }

  mirror(
    read: Read<L>,
    slots: ViewSlot<L>[],
    holder: Record<string | number, unknown>,
    key: string | number,
  ): void {
    const mine: Record<string, unknown> = {}
    holder[key] = mine
    for (const [childKey, child] of this.children) {
      child.mirror(read, slots, mine, childKey)
    }
  }

  scatter(input: unknown, path: string, apply: (leaf: L, value: number) => void): void {
    invariant(isRecord(input), `Expected an object at ${describePath(path)}`)
    for (const key of Object.keys(input)) {
      const value = input[key]
      if (value === undefined) continue
      const child = this.children.get(key)
      invariant(child !== undefined, `Unknown channel '${joinPath(path, key)}'`)
      child.scatter(value, joinPath(path, key), apply)
    }
  }

  zip(theirs: ShapeNode<L>, values: unknown, path: string, op: ZipOp<L>): void {
    invariant(
      theirs instanceof RecordNode && theirs.children.size === this.children.size,
      `Shape mismatch at ${describePath(path)}`,
    )
    let record: Record<string, unknown> | undefined
    if (values !== undefined) {
      invariant(isRecord(values), `Expected an object at ${describePath(path)} in ${op.label}`)
      for (const key of Object.keys(values)) {
        invariant(this.children.has(key), `Unknown channel '${joinPath(path, key)}' in ${op.label}`)
      }
      record = values
    }
    for (const [key, child] of this.children) {
      const their = theirs.children.get(key)
      invariant(their !== undefined, `Shape mismatch at ${describePath(path)}`)
      child.zip(their, record?.[key], joinPath(path, key), op)
    }
  }

  broadcast<V>(input: unknown, path: string, op: BroadcastOp<L, V>): void {
    const resolved = op.resolve(input, path)
    if ('value' in resolved) {
      this.cover(resolved.value, op.apply)
      return
    }
    invariant(isRecord(input), `Expected an object at ${describePath(path)} in ${op.label}`)
    for (const key of Object.keys(input)) {
      const value = input[key]
      if (value === undefined) continue
      const child = this.children.get(key)
      invariant(child !== undefined, `Unknown channel '${joinPath(path, key)}' in ${op.label}`)
      child.broadcast(value, joinPath(path, key), op)
    }
  }

  cover<V>(value: V, apply: (leaf: L, value: V) => void): void {
    for (const child of this.children.values()) child.cover(value, apply)
  }
}

/**
 * A live mirror of a shape with `read(leaf)` at every leaf. The mirror object
 * is stable — `refresh` rewrites the numbers in place through slots recorded
 * at construction, so per-frame reads do no traversal or allocation.
 */
export class ShapeView<L> {
  readonly root: object
  readonly #read: Read<L>
  readonly #slots: ViewSlot<L>[] = []

  constructor(root: ShapeNode<L>, read: Read<L>) {
    this.#read = read
    // The root is always a container (ShapeMap validates it), so mirroring
    // through a scratch holder always lands an object here.
    const scratch: Record<string, unknown> = {}
    root.mirror(read, this.#slots, scratch, 'root')
    this.root = scratch['root'] as object
  }

  /** Re-reads every leaf into the mirror. */
  refresh(): void {
    for (let i = 0; i < this.#slots.length; i++) {
      const slot = this.#slots[i]!
      slot.holder[slot.key] = this.#read(slot.leaf)
    }
  }
}
