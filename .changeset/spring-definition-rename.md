---
'coily': minor
---

`SpringConfig` is renamed to `SpringDefinition`, and `SpringOptions` to
`SpringDefinitionOptions`, completing the `defineSpring` story: options
are the plain objects you write inline, and a definition is the
immutable artifact `defineSpring` builds from them. The rename is
types-only — `spring.config`, the `config` parameters, and `ConfigShape`
keep their names, since "config" is the role a definition plays on a
spring.
