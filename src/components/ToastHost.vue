<script setup>
import { useRouter } from 'vue-router'
import { useToast } from '@/stores/toast.js'

const router = useRouter()
const { toasts, dismissToast } = useToast()

async function act(toast, action) {
  dismissToast(toast.id)
  if (action.to) router.push(action.to)
  if (action.run) await action.run()
}
</script>

<template>
  <div class="toasts" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind" role="status">
      <span class="message">{{ t.message }}</span>
      <button v-for="a in t.actions" :key="a.label" type="button" class="action" @click="act(t, a)">
        {{ a.label }}
      </button>
      <button type="button" class="close" aria-label="Dismiss" @click="dismissToast(t.id)">
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  inset: auto 0 calc(64px + env(safe-area-inset-bottom)) 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0 1rem;
  z-index: 30;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 32rem;
  width: 100%;
  min-height: 48px;
  padding: 0.25rem 0.25rem 0.25rem 1rem;
  border-radius: 12px;
  background: var(--color-heading);
  color: var(--color-background);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  pointer-events: auto;
}

.toast.error {
  background: hsl(0, 65%, 42%);
  color: #fff;
}

.message {
  flex: 1;
}

.action,
.close {
  min-height: 44px;
  min-width: 44px;
  padding: 0 0.75rem;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

@media (min-width: 768px) {
  .toasts {
    bottom: 1.5rem;
  }
}
</style>
