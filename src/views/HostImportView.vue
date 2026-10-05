<script setup>
// Import a discovery snapshot (spec §4.11, §13.3.1), in two ways:
// /settings/hosts/:id/import for a known host, or /import from the top bar,
// where the file comes first and Stocky suggests the host (a previous import
// of the same machine, else the hostname), with "Add host" when none fits.
// Upload (file or paste, checked here first) → preview (the server proposes
// rows and writes nothing) → apply the checked rows in one transaction. If
// anything changed in between, apply refuses with preview_stale and the
// preview runs again.
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { showToast } from '@/stores/toast.js'
import { applyDiscovery, createEntry, listImports, previewDiscovery } from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'
import { placeLabel } from '@/lib/format.js'
import {
  MAX_SNAPSHOT_BYTES,
  checkSnapshotText,
  countChanges,
  decisionsPayload,
  defaultDecisions,
  groupRows,
  importDay,
  parseSnapshot,
  suggestHost,
  validateDecisions,
} from '@/lib/discovery.js'
import { MAX_HOST_TYPE, MAX_LABEL, nextSortOrder } from '@/lib/lists.js'
import ImportRow from '@/components/ImportRow.vue'
import FieldError from '@/components/FieldError.vue'

const route = useRoute()
const router = useRouter()
const { records, status, canWrite, locations, categories, hosts, online } = useInventory()

// from Settings → Hosts the host is fixed; from the top bar it's picked here
const fixedHost = computed(() => !!route.params.id)
const chosenHostId = ref('')
const createdHost = ref(null) // shown before realtime brings it into the store
const hostId = computed(() => route.params.id || chosenHostId.value)
const host = computed(
  () =>
    records.hosts[hostId.value] ??
    (createdHost.value?.id === hostId.value ? createdHost.value : null),
)

// --- 1. the snapshot ---------------------------------------------------------------
const text = ref('')
const fileName = ref('')
const checkError = ref('')
async function onFile(e) {
  const file = e.target.files?.[0]
  checkError.value = ''
  if (!file) return
  if (file.size > MAX_SNAPSHOT_BYTES) {
    checkError.value = 'The snapshot is larger than 256 KB'
    return
  }
  fileName.value = file.name
  text.value = await file.text()
}

// --- 1b. which host (top-bar import only) ------------------------------------------------
const imports = ref([])
onMounted(async () => {
  if (fixedHost.value) return
  try {
    imports.value = await listImports()
  } catch (e) {
    describeError(e) // logs it; suggestions then use the hostname only
  }
})
const snapshot = computed(() =>
  checkSnapshotText(text.value).ok ? parseSnapshot(text.value) : null,
)
const suggestion = computed(() =>
  snapshot.value ? suggestHost(snapshot.value, hosts.value, imports.value) : null,
)
const hostTouched = ref(false)
watch(
  suggestion,
  (s) => {
    if (fixedHost.value || hostTouched.value) return
    chosenHostId.value = s?.hostId ?? ''
  },
  { immediate: true },
)
const suggestionText = computed(() => {
  const s = suggestion.value
  if (!s || s.hostId !== chosenHostId.value) return ''
  return s.reason === 'machine'
    ? 'Suggested: this machine was imported for this host before.'
    : "Suggested: the host's name matches the snapshot's hostname."
})

// "Add host", pre-filled from the snapshot
const adding = ref(false)
const newHost = reactive({ label: '', type: '', site: '' })
const addError = ref('')
function startAddHost() {
  adding.value = true
  addError.value = ''
  newHost.label = String(snapshot.value?.host?.hostname ?? '').slice(0, MAX_LABEL)
  newHost.type = String(snapshot.value?.host?.model ?? '').slice(0, MAX_HOST_TYPE)
  newHost.site = locations.value.find((l) => l.kind === 'site')?.id ?? ''
}
async function addHost() {
  addError.value = ''
  const label = newHost.label.trim()
  if (!label) return (addError.value = 'Give the host a name')
  if (!newHost.site) return (addError.value = 'Pick a site')
  busy.value = true
  try {
    const created = await createEntry('hosts', {
      label,
      type: newHost.type.trim(),
      site: newHost.site,
      sortOrder: nextSortOrder(hosts.value),
    })
    createdHost.value = created
    chosenHostId.value = created.id
    hostTouched.value = true
    adding.value = false
    showToast(`${label} added`)
  } catch (e) {
    const d = describeError(e)
    if (d.kind === 'fields' && d.fields.label?.code === 'validation_not_unique') {
      addError.value = `A host named ${label} already exists`
    } else if (d.kind !== 'aborted' && d.kind !== 'session') addError.value = d.message
  } finally {
    busy.value = false
  }
}
const sites = computed(() => locations.value.filter((l) => l.kind === 'site'))
const hostChoices = computed(() => {
  const list = [...hosts.value]
  if (createdHost.value && !list.some((h) => h.id === createdHost.value.id))
    list.push(createdHost.value)
  return list
})

