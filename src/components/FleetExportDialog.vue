<script setup>
// Fleet Export Modal (Phase 4):
// Formats: SVG Diagram, High-DPI 2x PNG (Canvas), Markdown Spec Matrix, JSON Inventory.
// Privacy Redaction Controls ON by default (strip serials, MACs/machineIdHash, costs, optional host anonymization).
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  DEFAULT_REDACT_OPTIONS,
  generateFleetMarkdown,
  generateFleetSvg,
  prepareExportData,
} from '@/lib/fleet.js'

const props = defineProps({
  hosts: { type: Array, required: true },
  locationsById: { type: Object, required: true },
  fleetName: { type: String, default: 'My Homelab Fleet' },
})

const emit = defineEmits(['close'])

const format = ref('svg') // 'svg' | 'png' | 'markdown' | 'json'
const svgTheme = ref('dark')
const redact = reactive({ ...DEFAULT_REDACT_OPTIONS })
const statusMsg = ref('')

const slug = computed(
  () =>
    String(props.fleetName || 'fleet')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'fleet',
)

const svgOutput = computed(() =>
  generateFleetSvg(props.hosts, props.locationsById, redact, {
    fleetName: props.fleetName,
    theme: svgTheme.value,
  }),
)

const markdownOutput = computed(() =>
  generateFleetMarkdown(props.hosts, props.locationsById, redact, {
    fleetName: props.fleetName,
  }),
)

const jsonOutput = computed(() =>
  JSON.stringify(
    prepareExportData(props.hosts, props.locationsById, redact, {
      fleetName: props.fleetName,
    }),
    null,
    2,
  ),
)

const previewText = computed(() => {
  if (format.value === 'markdown') return markdownOutput.value
  if (format.value === 'json') return jsonOutput.value
  return svgOutput.value
})

async function copyOutput() {
  try {
    await navigator.clipboard.writeText(previewText.value)
    statusMsg.value = 'Copied to clipboard'
  } catch {
    statusMsg.value = 'Select the preview text and copy manually'
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function downloadOutput() {
  statusMsg.value = ''
  if (format.value === 'svg') {
    const blob = new Blob([svgOutput.value], { type: 'image/svg+xml;charset=utf-8' })
    triggerDownload(blob, `${slug.value}-topology.svg`)
    statusMsg.value = `Downloaded ${slug.value}-topology.svg`
    return
  }
  if (format.value === 'markdown') {
    const blob = new Blob([markdownOutput.value], { type: 'text/markdown;charset=utf-8' })
    triggerDownload(blob, `${slug.value}-hardware.md`)
    statusMsg.value = `Downloaded ${slug.value}-hardware.md`
    return
  }
  if (format.value === 'json') {
    const blob = new Blob([jsonOutput.value], { type: 'application/json;charset=utf-8' })
    triggerDownload(blob, `${slug.value}-hardware.json`)
    statusMsg.value = `Downloaded ${slug.value}-hardware.json`
    return
  }
  if (format.value === 'png') {
    const svgText = svgOutput.value
    const matchW = svgText.match(/width="(\d+)"/)
    const matchH = svgText.match(/height="(\d+)"/)
    const w = matchW ? Number(matchW[1]) : 960
    const h = matchH ? Number(matchH[1]) : 540
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w * 2
      canvas.height = h * 2
      const ctx = canvas.getContext('2d')
      ctx.scale(2, 2)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          triggerDownload(pngBlob, `${slug.value}-topology.png`)
          statusMsg.value = `Downloaded 2× PNG (${w * 2}×${h * 2})`
        }
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      statusMsg.value = 'Could not rasterize PNG in this browser; download SVG instead'
    }
    img.src = url
  }
}

