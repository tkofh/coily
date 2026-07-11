import { invariant, isRecord, isRecordOrArray, isArray, isNumber } from './util.ts'

function joinPath(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key)
}

export function describePath(path: string): string {
  return path ? `'${path}'` : 'the root'
}

/** The sentinel a resolver returns to descend into a node instead of covering it. */
export const BRANCH: unique symbol = Symbol('branch')

/** A resolver's verdict at a node: a value covering the whole subtree, or `BRANCH` to descend deeper. */
export type Coverage<V> = V | typeof BRANCH

type Read<L> = (leaf: L) => number

/** One mirror position a view rewrites on refresh: `carrier[key] = read(leaf)`. */
interface ViewSlot<L> {
  readonly leaf: L
  readonly key: string | number
  readonly carrier: Record<string | number, unknown>
}

/**
 * One node of a shape's tree: a `LeafNode` wraps a single channel's leaf
 * object, `ListNode` and `RecordNode` carry the nesting. Every traversal is
 * an ordinary method each kind implements for itself, so call sites dispatch
 * without inspecting nodes; errors keep their dot paths because each node
 * stores the `path` it was built at.
 */
export abstract class ChannelTreeNode<L> {
  /** This node's dot path from the root (`position.x`), fixed at construction. */
  readonly path: string

  protected constructor(path: string) {
    this.path = path
  }

  /** Parses a numeric shape into a node tree, appending each created leaf to `leaves`. */
  static build<L>(
    shape: Record<string, unknown> | unknown[],
    path: string,
    factory: (value: number, path: string) => L,
    leaves: L[],
  ): ChannelTreeNode<L> {
    if (isArray(shape)) {
      invariant(shape.length > 0, () => emptyShape(path))
      return new ListNode(
        shape.map((child, i) => ChannelTreeNode.#child(child, joinPath(path, i), factory, leaves)),
        path,
      )
    }
    const keys = Object.keys(shape)
    invariant(keys.length > 0, () => emptyShape(path))
    const children = new Map<string, ChannelTreeNode<L>>()
    for (const key of keys) {
      children.set(key, ChannelTreeNode.#child(shape[key], joinPath(path, key), factory, leaves))
    }
    return new RecordNode(children, path)
  }

  static #child<L>(
    value: unknown,
    path: string,
    factory: (value: number, path: string) => L,
    leaves: L[],
  ): ChannelTreeNode<L> {
    if (isNumber(value)) {
      const leaf = factory(value, path)
      leaves.push(leaf)
      return new LeafNode(leaf, path)
    }
    invariant(
      isRecordOrArray(value),
      `Invalid value at '${path}': expected a number or a nested shape of numbers`,
    )
    return ChannelTreeNode.build(value, path, factory, leaves)
  }

  /** Writes this node's mirror into `carrier[key]`, recording a slot per leaf for refresh. */
  abstract mirror(
    read: Read<L>,
    slots: ViewSlot<L>[],
    carrier: Record<string | number, unknown>,
    key: string | number,
  ): void

  /** Scatters a partial numeric shape into the leaves the input mentions. */
  abstract scatter(input: unknown, apply: (leaf: L, value: number) => void): void

  /**
   * Pairs this subtree's leaves with a structurally identical one's. `values`
   * is an optional partial numeric shape (named `label` in errors) delivered
   * alongside each pair; absent entries arrive as `undefined`.
   */
  abstract zip(
    theirs: ChannelTreeNode<L>,
    values: unknown,
    label: string,
    fn: (mine: L, theirs: L, value: number | undefined, path: string) => void,
  ): void

  /**
   * Broadcasts a covering shape: `resolve` decides value-for-subtree vs
   * descend, `apply` runs per covered leaf, and `label` names the input shape
   * (`config`, …) in error messages.
   */
  abstract broadcast<V>(
    input: unknown,
    resolve: (input: unknown, path: string) => Coverage<V>,
    apply: (leaf: L, value: V) => void,
    label: string,
  ): void

  /** Applies one value to every leaf at or below this node. */
  abstract cover<V>(value: V, apply: (leaf: L, value: V) => void): void
}

function emptyShape(path: string): string {
  return `Invalid value at ${describePath(path)}: a shape must contain at least one channel`
}

export class LeafNode<L> extends ChannelTreeNode<L> {
  readonly leaf: L

