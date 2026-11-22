<script setup>
// "Connect a Host" Wizard (Phase 5.2):
// Step 1: Choose Site + Token Scope (Single Host or Whole Fleet) -> generate stky_... token (copied once).
// Step 2: Shows copy-ready commands tailored to window.location.origin:
//   - Linux / Raspberry Pi / VPS (one-shot): download stocky-collect.sh + verify SHA-256 + run --push
//   - Automated nightly sync: copy-ready cron or systemd user timer
//   - Central SSH pull (for NAS / isolated nodes): stocky-fleet-pull.sh snippet
//   - Air-gapped / offline: download JSON + drag-and-drop upload
// Also lists active tokens with 1-click Revoke.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { createIngestToken, listIngestTokens, revokeIngestToken } from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'

const props = defineProps({
  sites: { type: Array, required: true },
  hosts: { type: Array, required: true },
})

const emit = defineEmits(['close'])

const origin = computed(() =>
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://stocky.example.com',
)

const form = reactive({
  label: 'Homelab Fleet Collector',
  scope: 'fleet',
  defaultSite: props.sites[0]?.id ?? '',
  host: '',
  autoRegisterHosts: true,
})

const generatedToken = ref('')
const busy = ref(false)
const error = ref('')
const copiedMsg = ref('')
const modeTab = ref('oneshot') // 'oneshot' | 'cron' | 'ssh' | 'offline'
const tokens = ref([])

async function refreshTokens() {
  try {
    tokens.value = await listIngestTokens()
  } catch {}
}

onMounted(refreshTokens)

async function generate() {
  error.value = ''
  busy.value = true
  try {
    const res = await createIngestToken({
      label: form.label.trim() || 'Fleet Collector',
      scope: form.scope,
      defaultSite: form.defaultSite,
      host: form.scope === 'single_host' ? form.host : '',
      autoRegisterHosts: form.scope !== 'single_host' && form.autoRegisterHosts,
    })
    generatedToken.value = res.token
    await refreshTokens()
  } catch (e) {
    error.value = describeError(e).message
  } finally {
    busy.value = false
  }
}

async function revoke(id) {
  try {
    await revokeIngestToken(id)
    await refreshTokens()
  } catch (e) {
    error.value = describeError(e).message
  }
}

const tokenPlaceholder = computed(() => generatedToken.value || 'stky_<your-generated-token>')

const snippetText = computed(() => {
  const url = origin.value
  const tok = tokenPlaceholder.value
  if (modeTab.value === 'oneshot') {
    return [
      `# 1. Save your ingest token (mode 0600, never visible in ps)`,
      `mkdir -p ~/.config/stocky ~/bin && chmod 700 ~/.config/stocky`,
      `umask 077 && printf '%s\\n' '${tok}' > ~/.config/stocky/ingest.token`,
      ``,
      `# 2. Download & verify stocky-collect.sh from this Stocky instance`,
      `curl -fsSL ${url}/tools/stocky-collect.sh -o ~/bin/stocky-collect.sh`,
      `curl -fsSL ${url}/tools/stocky-collect.sh.sha256 | (cd ~/bin && sha256sum -c -)`,
      `chmod +x ~/bin/stocky-collect.sh`,
      ``,
      `# 3. Collect and push hardware snapshot`,
      `~/bin/stocky-collect.sh --push ${url} --token-file ~/.config/stocky/ingest.token`,
    ].join('\n')
  }
  if (modeTab.value === 'cron') {
    return [
      `# Automated nightly sync (04:15) + 5 min after boot:`,
      `~/bin/stocky-collect.sh --push ${url} --token-file ~/.config/stocky/ingest.token --print-cron`,
      ``,
      `# Or install a systemd user timer:`,
      `~/bin/stocky-collect.sh --push ${url} --token-file ~/.config/stocky/ingest.token --print-systemd`,
    ].join('\n')
  }
  if (modeTab.value === 'ssh') {
    return [
      `# Central read-only SSH pull (for Synology NAS or isolated nodes):`,
      `cat > ~/.config/stocky/hosts.conf << 'EOF'`,
      `nas-a --no-sudo`,
      `pi-a`,
      `EOF`,
      `./tools/stocky-fleet-pull.sh -c ~/.config/stocky/hosts.conf \\`,
      `  --push ${url} --token-file ~/.config/stocky/ingest.token`,
    ].join('\n')
  }
  return [
    `# Air-gapped / offline collection:`,
    `./stocky-collect.sh -o "$(hostname).json"`,
    `# Then upload $(hostname).json via the Import screen.`,
  ].join('\n')
})

