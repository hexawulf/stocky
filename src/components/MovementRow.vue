<script setup>
// One movement in a history list (spec §4.5, §4.8). Undone movements are
// greyed with a badge; a reversal reads "Undo of: …" (its server-written note).
import { computed } from 'vue'
import { formatMoney, formatQty } from '@/lib/format.js'
import { MOVEMENT_TYPES, placesOf } from '@/lib/movements.js'
import { placeLabel } from '@/lib/format.js'
import MovementIcon from '@/components/MovementIcon.vue'

const props = defineProps({
  movement: { type: Object, required: true },
  records: { type: Object, required: true }, // inventory records (parts, locations, hosts)
  showPart: { type: Boolean, default: false },
  undone: { type: Boolean, default: false },
  undoable: { type: Boolean, default: false },
})
defineEmits(['undo'])

const type = computed(() => MOVEMENT_TYPES.find((t) => t.value === props.movement.type))
const part = computed(() => props.records.parts[props.movement.part])
const places = computed(() => placesOf(props.movement, props.records))
const route = computed(() => {
  const { from, to } = places.value
  if (from && to) return `${placeLabel(from)} → ${placeLabel(to)}`
  if (to) return `→ ${placeLabel(to)}`
  return `${placeLabel(from)} →`
})
const price = computed(() =>
  props.movement.priceCurrency
    ? formatMoney(props.movement.priceMinor, props.movement.priceCurrency)
    : '',
)
const isReversal = computed(() => !!props.movement.reverses)
// units come expanded from the list (spec §13.4.3)
const serials = computed(() => (props.movement.expand?.units ?? []).map((u) => u.serial))
const note = computed(() => {
  const n = props.movement.note
  if (isReversal.value) return n?.startsWith('Undo of ') ? `Undo of: ${n.slice(8)}` : 'Undo'
  return n
})
</script>

<template>
  <div class="row" :class="{ undone }" :data-id="movement.id">
    <MovementIcon :type="movement.type" :title="type?.label" />
    <div class="body">
      <div class="line">
        <span class="type">{{ type?.label }}</span>
        <RouterLink
          v-if="showPart && part"
          :to="{ name: 'part', params: { id: part.id } }"
          class="part"
          >{{ part.name }}</RouterLink
        >
        <span class="qty">{{ formatQty(movement.quantity, part?.unit ?? 'pcs') }}</span>
        <span v-if="undone" class="badge">Undone</span>
      </div>
      <div class="meta">
        <span>{{ route }}</span>
        <span v-if="movement.reason"> · {{ movement.reason }}</span>
        <span v-if="price"> · {{ price }} each</span>
      </div>
      <p v-if="serials.length" class="serials" data-test="serials">S/N {{ serials.join(', ') }}</p>
      <p v-if="note" class="note" :class="{ reversal: isReversal }">{{ note }}</p>
    </div>
    <button
      v-if="undoable"
      type="button"
      class="undo"
      data-test="undo"
      @click="$emit('undo', movement)"
    >
      Undo
    </button>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 0.6rem 0;
  border-top: 1px solid var(--color-border);
}

.row.undone {
  opacity: 0.55;
}

.body {
  flex: 1;
  min-width: 0;
}

.line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
}

.type {
  color: var(--color-heading);
  font-weight: 600;
}

.part {
  font-weight: 600;
}

.qty {
  font-variant-numeric: tabular-nums;
}

.badge {
  padding: 0 0.4rem;
  border-radius: 6px;
  background: var(--color-background-mute);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 600;
}

.meta,
.note,
.serials {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.serials {
  overflow-wrap: anywhere;
}

.note.reversal {
  font-style: italic;
}

.undo {
  flex: none;
  min-height: 44px;
  padding: 0 0.9rem;
  border: 1px solid var(--color-accent);
  border-radius: 999px;
  background: none;
  color: var(--color-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
</style>
