# Coily

Spring animation library with Vue integration.

## Commands

Use `pnpm` for all commands (this is a pnpm workspace). Root scripts are
read-only unless named `fix`/`:fix`/`format`: `check`, `lint`, and
`format:check` verify without touching files; `fix`, `lint:fix`, and
`format` write. Never wire a mutating command into a place that expects
verification.

- **Typecheck one package:** `pnpm --filter coily check` (the package's
  own `check` is `tsc`)
- **Verify everything (typecheck + lint + format, read-only):** `pnpm check`
- **Autofix lint + format:** `pnpm fix`
- **Run tests:** `pnpm --filter coily test`
- **Run benchmarks:** `pnpm --filter coily bench`
- **Build:** `pnpm build`
- **Dev (Nuxt playground):** `pnpm dev:nuxt`
- **Dev (Vanilla playground):** `pnpm dev:vanilla`

## Documentation

### Reader

Public doc comments address an application developer animating UI. They
are fluent in TypeScript and browser rendering. They have spring
intuition (stiffer snaps faster, more friction kills bounce) but no
physics background: gloss physical terms in mechanical language on first
contact (tension is stiffness, damping is friction), never assume the
spring ODE or calculus. When a doc needs the numerical model, link
PRECISION.md instead of re-deriving it.

Docs in `src/vue/` may additionally assume working Vue 3 knowledge —
refs, getters, `setup()`, provide/inject, effect scopes — and never gloss
those terms.

Internal (non-exported) code addresses a maintainer reading the module.
Inline comments exist only for what the code cannot say: a why, a
constraint from elsewhere, an invariant the code relies on.

### Conventions

- Cross-reference symbols with backticked names (`defineSpring`), never
  `{@link}`.
- PRECISION.md is the deep reference for precision and rest semantics.
  Link it as `https://github.com/tkofh/coily/blob/main/PRECISION.md`.
- `@default` on optional properties that have one; the value must match
  the code.
- No `@since` tags.
- Examples are ```ts fenced blocks and ship only after being executed (or
  typechecked, for type-level claims) against the current source.
- Write math the way code writes it: `10^-precision`, `sqrt(x)`, `<=`,
  `t in [0, 1]` — never `10⁻ᵖ`, `√`, `≤`, `∈`.
- On get/set accessor pairs the getter carries the doc block, and it
  states both what reads return and what assignment accepts when the two
  differ (`target`, `value`, `config`).
- Units are milliseconds unless a doc says otherwise; say "ms" at every
  time-valued parameter, property, and return.
- Exemplar docs to imitate: `Shape` and `ConfigShape` in
  `src/composite-spring.ts`, `ShapeView` in `src/shape-tree-node.ts`.
