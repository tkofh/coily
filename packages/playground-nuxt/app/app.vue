<script setup lang="ts">
const mouseX = ref(0)
const mouseY = ref(0)

function onMouseMove(event: MouseEvent) {
  mouseX.value = event.clientX
  mouseY.value = event.clientY
}

const bouncyOptions = defineSpring({ bounce: 0.4, duration: 1000 })
const stiffOptions = defineSpring({ tension: 600, bounce: 0 })

const [bouncyX, bouncyY] = useSpring([mouseX, mouseY], bouncyOptions)
const [stiffX, stiffY] = useSpring([mouseX, mouseY], stiffOptions)
</script>

<template>
  <div class="playground" @mousemove="onMouseMove">
    <div class="ball bouncy" :style="{ '--x': bouncyX, '--y': bouncyY }" />
    <div class="ball stiff" :style="{ '--x': stiffX, '--y': stiffY }" />
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

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.playground {
  width: 100vw;
  height: 100vh;
  background-color: #242424;
  overflow: hidden;
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
