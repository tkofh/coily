<template>
  <div :style="`transform: translateX(${current}px)`">hey</div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useSpring } from '../src'

const { target, jumpTo, current } = useSpring(ref(10), { friction: 80, tension: 20, mass: 1 })

target.value = 450

setTimeout(() => {
  jumpTo(500, false)
}, 2000)
</script>
