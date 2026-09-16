import test from 'node:test'
import assert from 'node:assert/strict'
import { act, create } from 'react-test-renderer'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { App } from '../src/app/App'
import { AuthProvider, useAuth } from '../src/features/auth/AuthProvider'
import { identities } from '../src/features/auth/identities'
import { mock } from './mockSupabase'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let auth: ReturnType<typeof useAuth>
let location: string
function Probe() {
  auth = useAuth()
  location = useLocation().pathname
  return null
}
async function mount(path = '/room') {
  let renderer: any
  await act(async () => {
    renderer = create(<MemoryRouter initialEntries={[path]}><AuthProvider><Probe /><App /></AuthProvider></MemoryRouter>)
  })
  return renderer
}
async function dispose(renderer: any) {
  await act(async () => renderer.unmount())
  assert.equal(mock.listeners.size, 0, 'auth subscriptions clean up')
}

test('every protected route redirects logged-out users; no signup route exists', async () => {
  for (const path of ['/room', '/furniture', '/furniture/new', '/furniture/item/edit', '/settings']) {
    mock.reset()
    const renderer = await mount(path)
    assert.equal(location, '/login')
    assert.equal(renderer.root.findAllByType('input').length, 0)
    assert.equal(renderer.root.findAllByType('button').length, 2)
    await dispose(renderer)
  }
  mock.reset()
  const renderer = await mount('/signup')
  assert.match(JSON.stringify(renderer.toJSON()), /That cubby is empty/)
  await dispose(renderer)
})

test('both identities map to hidden emails, sign in, show identity, and log out', async () => {
  for (const identity of identities) {
    mock.reset()
    const renderer = await mount('/login')
    const button = renderer.root.findAllByType('button').find((node: any) => node.children.includes(identity.displayName))
    await act(async () => button.props.onClick())
    assert.equal(renderer.root.findByType('input').props.type, 'password')
    assert.ok(!JSON.stringify(renderer.toJSON()).includes(identity.email))
    await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: 'test-only-input' } }))
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    assert.equal(location, '/room')
    assert.equal(auth.identity?.id, identity.id)
    assert.deepEqual(mock.loginCalls, [{ email: identity.email, password: 'test-only-input' }])
    await act(async () => renderer.update(<MemoryRouter initialEntries={['/settings']} key="settings"><AuthProvider><Probe /><App /></AuthProvider></MemoryRouter>))
    assert.match(JSON.stringify(renderer.toJSON()), new RegExp(identity.displayName))
    assert.ok(!JSON.stringify(renderer.toJSON()).includes(identity.email))
    await act(async () => renderer.root.findByType('button').props.onClick())
    assert.equal(location, '/login')
    assert.equal(auth.identity, null)
    assert.equal(mock.session, null)
    assert.deepEqual(mock.logoutCalls, [{ scope: 'local' }])
    await dispose(renderer)
    const reopened = await mount('/room')
    assert.equal(location, '/login')
    await dispose(reopened)
  }
})

test('wrong password stays logged out, gives feedback, and clears password', async () => {
  mock.reset()
  mock.loginError = { code: 'invalid_credentials' }
  const renderer = await mount('/login')
  await act(async () => renderer.root.findAllByType('button')[0].props.onClick())
  await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: 'wrong-test-input' } }))
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  assert.equal(location, '/login')
  assert.equal(auth.identity, null)
  assert.equal(renderer.root.findByType('input').props.value, '')
  assert.match(JSON.stringify(renderer.toJSON()), /Incorrect password/)
  await dispose(renderer)
})

test('restored session opens the room and redirects away from login', async () => {
  for (const path of ['/room', '/login']) {
    mock.reset()
    mock.session = { user: { email: identities[0].email } }
    const renderer = await mount(path)
    assert.equal(location, '/room')
    assert.equal(auth.identity?.id, identities[0].id)
    await dispose(renderer)
  }
})

