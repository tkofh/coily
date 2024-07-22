<template>
  <SpringValue v-slot="{ value }" :target="toggle ? 100 : 0">
    <p>{{value}}</p>
  </SpringValue>
</template>

<script lang="ts" setup>

const toggle = ref(false)
onMounted(() => {
  setInterval(() => {
    toggle.value = !toggle.value
  }, 1000)
})

// const { value } = useSpring(() => toggle.value ? 0 : 100, { mass: 1, tension: 100, damping: 10 })

</script>
