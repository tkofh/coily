<template>
  <slot />
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { SPRING_SYSTEM } from '../../src/injection'

const system = inject(SPRING_SYSTEM)

defineExpose({ system })
</script>