test('authenticated editor routes expose creation and reject inaccessible saved records', async () => {
  for (const path of ['/furniture/new', '/furniture/item/edit']) {
    mock.reset()
    mock.session = { user: { email: identities[0].email } }
    const renderer = await mount(path)
    assert.equal(location, path)
    if (path === '/furniture/new') {
      assert.match(JSON.stringify(renderer.toJSON()), /Mock voxel canvas/)
      assert.equal(mock.queryCalls.length, 0)
      assert.match(JSON.stringify(renderer.toJSON()), /Save furniture/)
    } else {
      assert.match(JSON.stringify(renderer.toJSON()), /no longer exists or is not accessible/)
      assert.ok(mock.queryCalls.some(call => call.table === 'furniture'))
    }
    await dispose(renderer)
  }
})

test('initialization waits, ignores stale restoration, and reacts to auth changes', async () => {
  mock.reset()
  mock.pendingRestore = true
  const renderer = await mount()
  assert.match(JSON.stringify(renderer.toJSON()), /Opening your home/)
  assert.ok(!JSON.stringify(renderer.toJSON()).includes('Room scene boundary'))
  await act(async () => mock.emit({ user: { email: identities[1].email } }))
  await act(async () => mock.resolveRestore({ data: { session: null }, error: null }))
  assert.equal(auth.identity?.id, identities[1].id)
  await act(async () => mock.emit(null))
  assert.equal(location, '/login')
  await dispose(renderer)
})

test('restoration error permits retry; logout failure preserves session', async () => {
  mock.reset()
  mock.restoreError = new Error('test network failure')
  const renderer = await mount('/settings')
  assert.match(JSON.stringify(renderer.toJSON()), /Session unavailable/)
  mock.restoreError = null
  mock.session = { user: { email: identities[0].email } }
  await act(async () => renderer.root.findByType('button').props.onClick())
  assert.equal(location, '/settings')
  mock.logoutError = new Error('test logout failure')
  await act(async () => renderer.root.findByType('button').props.onClick())
  assert.equal(location, '/settings')
  assert.equal(auth.identity?.id, identities[0].id)
  assert.match(JSON.stringify(renderer.toJSON()), /Unable to log out/)
  await dispose(renderer)
})

test('unrecognized persisted identity cannot open protected screens', async () => {
  mock.reset()
  mock.session = { user: { email: 'other@example.test' } }
  const renderer = await mount()
  assert.equal(location, '/login')
  await dispose(renderer)
})

test('actual Supabase SDK persists, restores, and removes sessions with isolated storage', async () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`
  const options = {
    auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url: any) => {
      if (String(url).includes('/logout')) return new Response(null, { status: 204 })
      assert.ok(String(url).includes('/token?grant_type=password'), 'no signup or other endpoint requested')
      return new Response(JSON.stringify({
        access_token: token, refresh_token: 'test-refresh-token', expires_in: 3600, token_type: 'bearer',
        user: { id: 'test-user', email: identities[0].email },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } },
  }
  const first = createClient('https://phase-2.supabase.co', 'test-key', options)
  const login = await first.auth.signInWithPassword({ email: identities[0].email, password: 'test-only-input' })
  assert.equal(login.error, null)
  assert.ok(values.size > 0)
  assert.ok(![...values.values()].some((value) => value.includes('test-only-input')))
  const reopened = createClient('https://phase-2.supabase.co', 'test-key', options)
  const restored = await reopened.auth.getSession()
  assert.equal(restored.data.session?.user.email, identities[0].email)
  assert.equal((await reopened.auth.signOut({ scope: 'local' })).error, null)
  const afterLogout = createClient('https://phase-2.supabase.co', 'test-key', options)
  assert.equal((await afterLogout.auth.getSession()).data.session, null)
})

test('source contains only password login/logout and normal persistent browser configuration', () => {
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : [join(directory, entry.name)])
  }
  const source = sourceFiles('src').map((path) => readFileSync(path, 'utf8')).join('\n')
  assert.doesNotMatch(source, /signUp\s*\(|resetPasswordForEmail\s*\(|signInWithOAuth\s*\(|service[_-]role|HashRouter/i)
  const client = readFileSync('src/lib/supabase/client.ts', 'utf8')
  assert.match(client, /persistSession:\s*true/)
  assert.match(client, /autoRefreshToken:\s*true/)
})
