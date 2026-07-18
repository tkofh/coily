<script setup lang="ts">
import { springStateAt, springToCss, springToTransition, springToWaapi } from 'coily/css'

// Settle · driven imperatively with the Web Animations API.
const settleConfig = defineSpring({ bounce: 0.5, duration: 700, displacement: 320 })
const settleWaapi = springToWaapi(settleConfig, {
  property: 'translate',
  from: 0,
  to: 320,
  unit: 'px',
})
const settleBox = ref<HTMLElement>()
function playSettle() {
  settleBox.value?.animate(settleWaapi.keyframes, settleWaapi.options)
}

// Hover · a CSS transition. Springs on hover — and if you mouse out
// mid-flight it stalls at the turn, because a transition can't carry
// velocity. That is the tradeoff versus a live spring, made visible.
const hoverConfig = defineSpring({ bounce: 0.4, duration: 650, displacement: 240 })
const hoverTransition = springToTransition(hoverConfig, {
  property: 'translate',
  from: 0,
  to: 240,
})

// Hover · WAAPI with momentum. On every mouse event we read the spring's
// live velocity — springStateAt at the running animation's currentTime —
// and regenerate from that state, so reversing mid-flight carries momentum
// instead of stalling like the plain transition above.
const momentumConfig = defineSpring({ bounce: 0.5, duration: 700, displacement: 240 })
const momentumBox = ref<HTMLElement>()
let momentumAnim: Animation | null = null
let momentumStart = { position: 0, velocity: 0 }
let momentumTarget = 0

function retarget(to: number) {
  const el = momentumBox.value
  if (!el) return

  let value = momentumTarget
  let velocity = 0
  if (momentumAnim && momentumAnim.playState === 'running') {
    const elapsed = typeof momentumAnim.currentTime === 'number' ? momentumAnim.currentTime : 0
    const live = springStateAt(momentumConfig, momentumStart, elapsed)
    value = momentumTarget + live.position
    velocity = live.velocity
  }
  if (Math.abs(value - to) < 1e-6) return

  momentumAnim?.cancel()
  const { keyframes, options } = springToWaapi(momentumConfig, {
    property: 'translate',
    from: value,
    to,
    unit: 'px',
    velocity,
  })
  momentumAnim = el.animate(keyframes, options)
  momentumStart = { position: value - to, velocity }
  momentumTarget = to
}

// Loop · a pure undamped spring never rests, so coily/css emits a seamless
// infinite alternating animation. Shown as CSS @keyframes and WAAPI at once.
const loopConfig = defineSpring({ tension: 150, damping: 0 })
const loopSpec = { property: 'translate', from: 0, to: 280, unit: 'px' } as const
const loopCss = springToCss(loopConfig, loopSpec, { name: 'coily-loop' })
const loopWaapi = springToWaapi(loopConfig, loopSpec)
const loopWaBox = ref<HTMLElement>()

// Multi-property · one spring drives translate + scale + opacity together.
const enterConfig = defineSpring({ bounce: 0.35, duration: 650, displacement: 280 })
const enterSpecs = [
  { property: 'translate', from: 280, to: 0, unit: 'px' },
  { property: 'scale', from: 0.6, to: 1 },
  { property: 'opacity', from: 0, to: 1 },
]
const enterWaapi = springToWaapi(enterConfig, enterSpecs)
const enterBox = ref<HTMLElement>()
function playEnter() {
  enterBox.value?.animate(enterWaapi.keyframes, enterWaapi.options)
}

// The loop's @keyframes rule has to live in the document for the CSS lane.
useHead({ style: [{ innerHTML: loopCss.keyframes }] })

onMounted(() => {
  loopWaBox.value?.animate(loopWaapi.keyframes, loopWaapi.options)
})

// Collapse a linear()'s interior stops so the snippets stay readable.
function short(css: string): string {
  return css.replace(/linear\(([^)]*)\)/g, (_full, body: string) => {
    const stops = body.split(',').map((stop) => stop.trim())
    return stops.length <= 4
      ? `linear(${stops.join(', ')})`
      : `linear(${stops[0]}, ${stops[1]}, …, ${stops.at(-1)})`
  })
}
</script>

