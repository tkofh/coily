<script setup lang="ts">
const mouse = ref({ x: 0, y: 0 })

function onMouseMove(event: MouseEvent) {
  mouse.value = { x: event.clientX, y: event.clientY }
}

// High mass keeps wn = sqrt(tension / mass) low: a slow first step, then
// real momentum. arrival -0.75 rebounds each axis off the cursor with
// three quarters of its speed instead of overshooting it, so the balls
// rattle into the pointer and come to rest on it.
const heavy = useSpring(
  mouse,
  defineSpring({ mass: 8, tension: 400, dampingRatio: 0.25, arrival: -0.75 }),
)
const heavier = useSpring(
  mouse,
  defineSpring({ mass: 16, tension: 400, dampingRatio: 0.2, arrival: -0.75 }),
)
</script>

<template>
  <div class="playground" @mousemove="onMouseMove">
    <NuxtLink to="/" class="nav-link">&larr; Spring Demo</NuxtLink>
    <div class="ball heavy" :style="{ '--x': heavy.x, '--y': heavy.y }" />
    <div class="ball heavier" :style="{ '--x': heavier.x, '--y': heavier.y }" />
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
  width: 100px;
  height: 100px;
  border-radius: 50%;
  translate: calc(var(--x) * 1px - 50%) calc(var(--y) * 1px - 50%);
}

.ball.heavy {
  background-color: #2ecc71;
}

.ball.heavier {
  background-color: #9b59b6;
}
</style>
