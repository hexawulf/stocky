<script setup>
// Public landing page for signed-out visitors (§11.5b).
// Lazy-loaded via vue-router so signed-in users never download landing code or images.
// Same-origin only: zero external fonts, scripts, analytics, or images.
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useTheme } from '@/composables/useTheme.js'
import { APP_VERSION } from '@/lib/about.js'

const { effectiveTheme, toggleTheme } = useTheme()

const features = [
  {
    title: 'Rack & chassis view',
    body: 'Hardware cards grouped by site with form-factor badges, CPU, RAM, OS, SMART drive bays, GPU/HAT/NIC chips, and a sortable Spec Matrix.',
  },
  {
    title: 'Interactive topology map',
    body: 'Pure SVG hierarchy from Fleet Root to Site Zones, Host Nodes, and expandable Hardware Anatomy block diagrams.',
  },
  {
    title: 'Zero-noise drift inbox',
    body: 'Automated snapshots refresh live telemetry while queuing physical hardware changes for 1-click transactional confirmation.',
  },
  {
    title: 'Spare-parts ledger & history',
    body: 'Track spares per site and In transit, low-stock alerts, unit pricing, append-only transactional movements, and 24-hour undo.',
  },
  {
    title: 'Discovery collector & import',
    body: 'Read-only POSIX Bash collector for Linux, Raspberry Pi, Cloud VPS, Synology NAS, and WSL2 — via push token, SSH pull, or JSON upload.',
  },
  {
    title: '⌘K search & redacted export',
    body: 'Instant fuzzy search across hosts, drive serials, GPUs, MACs, and parts, plus SVG, 2× PNG, Markdown, and JSON exports redacted by default.',
  },
]

const screenshots = [
  {
    src: '/landing/fleet-rack.webp',
    title: 'Fleet Rack & Chassis View',
    alt: 'Stocky Fleet Rack and Chassis view showing KPI summary strip and hardware cards with SMART drive bays',
  },
  {
    src: '/landing/fleet-topology.webp',
    title: 'Interactive Fleet Topology SVG',
    alt: 'Stocky interactive SVG fleet topology map grouping hosts by site with expandable hardware anatomy',
  },
  {
    src: '/landing/host-inspector.webp',
    title: 'Host Hardware Anatomy Inspector',
    alt: 'Stocky Host Detail Inspector showing visual SVG hardware anatomy diagram and installed serialized units',
  },
  {
    src: '/landing/command-palette.webp',
    title: 'Global ⌘K Command Palette & Serial Search',
    alt: 'Stocky global command palette searching physical drives by serial number across the fleet',
  },
]

const composeSnippet = `services:
  stocky:
    image: 0xwulf/stocky:1.2.0
    container_name: stocky
    restart: unless-stopped
    ports:
      - '127.0.0.1:5030:8080'
    volumes:
      - ./pb_data:/pb/pb_data
    mem_limit: 128m`

const dockerRunSnippet = `mkdir -p pb_data && sudo chown 1000:1000 pb_data
docker run -d --name stocky --restart unless-stopped \\
  -p 127.0.0.1:5030:8080 -v "$PWD/pb_data:/pb/pb_data" 0xwulf/stocky:1.2.0
docker exec -it stocky /pb/pocketbase superuser upsert you@example.com 'a-long-password'`

const activeTab = ref('compose')
const copied = ref('')

async function copySnippet() {
  const text = activeTab.value === 'compose' ? composeSnippet : dockerRunSnippet
  try {
    await navigator.clipboard.writeText(text)
    copied.value = 'Copied'
    setTimeout(() => {
      copied.value = ''
    }, 2500)
  } catch {
    copied.value = 'Select and copy manually'
  }
}
</script>

