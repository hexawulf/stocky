<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth.js'

// Spec §4.2: no sign-up link; accounts are created in the dashboard.
const router = useRouter()
const route = useRoute()
const { login, notice, requestPasswordReset } = useAuth()

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const busy = ref(false)
const error = ref('')
const info = ref('')

async function submit() {
  if (busy.value) return
  error.value = ''
  info.value = ''
  busy.value = true
  try {
    await login(email.value, password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    // only follow in-app paths
    router.replace(redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/')
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

async function forgotPassword() {
  error.value = ''
  info.value = ''
  if (!email.value.trim()) {
    error.value = 'Enter your email first, then tap "Forgot password?"'
    return
  }
  try {
    await requestPasswordReset(email.value)
    info.value = 'If that account exists, a reset email is on its way.'
  } catch (err) {
    error.value = err.message
  }
}
</script>

<template>
  <main class="login">
    <h1>Stocky</h1>
    <p class="tagline">Know what's in your machines, and what's in stock.</p>

    <p v-if="notice" class="message notice" role="status">{{ notice }}</p>

    <form novalidate @submit.prevent="submit">
      <label>
        Email
        <input v-model="email" type="email" autocomplete="username" inputmode="email" required />
      </label>

      <label>
        Password
        <span class="password">
          <input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            required
          />
          <button
            type="button"
            class="toggle"
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          >
            {{ showPassword ? 'Hide' : 'Show' }}
          </button>
        </span>
      </label>

      <p v-if="error" class="message error" role="alert">{{ error }}</p>
      <p v-if="info" class="message" role="status">{{ info }}</p>

      <button type="submit" class="btn btn-primary submit" :disabled="busy">
        <span v-if="busy" class="spinner" aria-hidden="true"></span>
        {{ busy ? 'Logging in…' : 'Log in' }}
      </button>

      <button type="button" class="link" @click="forgotPassword">Forgot password?</button>
    </form>
  </main>
</template>

<style scoped>
.login {
  max-width: 24rem;
  margin: 0 auto;
  padding: 4rem 0 2rem;
}

h1 {
  font-size: 2rem;
  font-weight: 700;
}

.tagline {
  color: var(--color-text-muted);
  margin-bottom: 2rem;
}

form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-weight: 600;
  color: var(--color-heading);
}

input {
  min-height: 44px;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font: inherit;
}

input:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.password {
  display: flex;
  gap: 0.5rem;
}

.password input {
  flex: 1;
}

.toggle,
.link {
  min-height: 44px;
  padding: 0 0.8rem;
  border: none;
  background: none;
  color: var(--color-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.link {
  align-self: center;
}

.submit {
  min-height: 48px;
  border: none;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  gap: 0.5rem;
}

.submit:disabled {
  opacity: 0.7;
  cursor: progress;
}

.message {
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
  background: var(--color-background-mute);
}

.notice {
  margin-bottom: 1rem;
}

.error {
  background: hsla(0, 80%, 50%, 0.12);
  color: var(--color-heading);
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
