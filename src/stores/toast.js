// Short-lived messages with optional actions, e.g. "Recorded · Undo · View
// part" (spec §4.7). ToastHost.vue (in App.vue) renders them.
import { ref } from 'vue'

const toasts = ref([])
let nextId = 1

// actions: [{ label, to?: route location, run?: async () => void }]
export function showToast(message, { actions = [], timeout = 6000, kind = 'info' } = {}) {
  const id = nextId++
  toasts.value.push({ id, message, actions, kind })
  if (timeout) setTimeout(() => dismissToast(id), timeout)
  return id
}

export function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

export function useToast() {
  return { toasts, showToast, dismissToast }
}
