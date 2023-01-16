module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: ['commitlint-plugin-workspace-scopes'],
  rules: {
    'scope-enum': [2, 'always', ['release']],
  },
}
