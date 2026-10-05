<script setup>
// One row of a discovery preview (spec §13.3.1 step 4, §13.6): what was
// detected, what it matched, and the decision (checkbox, action, where it
// goes or why it's gone, and for a new part its name, category and unit, or
// an existing part from "Is this …?"). The decision object is edited in place.
import { computed, watch } from 'vue'
import { UNITS, placeLabel } from '@/lib/format.js'
import { REASONS } from '@/lib/movements.js'
import { ACTION_LABELS, MATCHED_BY, itemDetail, rowQty } from '@/lib/discovery.js'
import FieldError from '@/components/FieldError.vue'

const props = defineProps({
  row: { type: Object, required: true },
  decision: { type: Object, default: null }, // null for ignored rows
  records: { type: Object, required: true }, // inventory records
  locations: { type: Array, required: true }, // active locations, in order
  categories: { type: Array, required: true }, // active categories, in order
  error: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  half: { type: String, default: '' }, // 'out' | 'in' inside a Replaced pair
})

const r = computed(() => props.row)
const d = computed(() => props.decision)
const toggleable = computed(() => !!d.value && r.value.group !== 'unchanged')
const actions = computed(() => (r.value.options ?? []).filter((o) => o !== 'none'))
const chosenPart = computed(() => (d.value?.partId ? props.records.parts[d.value.partId] : null))
// picked from "Is this …?" among parts recorded on this host by hand
const chosenHere = computed(
  () => (r.value.suggestions ?? []).find((s) => s.id === d.value?.partId)?.here > 0,
)
// a Conflict asks for the detected item's part only when replacing
const isConflict = computed(() => r.value.group === 'conflict')
const replacing = computed(() => isConflict.value && d.value?.action?.startsWith('replace'))
const showNewPart = computed(() => !!r.value.newPart && (!isConflict.value || replacing.value))
const title = computed(
  () =>
    chosenPart.value?.name ||
    r.value.partName ||
    d.value?.newPart?.name ||
    r.value.newPart?.name ||
    r.value.items[0]?.label ||
    'Unknown item',
)
const installSources = computed(() =>
  (r.value.sources ?? []).map((id) => props.records.locations[id]).filter(Boolean),
)
const fromHost = computed(() => props.records.hosts[r.value.fromHost])
const id = (s) => `ir-${r.value.id}-${s}`

// checking a row that defaults to "ignore this time" means doing something
watch(
  () => d.value?.apply,
  (on) => {
    if (on && d.value.action === 'ignore') {
      d.value.action = actions.value.find((a) => a !== 'ignore') ?? 'ignore'
    }
  },
)
</script>

