<script setup>
// Manage sites, hosts or categories (spec §4.10): /settings/sites|hosts|categories.
// Active entries in order (↑/↓), then a collapsed "Retired" group; add, rename,
// retire / unretire, and delete while never referenced. In transit can only
// be renamed. The retire guards and label uniqueness are enforced on the
// server; their messages are shown on the row. Hosts also link to Import
// discovery and show their last import (spec §13.4.6).
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { showToast } from '@/stores/toast.js'
import { createEntry, deleteEntry, listImports, updateEntry } from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'
import { CURRENCIES, placeLabel } from '@/lib/format.js'
import { importDay } from '@/lib/discovery.js'
import {
  LIST_KINDS,
  MAX_DESCRIPTION,
  MAX_HOST_TYPE,
  MAX_LABEL,
  entryFields,
  nextSortOrder,
  reorder,
  validateEntry,
} from '@/lib/lists.js'
import FieldError from '@/components/FieldError.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'

const route = useRoute()
const { records, status, canWrite } = useInventory()

const kind = computed(() => route.params.kind)
const conf = computed(() => LIST_KINDS[kind.value])
const source = computed(() => (conf.value ? records[conf.value.collection] : {}))

const bySort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.label.localeCompare(b.label)
const all = computed(() => Object.values(source.value))
// what the ↑/↓ buttons reorder (In transit stays pinned at the end of Sites)
const orderable = computed(() =>
  all.value.filter((x) => !x.retired && x.kind !== 'transit').sort(bySort),
)
const transit = computed(() =>
  kind.value === 'sites' ? all.value.find((x) => x.kind === 'transit') : null,
)
const retired = computed(() =>
  all.value.filter((x) => x.retired).sort((a, b) => a.label.localeCompare(b.label)),
)
const activeSites = computed(() =>
  Object.values(records.locations)
    .filter((l) => l.kind === 'site' && !l.retired)
    .sort(bySort),
)

// --- add / edit -------------------------------------------------------------------
const editing = ref('') // '' | 'new' | entry id
const form = reactive({})
const showErrors = ref(false)
const serverErrors = reactive({})
const busy = ref(false)

function startAdd() {
  editing.value = 'new'
  Object.assign(form, {
    label: '',
    type: '',
    site: activeSites.value[0]?.id ?? '',
    description: '',
    defaultCurrency: '',
    kind: 'site',
  })
  resetErrors()
}
function startEdit(x) {
  editing.value = x.id
  Object.assign(form, {
    label: x.label,
    type: x.type ?? '',
    site: x.site ?? '',
    description: x.description ?? '',
    defaultCurrency: x.defaultCurrency ?? '',
    kind: x.kind ?? 'site',
  })
  resetErrors()
}
function cancelEdit() {
  editing.value = ''
}
function resetErrors() {
  showErrors.value = false
  for (const k of Object.keys(serverErrors)) delete serverErrors[k]
}

// an edited host may keep a site that has been retired since
const siteChoices = computed(() => {
  const list = [...activeSites.value]
  const current = records.locations[form.site]
  if (editing.value !== 'new' && current?.retired) list.push(current)
  return list
})
const errors = computed(() =>
  validateEntry(kind.value, form, {
    entries: all.value,
    exceptId: editing.value === 'new' ? '' : editing.value,
    sites: siteChoices.value,
  }),
)
const err = (f) => serverErrors[f] || (showErrors.value ? errors.value[f] || '' : '')

function applyServerError(e, { labelForUnique }) {
  const d = describeError(e)
  if (d.kind === 'fields') {
    if (
      d.fields.label?.code === 'validation_not_unique' ||
      d.fields.user?.code === 'validation_not_unique'
    ) {
      return { label: `A ${conf.value.noun} named ${labelForUnique} already exists` }
    }
    return Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, v.message]))
  }
  if (d.kind === 'validation') return { [d.data?.field || 'row']: d.message }
  if (d.kind === 'session' || d.kind === 'aborted') return {}
  return { row: d.message }
}

