# Coily

Spring physics animation for JavaScript, with Vue and Nuxt integrations.

This is the development monorepo. The published package is in [`packages/coily`](packages/coily). Its [README](packages/coily/README.md) explains how to use it.

## Packages

- [`coily`](packages/coily): the library. It has a framework-agnostic core and the `coily/vue`, `coily/nuxt`, and `coily/css` entry points.
- `playground-vanilla`: a minimal Vite demo of the core API.
- `playground-nuxt`: a Nuxt demo of the Vue composables, including a chain of 512 springs.

## Development

The repo uses [pnpm](https://pnpm.io) workspaces and [Turborepo](https://github.com/vercel/turborepo).

```sh
pnpm install
pnpm build            # build all packages
pnpm test             # run all tests
pnpm dev:vanilla      # vanilla playground
pnpm dev:nuxt         # nuxt playground
pnpm check            # typecheck, lint, and format check (read-only)
pnpm fix              # autofix lint and format
```

[Changesets](https://github.com/changesets/changesets) manages releases, and GitHub Actions publishes them. [RELEASING.md](RELEASING.md) describes the flow.

## License

[MIT](LICENSE)
