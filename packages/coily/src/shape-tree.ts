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

/** The standard scatter leaf guard: partial numeric shapes take only finite numbers at channels. */
export function acceptNumber(input: unknown, path: string): number {
  invariant(
    isNumber(input) && Number.isFinite(input),
    () => `Expected a finite number for channel '${path}'`,
  )
  return input
}

/**
 * What a shape's leaves are, for `ShapeTree`: `match` recognizes a leaf
 * value and constructs the leaf object — returning `undefined` declines,
 * and the node is parsed as a nested shape instead. `match` may
 * throw for a value it recognizes but rejects (a non-finite number). The
 * message builders name the leaf kind in structural errors, keeping the
 * tree machinery ignorant of what it holds.
 */
export interface LeafParser<L> {
  match(value: unknown, path: string): L | undefined
  /** The error for a node that is neither a leaf nor a plain object or array. */
  mismatch(path: string): string
  /** The error for an object or array with nothing in it. */
  empty(path: string): string
}

/**
 * The canonical numeric `LeafParser`: finite-number leaves built through
 * `factory`, named "channels" in structural errors. The default for value
 * shapes, whose leaves are all numbers.
 */
export function channelParser<L>(factory: (value: number, path: string) => L): LeafParser<L> {
  return {
    match(value, path) {
      if (!isNumber(value)) return undefined
      invariant(
        Number.isFinite(value),
        () => `Invalid value at '${path}': channel values must be finite`,
      )
      return factory(value, path)
    },
    mismatch: (path) =>
      `Invalid value at '${path}': expected a number or a nested shape of numbers`,
    empty: (path) =>
      `Invalid value at ${describePath(path)}: a shape must contain at least one channel`,
  }
}

type Read<L> = (leaf: L) => unknown

/** One mirror position a view rewrites on refresh: `carrier[key] = read(leaf)`. */
interface ViewSlot<L> {
  readonly leaf: L
  readonly key: string | number
  readonly carrier: Record<string | number, unknown>
}

/**
 * One node of a shape's tree: a `LeafNode` wraps a single leaf object,
 * `ListNode` and `RecordNode` carry the nesting. What a leaf is comes from
 * the `LeafParser` given to `ShapeTree` — a channel spring, a source
 * reader. Every traversal is an ordinary method each kind implements for
 * itself, so call sites dispatch without inspecting nodes; errors keep
 * their dot paths because each node stores the `path` it was built at.
 */
export interface ShapeTreeNode<L> {
  /** This node's dot path from the root (`position.x`), fixed at construction. */
  readonly path: string

  /** Writes this node's mirror into `carrier[key]`, recording a slot per leaf for refresh. */
  mirror(
    read: Read<L>,
    slots: ViewSlot<L>[],
    carrier: Record<string | number, unknown>,
    key: string | number,
  ): void

  /**
   * Scatters a partial shape into the leaves the input mentions; `accept`
   * validates (and narrows) the value named at each leaf.
   */
  scatter<V>(
    input: unknown,
    accept: (input: unknown, path: string) => V,
    apply: (leaf: L, value: V) => void,
  ): void

  /** Pairs this subtree's leaves with a structurally identical one's. */
  zip(theirs: ShapeTreeNode<L>, fn: (mine: L, theirs: L) => void): void

  /**
   * Broadcasts a covering shape: `resolve` decides value-for-subtree vs
   * descend, `apply` runs per covered leaf, and `label` names the input shape
   * (`config`, …) in error messages.
   */
  broadcast<V>(
    input: unknown,
    resolve: (input: unknown, path: string) => Coverage<V>,
    apply: (leaf: L, value: V) => void,
    label: string,
  ): void

  /** Applies one value to every leaf at or below this node. */
  cover<V>(value: V, apply: (leaf: L, value: V) => void): void
}

export class LeafNode<L> implements ShapeTreeNode<L> {
  readonly path: string
  readonly leaf: L