<template>
  <div class="landing" data-test="landing-page">
    <header class="landing-header">
      <RouterLink :to="{ name: 'welcome' }" class="brand">Stocky</RouterLink>
      <nav class="header-actions" aria-label="Landing">
        <button
          type="button"
          class="theme-btn"
          :aria-label="effectiveTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
          :title="effectiveTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
          data-test="landing-theme"
          @click="toggleTheme"
        >
          <span aria-hidden="true">{{ effectiveTheme === 'dark' ? '☀' : '☾' }}</span>
        </button>
        <RouterLink :to="{ name: 'login' }" class="header-signin" data-test="header-signin">
          Sign in
        </RouterLink>
      </nav>
    </header>

    <main>
      <!-- Hero -->
      <section class="hero" aria-labelledby="hero-title">
        <p class="eyebrow">PocketBase + Vue 3 · Single multi-arch Docker container</p>
        <h1 id="hero-title">Stocky</h1>
        <p class="pitch">
          Self-hosted hardware inventory: know what's in your machines, and what's in stock.
        </p>
        <div class="hero-cta">
          <RouterLink :to="{ name: 'login' }" class="btn btn-primary" data-test="landing-signin">
            Sign in
          </RouterLink>
          <a
            href="https://github.com/hexawulf/stocky"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-secondary"
            data-test="landing-github"
          >
            View on GitHub
          </a>
        </div>
      </section>

      <!-- Features -->
      <section class="block" aria-labelledby="features-title">
        <h2 id="features-title">What it tracks</h2>
        <div class="feature-grid">
          <article v-for="f in features" :key="f.title" class="feature-card">
            <h3>{{ f.title }}</h3>
            <p>{{ f.body }}</p>
          </article>
        </div>
      </section>

      <!-- Screenshots -->
      <section class="block" aria-labelledby="shots-title">
        <h2 id="shots-title">Inside Stocky</h2>
        <p class="section-sub">
          Captured from the built-in <code>demo_fleet</code> preset — zero cloud services, zero
          external requests.
        </p>
        <div class="shot-grid">
          <figure v-for="s in screenshots" :key="s.src" class="shot-card">
            <img :src="s.src" :alt="s.alt" width="1280" height="860" loading="lazy" />
            <figcaption>{{ s.title }}</figcaption>
          </figure>
        </div>
      </section>

      <!-- Self-host in one minute -->
      <section class="block" aria-labelledby="selfhost-title">
        <div class="selfhost-head">
          <div>
            <h2 id="selfhost-title">Self-host in one minute</h2>
            <p class="section-sub">
              One <code>linux/amd64</code> + <code>linux/arm64</code> container. PocketBase serves
              the API, SQLite ledger, realtime SSE, and built Vue app on one origin.
            </p>
          </div>
          <div class="snippet-controls">
            <div class="tab-group" role="tablist" aria-label="Deployment method">
              <button
                type="button"
                role="tab"
                :aria-selected="activeTab === 'compose'"
                class="tab-btn"
                :class="{ active: activeTab === 'compose' }"
                @click="activeTab = 'compose'"
              >
                Compose
              </button>
              <button
                type="button"
                role="tab"
                :aria-selected="activeTab === 'run'"
                class="tab-btn"
                :class="{ active: activeTab === 'run' }"
                @click="activeTab = 'run'"
              >
                docker run
              </button>
            </div>
            <button type="button" class="copy-btn" @click="copySnippet">
              {{ copied || 'Copy' }}
            </button>
          </div>
        </div>

        <pre
          class="code-block"
        ><code>{{ activeTab === 'compose' ? composeSnippet : dockerRunSnippet }}</code></pre>

        <p class="deploy-note">
          Need reverse proxy SSE config, locking down <code>/_/</code>, SMTP password reset, or
          backups? Read the
          <a
            href="https://github.com/hexawulf/stocky/blob/main/docs/deploy.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            deployment guide (docs/deploy.md)
          </a>
          on GitHub.
        </p>
      </section>
    </main>

    <footer class="landing-footer">
      <div class="footer-links">
        <a href="https://github.com/hexawulf/stocky" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <a href="https://hub.docker.com/r/0xwulf/stocky" target="_blank" rel="noopener noreferrer">
          Docker Hub
        </a>
        <a
          href="https://github.com/hexawulf/stocky/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
        >
          MIT License
        </a>
        <a href="https://0xwulf.dev" target="_blank" rel="noopener noreferrer">Built by 0xWulf</a>
      </div>
      <span class="version-pill" data-test="landing-version">v{{ APP_VERSION }}</span>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.landing-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 56px;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border);
}

