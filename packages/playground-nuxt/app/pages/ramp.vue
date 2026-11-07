<script setup lang="ts">
const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')

// Spin · an endless ramp is a constant-speed rotation. The following
// spring lags, eases through rate changes, and at rate 0 overshoots a
// little and settles back.
const spinRate = ref(180)
const spin = useRamp(Infinity, spinRate, { from: 0 })
const flywheel = useSpring(spin, defineSpring({ bounce: 0.3, duration: 800 }))

// Heading · a ramp toward a target is a rate limiter. The pointer sets
// the heading, the ramp turns toward it at no more than `turnRate`, and
// a spring on top softens the starts and stops.
const turnRate = ref(240)
const heading = ref(0)
const turn = useRamp(heading, turnRate)
const needle = useSpring(turn, defineSpring({ bounce: 0, duration: 250 }))
// Templates unwrap only top-level refs, so the attached ones get names.
const turnRemaining = turn.timeRemaining
const dial = ref<HTMLElement>()
let lastAngle = 0

function onDialMove(event: PointerEvent) {
  const box = dial.value?.getBoundingClientRect()
  if (!box) return
  const x = event.clientX - (box.left + box.width / 2)
  const y = event.clientY - (box.top + box.height / 2)
  const angle = (Math.atan2(y, x) * 180) / Math.PI + 90
  // Unwrap across +-180 so the heading turns the short way round.
  const delta = ((angle - lastAngle + 540) % 360) - 180
  lastAngle = angle
  heading.value += delta
}

// Fill · a bounded ramp crosses at a fixed speed, so `timeRemaining` is
// exact and `settled` resolves on arrival. The marker springs after the
// fill and overshoots where the ramp stops dead.
const fillTarget = ref(0)
const fill = useRamp(fillTarget, 40)
const marker = useSpring(fill, defineSpring({ bounce: 0.5, duration: 500 }))
const fillRemaining = fill.timeRemaining
const fillStatus = ref('at rest')

async function fillTo(to: number) {
  fillTarget.value = to
  fillStatus.value = `heading to ${to}%`
  await fill.settled
  if (fillTarget.value === to) fillStatus.value = `settled at ${to}%`
}

function knockBack() {
  fill.value = Math.max(0, fill.value - 30)
}

// Stopwatch · a 'nonmotion' ramp at 1000 per second counts ms and keeps
// counting under reduced motion. The hand springs after a stepped
// `mapSpring` of it, so each second lands with a bounce, or snaps under
// reduced motion.
const running = ref(true)
const clock = useRamp(Infinity, () => (running.value ? 1000 : 0), {
  from: 0,
  purpose: 'nonmotion',
})
const tick = useSpring(
  mapSpring(clock, (ms) => Math.floor(ms / 1000) * 6),
  defineSpring({ bounce: 0.55, duration: 350 }),
)

function resetClock() {
  clock.value = 0
}
</script>

<template>
  <div class="page">
    <header>
      <NuxtLink to="/" class="nav-link">&larr; Spring Demo</NuxtLink>
      <h1>Ramps · <code>useRamp(target, rate)</code></h1>
      <p class="sub">
        A ramp moves toward its target at a fixed speed and stops there. Springs that follow one
        integrate against its motion exactly, so nothing steps frame to frame.
      </p>
      <p class="sub">
        Reduced motion is <strong>{{ reduced ? 'on' : 'off' }}</strong
        >. Turn it on in your OS settings to watch the motion ramps jump or hold while the stopwatch
        keeps counting.
      </p>
    </header>

    <section class="card">
      <h2>Spin · endless ramp, spring follower</h2>
      <div class="row">
        <figure>
          <div class="ring" :style="{ rotate: `${spin}deg` }"><span class="dot" /></div>
          <figcaption>ramp</figcaption>
        </figure>
        <figure>
          <div class="ring" :style="{ rotate: `${flywheel}deg` }">
            <span class="dot follow" />
          </div>
          <figcaption>spring following it</figcaption>
        </figure>
      </div>
      <label>
        rate <input v-model.number="spinRate" type="range" min="0" max="720" step="30" />
        <output>{{ spinRate }} deg/s</output>
      </label>
      <p class="hint">
        Drag the rate. The ramp changes speed at once. The follower speeds up or slows down to
        match, and at 0 it coasts past the ramp and settles back.
      </p>
    </section>

    <section class="card">
      <h2>Heading · rate-limited turn</h2>
      <div ref="dial" class="dial" @pointermove="onDialMove">
        <div class="needle ghost" :style="{ rotate: `${heading}deg` }" />
        <div class="needle" :style="{ rotate: `${needle}deg` }" />
        <span class="hub" />
      </div>
      <label>
        turn rate <input v-model.number="turnRate" type="range" min="30" max="720" step="30" />
        <output>{{ turnRate }} deg/s</output>
      </label>
      <p class="hint">
        Move the pointer around the dial. The faint needle is the target. The solid one turns toward
        it no faster than the turn rate. The ramp under it arrives in
        {{ Math.round(turnRemaining) }} ms.
      </p>
    </section>

    <section class="card">
      <h2>Fill · bounded ramp, <code>timeRemaining</code> and <code>settled</code></h2>
      <div class="bar">
        <div class="fill" :style="{ width: `${fill}%` }" />
        <span class="marker" :style="{ left: `${marker}%` }" />
      </div>
      <div class="buttons">
        <button @click="fillTo(100)">Fill</button>
        <button @click="fillTo(0)">Drain</button>
        <button class="quiet" @click="knockBack">Knock back 30%</button>
      </div>
      <p class="hint">
        40% per second. {{ fillStatus }}, {{ Math.round(fillRemaining) }} ms to go. Knocking it back
        writes <code>value</code>, and the ramp continues toward its target from there.
      </p>
    </section>

    <section class="card">
      <h2>Stopwatch · <code>'nonmotion'</code> clock and <code>mapSpring</code></h2>
      <div class="row">
        <div class="face">
          <div class="hand sweep" :style="{ rotate: `${(clock / 1000) * 6}deg` }" />
          <div class="hand tick" :style="{ rotate: `${tick}deg` }" />
          <span class="hub" />
        </div>
        <div class="readout">
          <output>{{ (clock / 1000).toFixed(1) }} s</output>
          <div class="buttons">
            <button @click="running = !running">{{ running ? 'Pause' : 'Run' }}</button>
            <button class="quiet" @click="resetClock">Reset</button>
          </div>
        </div>
      </div>
      <p class="hint">
        The thin hand reads the ramp directly. The thick one follows
        <code>mapSpring(clock, (ms) => Math.floor(ms / 1000) * 6)</code>. The system clock pauses
        while the tab is hidden, so this times visible time, not wall time.
      </p>
    </section>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #242424;
  color: #e6e6ea;
  font-family: system-ui, sans-serif;
  padding: 2rem;
  max-width: 720px;
  margin: 0 auto;
}

