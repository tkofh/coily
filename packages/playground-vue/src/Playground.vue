<script setup lang="ts">
import { useSpring } from '@coily/vue'
import { onMounted, ref } from 'vue'

const mouseX = ref(0)
const mouseY = ref(0)

onMounted(() => {
  window.addEventListener('mousemove', (e) => {
    mouseX.value = e.clientX
    mouseY.value = e.clientY
  })
})

// biome-disable lint/correctness/noUnusedVariables: vue
const { value: x, velocity: velocityX, resting: restingX } = useSpring(mouseX)
// biome-disable lint/correctness/noUnusedVariables: vue
const { value: y, velocity: velocityY, resting: restingY  } = useSpring(mouseY)


function click() {
  velocityX.value += (Math.random() - 0.5) * 2000
  velocityY.value += (Math.random() - 0.5) * 2000
}
</script>

<template>
  <div
    class="ball"
    :style="{ '--x': x, '--y': y, backgroundColor: 'blue' }"
    @click="click"
  ></div>
</template>

<style scoped>
.ball {
  --x: 0;
  --y: 0;
  position: absolute;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  transform: translate(calc(var(--x) * 1px - 50%), calc(var(--y) * 1px - 50%));
}
</style>
