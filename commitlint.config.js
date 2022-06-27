// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getPackages } = require('@commitlint/config-lerna-scopes').utils

module.exports = {
  extends: ['@commitlint/config-lerna-scopes', '@commitlint/config-conventional'],
  rules: {
    'scope-enum': (ctx) =>
      getPackages(ctx).then((packages) => [2, 'always', [...packages, 'release']]),
  },
}
