<script setup>
// Record a movement (spec §4.7). Also opened from Part detail as
// /record?type=move&part=<id>, which pre-selects both.
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { showToast } from '@/stores/toast.js'
import { recordMovement, undoMovement } from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'
import { todayLocal } from '@/lib/dates.js'
import { getLastCurrency, setLastCurrency } from '@/lib/prefs.js'
import { CURRENCIES, UNITS, formatQty, parseMoney, unitLabel } from '@/lib/format.js'
import {
  MOVEMENT_TYPES,
  NEW_PART_TYPES,
  REASONS,
  SHAPES,
  available,
  destinationsFor,
  findDuplicate,
  sourcesFor,
  summary,
  validateMovement,
} from '@/lib/movements.js'
import PartPicker from '@/components/PartPicker.vue'
import QuantityStepper from '@/components/QuantityStepper.vue'
import FieldError from '@/components/FieldError.vue'
import PriceField from '@/components/PriceField.vue'
import MovementIcon from '@/components/MovementIcon.vue'

const route = useRoute()
const inv = useInventory()
const { records, parts, locations, hosts, categories, canWrite, online, status } = inv

const today = ref(todayLocal())

function blankDraft(type = 'stock_in') {
  return {
    type,
    partId: '',
    newPart: null, // { name, category, unit } while adding a part inline
    quantity: 1,
    fromId: '',
    toId: '',
    reason: '',
    priceText: '',
    currency: '',
    date: todayLocal(),
    note: '',
  }
}

const draft = reactive(blankDraft())
const showErrors = ref(false)
const busy = ref(false)
const formError = ref('')
const currencyTouched = ref(false)

// --- pre-selection from the query (Part detail actions) --------------------------
function applyQuery(q) {
  if (q.type && SHAPES[q.type]) draft.type = q.type
  if (q.part && records.parts[q.part] && !records.parts[q.part].archived) draft.partId = q.part
  presetHost()
}
// ?host= (from an import's "Not detectable" panel) pre-selects the host
function presetHost() {
  const h = route.query.host
  if (draft.type === 'found_installed' && h && records.hosts[h] && !records.hosts[h].retired) {
    draft.toId = h
  }
}
watch(() => route.query, applyQuery, { immediate: true })
// the catalog may arrive after the route: retry the part pre-selection once it does
watch(
  () => status.value,
  () => applyQuery(route.query),
)

// --- derived state ----------------------------------------------------------------
const shape = computed(() => SHAPES[draft.type])
const part = computed(() => (draft.partId ? records.parts[draft.partId] : null))
const unit = computed(() => part.value?.unit ?? draft.newPart?.unit ?? 'pcs')
const toHost = computed(() => (draft.type === 'install' ? records.hosts[draft.toId] : null))
const canCreatePart = computed(() => NEW_PART_TYPES.includes(draft.type))

const sources = computed(() =>
  sourcesFor(draft.type, {
    part: part.value,
    locations: locations.value,
    hosts: hosts.value,
    toHost: toHost.value,
  }),
)
const destinations = computed(() =>
  destinationsFor(draft.type, {
    locations: locations.value,
    hosts: hosts.value,
    fromId: draft.fromId,
  }),
)
// a host or a location: stock out may come from either (spec §13.4.2)
const fromKind = computed(
  () => sources.value.find((s) => s.id === draft.fromId)?.kind ?? shape.value?.from,
)
const fromPlace = computed(() =>
  fromKind.value === 'host' ? records.hosts[draft.fromId] : records.locations[draft.fromId],
)
const toPlace = computed(() =>
  shape.value?.to === 'host' ? records.hosts[draft.toId] : records.locations[draft.toId],
)
const avail = computed(() =>
  shape.value?.from && draft.fromId
    ? available(part.value, draft.fromId, fromKind.value)
    : undefined,
)
const maxQty = computed(() => (avail.value === undefined ? 9999 : Math.max(1, avail.value)))

const allParts = computed(() => Object.values(records.parts))
const duplicate = computed(() =>
  draft.newPart ? findDuplicate(allParts.value, draft.newPart.name) : null,
)

const errors = computed(() => {
  const e = validateMovement(draft, {
    part: part.value,
    available: avail.value,
    fromPlace: fromPlace.value,
    toHost: toHost.value,
    today: today.value,
  })
  if (draft.newPart) {
    const name = draft.newPart.name.trim()
    if (name.length < 2 || name.length > 80) e.newName = 'Name: 2–80 characters'
    else if (duplicate.value) e.newName = `You already have '${duplicate.value.name}'`
    if (!draft.newPart.category) e.newCategory = 'Pick a category'
  }
  return e
})
const err = (field) => (showErrors.value ? errors.value[field] || '' : '')
const valid = computed(() => Object.keys(errors.value).length === 0)

