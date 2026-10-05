// The undo confirm sheet shared by Part detail and History (spec §4.5, §4.8):
// shows the reversal summary, calls the undo route, and keeps the server's
// undo errors ("Can't undo — a newer movement was recorded", …) in the sheet.
import { computed, ref } from 'vue'
import { undoMovement } from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'
import { todayLocal } from '@/lib/dates.js'
import { reversalSummary } from '@/lib/movements.js'
import { showToast } from '@/stores/toast.js'

export function useUndoSheet(records, { onDone } = {}) {
  const pending = ref(null) // the movement being undone
  const busy = ref(false)
  const error = ref('')

  const text = computed(() => {
    const m = pending.value
    if (!m) return ''
    const name = records.parts[m.part]?.name ?? 'part'
    return reversalSummary(m, records, name, todayLocal())
  })

  function open(m) {
    pending.value = m
    error.value = ''
  }

  function close() {
    pending.value = null
    error.value = ''
  }

  async function confirm() {
    if (!pending.value || busy.value) return
    busy.value = true
    error.value = ''
    try {
      const res = await undoMovement(pending.value.id)
      close()
      showToast('Undone')
      onDone?.(res)
    } catch (e) {
      const d = describeError(e)
      if (d.kind !== 'aborted' && d.kind !== 'session') error.value = d.message
    } finally {
      busy.value = false
    }
  }

  return { pending, busy, error, text, open, close, confirm }
}
