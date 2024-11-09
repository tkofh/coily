<template>
  <SpringValue v-slot="{ value }" :target="toggle ? 100 : 0">
    <p>{{value}}</p>
  </SpringValue>
</template>

<script lang="ts" setup>
const target = ref(0)
const { value, resting } = useSpring(target, { mass: 1, tension: 100, damping: 10 })

target.value = 100

console.log({ target: target.value, value: value.value, resting: resting.value })

value.value = 100

console.log({ target: target.value, value: value.value, resting: resting.value })

value.value = 0

console.log({ target: target.value, value: value.value, resting: resting.value })

target.value = 0

console.log({ target: target.value, value: value.value, resting: resting.value })

const toggle = ref(false)
onMounted(() => {
  setInterval(() => {
    toggle.value = !toggle.value
  }, 1000)
})

// const { value } = useSpring(() => toggle.value ? 0 : 100, { mass: 1, tension: 100, damping: 10 })

</script>
