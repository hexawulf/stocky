<script setup>
// Search picker for a part (spec §4.7): substring match on name, manufacturer
// and model; offers "＋ new part" with the typed text when allowNew is set.
import { computed, ref, watch } from 'vue'
import { formatQty } from '@/lib/format.js'

const props = defineProps({
  parts: { type: Array, required: true },
  allowNew: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  id: { type: String, default: undefined },
})
const model = defineModel({ type: String, default: '' }) // part id
const emit = defineEmits(['new'])

const query = ref('')
const open = ref(false)
const selected = computed(() => props.parts.find((p) => p.id === model.value) ?? null)

// show the chosen part's name; clear the text when the selection is reset
// from outside (e.g. the form resets after recording)
watch(
  selected,
  (p, old) => {
    if (p) query.value = p.name
    else if (old && query.value === old.name) query.value = ''
  },
  { immediate: true },
)

const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = q
    ? props.parts.filter((p) =>
        [p.name, p.manufacturer, p.model].some((v) => v && v.toLowerCase().includes(q)),
      )
    : props.parts
  return list.slice(0, 30)
})

function pick(p) {
  model.value = p.id
  query.value = p.name
  open.value = false
}

function onInput(e) {
  query.value = e.target.value
  open.value = true
  if (selected.value && query.value !== selected.value.name) model.value = ''
}

function createNew() {
  open.value = false
  emit('new', query.value.trim())
}
</script>

<template>
  <div class="picker">
    <input
      :id="id"
      type="search"
      autocomplete="off"
      placeholder="Search parts"
      :value="query"
      :disabled="disabled"
      role="combobox"
      :aria-expanded="open"
      @input="onInput"
      @focus="open = true"
    />
    <ul v-if="open && !disabled" class="options" role="listbox">
      <li v-for="p in matches" :key="p.id" role="option" :aria-selected="p.id === model">
        <button type="button" @click="pick(p)">
          <span class="name">{{ p.name }}</span>
          <span class="meta">{{ formatQty(p.spareTotal, p.unit) }} spare</span>
        </button>
      </li>
      <li v-if="!matches.length && !allowNew" class="none">No parts match</li>
      <li v-if="allowNew">
        <button type="button" class="new" @click="createNew">
          ＋ new part{{ query.trim() ? ` "${query.trim()}"` : '' }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
}

input {
  width: 100%;
  min-height: 44px;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
}

.options {
  position: absolute;
  inset: calc(100% + 4px) 0 auto 0;
  max-height: 18rem;
  overflow-y: auto;
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  z-index: 20;
}

.options button {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  min-height: 44px;
  padding: 0 0.75rem;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.options button:hover {
  background: var(--color-background-mute);
}

.meta,
.none {
  color: var(--color-text-muted);
}

.none {
  padding: 0.6rem 0.75rem;
}

.new {
  color: var(--color-accent) !important;
  font-weight: 600 !important;
}
</style>