const priceMinor = computed(() =>
  draft.type === 'stock_in' && CURRENCIES.includes(draft.currency)
    ? parseMoney(draft.priceText, draft.currency)
    : null,
)

const summaryText = computed(() => {
  const name = part.value?.name ?? draft.newPart?.name?.trim()
  if (!name || (shape.value.from && !fromPlace.value) || (shape.value.to && !toPlace.value)) {
    return ''
  }
  const reason = REASONS.find((r) => r.value === draft.reason)?.label.toLowerCase()
  return summary({
    type: draft.type,
    quantity: draft.quantity,
    partName: name,
    from: fromPlace.value,
    to: toPlace.value,
    reason,
    date: draft.date,
  })
})

// --- defaults that follow other choices --------------------------------------------
watch(
  () => draft.type,
  () => {
    draft.fromId = ''
    draft.toId = ''
    draft.reason = ''
    draft.priceText = ''
    currencyTouched.value = false
    if (!canCreatePart.value) draft.newPart = null
    showErrors.value = false
    formError.value = ''
    presetHost()
  },
)

// pick the only sensible source: keep a valid choice, else the first with stock.
// immediate: the query (Part detail) may already have set type and part
// before this watcher exists, and then nothing would change to trigger it.
watch(
  sources,
  (list) => {
    if (list.some((s) => s.id === draft.fromId)) return
    draft.fromId = list.find((s) => s.available > 0)?.id ?? ''
  },
  { immediate: true },
)

// uninstall: the host's own site is the default destination (spec §4.7)
watch(
  () => draft.fromId,
  (id) => {
    if (draft.type !== 'uninstall') return
    const site = records.hosts[id]?.site
    if (site && destinations.value.some((l) => l.id === site)) draft.toId = site
  },
  { immediate: true },
)

// stock in: currency from the site, else the last one used here, else empty
// (then the user must pick one before a price can be saved; decision #21)
watch(
  () => [draft.type, draft.toId],
  () => {
    if (draft.type !== 'stock_in' || currencyTouched.value) return
    draft.currency = records.locations[draft.toId]?.defaultCurrency || getLastCurrency() || ''
  },
  { immediate: true },
)

// keep the quantity within what's available as the source changes
watch(maxQty, (max) => {
  if (draft.quantity > max) draft.quantity = max
})

// --- new part inline (stock in and found installed) ------------------------------------
function startNewPart(name) {
  draft.partId = ''
  draft.newPart = { name: name || '', category: '', unit: 'pcs' }
}
function useExisting(p) {
  draft.newPart = null
  draft.partId = p.id
}

// --- submit ---------------------------------------------------------------------------
function buildInput() {
  const input = {
    type: draft.type,
    quantity: draft.quantity,
    date: draft.date,
    note: draft.note.trim(),
  }
  if (draft.newPart) {
    input.newPart = {
      name: draft.newPart.name.trim(),
      category: draft.newPart.category,
      unit: draft.newPart.unit,
    }
  } else {
    input.part = draft.partId
  }
  if (shape.value.from)
    input[fromKind.value === 'host' ? 'fromHost' : 'fromLocation'] = draft.fromId
  if (shape.value.to) input[shape.value.to === 'host' ? 'toHost' : 'toLocation'] = draft.toId
  if (draft.type === 'stock_out') input.reason = draft.reason
  if (draft.type === 'stock_in' && Number.isInteger(priceMinor.value)) {
    input.priceMinor = priceMinor.value
    input.priceCurrency = draft.currency
  }
  return input
}

async function undo(movementId) {
  try {
    await undoMovement(movementId)
    showToast('Undone')
  } catch (e) {
    showToast(describeError(e).message || 'Undo failed', { kind: 'error' })
  }
}

