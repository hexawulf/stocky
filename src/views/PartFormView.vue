<script setup>
// Add / edit a part (spec §4.6). /parts/new (?name= prefills) and
// /parts/:id/edit. A new part can start with initial stock, which creates
// the part and its stock in together (one server transaction).
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useInventory } from '@/stores/inventory.js'
import { showToast } from '@/stores/toast.js'
import { countPartMovements, createPart, recordMovement, updatePart } from '@/lib/api.js'
import { describeError } from '@/lib/errors.js'
import { todayLocal } from '@/lib/dates.js'
import { getLastCurrency, setLastCurrency } from '@/lib/prefs.js'
import { CURRENCIES, UNITS, parseMoney } from '@/lib/format.js'
import { findDuplicate, validateMovement } from '@/lib/movements.js'
import {
  MAX_MAKER,
  MAX_NAME,
  MAX_NOTES,
  emptyPartForm,
  partFieldsFromForm,
  partFormFromRecord,
  validatePart,
} from '@/lib/parts.js'
import FieldError from '@/components/FieldError.vue'
import PriceField from '@/components/PriceField.vue'
import QuantityStepper from '@/components/QuantityStepper.vue'

const route = useRoute()
const router = useRouter()
const { records, categories, locations, status, canWrite, online } = useInventory()

const id = computed(() => (route.name === 'part-edit' ? route.params.id : ''))
const isNew = computed(() => !id.value)
const existing = computed(() => (id.value ? records.parts[id.value] : null))

const form = reactive(emptyPartForm(typeof route.query.name === 'string' ? route.query.name : ''))
const loaded = ref(isNew.value)
const movementCount = ref(0)

// edit: fill the form once the part is there (it may arrive after the route)
watch(
  existing,
  async (p) => {
    if (!p || loaded.value) return
    Object.assign(form, partFormFromRecord(p))
    loaded.value = true
    try {
      movementCount.value = await countPartMovements(p.id)
    } catch {
      movementCount.value = 0
    }
  },
  { immediate: true },
)
const notFound = computed(() => !isNew.value && status.value === 'ready' && !existing.value)

// initial stock (new parts only): a stock in written with the part
const withStock = ref(false)
const stock = reactive({ quantity: 1, toId: '', date: todayLocal(), priceText: '', currency: '' })
const currencyTouched = ref(false)
watch(
  () => stock.toId,
  () => {
    if (currencyTouched.value) return
    stock.currency = records.locations[stock.toId]?.defaultCurrency || getLastCurrency() || ''
  },
  { immediate: true },
)

const showErrors = ref(false)
const serverErrors = reactive({})
const busy = ref(false)
const formError = ref('')

const allParts = computed(() => Object.values(records.parts))
const allCategories = computed(() => Object.values(records.categories))
// active categories, plus the part's current one if it has been retired since
const categoryOptions = computed(() => {
  const list = [...categories.value]
  const current = records.categories[existing.value?.category]
  if (current?.retired) list.push(current)
  return list
})
const duplicate = computed(() => findDuplicate(allParts.value, form.name, id.value))

const errors = computed(() => {
  const e = validatePart(form, {
    parts: allParts.value,
    categories: allCategories.value,
    exceptId: id.value,
    originalCategory: existing.value?.category,
  })
  if (isNew.value && withStock.value) {
    const m = validateMovement(
      {
        type: 'stock_in',
        newPart: { name: form.name },
        quantity: stock.quantity,
        toId: stock.toId,
        date: stock.date,
        priceText: stock.priceText,
        currency: stock.currency,
        note: '',
      },
      { today: todayLocal() },
    )
    for (const k of ['quantity', 'to', 'date', 'price', 'currency']) {
      if (m[k]) e[`stock_${k}`] = m[k]
    }
  }
  return e
})
const err = (field) => {
  if (serverErrors[field]) return serverErrors[field]
  if (!showErrors.value) return ''
  const m = errors.value[field] || ''
  return m === 'duplicate' ? '' : m // the duplicate notice is shown with a link instead
}
const valid = computed(() => Object.keys(errors.value).length === 0)
const unitChanged = computed(
  () =>
    !isNew.value && existing.value && form.unit !== existing.value.unit && movementCount.value > 0,
)

watch(form, () => {
  for (const k of Object.keys(serverErrors)) delete serverErrors[k]
})