<template>
  <div class="page">
    <header>
      <NuxtLink to="/" class="nav-link">&larr; Spring Demo</NuxtLink>
      <h1>coily → CSS <code>linear()</code> &amp; Web Animations API</h1>
      <p class="sub">
        Every card is generated from a <code>defineSpring</code> config by <code>coily/css</code> —
        no per-frame ticking, just a static easing.
      </p>
    </header>

    <section class="card">
      <h2>Settle · WAAPI</h2>
      <div class="track"><div ref="settleBox" class="box" /></div>
      <button @click="playSettle">▶ element.animate()</button>
      <pre>{{ short(settleWaapi.options.easing as string) }}</pre>
    </section>

    <section class="card">
      <h2>Hover · CSS transition <span class="badge stall">stalls</span></h2>
      <div class="track">
        <div class="box hover-box" :style="{ transition: hoverTransition }" />
      </div>
      <p class="hint">
        Hover, then mouse out mid-flight. A transition carries no velocity, so it stalls at the turn
        and restarts from rest.
      </p>
      <pre>transition: {{ short(hoverTransition) }}</pre>
    </section>

    <section class="card">
      <h2>Hover · WAAPI, regenerated per event <span class="badge carry">momentum</span></h2>
      <div class="track" @mouseenter="retarget(240)" @mouseleave="retarget(0)">
        <div ref="momentumBox" class="box momentum-box" />
      </div>
      <p class="hint">
        Same gesture — but each event reads the live velocity and regenerates the easing from that
        state, so reversing mid-flight carries momentum. Flick in and out rapidly.
      </p>
    </section>

    <section class="card">
      <h2>Loop · undamped, CSS <code>@keyframes</code> vs WAAPI</h2>
      <div class="track"><div class="box" :style="{ animation: loopCss.animation }" /></div>
      <div class="track"><div ref="loopWaBox" class="box waapi" /></div>
      <p class="hint">Top lane is CSS, bottom is WAAPI — same easing, both looping forever.</p>
      <pre>animation: {{ short(loopCss.animation) }}</pre>
    </section>

    <section class="card">
      <h2>Multi-property · one spring, three properties</h2>
      <div class="track"><div ref="enterBox" class="box enter-box" /></div>
      <button @click="playEnter">▶ translate + scale + opacity</button>
      <pre>{{ JSON.stringify(enterWaapi.keyframes) }}</pre>
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
  margin-top: 0.5rem;
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

.track {
  position: relative;
  height: 56px;
  background: #1b1b1e;
  border-radius: 8px;
  margin: 0.4rem 0;
  overflow: hidden;
}

.box {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 40px;
  height: 40px;
  border-radius: 9px;
  background: linear-gradient(135deg, #6d5efc, #c86dfc);
}

.box.waapi {
  background: linear-gradient(135deg, #2ecc71, #56d9a0);
}

.hover-box {
  background: linear-gradient(135deg, #f0c060, #f08050);
}

.track:hover .hover-box {
  translate: 240px 0;
}

.momentum-box {
  background: linear-gradient(135deg, #4ea1ff, #56d9d9);
}

.badge {
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.42rem;
  border-radius: 999px;
  vertical-align: middle;
}

.badge.stall {
  background: #46323a;
  color: #ff9db0;
}

.badge.carry {
  background: #223a46;
  color: #7fe3e3;
}

.enter-box {
  translate: 280px 0;
  scale: 0.6;
  opacity: 0;
  background: linear-gradient(135deg, #fca35e, #fc6d8f);
}

button {
  margin-top: 0.75rem;
  padding: 0.45rem 0.9rem;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  background: #6d5efc;
  color: #fff;
  font-size: 0.82rem;
}

.hint {
  color: #9a9aa6;
  font-size: 0.8rem;
  margin: 0.5rem 0 0;
}

pre {
  background: #1b1b1e;
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  margin: 0.75rem 0 0;
  overflow-x: auto;
  font-size: 0.72rem;
  color: #b8b8c4;
}
</style>