// --- 2. preview ----------------------------------------------------------------------
const preview = ref(null)
const decisions = reactive({})
const busy = ref(false)
const formError = ref('')
const stale = ref(false)
const showErrors = ref(false)

async function runPreview() {
  checkError.value = ''
  formError.value = ''
  const check = checkSnapshotText(text.value)
  if (!check.ok) {
    checkError.value = check.message
    return
  }
  busy.value = true
  try {
    const p = await previewDiscovery(host.value.id, text.value)
    for (const k of Object.keys(decisions)) delete decisions[k]
    Object.assign(decisions, defaultDecisions(p.rows))
    preview.value = p
    stale.value = false
    showErrors.value = false
  } catch (e) {
    const d = describeError(e)
    if (d.kind !== 'aborted' && d.kind !== 'session') checkError.value = d.message
  } finally {
    busy.value = false
  }
}

function startOver() {
  preview.value = null
  text.value = ''
  fileName.value = ''
  formError.value = ''
  stale.value = false
}

const rows = computed(() => preview.value?.rows ?? [])
const groups = computed(() => groupRows(rows.value))
const changes = computed(() => countChanges(decisions, rows.value))
const errors = computed(() => validateDecisions(decisions, rows.value, records.parts))
const rowError = (id) => (showErrors.value ? errors.value[id] || '' : '')
const applyLabel = computed(() => {
  if (busy.value) return 'Applying…'
  if (!changes.value) return 'Confirm (nothing to change)'
  return `Apply ${changes.value} change${changes.value === 1 ? '' : 's'}`
})

// --- 3. apply ----------------------------------------------------------------------------
async function apply() {
  showErrors.value = true
  formError.value = ''
  if (Object.keys(errors.value).length || busy.value || !canWrite.value) return
  busy.value = true
  try {
    const res = await applyDiscovery({
      hostId: host.value.id,
      snapshotText: text.value,
      previewHash: preview.value.previewHash,
      decisions: decisionsPayload(decisions, rows.value),
    })
    const n = res.movements
    showToast(
      n
        ? `Imported for ${host.value.label}: ${n} movement${n === 1 ? '' : 's'}`
        : `Imported for ${host.value.label}: no quantity changes`,
      { actions: [{ label: 'History', to: { name: 'history', query: { place: host.value.id } } }] },
    )
    router.push(
      fixedHost.value
        ? { name: 'settings-list', params: { kind: 'hosts' } }
        : { name: 'history', query: { place: host.value.id } },
    )
  } catch (e) {
    const d = describeError(e)
    if (d.code === 'preview_stale') {
      stale.value = true
      formError.value = d.message
    } else if (d.kind !== 'aborted' && d.kind !== 'session') {
      formError.value = d.data?.row ? `${d.message} (row ${d.data.row.slice(1)})` : d.message
    }
  } finally {
    busy.value = false
  }
}

const notDetectable = computed(() => ({
  name: 'record',
  query: { type: 'found_installed', host: host.value?.id },
}))
</script>