async function save() {
  showErrors.value = true
  for (const k of Object.keys(serverErrors)) delete serverErrors[k]
  if (Object.keys(errors.value).length || busy.value || !canWrite.value) return
  busy.value = true
  const fields = entryFields(kind.value, form)
  try {
    if (editing.value === 'new') {
      const extra = { sortOrder: nextSortOrder(orderable.value) }
      if (kind.value === 'sites') extra.kind = 'site'
      await createEntry(conf.value.collection, { ...fields, ...extra })
      showToast(`${fields.label} added`)
    } else {
      await updateEntry(conf.value.collection, editing.value, fields)
      showToast('Saved')
    }
    editing.value = ''
  } catch (e) {
    Object.assign(serverErrors, applyServerError(e, { labelForUnique: fields.label }))
  } finally {
    busy.value = false
  }
}

// --- row actions ------------------------------------------------------------------------
const rowErrors = reactive({})
async function rowAction(x, run) {
  delete rowErrors[x.id]
  try {
    await run()
  } catch (e) {
    const m = applyServerError(e, { labelForUnique: x.label })
    rowErrors[x.id] = Object.values(m)[0] || ''
  }
}
const setRetired = (x, value) =>
  rowAction(x, async () => {
    await updateEntry(conf.value.collection, x.id, { retired: value })
    showToast(value ? `${x.label} retired` : `${x.label} is active again`)
  })

async function move(index, dir) {
  const changes = reorder(orderable.value, index, dir)
  const x = orderable.value[index]
  await rowAction(x, async () => {
    for (const c of changes)
      await updateEntry(conf.value.collection, c.id, { sortOrder: c.sortOrder })
  })
}

const deleting = ref(null)
const deleteBusy = ref(false)
const deleteError = ref('')
async function confirmDelete() {
  const x = deleting.value
  deleteBusy.value = true
  deleteError.value = ''
  try {
    await deleteEntry(conf.value.collection, x.id)
    showToast(`${x.label} deleted`)
    deleting.value = null
  } catch (e) {
    deleteError.value =
      Object.values(applyServerError(e, { labelForUnique: x.label }))[0] || 'Could not delete'
  } finally {
    deleteBusy.value = false
  }
}

// hosts: the newest import still in effect, per host
const lastImport = reactive({})
async function loadImports() {
  if (kind.value !== 'hosts') return
  try {
    const list = await listImports()
    for (const k of Object.keys(lastImport)) delete lastImport[k]
    for (const imp of list) if (!imp.undone && !lastImport[imp.host]) lastImport[imp.host] = imp
  } catch (e) {
    describeError(e) // logs it; the list works without this line
  }
}
watch(kind, loadImports, { immediate: true })
const importLine = (x) => {
  const imp = lastImport[x.id]
  if (!imp) return ''
  return `Last import ${importDay(imp.created)}${imp.collector ? ` · ${imp.collector}` : ''}`
}

const secondary = (x) => {
  if (kind.value === 'sites') {
    if (x.kind === 'transit') return 'System entry: can be renamed'
    return x.defaultCurrency ? `Default currency ${x.defaultCurrency}` : ''
  }
  if (kind.value === 'hosts') {
    return [x.type, placeLabel(records.locations[x.site])].filter(Boolean).join(' · ')
  }
  return x.description || ''
}
const canDelete = (x) => !x.referenced && x.kind !== 'transit'
</script>