async function copyText(str, label) {
  try {
    await navigator.clipboard.writeText(str)
    copiedMsg.value = `${label} copied`
  } catch {
    copiedMsg.value = 'Select and copy manually'
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
      aria-labelledby="connect-title"
      data-test="connect-host-dialog"
    >
      <header class="head">
        <div>
          <h2 id="connect-title">Connect a Host or Fleet</h2>
          <p class="sub">
            Auto-discover bare-metal Linux, Raspberry Pi SBCs, Cloud KVM VPSes, Synology NASes &amp;
            WSL2
          </p>
        </div>
        <button
          ref="closeBtn"
          type="button"
          class="close"
          aria-label="Close"
          data-test="connect-close"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <!-- Step 1: Token generation -->
      <div class="step-card">
        <h3>1. Generate a Scoped Ingest Token</h3>
        <div class="form-grid">
          <div class="field">
            <label for="ch-label">Token label</label>
            <input id="ch-label" v-model="form.label" maxlength="80" />
          </div>
          <div class="field">
            <label for="ch-scope">Scope</label>
            <select id="ch-scope" v-model="form.scope">
              <option value="fleet">Whole Fleet (auto-register new hosts)</option>
              <option value="site">Single Site</option>
              <option value="single_host">Single Host only</option>
            </select>
          </div>
          <div v-if="form.scope !== 'single_host'" class="field">
            <label for="ch-site">Default Site for new hosts</label>
            <select id="ch-site" v-model="form.defaultSite">
              <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </div>
          <div v-else class="field">
            <label for="ch-host">Target Host</label>
            <select id="ch-host" v-model="form.host">
              <option value="" disabled>Pick a host</option>
              <option v-for="h in hosts" :key="h.id" :value="h.id">{{ h.label }}</option>
            </select>
          </div>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="token-actions">
          <button
            type="button"
            class="btn btn-primary"
            :disabled="busy || (form.scope === 'single_host' && !form.host)"
            data-test="generate-token"
            @click="generate"
          >
            {{ busy ? 'Generating…' : 'Generate Ingest Token' }}
          </button>
        </div>

        <div v-if="generatedToken" class="token-banner" data-test="generated-token">
          <p class="warn-line">
            Copy this token now — Stocky stores only its SHA-256 hash and never shows it again:
          </p>
          <div class="token-row">
            <code>{{ generatedToken }}</code>
            <button
              type="button"
              class="btn btn-secondary"
              @click="copyText(generatedToken, 'Token')"
            >
              Copy Token
            </button>
          </div>
        </div>
      </div>

      <!-- Step 2: Copy-ready collector snippets -->
      <div class="step-card">
        <h3>2. Run the Read-Only Collector</h3>
        <div class="mode-tabs" role="tablist">
          <button
            v-for="m in [
              { id: 'oneshot', label: 'Linux / Pi / VPS' },
              { id: 'cron', label: 'Nightly Cron / Timer' },
              { id: 'ssh', label: 'Central SSH Pull (NAS)' },
              { id: 'offline', label: 'Offline JSON' },
            ]"
            :key="m.id"
            type="button"
            role="tab"
            class="tab-pill"
            :class="{ active: modeTab === m.id }"
            @click="modeTab = m.id"
          >
            {{ m.label }}
          </button>
        </div>
        <pre class="snippet" data-test="connect-snippet"><code>{{ snippetText }}</code></pre>
        <div class="foot-row">
          <span class="copied">{{ copiedMsg }}</span>
          <div class="actions">
            <RouterLink
              v-if="modeTab === 'offline'"
              :to="{ name: 'import' }"
              class="btn btn-secondary"
              @click="emit('close')"
            >
              Open Manual Import
            </RouterLink>
            <button
              type="button"
              class="btn btn-secondary"
              data-test="copy-snippet"
              @click="copyText(snippetText, 'Commands')"
            >
              Copy Commands
            </button>
          </div>
        </div>
      </div>

      <!-- Active tokens list -->
      <div v-if="tokens.length" class="step-card">
        <h3>Active &amp; Past Tokens</h3>
        <ul class="token-list">
          <li v-for="t in tokens" :key="t.id">
            <div>
              <strong>{{ t.label }}</strong>
              <span class="meta">
                · <code>{{ t.tokenPrefix }}…</code> · {{ t.scope }}
                <template v-if="t.lastUsedAt">
                  · last used {{ t.lastUsedAt.slice(0, 16).replace('T', ' ') }}
                </template>
              </span>
            </div>
            <span v-if="t.revoked" class="revoked-pill">Revoked</span>
            <button
              v-else
              type="button"
              class="revoke-btn"
              :data-test="`revoke-${t.id}`"
              @click="revoke(t.id)"
            >
              Revoke
            </button>
          </li>
        </ul>
      </div>
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
  max-width: 46rem;
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

h3 {
  font-size: 0.95rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
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

.step-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.65rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
}

.field input,
.field select {
  min-height: 42px;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
}

.token-banner {
  padding: 0.75rem;
  border-radius: 10px;
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
}

.warn-line {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
  margin-bottom: 0.35rem;
}

.token-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.token-row code {
  flex: 1;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  background: var(--color-background);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
  overflow-wrap: anywhere;
  user-select: all;
}

.mode-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tab-pill {
  min-height: 36px;
  padding: 0 0.75rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 999px;
  background: none;
  color: var(--color-heading);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.tab-pill.active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-on-accent);
}

.snippet {
  margin: 0;
  padding: 0.75rem;
  border-radius: 10px;
  background: var(--color-background-mute);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  overflow-x: auto;
  white-space: pre;
}

.foot-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.copied {
  color: var(--color-accent);
  font-size: 0.85rem;
  font-weight: 600;
}

.token-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.token-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0;
  border-top: 1px solid var(--color-border);
  font-size: 0.86rem;
}

.token-list li:first-child {
  border-top: none;
}

.meta {
  color: var(--color-text-muted);
}

.revoke-btn {
  min-height: 34px;
  padding: 0 0.65rem;
  border: 1px solid hsl(0, 65%, 50%);
  border-radius: 8px;
  background: none;
  color: hsl(0, 65%, 50%);
  font-weight: 600;
  cursor: pointer;
}

.revoked-pill {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.error {
  color: hsl(0, 65%, 50%);
  font-size: 0.85rem;
  font-weight: 600;
}

.btn {
  min-height: 42px;
  border: none;
  cursor: pointer;
}
</style>