  constructor(leaf: L, path: string) {
    super(path)
    this.leaf = leaf
  }

  mirror(
    read: Read<L>,
    slots: ViewSlot<L>[],
    carrier: Record<string | number, unknown>,
    key: string | number,
  ): void {
    carrier[key] = read(this.leaf)
    slots.push({ leaf: this.leaf, key, carrier })
  }

  scatter(input: unknown, apply: (leaf: L, value: number) => void): void {
    invariant(isNumber(input), `Expected a number for channel '${this.path}'`)
    apply(this.leaf, input)
  }

  zip(
    theirs: ChannelTreeNode<L>,
    values: unknown,
    label: string,
    fn: (mine: L, theirs: L, value: number | undefined, path: string) => void,
  ): void {
    invariant(theirs instanceof LeafNode, () => `Shape mismatch at ${describePath(this.path)}`)
    let value: number | undefined
    if (values !== undefined) {
      invariant(isNumber(values), `Expected a number at '${this.path}' in ${label}`)
      value = values
    }
    fn(this.leaf, theirs.leaf, value, this.path)
  }

  broadcast<V>(
    input: unknown,
    resolve: (input: unknown, path: string) => Coverage<V>,
    apply: (leaf: L, value: V) => void,
    _label: string,
  ): void {
    const resolved = resolve(input, this.path)
    invariant(resolved !== BRANCH, `Cannot descend into channel '${this.path}'`)
    apply(this.leaf, resolved)
  }

  cover<V>(value: V, apply: (leaf: L, value: V) => void): void {
    apply(this.leaf, value)
  }
}

export class ListNode<L> extends ChannelTreeNode<L> {
  readonly children: readonly ChannelTreeNode<L>[]

  constructor(children: readonly ChannelTreeNode<L>[], path: string) {
    super(path)
    this.children = children
  }

  mirror(
    read: Read<L>,
    slots: ViewSlot<L>[],
    carrier: Record<string | number, unknown>,
    key: string | number,
  ): void {
    const mine: unknown[] = []
    carrier[key] = mine
    // Arrays index soundly with numbers alone, which the slot's carrier type
    // cannot express — every key written through this carrier is a number.
    const slotcarrier = mine as unknown as Record<string | number, unknown>
    for (let i = 0; i < this.children.length; i++) {
      this.children[i]!.mirror(read, slots, slotcarrier, i)
    }
  }

  scatter(input: unknown, apply: (leaf: L, value: number) => void): void {
    invariant(isArray(input), () => `Expected an array at ${describePath(this.path)}`)
    invariant(
      input.length <= this.children.length,
      `Unknown channel '${joinPath(this.path, this.children.length)}'`,
    )
    for (let i = 0; i < input.length; i++) {
      if (input[i] === undefined) continue
      this.children[i]!.scatter(input[i], apply)
    }
  }

  zip(
    theirs: ChannelTreeNode<L>,
    values: unknown,
    label: string,
    fn: (mine: L, theirs: L, value: number | undefined, path: string) => void,
  ): void {
    invariant(
      theirs instanceof ListNode && theirs.children.length === this.children.length,
      () => `Shape mismatch at ${describePath(this.path)}`,
    )
    let list: readonly unknown[] | undefined
    if (values !== undefined) {
      invariant(isArray(values), `Expected an array at ${describePath(this.path)} in ${label}`)
      invariant(
        values.length <= this.children.length,
        `Unknown channel '${joinPath(this.path, this.children.length)}' in ${label}`,
      )
      list = values
    }
    for (let i = 0; i < this.children.length; i++) {
      this.children[i]!.zip(theirs.children[i]!, list?.[i], label, fn)
    }
  }

  broadcast<V>(
    input: unknown,
    resolve: (input: unknown, path: string) => Coverage<V>,
    apply: (leaf: L, value: V) => void,
    label: string,
  ): void {
    const resolved = resolve(input, this.path)
    if (resolved !== BRANCH) {
      this.cover(resolved, apply)
      return
    }
    invariant(isArray(input), () => `Expected an array at ${describePath(this.path)} in ${label}`)
    invariant(
      input.length <= this.children.length,
      () => `Unknown channel '${joinPath(this.path, this.children.length)}' in ${label}`,
    )
    for (let i = 0; i < input.length; i++) {
      if (input[i] === undefined) continue
      this.children[i]!.broadcast(input[i], resolve, apply, label)
    }
  }

