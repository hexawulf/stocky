// Auth state as a plain composable (spec decision #13): one module-level copy
// shared by every component that calls useAuth().
import { computed, ref } from 'vue'
import { getTokenPayload } from 'pocketbase'
import { pb } from '../lib/pb.js'
import { seedReferenceLists } from '../lib/api.js'
import { NETWORK_MESSAGE } from '../lib/errors.js'

const EXPIRED_NOTICE = 'Your session expired, please log in again'
const REFRESH_WITHIN_SECONDS = 24 * 60 * 60
const CHECK_EVERY_MS = 10 * 60 * 1000

const user = ref(pb.authStore.isValid ? pb.authStore.record : null)
// shown once on the Login screen, e.g. after a session expired
const notice = ref('')

pb.authStore.onChange((_token, record) => {
  user.value = pb.authStore.isValid ? record : null
})

function expire() {
  notice.value = EXPIRED_NOTICE
  pb.authStore.clear()
}

// A 401 means the session is gone (spec §4 "session expired"): sign out,
// and App.vue sends the user to Login.
pb.afterSend = (response, data) => {
  if (response.status === 401 && pb.authStore.isValid) expire()
  return data
}

// PocketBase treats an invalid or revoked token as a guest: record lists come
// back empty with 200, not 401. So the session is confirmed explicitly before
// data is loaded, instead of trusting an empty list. Offline, the saved
// session is kept so the last data can still be shown.
export async function confirmSession() {
  if (!pb.authStore.isValid) {
    if (pb.authStore.token) expire() // a saved token that has run out
    return false
  }
  try {
    await pb.collection('users').authRefresh()
    return true
  } catch (err) {
    if (err?.status === 0) return true
    if (pb.authStore.isValid) expire() // afterSend already did this for a 401
    return false
  }
}

let restoring = null

// Confirm a saved session once, on first navigation (spec §4.1 splash).
export function restore() {
  restoring ??= confirmSession()
  return restoring
}

// Refresh the token before it runs out, and sign out once it has.
async function keepSessionFresh() {
  if (!user.value) return
  if (!pb.authStore.isValid) return expire()
  const exp = getTokenPayload(pb.authStore.token).exp ?? 0
  if (exp - Date.now() / 1000 < REFRESH_WITHIN_SECONDS) await confirmSession()
}

if (typeof window !== 'undefined') {
  setInterval(keepSessionFresh, CHECK_EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepSessionFresh()
  })
}

// Spec §4.2: one generic message for wrong email or password, so the app
// doesn't reveal which accounts exist.
export async function login(email, password) {
  notice.value = ''
  try {
    await pb.collection('users').authWithPassword(email.trim(), password)
  } catch (err) {
    if (err?.status === 0) throw new Error(NETWORK_MESSAGE)
    if (err?.status === 429) throw new Error('Too many attempts, try again later')
    throw new Error('Email or password is incorrect')
  }
  await ensureSeeded()
}

// First login: write the reference lists (spec §5.4), then refresh the
// record so seedVersion is current. Failing here doesn't block sign-in;
// the next start retries.
export async function ensureSeeded() {
  if (!user.value || user.value.seedVersion >= 1) return
  try {
    await seedReferenceLists()
    await pb.collection('users').authRefresh()
  } catch (err) {
    console.error('Seeding failed; will retry on next start', err)
  }
}

export function logout() {
  notice.value = ''
  pb.authStore.clear()
}

// Sends PocketBase's reset email (spec §4.2). It answers success whether or
// not the account exists, and mail only goes out once SMTP is configured
// (spec §6.4); until then reset is dashboard-only.
export async function requestPasswordReset(email) {
  try {
    await pb.collection('users').requestPasswordReset(email.trim())
  } catch (err) {
    if (err?.status === 0) throw new Error(NETWORK_MESSAGE)
    throw new Error('Enter the email address you log in with')
  }
}

export function useAuth() {
  return {
    user,
    notice,
    isSignedIn: computed(() => user.value !== null),
    restore,
    confirmSession,
    login,
    logout,
    ensureSeeded,
    requestPasswordReset,
  }
}
