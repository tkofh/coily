<template>
  <slot />
</template>

<script setup lang="ts">
import { useSpring } from '../../src'

const spring = useSpring(0, { mass: 1, tension: 100, friction: 20 })

defineExpose({ spring })
</script>