  cover<V>(value: V, apply: (leaf: L, value: V) => void): void {
    for (const child of this.children) child.cover(value, apply)
  }
}

export class RecordNode<L> extends ChannelTreeNode<L> {
  readonly children: ReadonlyMap<string, ChannelTreeNode<L>>

  constructor(children: ReadonlyMap<string, ChannelTreeNode<L>>, path: string) {
    super(path)
    this.children = children
  }

  mirror(
    read: Read<L>,
    slots: ViewSlot<L>[],
    carrier: Record<string | number, unknown>,
    key: string | number,
  ): void {
    const mine: Record<string, unknown> = {}
    carrier[key] = mine
    for (const [childKey, child] of this.children) {
      child.mirror(read, slots, mine, childKey)
    }
  }

  scatter(input: unknown, apply: (leaf: L, value: number) => void): void {
    invariant(isRecord(input), () => `Expected an object at ${describePath(this.path)}`)
    for (const key of Object.keys(input)) {
      const value = input[key]
      if (value === undefined) continue
      const child = this.children.get(key)
      invariant(child !== undefined, () => `Unknown channel '${joinPath(this.path, key)}'`)
      child.scatter(value, apply)
    }
  }

  zip(
    theirs: ChannelTreeNode<L>,
    values: unknown,
    label: string,
    fn: (mine: L, theirs: L, value: number | undefined, path: string) => void,
  ): void {
    invariant(
      theirs instanceof RecordNode && theirs.children.size === this.children.size,
      () => `Shape mismatch at ${describePath(this.path)}`,
    )
    let record: Record<string, unknown> | undefined
    if (values !== undefined) {
      invariant(
        isRecord(values),
        () => `Expected an object at ${describePath(this.path)} in ${label}`,
      )
      for (const key of Object.keys(values)) {
        invariant(
          this.children.has(key),
          () => `Unknown channel '${joinPath(this.path, key)}' in ${label}`,
        )
      }
      record = values
    }
    for (const [key, child] of this.children) {
      const their = theirs.children.get(key)
      invariant(their !== undefined, () => `Shape mismatch at ${describePath(this.path)}`)
      child.zip(their, record?.[key], label, fn)
    }
  }

  broadcast<V>(
    input: unknown,
    resolve: (input: unknown, path: string) => Coverage<V>,
    apply: (leaf: L, value: V) => void,
    label: string,
  ): void {
    const resolved = resolve(input, this.path)
    if (resolved !== BRANCH) {
      this.cover(resolved, apply)
      return
    }
    invariant(isRecord(input), () => `Expected an object at ${describePath(this.path)} in ${label}`)
    for (const key of Object.keys(input)) {
      const value = input[key]
      if (value === undefined) continue
      const child = this.children.get(key)
      invariant(
        child !== undefined,
        () => `Unknown channel '${joinPath(this.path, key)}' in ${label}`,
      )
      child.broadcast(value, resolve, apply, label)
    }
  }

  cover<V>(value: V, apply: (leaf: L, value: V) => void): void {
    for (const child of this.children.values()) child.cover(value, apply)
  }
}

/**
 * A live view of a shape: `read(leaf)` at every leaf, mirrored into a stable
 * object — `refresh` rewrites the numbers in place through slots recorded at
 * construction, so per-frame reads do no traversal or allocation.
 */
export class ChannelView<L> {
  readonly root: object
  readonly #read: Read<L>
  readonly #slots: ViewSlot<L>[] = []

  constructor(root: ChannelTreeNode<L>, read: Read<L>) {
    this.#read = read
    // The root is always a container (ChannelTree validates it), so mirroring
    // through a scratch carrier always lands an object here.
    const scratch: Record<string, unknown> = {}
    root.mirror(read, this.#slots, scratch, 'root')
    this.root = scratch['root'] as object
  }

  /** Re-reads every leaf into the view. */
  refresh(): void {
    for (const slot of this.#slots) {
      slot.carrier[slot.key] = this.#read(slot.leaf)
    }
  }
}
