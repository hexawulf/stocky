<script setup>
// Unit price input (spec §4.7, decision #21): amount in major units plus a
// currency, with a live reading of what will be saved so a slip like
// "20000" for €200.00 shows up before saving.
import { computed } from 'vue'
import { CURRENCIES, priceHint, pricePreview } from '@/lib/format.js'
import FieldError from '@/components/FieldError.vue'

const props = defineProps({
  id: { type: String, required: true },
  quantity: { type: Number, default: 1 },
  error: { type: String, default: '' },
})
const text = defineModel('text', { type: String, default: '' })
const currency = defineModel('currency', { type: String, default: '' })
const emit = defineEmits(['currency-picked'])

const hint = computed(() => priceHint(currency.value))
const preview = computed(() => pricePreview(text.value, currency.value, props.quantity))
const ok = computed(() => preview.value.startsWith('='))
</script>

<template>
  <div class="field price-field">
    <label :for="id">Unit price (optional)</label>
    <div class="price">
      <input
        :id="id"
        v-model="text"
        inputmode="decimal"
        autocomplete="off"
        placeholder="0"
        :aria-describedby="`${id}-hint ${id}-preview`"
      />
      <select v-model="currency" aria-label="Currency" @change="emit('currency-picked')">
        <option value="">Currency</option>
        <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
      </select>
    </div>
    <p :id="`${id}-hint`" class="hint">{{ hint }}</p>
    <p
      v-if="preview"
      :id="`${id}-preview`"
      class="preview"
      :class="{ ok }"
      data-test="price-preview"
      aria-live="polite"
    >
      {{ preview }}
    </p>
    <FieldError :message="error" />
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
}

/* same look as the form controls in the screens that use it */
label {
  font-weight: 600;
  color: var(--color-heading);
}

input,
select {
  min-height: 44px;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
}

.price {
  display: flex;
  gap: 0.5rem;
}

.price input {
  flex: 1;
  min-width: 0;
}

.hint,
.preview {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.preview.ok {
  color: var(--color-heading);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
