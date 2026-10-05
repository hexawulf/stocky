import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/stores/auth.js'
import AppShell from '@/layouts/AppShell.vue'
import HomeView from '@/views/HomeView.vue'

// Every route except Login needs a session (spec §4.1); the API rules
// enforce the same thing on the server.
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: AppShell,
      children: [
        { path: '', name: 'home', component: HomeView },
        { path: 'parts', name: 'parts', component: () => import('@/views/PartsView.vue') },
        {
          path: 'parts/new',
          name: 'part-new',
          component: () => import('@/views/PartFormView.vue'),
        },
        {
          path: 'parts/:id/edit',
          name: 'part-edit',
          component: () => import('@/views/PartFormView.vue'),
        },
        { path: 'parts/:id', name: 'part', component: () => import('@/views/PartDetailView.vue') },
        { path: 'record', name: 'record', component: () => import('@/views/RecordView.vue') },
        { path: 'history', name: 'history', component: () => import('@/views/HistoryView.vue') },
        { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
        { path: 'import', name: 'import', component: () => import('@/views/HostImportView.vue') },
        {
          path: 'settings/hosts/:id/import',
          name: 'host-import',
          component: () => import('@/views/HostImportView.vue'),
        },
        {
          path: 'settings/:kind(sites|hosts|categories)',
          name: 'settings-list',
          component: () => import('@/views/ReferenceListView.vue'),
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const { restore, isSignedIn, ensureSeeded } = useAuth()
  await restore() // only does work on the first navigation
  if (to.meta.public) {
    return isSignedIn.value && to.name === 'login' ? { name: 'home' } : true
  }
  if (!isSignedIn.value) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
  }
  await ensureSeeded() // no-op once seeded (spec §5.4)
  return true
})

export default router
