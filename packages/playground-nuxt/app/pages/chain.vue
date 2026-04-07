<script setup lang="ts">
import type { SpringOptions } from 'coily'


const count = 512
const playgroundRef = ref<HTMLElement | null>(null)
const { width: winW, height: winH } = useElementSize(playgroundRef)

const mouse = ref({
  x: typeof window !== 'undefined' ? window.innerWidth / 2 : 960,
  y: typeof window !== 'undefined' ? window.innerHeight / 2 : 540,
})
const autoMode = ref(true)
let autoTimer: ReturnType<typeof setInterval> | undefined

function onMouseMove(event: MouseEvent) {
  if (!autoMode.value) {
    mouse.value = { x: event.clientX, y: event.clientY }
  }
}

let step = 0
let driftX = 0
let driftY = 0

function teleport() {
  const w = window.innerWidth
  const h = window.innerHeight

  // Slow sine drift gives a general direction, randomness breaks the pattern
  const stepSize = 0.15 + 1.85 * (0.5 + 0.5 * Math.sin(step * 0.31)) ** 2
  step += stepSize

  // Drift: sine backbone + random wobble, amplified during leap phases
  const intensity = 0.5 + stepSize * 0.5
  driftX += Math.sin(step * 0.7) * 0.12 + (Math.random() - 0.5) * 0.25 * intensity
  driftY += Math.cos(step * 0.5) * 0.12 + (Math.random() - 0.5) * 0.25 * intensity

  // Soft wrap: pull back harder as drift approaches edges
  driftX += -driftX * Math.min(0.1 + 4 * Math.max(0, Math.abs(driftX) - 0.35), 1)
  driftY += -driftY * Math.min(0.1 + 4 * Math.max(0, Math.abs(driftY) - 0.35), 1)

  mouse.value = { x: (0.5 + driftX) * w, y: (0.5 + driftY) * h }
}

function scheduleAuto() {
  const t = 0.5 + 0.5 * Math.sin(step * 0.31)
  const delay = 200 + t * 300
  autoTimer = setTimeout(() => {
    if (!autoMode.value) return
    teleport()
    scheduleAuto()
  }, delay)
}

function toggleAuto() {
  autoMode.value = !autoMode.value
  if (autoMode.value) {
    teleport()
    scheduleAuto()
  } else {
    clearTimeout(autoTimer)
  }
}

onMounted(() => {
  teleport()
  scheduleAuto()
})

onBeforeUnmount(() => clearTimeout(autoTimer))

const chainConfig = { bounce: -1, duration: 1000, precision: 3 } satisfies SpringOptions

// Build chain: first spring follows mouse, each subsequent spring follows the previous
const springs: SpringRef2D[] = []

for (let i = 0; i < count; i++) {
  springs.push(useSpring2D(i === 0 ? mouse : springs[i - 1]!, chainConfig))
}

const colors = Array.from({ length: count }, (_, i) => {
  const hue = (i / count) * 360
  return `hsl(${hue}, 70%, 60%)`
})
</script>

<template>
  <div ref="playgroundRef" class="playground" @mousemove="onMouseMove">
    <svg
      class="grid"
      xmlns="http://www.w3.org/2000/svg"
      :viewBox="`${-winW / 2} ${-winH / 2} ${winW} ${winH}`"
    >
      <defs>
        <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#555" stroke-width="0.5" />
        </pattern>
      </defs>
      <rect :x="-winW / 2" :y="-winH / 2" :width="winW" :height="winH" fill="url(#grid)" />
      <circle v-for="r in 6" :key="r" cx="0" cy="0" :r="r * 120" fill="none" stroke="#555" stroke-width="0.5" />
    </svg>
    <div
      v-for="i in count"
      :key="i"
      class="ball"
      :style="{
        '--x': springs[i - 1]!.value.x,
        '--y': springs[i - 1]!.value.y,
        '--color': colors[i - 1],
        '--size': 60 - i * 0.01,
        '--z': count - (i - 1),
      }"
    />
    <NuxtLink to="/" class="nav-link">&larr; Spring Demo</NuxtLink>
    <button class="auto-btn" :class="{ active: autoMode }" @click="toggleAuto">
      {{ autoMode ? 'Auto' : 'Auto' }}
    </button>
  </div>
</template>

<style scoped>
@property --x {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}

@property --y {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}

.playground {
  width: 100vw;
  height: 100vh;
  background-color: #242424;
  overflow: hidden;
}

.grid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.nav-link {
  position: fixed;
  top: 20px;
  left: 20px;
  color: #888;
  text-decoration: none;
  font-family: system-ui;
  font-size: 14px;
  z-index: 1000;
}

.nav-link:hover {
  color: #fff;
}

.auto-btn {
  position: fixed;
  top: 20px;
  left: 150px;
  background: transparent;
  border: 1px solid #555;
  color: #888;
  font-family: system-ui;
  font-size: 14px;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  z-index: 1000;
}

.auto-btn:hover {
  border-color: #fff;
  color: #fff;
}

.auto-btn.active {
  border-color: #e74c3c;
  color: #e74c3c;
}

.ball {
  position: absolute;
  width: calc(var(--size) * 1px);
  height: calc(var(--size) * 1px);
  border-radius: 50%;
  background-color: transparent;
  border: 0.25rem solid var(--color);
  translate: calc(var(--x) * 1px - 50%) calc(var(--y) * 1px - 50%);
  z-index: var(--z);
}
</style>
