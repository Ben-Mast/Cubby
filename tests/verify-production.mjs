import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

assert.ok(existsSync('dist/index.html'), 'Run pnpm build before production verification.')
assert.ok(existsSync('dist/sw.js'), 'Production service worker is missing.')
assert.ok(readdirSync('dist').some(name => /^workbox-.*\.js$/.test(name)), 'Workbox runtime is missing.')
const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'))
assert.equal(manifest.id, '/')
assert.equal(manifest.start_url, '/')
assert.equal(manifest.scope, '/')
assert.equal(manifest.display, 'standalone')
for (const [file, size] of [['cubby-icon-192.png', '192x192'], ['cubby-icon-512.png', '512x512']]) {
  assert.ok(manifest.icons.some(icon => icon.src.endsWith(file) && icon.sizes === size), `${file} is missing from the manifest.`)
  assert.ok(existsSync(`dist/icons/${file}`), `${file} was not copied to dist.`)
}
assert.match(readFileSync('dist/index.html', 'utf8'), /rel="manifest"/)
assert.match(readFileSync('dist/index.html', 'utf8'), /rel="apple-touch-icon"/)
assert.equal(existsSync('dist/404.html'), false, 'A top-level 404 would disable Cloudflare Pages SPA fallback.')
assert.equal(existsSync('dist/_worker.js'), false)
assert.equal(existsSync('dist/functions'), false)
const javascript = readdirSync('dist/assets').filter(name => name.endsWith('.js'))
  .map(name => readFileSync(`dist/assets/${name}`, 'utf8')).join('\n')
assert.doesNotMatch(javascript, /Local\/debug serialization|Capture snapshot|SUPABASE_SERVICE|service_role/i)
console.log('Production artifact verification passed: manifest, icons, service worker, SPA fallback, debug removal, and credential boundary.')
