// Turn a PocketBase SDK error into something the UI can show (spec §4 global
// states). Raw responses go to the console, never to the screen.

export const NETWORK_MESSAGE = "Can't reach the server"
export const UNEXPECTED_MESSAGE = 'Something went wrong. Please try again.'

// -> { kind: 'network' | 'session' | 'validation' | 'fields' | 'unexpected' | 'aborted',
//      code, message, data, fields }
// 'fields': PocketBase's own record validation, data.<field> = { code, message };
// fields maps each field to { code, message } (e.g. label: validation_not_unique
// when a unique index rejects a duplicate)
export function describeError(err) {
  if (err?.isAbort) return { kind: 'aborted', code: '', message: '', data: {} }
  const status = err?.status ?? -1
  const response = err?.response ?? {}
  if (status === 0) return { kind: 'network', code: '', message: NETWORK_MESSAGE, data: {} }
  if (status === 401) {
    return {
      kind: 'session',
      code: '',
      message: 'Your session expired, please log in again',
      data: {},
    }
  }
  // Stocky's routes and hooks answer 400 { message, data: { code, ... } } (spec §7.7)
  if (status === 400 && typeof response.data?.code === 'string') {
    return {
      kind: 'validation',
      code: response.data.code,
      message: response.message,
      data: response.data,
    }
  }
  const data = response.data ?? {}
  const fieldEntries = Object.entries(data).filter(([, v]) => typeof v?.code === 'string')
  if (status === 400 && fieldEntries.length) {
    return {
      kind: 'fields',
      code: '',
      message: response.message ?? 'Please check the highlighted fields',
      data,
      fields: Object.fromEntries(
        fieldEntries.map(([k, v]) => [k, { code: v.code, message: v.message }]),
      ),
    }
  }
  console.error('Unexpected PocketBase error', err)
  return { kind: 'unexpected', code: '', message: UNEXPECTED_MESSAGE, data: response.data ?? {} }
}
