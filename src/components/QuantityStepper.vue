<script setup>
// Whole numbers only (spec §8); max follows what's available (spec §4.7).
import { computed } from 'vue'

const props = defineProps({
  min: { type: Number, default: 1 },
  max: { type: Number, default: 9999 },
  disabled: { type: Boolean, default: false },
  id: { type: String, default: undefined },
})
const model = defineModel({ type: Number, default: 1 })

const canDown = computed(() => !props.disabled && model.value > props.min)
const canUp = computed(() => !props.disabled && model.value < props.max)

function onInput(e) {
  const n = Number.parseInt(e.target.value, 10)
  model.value = Number.isNaN(n) ? 0 : n
}
</script>

<template>
  <div class="stepper">
    <button type="button" :disabled="!canDown" aria-label="Decrease" @click="model = model - 1">
      −
    </button>
    <input
      :id="id"
      type="number"
      inputmode="numeric"
      :min="min"
      :max="max"
      step="1"
      :value="model"
      :disabled="disabled"
      @input="onInput"
    />
    <button type="button" :disabled="!canUp" aria-label="Increase" @click="model = model + 1">
      +
    </button>
  </div>
</template>

<style scoped>
.stepper {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  overflow: hidden;
}

button {
  width: 48px;
  min-height: 44px;
  border: none;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 1.3rem;
  cursor: pointer;
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

input {
  width: 4.5rem;
  border: none;
  text-align: center;
  font: inherit;
  font-variant-numeric: tabular-nums;
  background: var(--color-background-soft);
  color: var(--color-text);
  -moz-appearance: textfield;
}

input::-webkit-inner-spin-button,
input::-webkit-outer-spin-button {
  -webkit-appearance: none;
}
</style>
