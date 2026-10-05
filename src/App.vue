<script setup>
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth.js'
import { useInventory } from '@/stores/inventory.js'
import ToastHost from '@/components/ToastHost.vue'

const router = useRouter()
const route = useRoute()
const { isSignedIn } = useAuth()
const inventory = useInventory()

// Live data runs while signed in. Signing out (or a 401 that ends the
// session) stops it and sends the user to Login (spec §4 global states).
watch(
  isSignedIn,
  (signedIn) => {
    if (signedIn) {
      inventory.start()
    } else {
      inventory.stop()
      if (route.name && !route.meta.public) router.replace({ name: 'login' })
    }
  },
  { immediate: true },
)
</script>

<template>
  <!-- splash until the first navigation has confirmed the session (spec §4.1) -->
  <div v-if="!route.name" class="splash" role="status" aria-label="Loading Stocky">
    <span class="logo">Stocky</span>
    <span class="spinner" aria-hidden="true"></span>
  </div>
  <RouterView v-else />
  <ToastHost />
</template>

<style scoped>
.splash {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.logo {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--color-heading);
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--color-accent-soft);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
