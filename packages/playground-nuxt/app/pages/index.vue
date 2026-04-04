<script setup lang="ts">
const mouseX = ref(0)
const mouseY = ref(0)

function onMouseMove(event: MouseEvent) {
  mouseX.value = event.clientX
  mouseY.value = event.clientY
}

const [bouncyX, bouncyY] = useSpring([mouseX, mouseY], { bounce: 0.5, duration: 2000 })
const [stiffX, stiffY] = useSpring([mouseX, mouseY], { tension: 600, bounce: -0.1 })
</script>

<template>
  <div class="playground" @mousemove="onMouseMove">
    <NuxtLink to="/chain" class="nav-link">Chain Demo →</NuxtLink>
    <div class="ball bouncy" :style="{ '--x': bouncyX, '--y': bouncyY }" />
    <div class="ball stiff" :style="{ '--x': stiffX, '--y': stiffY }" />
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