header {
  margin-bottom: 1.5rem;
}

h1 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0.5rem 0;
}

h2 {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 0.9rem;
}

code {
  font-family: ui-monospace, monospace;
  color: #c8a6ff;
}

.sub {
  color: #9a9aa6;
  font-size: 0.85rem;
  margin-top: 0.4rem;
}

.sub strong {
  color: #e6e6ea;
}

.nav-link {
  color: #888;
  text-decoration: none;
  font-size: 0.85rem;
}

.nav-link:hover {
  color: #fff;
}

.card {
  background: #2c2c30;
  border: 1px solid #3a3a40;
  border-radius: 12px;
  padding: 1.25rem;
  margin: 1rem 0;
}

.row {
  display: flex;
  gap: 2rem;
  align-items: center;
  flex-wrap: wrap;
}

figure {
  display: grid;
  justify-items: center;
  gap: 0.5rem;
}

figcaption,
.hint {
  color: #9a9aa6;
  font-size: 0.8rem;
}

.hint {
  margin: 0.75rem 0 0;
}

label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
  font-size: 0.82rem;
  color: #b8b8c4;
}

label input {
  flex: 1;
}

output {
  font-family: ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  min-width: 6rem;
}

.ring {
  position: relative;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  border: 2px solid #3a3a40;
}

.dot {
  position: absolute;
  top: -9px;
  left: calc(50% - 8px);
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6d5efc, #c86dfc);
}

.dot.follow {
  background: linear-gradient(135deg, #2ecc71, #56d9a0);
}

.dial,
.face {
  position: relative;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: #1b1b1e;
  touch-action: none;
}

.dial {
  margin: 0 auto;
  cursor: crosshair;
}

.face {
  width: 160px;
  height: 160px;
}

.needle,
.hand {
  position: absolute;
  bottom: 50%;
  left: calc(50% - 2px);
  width: 4px;
  height: 44%;
  border-radius: 2px;
  transform-origin: 50% 100%;
  background: #4ea1ff;
}

.needle.ghost {
  background: #4ea1ff40;
}

.hand.sweep {
  left: calc(50% - 1px);
  width: 2px;
  background: #fc6d8f;
}

.hand.tick {
  left: calc(50% - 3px);
  width: 6px;
  height: 38%;
  background: #e6e6ea;
}

.hub {
  position: absolute;
  top: calc(50% - 6px);
  left: calc(50% - 6px);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #e6e6ea;
}

.bar {
  position: relative;
  height: 28px;
  background: #1b1b1e;
  border-radius: 8px;
}

.fill {
  height: 100%;
  border-radius: 8px;
  background: linear-gradient(90deg, #6d5efc, #c86dfc);
}

.marker {
  position: absolute;
  top: -6px;
  width: 4px;
  height: 40px;
  margin-left: -2px;
  border-radius: 2px;
  background: #f0c060;
}

.readout {
  display: grid;
  gap: 0.5rem;
}

.readout output {
  font-size: 1.5rem;
}

.buttons {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

button {
  padding: 0.45rem 0.9rem;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  background: #6d5efc;
  color: #fff;
  font-size: 0.82rem;
}

button.quiet {
  background: #3a3a40;
}
</style>