<template>
  <div
    class="import-row"
    :class="{ off: d && !d.apply }"
    :data-row="row.id"
    :data-group="row.group"
  >
    <div class="head">
      <input
        v-if="toggleable"
        :id="id('apply')"
        v-model="d.apply"
        type="checkbox"
        :disabled="disabled"
        data-test="apply"
      />
      <label :for="toggleable ? id('apply') : undefined" class="title">
        <span v-if="half === 'out'" class="half">Out:</span>
        <span v-else-if="half === 'in'" class="half">In:</span>
        {{ title }}
      </label>
      <span class="qty">{{ rowQty(row, records.parts) }}</span>
    </div>

    <ul class="detected">
      <li v-for="it in row.items" :key="it.index">
        <span class="raw">{{ it.label }}</span>
        <span v-if="itemDetail(it)" class="meta">{{ itemDetail(it) }}</span>
      </li>
      <li v-if="!row.items.length && row.serials.length" class="meta">
        Not detected: S/N {{ row.serials.join(', ')
        }}<template v-if="row.slot"> · was in {{ row.slot }}</template>
      </li>
    </ul>

    <p v-if="isConflict" class="conflict" data-test="recorded">
      Recorded here: <strong>{{ row.recorded.name }}</strong> · detected:
      <strong>{{ row.items[0]?.label }}</strong>
    </p>
    <p v-if="row.declined" class="meta" data-test="declined">
      You left this out before. Check it to import it after all.
    </p>
    <p class="meta match">
      <template v-if="row.group === 'ignored'">{{ row.reason }}</template>
      <template v-else-if="row.matchedBy">{{ MATCHED_BY[row.matchedBy] }}</template>
      <template v-else-if="row.newPart && !chosenPart">New part</template>
      <template v-if="row.noSerial"> · no serial: matched by count only</template>
      <template v-if="row.group === 'moved'">
        · last seen in {{ fromHost ? placeLabel(fromHost) : 'another host' }}</template
      >
    </p>

    <template v-if="d && d.apply">
      <!-- new part: name, category, unit, or an existing part ("Is this …?") -->
      <div v-if="showNewPart" class="new-part">
        <p v-if="chosenPart" class="using">
          Using your part <strong>{{ chosenPart.name }}</strong
          ><template v-if="chosenHere"
            >, already recorded here: adds the serial, no movement.</template
          >
          <button type="button" class="link" :disabled="disabled" @click="d.partId = ''">
            Create a new part instead
          </button>
        </p>
        <template v-else>
          <div v-if="row.suggestions?.length" class="suggest">
            <span class="meta">Is this …?</span>
            <button
              v-for="s in row.suggestions"
              :key="s.id"
              type="button"
              class="chip"
              :disabled="disabled"
              data-test="suggestion"
              @click="d.partId = s.id"
            >
              {{ s.name }}<template v-if="s.here"> ({{ s.here }} recorded here)</template>
            </button>
          </div>
          <div class="field">
            <label :for="id('name')">Name</label>
            <input :id="id('name')" v-model="d.newPart.name" maxlength="80" :disabled="disabled" />
          </div>
          <div class="pair">
            <div class="field">
              <label :for="id('category')">Category</label>
              <select :id="id('category')" v-model="d.newPart.category" :disabled="disabled">
                <option value="" disabled>Pick one</option>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.label }}</option>
              </select>
            </div>
            <div class="field">
              <label :for="id('unit')">Unit</label>
              <select :id="id('unit')" v-model="d.newPart.unit" :disabled="disabled">
                <option v-for="u in UNITS" :key="u" :value="u">{{ u }}</option>
              </select>
            </div>
          </div>
        </template>
      </div>

      <div v-if="actions.length > 1" class="field">
        <label :for="id('action')">What happened</label>
        <select :id="id('action')" v-model="d.action" :disabled="disabled">
          <option v-for="a in actions" :key="a" :value="a">{{ ACTION_LABELS[a] }}</option>
        </select>
      </div>
      <div v-if="d.action === 'install'" class="field">
        <label :for="id('location')">From spares at</label>
        <select :id="id('location')" v-model="d.location" :disabled="disabled">
          <option v-for="l in installSources" :key="l.id" :value="l.id">{{ l.label }}</option>
        </select>
      </div>
      <div v-if="d.action === 'uninstall' || d.action === 'replace_uninstall'" class="field">
        <label :for="id('location')">Keep it at</label>
        <select :id="id('location')" v-model="d.location" :disabled="disabled">
          <option v-for="l in locations" :key="l.id" :value="l.id">{{ l.label }}</option>
        </select>
      </div>
      <div v-if="d.action === 'stock_out' || d.action === 'replace_stock_out'" class="field">
        <label :for="id('reason')">Reason</label>
        <select :id="id('reason')" v-model="d.reason" :disabled="disabled">
          <option v-for="x in REASONS" :key="x.value" :value="x.value">{{ x.label }}</option>
        </select>
      </div>
    </template>
    <FieldError :message="error" />
  </div>
</template>

<style scoped>
.import-row {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem 0;
  border-top: 1px solid var(--color-border);
}

.import-row.off .title,
.import-row.off .detected {
  opacity: 0.6;
}

.head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 44px;
}

.head input[type='checkbox'] {
  width: 1.3rem;
  height: 1.3rem;
  flex: none;
}

.title {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  color: var(--color-heading);
  overflow-wrap: anywhere;
}

.half {
  color: var(--color-text-muted);
  font-weight: 600;
}

.qty {
  flex: none;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--color-heading);
}

.conflict {
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  background: hsla(40, 90%, 50%, 0.16);
  color: var(--color-heading);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.detected {
  list-style: none;
  padding: 0;
  margin: 0;
}

.detected li {
  display: flex;
  flex-direction: column;
  overflow-wrap: anywhere;
}

.raw {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
}

.meta {
  color: var(--color-text-muted);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.new-part {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.suggest {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.chip {
  min-height: 36px;
  padding: 0 0.8rem;
  border: 1px solid var(--color-accent);
  border-radius: 999px;
  background: var(--color-accent-soft);
  color: var(--color-heading);
  font: inherit;
  cursor: pointer;
}

.using {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
}

.link {
  border: none;
  background: none;
  padding: 0;
  color: var(--color-accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1;
}

.pair {
  display: flex;
  gap: 0.75rem;
}

label {
  font-weight: 600;
  color: var(--color-heading);
}

.field label {
  font-size: 0.9rem;
}

input:not([type='checkbox']),
select {
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
  min-width: 0;
}
</style>
