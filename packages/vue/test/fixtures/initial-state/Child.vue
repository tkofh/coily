<template>
  <p>{{ value }}</p>
</template>

<script lang="ts" setup>
import { useSpring } from '../../../src/spring'

const { value } = useSpring(1)

console.log(value.value)
</script>
