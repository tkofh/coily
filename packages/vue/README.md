# `coily`

Spring Physics Utilities

## Installation & Setup

`coily` is available on npm and can be installed with your favorite package manager:

```shell
$ yarn add coily
# or
$ npm i coily
```

Then import the creator from the package in your code:

```typescript
import { createSpring } from 'coily'

const spring = createSpring(0, { mass: 1, tension: 100, friction: 25 })
```

## Usage

### Creating a Spring

The `createSpring` function takes the following arguments:

- `initial: number`
  The initial value of the spring, and its target. All springs start in a resting state, but you can set `spring.target`
  at any time

- `config: SpringConfig`
  The configuration for the spring. `SpringConfig` takes the following parameters:

  - `config.mass: number`
    How massive the spring is. A lower number will allow the spring to speed up and slow down more quickly than a
    larger number. Larger numbers are more likely to overshoot the `target`

  - `config.tension: number`
    How much force the spring experiences toward its `target`. A higher value will move the spring more quickly, and
    allow the spring to potentially overshoot.

  - `config.friction: number`
    How much dampening the spring experiences against its tension. A higher friction will make sure the spring doesn't
    move too quickly, and slows down dramatically as it approaches the `target`

- `options: SpringOptions`
  Additional options for the spring. `SpringOptions` takes the following parameters:

  - `options.restingDistance: number`
    The minimum difference between the `target` and `value` at which the spring will consider itself "at" the `target`

  - `options.restingVelocity: number`
    The minimum velocity at which the spring will consider itself "not moving"

  - `options.arrivalBehavior: 'bounce' | 'clamp' | 'none' | number | ((velocity: number) => number)`
    How the spring's `velocity` behaves when it arrives at its `target` value.
    `velocity` is expressed in unit/second. Defaults to `none`.
    - `'bounce'`: multiplies the velocity by -1, bouncing the value back in the direction from which it came
    - `'clamp'`: multiplies the velocity by 0, instantly stopping the spring at its value
    - `'none'`: multiplies the velocity by 1, allowing the spring to overshoot as necessary
    - `number`: multiplies the velocity by the given number
    - `(velocity: number) => number`: sets the velocity to the result of a function whose only argument is the
      previous velocity

#### Spring Config Tips

The configuration object above provides a good starting point when picking your config:

```typescript
createSpring(0, { mass: 1, tension: 100, friction: 25 })
```

Don't be afraid to make `mass` a decimal, and don't be afraid of large tensions and frictions either. Picking the
configuration is more of an art than a science.

#### Spring Options

The spring options object is helpful in reducing the amount of computation your springs perform. If the spring was
allowed to wait until its `velocity` and difference (`value` - `target`) were _at_ zero, it would imperceptibly update
every frame for a very long time.

The `restingDistance` and `restingVelocity` options help combat this, by telling the spring at what point it should
consider itself on target and resting. Once the velocity is less than `restingVelocity` and the difference
between `value` and `target` is less than `restingDistance`, the spring sets its `value` to its `target` and enters
the `resting` state.

### Working With Springs

#### Reading Information

The spring exposes some readonly information such as its `value`, `state` and `velocity`:

```typescript
/**
 * The current value of the spring
 */
spring.value

/**
 * In which state the spring is currently. Will be one of:
 * - "resting"
 * - "moving"
 * - "frozen"
 */
spring.state

/**
 * How fast the spring is currently moving, and in which direction
 */
spring.velocity
```

Additionally, `target` and `config` can be updated whenever:

```typescript
/**
 * Get & Set the target of the spring
 */
console.log(spring.target)
spring.target = 10

/**
 * Get & Set the config of the spring
 */
console.log(spring.config)
spring.config = { mass: 0.1, tension: 500, friction: 5 }
```

#### Updating

To simulate the spring and update its value, call the `simulate` method and pass in the number of milliseconds since the
last update:

```typescript
// Tickloop is a library that exposes a simple requestAnimationFrame based update loop
import { createTicker } from 'tickloop'
import { createSpring } from 'coily'

const spring = createSpring(0, { mass: 1, tension: 100, friction: 20 })

const ticker = createTicker()
ticker.add((_, delta) => {
  spring.simulate(delta)
})
```

#### Freezing

To hold a spring in place (while maintaining its velocity), use the `freeze()` (and `unfreeze()`) methods.
Calling `freeze()` will set the spring's `state` to `'frozen'`

```typescript
const spring = createSpring(0, { mass: 1, tension: 100, friction: 20 })

spring.target = 100

console.log(spring.value) // 0

spring.freeze()
spring.simulate(1000)

console.log(spring.value) // 0
```

### Creating a Spring System

Manually updating every spring with its `simulate` method would be tedious to say the least. Where possible, prefer
using a `SpringSystem` to group springs together and provide a single call site for updating each spring:

```typescript
import { createSpringSystem } from 'coily'

// First, create the system
const system = createSpringSystem()

// Then, create some springs
const spring1 = system.createSpring(0, { mass: 1, tension: 100, friction: 20 })
const spring2 = system.createSpring(0, { mass: 0.25, tension: 50, friction: 10 })

// Simulate all springs at once from the system
system.simulate(16)
```

Should a spring become irrelevant for some reason, remember to call the `cleanup` method so that the system stops
updating it:

```typescript
import { createSpringSystem } from 'coily'

const system = createSpringSystem()

const spring = system.createSpring(0, { mass: 1, tension: 100, friction: 20 })

// Later

system.cleanup(spring)
```

### Spring Chains

Sometimes the `target` of one spring should be the `value` of another.
This can be tedious to set up manually and involves juggling multiple updates per frame to get a good look at the
current state.

Spring Chains help with this problem by building on the `createSpring` API. You'll still supply an `initial` target,
a `SpringConfig`, and an optional `SpringOptions`. You'll also pass an array of chain "links" that describe additional
values in the chain.

The links take one of two forms:

- A fixed, additive offset from the previous value, e.g. `50` will make Spring 2 target Spring 1's current value plus 50.
- A function with the following signature:
  ```typescript
  const link = (
    previousSpringValue: number,
    previousSpringTarget: number,
    currentSpringValue?: number,
    currentSpringTarget?: number
  ): number => /* ... */
  ```
  The `currentSpringTarget` and `currentSpringValue` will be `undefined` the first time the function is called, as the
  targets are initialized for all springs.

#### Creating

```typescript
const chain = createSpringChain(
  0, // initial
  [50, 50, (value) => value * 1.25],
  { mass: 10, tension: 3000, friction: 300 } // config
)
```

#### Reading State

Spring Chains have almost the same interface as Springs do.

Instead of a single `value`, they have an array of numbers as their value. The same goes for `targets`, `states`,
and `velocities`. Each of these arrays are updated _in place_, which means it is safe to grab a reference to the value
and read from it later.

Additionally, Spring Chains have a singular `state` property which indicates if _any_ of its links are in a `'moving'` state or not.

There is also a singular `target` property which returns the first target in the chain. Setting this will update the springs as well.

```typescript
chain.values // readonly number[]
chain.velocities // readonly number[]
chain.targets // readonly number[]
chain.states // readonly number[]

chain.target = 10 // get and set the first target
chain.state // if any children are 'moving', this will be moving. if the chain is frozen, it will be 'frozen'. otherwise, it is 'resting'.
```