async function save() {
  showErrors.value = true
  formError.value = ''
  if (!valid.value || busy.value || !canWrite.value) return
  busy.value = true
  const fields = partFieldsFromForm(form)
  try {
    let partId
    if (!isNew.value) {
      await updatePart(id.value, fields)
      partId = id.value
    } else if (withStock.value) {
      const input = {
        type: 'stock_in',
        quantity: stock.quantity,
        toLocation: stock.toId,
        date: stock.date,
        newPart: fields,
      }
      const minor = CURRENCIES.includes(stock.currency)
        ? parseMoney(stock.priceText, stock.currency)
        : null
      if (Number.isInteger(minor)) {
        input.priceMinor = minor
        input.priceCurrency = stock.currency
      }
      const res = await recordMovement(input)
      if (input.priceCurrency) setLastCurrency(input.priceCurrency)
      partId = res.part.id
    } else {
      partId = (await createPart(fields)).id
    }
    showToast(isNew.value ? 'Part added' : 'Saved')
    router.replace({ name: 'part', params: { id: partId } })
  } catch (e) {
    const d = describeError(e)
    if (d.code === 'duplicate_name') serverErrors.name = d.message
    else if (d.code === 'retired' && d.data?.field === 'category') serverErrors.category = d.message
    else if (d.kind === 'fields') {
      for (const [k, v] of Object.entries(d.fields)) {
        if (k === 'nameKey' && v.code === 'validation_not_unique')
          serverErrors.name = 'You already have a part with this name'
        else serverErrors[k] = v.message
      }
    } else if (d.kind === 'network') {
      showToast(d.message, { kind: 'error', actions: [{ label: 'Retry', run: save }] })
    } else if (d.kind !== 'session' && d.kind !== 'aborted') {
      formError.value = d.message
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="part-form">
    <p v-if="notFound" class="state">
      Part not found. <RouterLink :to="{ name: 'parts' }">Back to Parts</RouterLink>
    </p>

    <template v-else>
      <h1>{{ isNew ? 'New part' : 'Edit part' }}</h1>

      <form novalidate @submit.prevent="save">
        <div class="field">
          <label for="pf-name">Name</label>
          <input id="pf-name" v-model="form.name" :maxlength="MAX_NAME" autocomplete="off" />
          <p v-if="duplicate" class="hint dup" data-test="duplicate">
            You already have '{{ duplicate.name }}' —
            <RouterLink :to="{ name: 'part', params: { id: duplicate.id } }">open it?</RouterLink>
          </p>
          <FieldError :message="err('name')" />
        </div>

        <div class="row">
          <div class="field">
            <label for="pf-category">Category</label>
            <select id="pf-category" v-model="form.category">
              <option value="" disabled>Pick one</option>
              <option v-for="c in categoryOptions" :key="c.id" :value="c.id">
                {{ c.retired ? `${c.label} (retired)` : c.label }}
              </option>
            </select>
            <FieldError :message="err('category')" />
          </div>
          <div class="field narrow">
            <label for="pf-unit">Unit</label>
            <select id="pf-unit" v-model="form.unit">
              <option v-for="u in UNITS" :key="u" :value="u">{{ u }}</option>
            </select>
            <FieldError :message="err('unit')" />
          </div>
        </div>
        <p v-if="unitChanged" class="warning" role="status">
          Existing quantities will be shown in the new unit.
        </p>

        <div class="row">
          <div class="field">
            <label for="pf-manufacturer">Manufacturer</label>
            <input id="pf-manufacturer" v-model="form.manufacturer" :maxlength="MAX_MAKER" />
            <FieldError :message="err('manufacturer')" />
          </div>
          <div class="field">
            <label for="pf-model">Model</label>
            <input id="pf-model" v-model="form.model" :maxlength="MAX_MAKER" />
            <FieldError :message="err('model')" />
          </div>
        </div>

        <div class="field">
          <label for="pf-notes">Notes</label>
          <textarea id="pf-notes" v-model="form.notes" rows="3" :maxlength="MAX_NOTES"></textarea>
          <FieldError :message="err('notes')" />
        </div>

        <div class="field">
          <label for="pf-threshold">Low-stock threshold</label>
          <input
            id="pf-threshold"
            v-model="form.threshold"
            inputmode="numeric"
            placeholder="Blank for no alert"
          />
          <FieldError :message="err('threshold')" />
        </div>

        <fieldset v-if="isNew" class="stock">
          <label class="check">
            <input v-model="withStock" type="checkbox" data-test="with-stock" />
            Add initial stock
          </label>
          <template v-if="withStock">
            <div class="row">
              <div class="field narrow">
                <label for="pf-qty">Quantity</label>
                <QuantityStepper id="pf-qty" v-model="stock.quantity" />
                <FieldError :message="err('stock_quantity')" />
              </div>
              <div class="field">
                <label for="pf-location">Location</label>
                <select id="pf-location" v-model="stock.toId">
                  <option value="" disabled>Pick one</option>
                  <option v-for="l in locations" :key="l.id" :value="l.id">{{ l.label }}</option>
                </select>
                <FieldError :message="err('stock_to')" />
              </div>
            </div>
            <div class="field">
              <label for="pf-date">Date</label>
              <input id="pf-date" v-model="stock.date" type="date" :max="todayLocal()" />
              <FieldError :message="err('stock_date')" />
            </div>
            <PriceField
              id="pf-price"
              v-model:text="stock.priceText"
              v-model:currency="stock.currency"
              :quantity="stock.quantity"
              :error="err('stock_price') || err('stock_currency')"
              @currency-picked="currencyTouched = true"
            />
          </template>
        </fieldset>

        <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
        <p v-if="!online" class="hint">You're offline. Changes are disabled until you reconnect.</p>

        <div class="actions">
          <RouterLink
            :to="isNew ? { name: 'parts' } : { name: 'part', params: { id } }"
            class="btn btn-secondary"
          >
            Cancel
          </RouterLink>
          <button type="submit" class="btn btn-primary" :disabled="busy || !canWrite">
            {{ busy ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.part-form h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 34rem;
}

.row {
  display: flex;
  gap: 0.75rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
  min-width: 0;
}

.field.narrow {
  flex: 0 0 auto;
}

label,
legend {
  font-weight: 600;
  color: var(--color-heading);
}

input:not([type='checkbox']),
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

.stock {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 44px;
}

.hint {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.dup {
  color: var(--color-heading);
}

.warning {
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
  background: hsla(40, 90%, 50%, 0.16);
  color: var(--color-heading);
}

.form-error {
  padding: 0.75rem;
  border-radius: 10px;
  background: hsla(0, 80%, 50%, 0.12);
  color: var(--color-heading);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.btn {
  min-height: 48px;
  border: none;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.state {
  padding: 3rem 0;
  text-align: center;
}

@media (max-width: 420px) {
  .row {
    flex-direction: column;
  }
}
</style>
