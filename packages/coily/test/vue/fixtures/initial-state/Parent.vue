<template>
  <Child />
</template>

<script lang="ts" setup>
import Child from './Child.vue'
import { provideSpringSystem } from '../../../../src/vue/system.ts'
import { createSpringSystem } from '../../../../src/index.ts'

provideSpringSystem(createSpringSystem())
</script>
