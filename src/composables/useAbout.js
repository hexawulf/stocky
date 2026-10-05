// The About dialog is opened from the top bar and from Settings; one shared
// state, and focus goes back to whichever button opened it.
import { ref } from 'vue'

const isOpen = ref(false)
let returnFocusTo = null

export function useAbout() {
  function open(event) {
    returnFocusTo = event?.currentTarget ?? document.activeElement
    isOpen.value = true
  }
  function close() {
    isOpen.value = false
    const el = returnFocusTo
    returnFocusTo = null
    if (el && typeof el.focus === 'function') el.focus()
  }
  return { isOpen, open, close }
}
