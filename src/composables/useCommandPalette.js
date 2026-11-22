// Composable state for the ⌘K / Ctrl+K global Command Palette.
import { ref } from 'vue'

const isOpen = ref(false)
let opener = null

function open() {
  opener = typeof document !== 'undefined' ? document.activeElement : null
  isOpen.value = true
}

function close() {
  isOpen.value = false
  if (opener && typeof opener.focus === 'function' && opener.isConnected) {
    opener.focus()
  }
  opener = null
}

function toggle() {
  if (isOpen.value) close()
  else open()
}

export function useCommandPalette() {
  return { isOpen, open, close, toggle }
}