<template>
  <section class="import">
    <RouterLink
      v-if="fixedHost"
      :to="{ name: 'settings-list', params: { kind: 'hosts' } }"
      class="back"
      >‹ Hosts</RouterLink
    >
    <RouterLink v-else :to="{ name: 'home' }" class="back">‹ Home</RouterLink>

    <div v-if="status === 'loading' || status === 'idle'" class="skeleton" aria-busy="true">
      <div v-for="n in 3" :key="n" class="row"></div>
    </div>

    <p v-else-if="fixedHost && !host" class="state">This host doesn't exist.</p>

    <template v-else>
      <h1>
        {{
          host && (fixedHost || preview) ? `Import discovery: ${host.label}` : 'Import discovery'
        }}
      </h1>
      <p v-if="fixedHost && host.retired" class="state" role="alert">
        {{ placeLabel(host) }} is retired. Unretire it to import.
      </p>

      <!-- 1. upload -->
      <div v-else-if="!preview" class="upload">
        <p v-if="fixedHost" class="hint">
          Run the collector on {{ host.label }} and upload its file. Stocky shows what it found and
          writes nothing until you confirm.
        </p>
        <p v-else class="hint">
          Run the collector on a machine and upload its file. Stocky suggests which host it is,
          shows what it found, and writes nothing until you confirm.
        </p>
        <pre v-if="fixedHost" class="cmd">stocky-collect.sh -o {{ host.label }}.json</pre>
        <pre v-else class="cmd">stocky-collect.sh -o $(hostname).json</pre>
        <div class="field">
          <label for="hi-file">Snapshot file</label>
          <input
            id="hi-file"
            type="file"
            accept=".json,application/json"
            :disabled="busy"
            @change="onFile"
          />
          <span v-if="fileName" class="hint">{{ fileName }}</span>
        </div>
        <div class="field">
          <label for="hi-paste">…or paste it</label>
          <textarea
            id="hi-paste"
            v-model="text"
            rows="5"
            spellcheck="false"
            placeholder='{ "schema": "stocky.discovery/1", … }'
            :disabled="busy"
          ></textarea>
        </div>
        <!-- which host (top-bar import): suggested, picked, or added -->
        <div v-if="!fixedHost && snapshot" class="host-pick" data-test="host-pick">
          <p class="meta">
            Snapshot from <strong>{{ snapshot.host?.hostname || 'an unnamed machine' }}</strong>
            <template v-if="snapshot.host?.model"> ({{ snapshot.host.model }})</template>
          </p>
          <div class="field">
            <label for="hi-host">Import for host</label>
            <select
              id="hi-host"
              v-model="chosenHostId"
              :disabled="busy"
              @change="hostTouched = true"
            >
              <option value="">Pick a host</option>
              <option v-for="h in hostChoices" :key="h.id" :value="h.id">{{ h.label }}</option>
            </select>
            <p v-if="suggestionText" class="hint" data-test="suggestion">{{ suggestionText }}</p>
            <p v-else-if="!suggestion" class="hint" data-test="no-match">
              No host matches
              {{ snapshot.host?.hostname ? `“${snapshot.host.hostname}”` : 'this snapshot' }}. Pick
              one, or add it.
            </p>
          </div>
          <button
            v-if="!adding"
            type="button"
            class="link add-host-link"
            :disabled="busy || !canWrite"
            data-test="add-host"
            @click="startAddHost"
          >
            ＋ Add host
          </button>
          <form v-else class="add-host" novalidate @submit.prevent="addHost">
            <div class="field">
              <label for="hi-new-label">Name</label>
              <input id="hi-new-label" v-model="newHost.label" :maxlength="MAX_LABEL" />
            </div>
            <div class="field">
              <label for="hi-new-type">Type (optional)</label>
              <input id="hi-new-type" v-model="newHost.type" :maxlength="MAX_HOST_TYPE" />
            </div>
            <div class="field">
              <label for="hi-new-site">Site</label>
              <select id="hi-new-site" v-model="newHost.site">
                <option value="" disabled>Pick one</option>
                <option v-for="l in sites" :key="l.id" :value="l.id">{{ l.label }}</option>
              </select>
            </div>
            <FieldError :message="addError" />
            <div class="actions">
              <button type="button" class="btn btn-secondary" @click="adding = false">
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="busy || !canWrite"
                data-test="add-host-save"
              >
                Add host
              </button>
            </div>
          </form>
        </div>

        <FieldError :message="checkError" />
        <p v-if="!online" class="hint">You're offline. Import needs the server.</p>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="busy || !canWrite || !text.trim() || !host"
          data-test="preview"
          @click="runPreview"
        >
          {{ busy ? 'Reading…' : 'Preview' }}
        </button>
      </div>

      <!-- 2. preview -->
      <div v-else class="preview">
        <p class="meta" data-test="snapshot">
          From <strong>{{ preview.snapshot.hostname || 'unknown host' }}</strong>
          <template v-if="preview.snapshot.model"> ({{ preview.snapshot.model }})</template>
          · {{ preview.snapshot.collector }} · {{ preview.snapshot.items }} items
          <template v-if="preview.snapshot.collectedAt">
            · collected {{ preview.snapshot.collectedAt.slice(0, 16).replace('T', ' ') }}</template
          >
        </p>
        <p v-if="preview.previous" class="meta">
          Last import {{ importDay(preview.previous.created) }} ({{ preview.previous.collector }})
        </p>

        <ul
          v-if="preview.warnings.length || preview.skipped.length"
          class="notices"
          data-test="notices"
        >
          <li v-for="(w, i) in preview.warnings" :key="`w${i}`">{{ w }}</li>
          <li v-for="(s, i) in preview.skipped" :key="`s${i}`">
            {{ s.kind ? `${s.kind} skipped: ` : '' }}{{ s.reason }}
          </li>
          <li v-for="(x, i) in preview.ignored" :key="`i${i}`">
            Left out{{ x.kind ? ` (${x.kind})` : '' }}: {{ x.reason }}
          </li>
        </ul>

        <section
          v-for="g in groups"
          :key="g.group"
          class="group"
          :data-group="g.group"
          :aria-label="g.label"
        >
          <h2>
            {{ g.label }} <span class="count">{{ g.entries.length }}</span>
          </h2>
          <p class="hint">{{ g.hint }}</p>
          <div v-for="e in g.entries" :key="e.id" :class="{ pair: e.rows.length > 1 }">
            <ImportRow
              v-for="(r, i) in e.rows"
              :key="r.id"
              :row="r"
              :decision="decisions[r.id] ?? null"
              :records="records"
              :locations="locations"
              :categories="categories"
              :error="rowError(r.id)"
              :disabled="busy"
              :half="e.rows.length > 1 ? (i === 0 ? 'out' : 'in') : ''"
            />
          </div>
        </section>
        <p v-if="!rows.length" class="state">Nothing detected that Stocky tracks.</p>

        <aside class="undetectable" data-test="not-detectable">
          <h2>Not detectable</h2>
          <p>
            Discovery reads drives, memory, CPU, network adapters, USB devices and Pi HATs. Cases,
            power supplies, cables, fans and passive adapters can't be detected; add them with
            <RouterLink :to="notDetectable">Record → Found installed</RouterLink>.
          </p>
        </aside>

        <p v-if="formError" class="form-error" role="alert">
          {{ formError }}
          <button v-if="stale" type="button" class="link" :disabled="busy" @click="runPreview">
            Review again
          </button>
        </p>
        <div class="actions">
          <button type="button" class="btn btn-secondary" :disabled="busy" @click="startOver">
            Start over
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="busy || !canWrite || stale"
            data-test="apply"
            @click="apply"
          >
            {{ applyLabel }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.import {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 40rem;
}

.back {
  align-self: flex-start;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}

h1 {
  font-size: 1.4rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

h2 {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--color-heading);
}

.count {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.upload,
.preview {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.host-pick,
.add-host {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.host-pick {
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 14px;
}

.add-host-link {
  align-self: flex-start;
  min-height: 44px;
  margin-left: 0;
}

input:not([type='file']),
select {
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
}

.cmd {
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
  background: var(--color-background-mute);
  font-size: 0.85rem;
  overflow-x: auto;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

label {
  font-weight: 600;
  color: var(--color-heading);
}

textarea {
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
}

input[type='file'] {
  min-height: 44px;
}

.hint,
.meta {
  color: var(--color-text-muted);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.notices {
  margin: 0;
  padding: 0.6rem 0.8rem 0.6rem 1.8rem;
  border-radius: 10px;
  background: hsla(40, 90%, 50%, 0.16);
  color: var(--color-heading);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.group {
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 14px;
}

.group .hint {
  margin-bottom: 0.25rem;
}

.pair {
  margin: 0.25rem 0;
  padding: 0 0.6rem;
  border-left: 3px solid var(--color-accent);
}

.undetectable {
  padding: 0.75rem 1rem;
  border-radius: 14px;
  background: var(--color-background-mute);
}

.form-error {
  padding: 0.75rem;
  border-radius: 10px;
  background: hsla(0, 80%, 50%, 0.12);
  color: var(--color-heading);
}

.link {
  border: none;
  background: none;
  padding: 0;
  margin-left: 0.4rem;
  color: var(--color-accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.state {
  padding: 1.5rem 0;
  text-align: center;
}

.skeleton .row {
  height: 56px;
  margin-bottom: 0.75rem;
  border-radius: 14px;
  background: var(--color-background-mute);
}
</style>
