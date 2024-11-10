<template>
  <Child />
</template>

<script lang="ts" setup>
import Child from './Child.vue'
import { provideSpringSystem } from '../../../src/system'
import { createSpringSystem } from 'coily'

provideSpringSystem(createSpringSystem())
</script>
