<template>
  <slot />
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { SPRING_SYSTEM } from '../../src/injections'

const system = inject(SPRING_SYSTEM)

defineExpose({ system })
</script>
