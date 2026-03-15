<template>
  <Child />
</template>

<script lang="ts" setup>
import Child from './Child.vue'
import { provideSpringSystem } from '../../../../src/vue/system'
import { createSpringSystem } from '../../../../src/index'

provideSpringSystem(createSpringSystem())
</script>
