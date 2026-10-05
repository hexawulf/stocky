<script setup>
// One icon per movement type, each with its own shape (lib/icons.js) and
// tint so they're told apart at a glance.
import { computed } from 'vue'
import { movementIcon } from '@/lib/icons.js'

const props = defineProps({
  type: { type: String, required: true },
})

const paths = computed(() => movementIcon(props.type))
</script>

<template>
  <span class="movement-icon" :class="`t-${type}`" :data-type="type" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path v-for="(d, i) in paths" :key="i" :d="d" />
    </svg>
  </span>
</template>

<style scoped>
.movement-icon {
  flex: none;
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--tint, var(--color-heading));
  background: color-mix(in srgb, var(--tint, var(--color-heading)) 14%, transparent);
}

svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.t-stock_in {
  --tint: hsl(145, 60%, 36%);
}
.t-stock_out {
  --tint: hsl(4, 70%, 50%);
}
.t-move {
  --tint: hsl(210, 75%, 48%);
}
.t-install {
  --tint: hsl(265, 55%, 55%);
}
.t-uninstall {
  --tint: hsl(32, 85%, 45%);
}
.t-found_installed {
  --tint: hsl(185, 70%, 36%);
}

@media (prefers-color-scheme: dark) {
  .t-stock_in {
    --tint: hsl(145, 55%, 55%);
  }
  .t-stock_out {
    --tint: hsl(4, 80%, 66%);
  }
  .t-move {
    --tint: hsl(210, 85%, 66%);
  }
  .t-install {
    --tint: hsl(265, 70%, 72%);
  }
  .t-uninstall {
    --tint: hsl(32, 90%, 60%);
  }
  .t-found_installed {
    --tint: hsl(185, 65%, 55%);
  }
}
</style>
