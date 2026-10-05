import PocketBase from 'pocketbase'

// Same origin as the app (spec decision #15): in production one container
// serves the app and the API; in dev, Vite proxies /api and /_/ to a local
// PocketBase (vite.config.js). So there's no URL or other config to inject.
export const pb = new PocketBase('/')

// The stores load several lists at once; don't let the SDK cancel requests it
// considers duplicates.
pb.autoCancellation(false)
