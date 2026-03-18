<template>
  <p>{{ spring }}</p>
</template>

<script lang="ts" setup>
import { useSpring } from '../../../../src/vue/spring.ts'

const spring = useSpring(1)

console.log(spring.value)
</script>
