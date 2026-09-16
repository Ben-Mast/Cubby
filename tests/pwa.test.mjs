import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

function text(path) { return readFileSync(path, 'utf8') }
function pngSize(path) {
  const file = readFileSync(path)
  assert.deepEqual([...file.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  return [file.readUInt32BE(16), file.readUInt32BE(20)]
}

test('PWA configuration has installable manifest metadata and raster icon fallbacks', () => {
  const config = text('vite.config.ts')
  for (const setting of ["id: '/'", "start_url: '/'", "scope: '/'", "display: 'standalone'", "theme_color: '#5b4bdb'", "background_color: '#f4f2ff'"]) {
    assert.match(config, new RegExp(setting.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.deepEqual(pngSize('public/icons/cubby-icon-192.png'), [192, 192])
  assert.deepEqual(pngSize('public/icons/cubby-icon-512.png'), [512, 512])
  assert.deepEqual(pngSize('public/icons/cubby-apple-touch-icon.png'), [180, 180])
  assert.match(text('index.html'), /rel="apple-touch-icon"/)
})

test('production routes, Cloudflare SPA fallback, mobile targets and env contract stay explicit', () => {
  const app = text('src/app/App.tsx')
  for (const route of ['/', '/login', '/room', '/furniture', '/furniture/new', '/furniture/:id/edit', '/settings']) {
    assert.match(app, new RegExp(`path=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`))
  }
  assert.match(app, /path="\/settings" element={<Navigate to="\/room" replace/)
  assert.equal(existsSync('src/routes/SettingsPage.tsx'), false)
  assert.match(text('src/main.tsx'), /BrowserRouter/)
  assert.equal(existsSync('public/404.html'), false)
  assert.equal(existsSync('functions'), false)
  assert.equal(existsSync('public/_worker.js'), false)
  const css = text('src/styles.css')
  assert.match(css, /button \{ min-height: 44px/)
  assert.match(css, /safe-area-inset-bottom/)
  assert.match(css, /height: 58svh/)
  assert.match(text('.env.example'), /^VITE_SUPABASE_URL=.*\nVITE_SUPABASE_PUBLISHABLE_KEY=/)
  assert.equal(text('.node-version').trim(), '22.16.0')
})

test('production frontend contains no privileged credential contract or logging and gates debug UI', () => {
  const sourceFiles = readdirSync('src', { recursive: true }).filter(path => /\.(ts|tsx)$/.test(path))
  const source = sourceFiles.map(path => text(`src/${path}`)).join('\n')
  assert.doesNotMatch(source, /console\.(?:log|debug|info|warn|error)\s*\(/)
  assert.doesNotMatch(source, /service[_ -]?role|SUPABASE_SERVICE/i)
  assert.match(text('src/routes/FurnitureEditorPage.tsx'), /import\.meta\.env\.DEV && <EditorDebugPanel/)
})
