<script setup>
// About Stocky (spec §4): what it is, how it's built, who made it, links,
// version, and a diagnostics line to paste into a bug report. A modal
// dialog: focus moves in and stays inside, Esc or Close closes it, and focus
// returns to the button that opened it (useAbout).
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { pb } from '@/lib/pb.js'
import { getAbout } from '@/lib/api.js'
import { useAuth } from '@/stores/auth.js'
import { useInventory } from '@/stores/inventory.js'
import {
  APP_VERSION,
  CONTACT,
  LINKS,
  RELEASE_DATE,
  STACK,
  TAGLINE,
  diagnosticsLine,
} from '@/lib/about.js'

const emit = defineEmits(['close'])
const { user } = useAuth()
const { online } = useInventory()

const server = ref({ pocketbase: '', schema: '' })
const realtime = ref(false)
onMounted(async () => {
  realtime.value = !!pb.realtime?.isConnected
  try {
    server.value = await getAbout()
  } catch {
    // shown as "unknown": the dialog itself still works offline
  }
})

const diagnostics = computed(() =>
  diagnosticsLine({
    version: APP_VERSION,
    pocketbase: server.value.pocketbase,
    schema: server.value.schema,
    preset: user.value?.seedPreset,
    realtime: realtime.value,
    online: online.value,
  }),
)

const copied = ref('')
async function copy() {
  try {
    await navigator.clipboard.writeText(diagnostics.value)
    copied.value = 'Copied'
  } catch {
    copied.value = 'Select the line and copy it'
  }
}

// --- focus: in on open, trapped while open, Esc closes ----------------------------
const dialog = ref(null)
const closeButton = ref(null)
const focusables = () =>
  [
    ...dialog.value.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => !el.hasAttribute('inert'))
function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key !== 'Tab') return
  const list = focusables()
  if (!list.length) return
  const first = list[0]
  const last = list[list.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  } else if (!dialog.value.contains(document.activeElement)) {
    e.preventDefault()
    first.focus()
  }
}
onMounted(async () => {
  document.addEventListener('keydown', onKey)
  await nextTick()
  closeButton.value?.focus()
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <section
      ref="dialog"
      class="about"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
      aria-describedby="about-tagline"
    >
      <header class="head">
        <div>
          <h2 id="about-title">About Stocky</h2>
          <p id="about-tagline" class="tagline">{{ TAGLINE }}</p>
        </div>
        <button
          ref="closeButton"
          type="button"
          class="close"
          aria-label="Close"
          data-test="about-close"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <p class="version" data-test="about-version">
        Version {{ APP_VERSION }} · {{ RELEASE_DATE }}
      </p>

      <h3>Tech stack</h3>
      <dl class="stack">
        <template v-for="[label, value] in STACK" :key="label">
          <dt>{{ label }}</dt>
          <dd>{{ value }}</dd>
        </template>
      </dl>

      <h3>Contact</h3>
      <p>
        {{ CONTACT.author }} ·
        <a :href="`mailto:${CONTACT.email}`" data-test="about-mail">{{ CONTACT.email }}</a>
      </p>

      <h3>Links</h3>
      <ul class="links">
        <li v-for="l in LINKS" :key="l.href">
          <a :href="l.href" target="_blank" rel="noopener noreferrer">{{ l.label }}</a>
        </li>
      </ul>

      <h3>Diagnostics</h3>
      <div class="diag">
        <code data-test="about-diagnostics">{{ diagnostics }}</code>
        <button type="button" class="btn btn-secondary" data-test="about-copy" @click="copy">
          Copy
        </button>
      </div>
      <p class="copied" role="status" aria-live="polite">{{ copied }}</p>
    </section>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.about {
  width: 100%;
  max-width: 34rem;
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
  padding: 1.25rem 1rem calc(1rem + env(safe-area-inset-bottom));
  border-radius: 16px 16px 0 0;
  background: var(--color-background);
  color: var(--color-text);
  box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.2);
}

@media (min-width: 768px) {
  .backdrop {
    align-items: center;
  }

  .about {
    border-radius: 16px;
    padding: 1.5rem;
  }
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

h2 {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--color-heading);
}

.tagline {
  color: var(--color-text-muted);
}

.close {
  flex: none;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font: inherit;
  cursor: pointer;
}

.version {
  margin-top: 0.5rem;
  color: var(--color-heading);
  font-weight: 600;
}

h3 {
  margin: 1rem 0 0.35rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.stack {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 0.75rem;
  margin: 0;
  font-size: 0.92rem;
}

.stack dt {
  font-weight: 600;
  color: var(--color-heading);
}

.stack dd {
  margin: 0;
}

.links {
  list-style: none;
  padding: 0;
  margin: 0;
}

.links a,
a[href^='mailto'] {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}

.diag {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.diag code {
  flex: 1 1 16rem;
  min-width: 0;
  padding: 0.5rem 0.6rem;
  border-radius: 8px;
  background: var(--color-background-mute);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  overflow-wrap: anywhere;
  user-select: all;
}

.copied {
  min-height: 1.2rem;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

@media (max-width: 380px) {
  .stack {
    grid-template-columns: 1fr;
  }

  .stack dd {
    margin-bottom: 0.35rem;
  }
}
</style>