  constructor(leaf: L, path: string) {
    this.path = path
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

  scatter<V>(
    input: unknown,
    accept: (input: unknown, path: string) => V,
    apply: (leaf: L, value: V) => void,
  ): void {
    apply(this.leaf, accept(input, this.path))
  }

  zip(theirs: ShapeTreeNode<L>, fn: (mine: L, theirs: L) => void): void {
    invariant(theirs instanceof LeafNode, () => `Shape mismatch at ${describePath(this.path)}`)
    fn(this.leaf, theirs.leaf)
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

export class ListNode<L> implements ShapeTreeNode<L> {
  readonly path: string
  readonly children: readonly ShapeTreeNode<L>[]

  constructor(children: readonly ShapeTreeNode<L>[], path: string) {
    this.path = path
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

  scatter<V>(
    input: unknown,
    accept: (input: unknown, path: string) => V,
    apply: (leaf: L, value: V) => void,
  ): void {
    invariant(isArray(input), () => `Expected an array at ${describePath(this.path)}`)
    invariant(
      input.length <= this.children.length,
      `Unknown channel '${joinPath(this.path, this.children.length)}'`,
    )
    for (let i = 0; i < input.length; i++) {
      if (input[i] === undefined) continue
      this.children[i]!.scatter(input[i], accept, apply)
    }
  }

  zip(theirs: ShapeTreeNode<L>, fn: (mine: L, theirs: L) => void): void {
    invariant(
      theirs instanceof ListNode && theirs.children.length === this.children.length,
      () => `Shape mismatch at ${describePath(this.path)}`,
    )
    for (let i = 0; i < this.children.length; i++) {
      this.children[i]!.zip(theirs.children[i]!, fn)
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

export class RecordNode<L> implements ShapeTreeNode<L> {
  readonly path: string
  readonly children: ReadonlyMap<string, ShapeTreeNode<L>>

  constructor(children: ReadonlyMap<string, ShapeTreeNode<L>>, path: string) {
    this.path = path
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

  scatter<V>(
    input: unknown,
    accept: (input: unknown, path: string) => V,
    apply: (leaf: L, value: V) => void,
  ): void {
    invariant(isRecord(input), () => `Expected an object at ${describePath(this.path)}`)
    for (const key of Object.keys(input)) {
      const value = input[key]
      if (value === undefined) continue
      const child = this.children.get(key)
      invariant(child !== undefined, () => `Unknown channel '${joinPath(this.path, key)}'`)
      child.scatter(value, accept, apply)
    }
  }

  zip(theirs: ShapeTreeNode<L>, fn: (mine: L, theirs: L) => void): void {
    invariant(
      theirs instanceof RecordNode && theirs.children.size === this.children.size,
      () => `Shape mismatch at ${describePath(this.path)}`,
    )
    for (const [key, child] of this.children) {
      const their = theirs.children.get(key)
      invariant(their !== undefined, () => `Shape mismatch at ${describePath(this.path)}`)
      child.zip(their, fn)
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
 * A shape parsed into a node tree, paired with its leaves flattened in
 * depth-first shape order. `parser.match` decides leaf vs branch at every
 * position; the root must already be a container — callers validate that
 * (with their own message) before building. Nested non-containers and
 * empty nodes throw through `parser.mismatch`/`parser.empty`.
 *
 * Holds no behavior of its own: traversals run through `root`, and a live
 * view comes from `new ShapeView(root, read)`.
 */
export class ShapeTree<L> {
  readonly root: ShapeTreeNode<L>
  readonly leaves: readonly L[]

  constructor(shape: Record<string, unknown> | unknown[], parser: LeafParser<L>) {
    const leaves: L[] = []
    this.root = buildContainer(shape, '', parser, leaves)
    this.leaves = leaves
  }
}

function buildContainer<L>(
  shape: Record<string, unknown> | unknown[],
  path: string,
  parser: LeafParser<L>,
  leaves: L[],
): ShapeTreeNode<L> {
  if (isArray(shape)) {
    invariant(shape.length > 0, () => parser.empty(path))
    return new ListNode(
      shape.map((child, i) => buildChild(child, joinPath(path, i), parser, leaves)),
      path,
    )
  }
  const keys = Object.keys(shape)
  invariant(keys.length > 0, () => parser.empty(path))
  const children = new Map<string, ShapeTreeNode<L>>()
  for (const key of keys) {
    children.set(key, buildChild(shape[key], joinPath(path, key), parser, leaves))
  }
  return new RecordNode(children, path)
}

function buildChild<L>(
  value: unknown,
  path: string,
  parser: LeafParser<L>,
  leaves: L[],
): ShapeTreeNode<L> {
  const leaf = parser.match(value, path)
  if (leaf !== undefined) {
    leaves.push(leaf)
    return new LeafNode(leaf, path)
  }
  invariant(isRecordOrArray(value), () => parser.mismatch(path))
  return buildContainer(value, path, parser, leaves)
}

/**
 * A live view of a shape: `read(leaf)` at every leaf, mirrored into a stable
 * object — `refresh` rewrites the values in place through slots recorded at
 * construction, so per-frame reads do no traversal or allocation.
 */
export class ShapeView<L> {
  readonly root: object
  readonly #read: Read<L>
  readonly #slots: ViewSlot<L>[] = []

  constructor(root: ShapeTreeNode<L>, read: Read<L>) {
    this.#read = read
    // The root is always a container (callers validate it before build),
    // so mirroring through a scratch carrier always lands an object here.
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