async function submit() {
  today.value = todayLocal()
  showErrors.value = true
  formError.value = ''
  if (!valid.value || busy.value || !canWrite.value) return
  busy.value = true
  const input = buildInput()
  const localAvailable = avail.value
  try {
    const { movement, part: saved } = await recordMovement(input)
    if (input.priceCurrency) setLastCurrency(input.priceCurrency)
    showToast('Recorded', {
      actions: [
        { label: 'Undo', run: () => undo(movement.id) },
        { label: 'View part', to: { name: 'part', params: { id: saved.id } } },
      ],
    })
    // reset, keeping the type (spec §4.7)
    Object.assign(draft, blankDraft(draft.type))
    currencyTouched.value = false
    draft.currency = getLastCurrency()
    showErrors.value = false
  } catch (e) {
    const d = describeError(e)
    if (
      d.code === 'insufficient_stock' &&
      localAvailable !== undefined &&
      localAvailable >= input.quantity
    ) {
      formError.value = 'Stock changed on another device, please review'
    } else if (d.code === 'duplicate_name') {
      formError.value = d.message
    } else if (d.kind !== 'aborted' && d.kind !== 'session') {
      formError.value = d.message
    }
  } finally {
    busy.value = false
  }
}

const noHosts = computed(
  () =>
    ['install', 'uninstall', 'found_installed'].includes(draft.type) && hosts.value.length === 0,
)
const placeOption = (s) =>
  `${s.place.label} (${formatQty(s.available, unit.value)} ${s.kind === 'host' ? 'installed' : 'available'})`
const locationSources = computed(() => sources.value.filter((s) => s.kind === 'location'))
const hostSources = computed(() => sources.value.filter((s) => s.kind === 'host'))
</script>

