import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchCurrentHome } from '../src/features/home/currentHome'
import { mock } from './mockSupabase'

test('home lookup requires an authenticated user', async () => {
  mock.reset()
  await assert.rejects(fetchCurrentHome(), /Sign in/)
  assert.equal(mock.queryCalls.length, 0)
})

test('home lookup filters by authenticated UUID and reads the membership home', async () => {
  mock.reset()
  mock.session = { user: { id: 'approved-user' } }
  assert.deepEqual(await fetchCurrentHome(), mock.home)
  assert.deepEqual(mock.queryCalls.map(({ table, columns, filter }) => ({ table, columns, filter })), [
    { table: 'home_members', columns: 'home_id', filter: ['user_id', 'approved-user'] },
    { table: 'homes', columns: 'id, name, created_at, width, depth, height, floor_surface_id, wall_surface_id', filter: ['id', 'shared-home'] },
  ])
})

test('missing membership and query failures produce setup/connection feedback', async () => {
  mock.reset()
  mock.session = { user: { id: 'approved-user' } }
  mock.membership = null
  await assert.rejects(fetchCurrentHome(), /No shared home/)
  mock.membershipError = new Error('permission')
  await assert.rejects(fetchCurrentHome(), /membership/)
  mock.membershipError = null
  mock.membership = { home_id: 'shared-home' }
  mock.homeError = new Error('connection')
  await assert.rejects(fetchCurrentHome(), /Unable to load/)
})
