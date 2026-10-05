<script setup>
// Bottom sheet asking to confirm an action (spec §4.8 undo). Escape or the
// backdrop cancels.
import { onBeforeUnmount, onMounted } from 'vue'

defineProps({
  title: { type: String, required: true },
  confirmLabel: { type: String, default: 'Confirm' },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['confirm', 'cancel'])

const onKey = (e) => e.key === 'Escape' && emit('cancel')
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <section class="sheet" role="dialog" aria-modal="true" :aria-label="title">
      <h2>{{ title }}</h2>
      <div class="body"><slot /></div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" class="btn btn-secondary" @click="emit('cancel')">Cancel</button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="emit('confirm')">
          {{ busy ? 'Working…' : confirmLabel }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  z-index: 40;
}

.sheet {
  width: 100%;
  max-width: 32rem;
  padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
  border-radius: 16px 16px 0 0;
  background: var(--color-background);
}

h2 {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.error {
  margin-top: 0.75rem;
  color: hsl(0, 65%, 48%);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

.btn {
  min-height: 44px;
  border: none;
  font: inherit;
  cursor: pointer;
}

.btn-secondary {
  background: none;
}

@media (min-width: 768px) {
  .backdrop {
    align-items: center;
  }

  .sheet {
    border-radius: 16px;
  }
}
</style>