<template>
  <section class="record">
    <h1>Record</h1>

    <div class="types" role="radiogroup" aria-label="Movement type">
      <button
        v-for="t in MOVEMENT_TYPES"
        :key="t.value"
        type="button"
        role="radio"
        :aria-checked="draft.type === t.value"
        :class="{ on: draft.type === t.value }"
        :data-type="t.value"
        @click="draft.type = t.value"
      >
        <MovementIcon :type="t.value" class="type-icon" />
        {{ t.label }}
      </button>
    </div>

    <p v-if="draft.type === 'found_installed'" class="hint type-hint" data-test="found-hint">
      For hardware already in a host before Stocky knew about it. Spares aren't touched.
    </p>

    <form novalidate @submit.prevent="submit">
      <!-- part -->
      <div v-if="!draft.newPart" class="field">
        <label for="rec-part">Part</label>
        <PartPicker
          id="rec-part"
          v-model="draft.partId"
          :parts="parts"
          :allow-new="canCreatePart"
          @new="startNewPart"
        />
        <p v-if="!parts.length && !canCreatePart" class="hint">
          No parts yet. Record a stock in or found installed with a new part first.
        </p>
        <FieldError :message="err('part')" />
      </div>

      <fieldset v-else class="new-part">
        <legend>New part</legend>
        <div class="field">
          <label for="rec-new-name">Name</label>
          <input id="rec-new-name" v-model="draft.newPart.name" maxlength="80" />
          <p v-if="duplicate" class="hint dup">
            You already have '{{ duplicate.name }}' —
            <button type="button" class="link" @click="useExisting(duplicate)">use it</button>
          </p>
          <FieldError v-else :message="err('newName')" />
        </div>
        <div class="row">
          <div class="field">
            <label for="rec-new-category">Category</label>
            <select id="rec-new-category" v-model="draft.newPart.category">
              <option value="" disabled>Pick one</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.label }}</option>
            </select>
            <FieldError :message="err('newCategory')" />
          </div>
          <div class="field">
            <label for="rec-new-unit">Unit</label>
            <select id="rec-new-unit" v-model="draft.newPart.unit">
              <option v-for="u in UNITS" :key="u" :value="u">{{ u }}</option>
            </select>
          </div>
        </div>
        <button type="button" class="link" @click="draft.newPart = null">
          Pick an existing part
        </button>
      </fieldset>

      <p v-if="noHosts" class="hint">
        No hosts yet. <RouterLink :to="{ name: 'settings' }">Add one in Settings</RouterLink>.
      </p>

      <!-- install: the host first, then where the part comes from (spec §4.7) -->
      <div v-if="draft.type === 'install'" class="field">
        <label for="rec-to">Install into</label>
        <select id="rec-to" v-model="draft.toId">
          <option value="" disabled>Pick a host</option>
          <option v-for="h in destinations" :key="h.id" :value="h.id">{{ h.label }}</option>
        </select>
        <FieldError :message="err('to')" />
      </div>

      <div v-if="shape.from" class="field">
        <label for="rec-from">From</label>
        <select
          id="rec-from"
          v-model="draft.fromId"
          :disabled="draft.type === 'install' && !toHost"
        >
          <option value="" disabled>
            {{ draft.type === 'install' && !toHost ? 'Pick the host first' : 'Pick one' }}
          </option>
          <template v-if="hostSources.length && locationSources.length">
            <optgroup label="Spares">
              <option
                v-for="s in locationSources"
                :key="s.id"
                :value="s.id"
                :disabled="s.available === 0"
              >
                {{ placeOption(s) }}
              </option>
            </optgroup>
            <optgroup label="Installed in">
              <option v-for="s in hostSources" :key="s.id" :value="s.id">
                {{ placeOption(s) }}
              </option>
            </optgroup>
          </template>
          <template v-else>
            <option v-for="s in sources" :key="s.id" :value="s.id" :disabled="s.available === 0">
              {{ placeOption(s) }}
            </option>
          </template>
        </select>
        <FieldError :message="err('from')" />
      </div>

      <div v-if="shape.to && draft.type !== 'install'" class="field">
        <label for="rec-to">{{ draft.type === 'found_installed' ? 'Found in' : 'To' }}</label>
        <select id="rec-to" v-model="draft.toId">
          <option value="" disabled>Pick one</option>
          <option v-for="d in destinations" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>
        <FieldError :message="err('to')" />
      </div>

      <div class="field">
        <label for="rec-qty">Quantity</label>
        <div class="qty">
          <QuantityStepper id="rec-qty" v-model="draft.quantity" :max="maxQty" />
          <span v-if="avail !== undefined" class="hint"
            >of {{ formatQty(avail, unit) }}
            {{ fromKind === 'host' ? 'installed' : 'available' }}</span
          >
          <span v-else class="hint">{{ unitLabel(draft.quantity, unit) }}</span>
        </div>
        <FieldError :message="err('quantity')" />
      </div>

      <div v-if="draft.type === 'stock_out'" class="field">
        <span class="label" id="rec-reason-label">Reason</span>
        <div class="types small" role="radiogroup" aria-labelledby="rec-reason-label">
          <button
            v-for="r in REASONS"
            :key="r.value"
            type="button"
            role="radio"
            :aria-checked="draft.reason === r.value"
            :class="{ on: draft.reason === r.value }"
            @click="draft.reason = r.value"
          >
            {{ r.label }}
          </button>
        </div>
        <FieldError :message="err('reason')" />
      </div>

      <PriceField
        v-if="draft.type === 'stock_in'"
        id="rec-price"
        v-model:text="draft.priceText"
        v-model:currency="draft.currency"
        :quantity="draft.quantity"
        :error="err('price') || err('currency')"
        @currency-picked="currencyTouched = true"
      />

      <div class="field">
        <label for="rec-date">Date</label>
        <input id="rec-date" v-model="draft.date" type="date" :max="today" />
        <FieldError :message="err('date')" />
      </div>

      <div class="field">
        <label for="rec-note">Note (optional)</label>
        <textarea id="rec-note" v-model="draft.note" rows="2" maxlength="500"></textarea>
        <FieldError :message="err('note')" />
      </div>

      <p v-if="summaryText" class="summary" data-test="summary">{{ summaryText }}</p>
      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <p v-if="!online" class="hint">You're offline. Changes are disabled until you reconnect.</p>

      <button type="submit" class="btn btn-primary submit" :disabled="busy || !canWrite">
        {{ busy ? 'Recording…' : 'Record' }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.record h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

.types {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1.25rem;
}

.types button {
  min-height: 44px;
  padding: 0 0.9rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 999px;
  background: none;
  color: var(--color-heading);
  font: inherit;
  cursor: pointer;
}

.types button:has(.type-icon) {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding-left: 0.35rem;
}

.type-icon {
  width: 1.75rem;
  height: 1.75rem;
}

.types button.on .type-icon {
  background: var(--color-background);
}

.types button.on {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: var(--color-on-accent);
  font-weight: 600;
}

.type-hint {
  margin: -0.5rem 0 1rem;
}

.types.small {
  margin-bottom: 0;
}

form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 34rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
}

label,
.label,
legend {
  font-weight: 600;
  color: var(--color-heading);
}

input,
select,
textarea {
  min-height: 44px;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
}

.row {
  display: flex;
  gap: 0.75rem;
}

.qty {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.new-part {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

.hint {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.dup {
  color: var(--color-heading);
}

.link {
  align-self: flex-start;
  min-height: 44px;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.summary {
  padding: 0.75rem;
  border-radius: 10px;
  background: var(--color-accent-soft);
  color: var(--color-heading);
}

.form-error {
  padding: 0.75rem;
  border-radius: 10px;
  background: hsla(0, 80%, 50%, 0.12);
  color: var(--color-heading);
}

.submit {
  min-height: 48px;
  border: none;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.submit:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
