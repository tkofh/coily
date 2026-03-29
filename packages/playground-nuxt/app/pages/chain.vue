<script setup lang="ts">
import type { SpringOptions } from 'coily'

const count = 32

const mouseX = ref(0)
const mouseY = ref(0)

function onMouseMove(event: MouseEvent) {
  mouseX.value = event.clientX
  mouseY.value = event.clientY
}

const chainConfig = { bounce: -0.5, duration: 5000, precision: 5 } satisfies SpringOptions

// Build chains by passing each spring as the target for the next
const xSprings: SpringRef[] = []
const ySprings: SpringRef[] = []

for (let i = 0; i < count; i++) {
  xSprings.push(useSpring(i === 0 ? mouseX : xSprings[i - 1]!, chainConfig))
  ySprings.push(useSpring(i === 0 ? mouseY : ySprings[i - 1]!, chainConfig))
}

const colors = Array.from({ length: count }, (_, i) => {
  const hue = (i / count) * 360
  return `hsl(${hue}, 70%, 60%)`
})
</script>

<template>
  <div class="playground" @mousemove="onMouseMove">
    <NuxtLink to="/" class="nav-link">&larr; Spring Demo</NuxtLink>
    <div
      v-for="i in count"
      :key="i"
      class="ball"
      :style="{
        '--x': xSprings[i - 1]!.value,
        '--y': ySprings[i - 1]!.value,
        '--color': colors[i - 1],
        '--size': 60 - i * 1,
        '--z': i,
      }"
    />
  </div>
</template>

<style>
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

.nav-link {
  position: fixed;
  top: 20px;
  left: 20px;
  color: #888;
  text-decoration: none;
  font-family: system-ui;
  font-size: 14px;
  z-index: 10;
}

.nav-link:hover {
  color: #fff;
}

.ball {
  position: absolute;
  width: calc(var(--size) * 1px);
  height: calc(var(--size) * 1px);
  border-radius: 50%;
  background-color: var(--color);
  translate: calc(var(--x) * 1px - 50%) calc(var(--y) * 1px - 50%);
  z-index: var(--z);
}
</style>
