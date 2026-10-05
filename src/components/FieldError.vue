<script setup>
defineProps({ message: { type: String, default: '' }, id: { type: String, default: undefined } })
</script>

<template>
  <p v-if="message" :id="id" class="field-error" role="alert">{{ message }}</p>
</template>

<style scoped>
.field-error {
  color: hsl(0, 65%, 48%);
  font-size: 0.9rem;
  margin-top: 0.25rem;
}
</style>
