<template>
  <div>hey</div>
</template>

<script setup lang="ts">
import { useSpring } from '../src'
import { ref } from 'vue'

const target = ref(10)
const spring = useSpring(target, { friction: 100, tension: 10, mass: 1 })

spring.onValueChange((value) => {
  console.log({ value })
})
spring.onStateChange((state) => {
  console.log(state)
})

target.value = 100
</script>
