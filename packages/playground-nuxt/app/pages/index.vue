<script setup lang="ts">
const mouse = ref({ x: 0, y: 0 })

function onMouseMove(event: MouseEvent) {
  mouse.value = { x: event.clientX, y: event.clientY }
}

const bouncy = useSpring2D(mouse, { dampingRatio: 1, duration: 500 })
const stiff = useSpring2D(mouse, { dampingRatio: 1.5, duration: 500 })
</script>

<template>
  <div class="playground" @mousemove="onMouseMove">
    <NuxtLink to="/chain" class="nav-link">Chain Demo →</NuxtLink>
    <div class="ball bouncy" :style="{ '--x': bouncy.x, '--y': bouncy.y }" />
    <div class="ball stiff" :style="{ '--x': stiff.x, '--y': stiff.y }" />
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
  right: 20px;
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

.ball.bouncy {
  background-color: #e74c3c;
}

.ball.stiff {
  background-color: #3498db;
}
</style>
