<template>
  <slot />
</template>

<script lang="ts" setup>
import { useSpringSystem } from '../../src'

const system = useSpringSystem()

defineExpose({ system })
</script>