const dialog = ref(null)
const closeBtn = ref(null)
function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
onMounted(async () => {
  document.addEventListener('keydown', onKey)
  await nextTick()
  closeBtn.value?.focus()
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <section
      ref="dialog"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
      data-test="fleet-export-dialog"
    >
      <header class="head">
        <div>
          <h2 id="export-title">Export Fleet Topology &amp; Specs</h2>
          <p class="sub">Shareable visual diagram or spec table with privacy redaction</p>
        </div>
        <button
          ref="closeBtn"
          type="button"
          class="close"
          aria-label="Close"
          data-test="export-close"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <div class="format-bar" role="tablist" aria-label="Export format">
        <button
          v-for="opt in [
            { id: 'svg', label: 'SVG Diagram' },
            { id: 'png', label: '2× PNG Image' },
            { id: 'markdown', label: 'Markdown Table' },
            { id: 'json', label: 'JSON Inventory' },
          ]"
          :key="opt.id"
          type="button"
          role="tab"
          :aria-selected="format === opt.id"
          class="tab-pill"
          :class="{ active: format === opt.id }"
          :data-test="`export-format-${opt.id}`"
          @click="format = opt.id"
        >
          {{ opt.label }}
        </button>
      </div>

      <fieldset class="redaction-box">
        <legend>Privacy Redaction Controls (ON by default)</legend>
        <label class="chk">
          <input v-model="redact.stripSerials" type="checkbox" data-test="redact-serials" />
          <span>Strip drive, board, GPU &amp; system serial numbers</span>
        </label>
        <label class="chk">
          <input v-model="redact.stripMacsAndIds" type="checkbox" data-test="redact-macs" />
          <span>Strip MAC addresses &amp; machineIdHash</span>
        </label>
        <label class="chk">
          <input v-model="redact.hideCosts" type="checkbox" data-test="redact-costs" />
          <span>Hide monthly cloud spend &amp; provider notes</span>
        </label>
        <label class="chk">
          <input v-model="redact.anonymizeHosts" type="checkbox" data-test="redact-anon" />
          <span
            >Anonymize hostnames (e.g. <code>sbc-01</code>, <code>nas-01</code>,
            <code>vps-01</code>)</span
          >
        </label>
        <div v-if="format === 'svg' || format === 'png'" class="theme-pick">
          <span>Diagram palette:</span>
          <button
            type="button"
            class="mini-btn"
            :class="{ active: svgTheme === 'dark' }"
            @click="svgTheme = 'dark'"
          >
            Dark
          </button>
          <button
            type="button"
            class="mini-btn"
            :class="{ active: svgTheme === 'light' }"
            @click="svgTheme = 'light'"
          >
            Light
          </button>
        </div>
      </fieldset>

      <div class="preview-box" data-test="export-preview">
        <div
          v-if="format === 'svg' || format === 'png'"
          class="svg-preview"
          v-html="svgOutput"
        ></div>
        <pre v-else class="text-preview"><code>{{ previewText }}</code></pre>
      </div>

      <footer class="foot">
        <span class="status" role="status">{{ statusMsg }}</span>
        <div class="actions">
          <button
            v-if="format !== 'png'"
            type="button"
            class="btn btn-secondary"
            data-test="export-copy"
            @click="copyOutput"
          >
            Copy
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-test="export-download"
            @click="downloadOutput"
          >
            Download {{ format.toUpperCase() }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.5);
}

.modal {
  width: 100%;
  max-width: 48rem;
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
  padding: 1.25rem;
  border-radius: 16px;
  background: var(--color-background);
  color: var(--color-text);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

h2 {
  font-size: 1.25rem;
  font-weight: 700;
}

.sub {
  color: var(--color-text-muted);
  font-size: 0.88rem;
}

.close {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: var(--color-background-mute);
  color: var(--color-heading);
  cursor: pointer;
}

.format-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.tab-pill {
  min-height: 40px;
  padding: 0 0.85rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 999px;
  background: none;
  color: var(--color-heading);
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
}

.tab-pill.active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-on-accent);
}

.redaction-box {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.redaction-box legend {
  font-weight: 700;
  font-size: 0.82rem;
  color: var(--color-heading);
  padding: 0 0.35rem;
}

.chk {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.88rem;
  cursor: pointer;
}

.theme-pick {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  margin-top: 0.25rem;
}

.mini-btn {
  min-height: 32px;
  padding: 0 0.65rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 8px;
  background: none;
  color: var(--color-heading);
  font-weight: 600;
  cursor: pointer;
}

.mini-btn.active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.preview-box {
  max-height: 22rem;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 0.75rem;
}

.svg-preview :deep(svg) {
  width: 100%;
  height: auto;
}

.text-preview {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.status {
  color: var(--color-accent);
  font-size: 0.85rem;
  font-weight: 600;
}

.actions {
  display: flex;
  gap: 0.5rem;
}

.btn {
  min-height: 44px;
  border: none;
  cursor: pointer;
}
</style>
