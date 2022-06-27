# `coiled`

Spring Physics Utilities

## Installation & Setup

`coiled` is available on npm and can be installed with your favorite package manager:

```shell
$ yarn add coiled
# or
$ npm i coiled
```

Then import the creator from the package in your code:

```typescript
import { createSpring } from 'coiled'

const spring = createSpring(0, { mass: 1, tension: 100, friction: 25 })
```

## Usage

### Creating a Spring

Springs are created with the `createSpring` creator. It has this signature:

```typescript
function createSpring(initial: number, config: SpringConfig) {}
```
