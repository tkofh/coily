---
'coily': patch
---

Remove the `engines` field from the published package. It declared
`node >= 24.10`, which caused installs to fail or warn on Node LTS versions
for a library that runs anywhere. The constraint was a development-environment
requirement and now lives in the monorepo root instead.
