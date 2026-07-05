# Coily

Spring physics animation for JavaScript, with Vue and Nuxt integrations.

This is the development monorepo. The published package lives in [`packages/coily`](packages/coily) — see its [README](packages/coily/README.md) for usage.

## Packages

- [`coily`](packages/coily) — the library: framework-agnostic core plus `coily/vue` and `coily/nuxt` entry points
- `playground-vanilla` — minimal Vite demo of the core API
- `playground-nuxt` — Nuxt demo of the Vue composables, including a 512-spring chain

## Development

Uses [pnpm](https://pnpm.io) workspaces and [Turborepo](https://github.com/vercel/turborepo).

```sh
pnpm install
pnpm build            # build all packages
pnpm test             # run all tests
pnpm dev:vanilla      # vanilla playground
pnpm dev:nuxt         # nuxt playground
pnpm check            # lint + format check
```

Releases are managed with [changesets](https://github.com/changesets/changesets): `pnpm publish-packages`.

## License

[MIT](LICENSE)
