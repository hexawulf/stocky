// The built app must ship a real robots.txt. PocketBase's SPA index fallback
// otherwise answers /robots.txt with index.html and 200 text/html.
// Stocky stays out of search indexes: no sitemap, and the noindex meta stays.
import { readFileSync } from 'node:fs'

const robots = readFileSync(new URL('../dist/robots.txt', import.meta.url), 'utf8')
const expected = 'User-agent: *\nDisallow: /\n'
if (robots !== expected) {
  console.error('dist/robots.txt must be exactly "User-agent: *" and "Disallow: /"')
  console.error(JSON.stringify(robots))
  process.exit(1)
}
if (/sitemap/i.test(robots)) {
  console.error('dist/robots.txt must not advertise a sitemap')
  process.exit(1)
}

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
if (!html.includes('<meta name="robots" content="noindex, nofollow">')) {
  console.error('dist/index.html is missing <meta name="robots" content="noindex, nofollow">')
  process.exit(1)
}

console.log('ok  dist/robots.txt disallows all crawlers; noindex meta intact')