.brand {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-heading);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--color-heading);
  font: inherit;
  font-size: 1.25rem;
  cursor: pointer;
}

.theme-btn:hover {
  background: var(--color-background-mute);
}

.theme-btn:focus-visible,
.header-signin:focus-visible,
.tab-btn:focus-visible,
.copy-btn:focus-visible,
a:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.header-signin {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 0.9rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 999px;
  color: var(--color-heading);
  font-weight: 600;
  font-size: 0.92rem;
}

.header-signin:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

main {
  flex: 1;
}

.hero {
  padding: 2.5rem 0 2.25rem;
  max-width: 44rem;
}

.eyebrow {
  display: inline-block;
  margin-bottom: 0.75rem;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-size: 0.8rem;
  font-weight: 700;
}

.hero h1 {
  font-size: clamp(2.1rem, 5vw, 3rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: 0.65rem;
}

.pitch {
  font-size: clamp(1.05rem, 2.2vw, 1.25rem);
  color: var(--color-text-muted);
  margin-bottom: 1.5rem;
  max-width: 38rem;
}

.hero-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.hero-cta .btn {
  min-height: 46px;
}

.block {
  padding: 2rem 0;
  border-top: 1px solid var(--color-border);
}

.block h2 {
  font-size: 1.35rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.section-sub {
  color: var(--color-text-muted);
  margin-bottom: 1.25rem;
  max-width: 46rem;
}

.section-sub code,
.deploy-note code {
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  background: var(--color-background-mute);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
}

.feature-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.85rem;
  margin-top: 1rem;
}

@media (min-width: 600px) {
  .feature-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 900px) {
  .feature-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.feature-card {
  padding: 1rem 1.1rem;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background-soft);
}

.feature-card h3 {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 0.35rem;
}

.feature-card p {
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.shot-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

@media (min-width: 768px) {
  .hero {
    padding: 3.5rem 0 2.75rem;
  }

  .shot-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.shot-card {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  overflow: hidden;
  background: var(--color-background-soft);
}

.shot-card img {
  display: block;
  width: 100%;
  height: auto;
  border-bottom: 1px solid var(--color-border);
}

.shot-card figcaption {
  padding: 0.65rem 0.9rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-heading);
}

.selfhost-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.selfhost-head .section-sub {
  margin-bottom: 0;
}

.snippet-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tab-group {
  display: inline-flex;
  border: 1px solid var(--color-border-hover);
  border-radius: 999px;
  padding: 0.15rem;
  background: var(--color-background-soft);
}

.tab-btn {
  min-height: 36px;
  padding: 0 0.8rem;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
}

.tab-btn.active {
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.copy-btn {
  min-height: 38px;
  padding: 0 0.85rem;
  border: 1px solid var(--color-border-hover);
  border-radius: 999px;
  background: transparent;
  color: var(--color-heading);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
}

.copy-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.code-block {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-mute);
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.84rem;
  line-height: 1.55;
  color: var(--color-heading);
}

.deploy-note {
  margin-top: 0.85rem;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.deploy-note a {
  font-weight: 600;
  text-decoration: underline;
}

.landing-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 1.5rem 0 2rem;
  border-top: 1px solid var(--color-border);
  font-size: 0.88rem;
}

.footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.footer-links a {
  color: var(--color-heading);
  font-weight: 600;
}

.footer-links a:hover {
  color: var(--color-accent);
}

.version-pill {
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--color-background-mute);
  color: var(--color-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  font-weight: 600;
}
</style>