<template>
  <section class="lists">
    <RouterLink :to="{ name: 'settings' }" class="back">‹ Settings</RouterLink>

    <p v-if="!conf" class="state">Unknown list.</p>

    <template v-else>
      <header class="head">
        <h1>{{ conf.title }}</h1>
        <button
          v-if="editing !== 'new'"
          type="button"
          class="btn btn-primary add"
          :disabled="!canWrite || (kind === 'hosts' && !activeSites.length)"
          @click="startAdd"
        >
          {{ conf.add }}
        </button>
      </header>
      <p v-if="kind === 'hosts' && !activeSites.length" class="hint">
        Add a site first: every host belongs to one.
      </p>

      <!-- add / edit form (shared) -->
      <template v-if="editing === 'new'">
        <form class="entry-form" novalidate @submit.prevent="save">
          <div class="field">
            <label for="ef-label">Name</label>
            <input id="ef-label" v-model="form.label" :maxlength="MAX_LABEL" />
            <FieldError :message="err('label')" />
          </div>
          <div v-if="kind === 'sites'" class="field">
            <label for="ef-currency">Default currency (optional)</label>
            <select id="ef-currency" v-model="form.defaultCurrency">
              <option value="">None</option>
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <template v-if="kind === 'hosts'">
            <div class="field">
              <label for="ef-type">Type (optional)</label>
              <input
                id="ef-type"
                v-model="form.type"
                :maxlength="MAX_HOST_TYPE"
                placeholder="e.g. Raspberry Pi 5 (8 GB)"
              />
              <FieldError :message="err('type')" />
            </div>
            <div class="field">
              <label for="ef-site">Site</label>
              <select id="ef-site" v-model="form.site">
                <option value="" disabled>Pick one</option>
                <option v-for="s in siteChoices" :key="s.id" :value="s.id">
                  {{ placeLabel(s) }}
                </option>
              </select>
              <FieldError :message="err('site')" />
            </div>
          </template>
          <div v-if="kind === 'categories'" class="field">
            <label for="ef-description">Description (optional)</label>
            <input
              id="ef-description"
              v-model="form.description"
              :maxlength="MAX_DESCRIPTION"
              placeholder="e.g. NVMe, microSD, HDD"
            />
            <FieldError :message="err('description')" />
          </div>
          <FieldError :message="err('row')" />
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" @click="cancelEdit">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="busy || !canWrite">
              {{ busy ? 'Saving…' : 'Add' }}
            </button>
          </div>
        </form>
      </template>

      <div v-if="status === 'loading' || status === 'idle'" class="skeleton" aria-busy="true">
        <div v-for="n in 4" :key="n" class="row"></div>
      </div>

      <div v-else-if="!orderable.length && !transit && !retired.length" class="state">
        <p>{{ conf.empty }}</p>
      </div>

      <ul v-else class="list">
        <li
          v-for="(x, i) in [...orderable, ...(transit && !transit.retired ? [transit] : [])]"
          :key="x.id"
          :data-id="x.id"
        >
          <form v-if="editing === x.id" class="entry-form" novalidate @submit.prevent="save">
            <div class="field">
              <label :for="`ef-label-${x.id}`">Name</label>
              <input :id="`ef-label-${x.id}`" v-model="form.label" :maxlength="MAX_LABEL" />
              <FieldError :message="err('label')" />
            </div>
            <div v-if="kind === 'sites' && x.kind !== 'transit'" class="field">
              <label :for="`ef-currency-${x.id}`">Default currency (optional)</label>
              <select :id="`ef-currency-${x.id}`" v-model="form.defaultCurrency">
                <option value="">None</option>
                <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
            <template v-if="kind === 'hosts'">
              <div class="field">
                <label :for="`ef-type-${x.id}`">Type (optional)</label>
                <input :id="`ef-type-${x.id}`" v-model="form.type" :maxlength="MAX_HOST_TYPE" />
                <FieldError :message="err('type')" />
              </div>
              <div class="field">
                <label :for="`ef-site-${x.id}`">Site</label>
                <select :id="`ef-site-${x.id}`" v-model="form.site">
                  <option v-for="s in siteChoices" :key="s.id" :value="s.id">
                    {{ placeLabel(s) }}
                  </option>
                </select>
                <FieldError :message="err('site')" />
              </div>
            </template>
            <div v-if="kind === 'categories'" class="field">
              <label :for="`ef-description-${x.id}`">Description (optional)</label>
              <input
                :id="`ef-description-${x.id}`"
                v-model="form.description"
                :maxlength="MAX_DESCRIPTION"
              />
              <FieldError :message="err('description')" />
            </div>
            <FieldError :message="err('row')" />
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" @click="cancelEdit">Cancel</button>
              <button type="submit" class="btn btn-primary" :disabled="busy || !canWrite">
                {{ busy ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </form>

          <div v-else class="item">
            <div class="main">
              <span class="label">{{ x.label }}</span>
              <span v-if="secondary(x)" class="meta">{{ secondary(x) }}</span>
              <span v-if="kind === 'hosts' && importLine(x)" class="meta" data-test="last-import">
                {{ importLine(x) }}
              </span>
            </div>
            <div class="buttons">
              <RouterLink
                v-if="kind === 'hosts'"
                :to="{ name: 'host-import', params: { id: x.id } }"
                class="text import-link"
                data-test="import"
                >Import</RouterLink
              >
              <template v-if="x.kind !== 'transit'">
                <button
                  type="button"
                  class="icon"
                  aria-label="Move up"
                  :disabled="!canWrite || i === 0"
                  @click="move(i, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="icon"
                  aria-label="Move down"
                  :disabled="!canWrite || i === orderable.length - 1"
                  @click="move(i, 1)"
                >
                  ↓
                </button>
              </template>
              <button
                type="button"
                class="text"
                :disabled="!canWrite"
                data-test="edit"
                @click="startEdit(x)"
              >
                {{ x.kind === 'transit' ? 'Rename' : 'Edit' }}
              </button>
              <button
                v-if="x.kind !== 'transit'"
                type="button"
                class="text"
                :disabled="!canWrite"
                data-test="retire"
                @click="setRetired(x, true)"
              >
                Retire
              </button>
              <button
                v-if="canDelete(x)"
                type="button"
                class="text danger"
                :disabled="!canWrite"
                data-test="delete"
                @click="((deleting = x), (deleteError = ''))"
              >
                Delete
              </button>
            </div>
          </div>
          <p v-if="rowErrors[x.id]" class="row-error" role="alert">{{ rowErrors[x.id] }}</p>
        </li>
      </ul>

      <details v-if="retired.length" class="retired">
        <summary>Retired ({{ retired.length }})</summary>
        <ul class="list">
          <li v-for="x in retired" :key="x.id" :data-id="x.id">
            <div class="item">
              <div class="main">
                <span class="label">{{ x.label }}</span>
                <span v-if="secondary(x)" class="meta">{{ secondary(x) }}</span>
              </div>
              <div class="buttons">
                <button
                  type="button"
                  class="text"
                  :disabled="!canWrite"
                  data-test="unretire"
                  @click="setRetired(x, false)"
                >
                  Unretire
                </button>
                <button
                  v-if="canDelete(x)"
                  type="button"
                  class="text danger"
                  :disabled="!canWrite"
                  data-test="delete"
                  @click="((deleting = x), (deleteError = ''))"
                >
                  Delete
                </button>
              </div>
            </div>
            <p v-if="rowErrors[x.id]" class="row-error" role="alert">{{ rowErrors[x.id] }}</p>
          </li>
        </ul>
      </details>
    </template>

    <ConfirmSheet
      v-if="deleting"
      :title="`Delete ${deleting.label}?`"
      confirm-label="Delete"
      :busy="deleteBusy"
      :error="deleteError"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      <p>It has never been used, so nothing in your history refers to it.</p>
    </ConfirmSheet>
  </section>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-weight: 600;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

h1 {
  font-size: 1.5rem;
  font-weight: 700;
}

.btn {
  min-height: 44px;
  border: none;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.entry-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  margin: 0.5rem 0;
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

label {
  font-weight: 600;
  color: var(--color-heading);
}

input,
select {
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.list {
  list-style: none;
  padding: 0;
}

.list li {
  border-top: 1px solid var(--color-border);
}

.item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  min-height: 56px;
  padding: 0.4rem 0;
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.label {
  color: var(--color-heading);
  font-weight: 600;
}

.meta {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.25rem;
}

.icon,
.text {
  min-height: 44px;
  min-width: 44px;
  padding: 0 0.5rem;
  border: none;
  background: none;
  color: var(--color-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.import-link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.icon:disabled,
.text:disabled {
  color: var(--color-text-muted);
  cursor: default;
}

.danger {
  color: hsl(0, 65%, 50%);
}

.row-error {
  margin: 0 0 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 10px;
  background: hsla(0, 80%, 50%, 0.12);
  color: var(--color-heading);
}

.retired {
  margin-top: 1rem;
}

.retired summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  color: var(--color-text-muted);
  font-weight: 600;
  cursor: pointer;
}

.hint,
.state {
  color: var(--color-text-muted);
}

.state {
  padding: 2rem 0;
  text-align: center;
}

.skeleton .row {
  height: 52px;
  margin-bottom: 0.6rem;
  border-radius: 12px;
  background: var(--color-background-mute);
}
</style>
