import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const userOne = '11111111-1111-4111-8111-111111111111'
const userTwo = '22222222-2222-4222-8222-222222222222'
const outsider = '33333333-3333-4333-8333-333333333333'
const migration = readFileSync('supabase/migrations/202609150001_shared_home.sql', 'utf8')
const setup = readFileSync('supabase/setup_shared_home.sql', 'utf8')
const configuredEmails = [...readFileSync('src/features/auth/identities.ts', 'utf8').matchAll(/email: '([^']+)'/g)].map((match) => match[1])
assert.equal(configuredEmails.length, 2)
for (const email of configuredEmails) {
  assert.ok(setup.includes(`'${email}'`), 'SQL seed emails must match the login identity configuration')
  assert.ok(readFileSync('supabase/verify_access.sql', 'utf8').includes(`'${email}'`))
}

test('migration/setup execute and enforce API grants, RLS, constraints, and cascades', async (t) => {
  const db = new PGlite()
  try {
    // Minimal Supabase Auth fixtures, confined to this in-memory Postgres.
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon, authenticated;
    `)
    await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4),($5,$6)', [userOne, configuredEmails[0].toUpperCase(), userTwo, configuredEmails[1], outsider, 'outsider@cubby.example'])
    await db.exec(migration)
    // Missing/ambiguous configured accounts abort before any setup writes.
    await assert.rejects(db.exec(setup.replace(`'${configuredEmails[1]}'`, "'missing@cubby.example'")), /exactly one existing Auth user/)
    await db.exec('rollback')
    assert.equal((await db.query('select * from public.homes')).rows.length, 0)
    await db.query('update auth.users set email=$1 where id=$2', [configuredEmails[0], outsider])
    await assert.rejects(db.exec(setup), /exactly one existing Auth user/)
    await db.exec('rollback')
    assert.equal((await db.query('select * from public.profiles')).rows.length, 0)
    await db.query('update auth.users set email=$1 where id=$2', ['outsider@cubby.example', outsider])
    await db.exec(setup)
    await db.exec(setup)
    await db.query('update public.profiles set display_name=$1 where id=$2', ['Girlfriend', userTwo])
    const gabbyMigration = readFileSync('supabase/migrations/202609160001_gabby_display_name.sql', 'utf8')
    await db.exec(gabbyMigration)
    await db.exec(gabbyMigration)
    assert.equal((await db.query('select display_name from public.profiles where id=$1', [userTwo])).rows[0].display_name, 'Gabby')
    assert.equal((await db.query('select display_name from public.profiles where id=$1', [userOne])).rows[0].display_name, 'Ben')
    const homeId = (await db.query('select id from public.homes')).rows[0].id
    assert.equal((await db.query('select * from public.home_members')).rows.length, 2)
    assert.equal((await db.query('select * from public.homes')).rows.length, 1)
    const verification = readFileSync('supabase/verify_access.sql', 'utf8')
    await db.exec(verification)
    assert.equal((await db.query('select * from public.furniture')).rows.length, 0, 'manual verification rolls back probes')

    await t.test('optional Phase 6 test SQL previews, applies idempotently and cleans up four copies', async () => {
      const id = '66666666-6666-4666-8666-666666666666'
      await db.query('insert into public.furniture(id,home_id,creator_id,name,voxel_data) values ($1,$2,$3,$4,$5)',
        [id, homeId, userOne, 'Room test', JSON.stringify({ version: 1, size: [16,16,16], voxels: [{ x: 4,y: 6,z: 4,color: '#8b5e3c' }] })])
      // Developer may have configured/applied this optional script already.
      // Normalize only the isolated test copy; preserve their workspace SQL.
      const seed = readFileSync('supabase/test_room_rendering.sql', 'utf8').split('-- Later cleanup')[0]
        .replace(/design_id uuid := '[^']+'/, `design_id uuid := '${id}'`)
        .replace(/\ncommit;/, '\nrollback;')
      await db.exec(seed)
      assert.equal((await db.query('select * from public.placed_furniture')).rows.length, 0, 'preview rolls back')
      const apply = seed.replace('\nrollback;', '\ncommit;')
      await db.exec(apply); await db.exec(apply)
      const rows = (await db.query('select x,z,rotation from public.placed_furniture order by id')).rows
      assert.deepEqual(rows, [{ x: 3,z: 3,rotation: 0 },{ x: 9,z: 3,rotation: 90 },{ x: 3,z: 9,rotation: 180 },{ x: 9,z: 9,rotation: 270 }])
      await db.query('delete from public.furniture where id=$1', [id])
      assert.equal((await db.query('select * from public.placed_furniture')).rows.length, 0)
    })

    async function asRole(role, uid, action) {
      await db.exec(`set role ${role}`)
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ''])
      assert.equal((await db.query('select current_user as role')).rows[0].role, role)
      try { return await action() }
      finally { await db.exec('reset role'); await db.exec("reset request.jwt.claim.sub") }
    }
    async function denied(sql, params = [], code = '42501') {
      await assert.rejects(db.query(sql, params), (error) => error.code === code)
    }

    await t.test('all five tables have RLS enabled', async () => {
      const result = await db.query("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'")
      assert.equal(result.rows.length, 5)
      assert.ok(result.rows.every((row) => row.relrowsecurity))
    })

    await t.test('anonymous API reads/writes are denied, and private RPC is not callable', async () => {
      await asRole('anon', null, async () => {
        for (const table of ['profiles', 'homes', 'home_members', 'furniture', 'placed_furniture']) {
          await denied(`select * from public.${table}`)
        }
        await denied('insert into public.furniture(home_id,creator_id,name,voxel_data) values ($1,$2,$3,$4)', [homeId, userOne, 'Probe', '{}'])
        await denied('select private.is_home_member($1)', [homeId])
      })
      // Independently test anonymous RLS, even if someone later grants SELECT.
      await db.exec('grant select on public.homes to anon')
      await asRole('anon', null, async () => assert.equal((await db.query('select * from public.homes')).rows.length, 0))
      await db.exec('revoke select on public.homes from anon')
    })

    let furnitureId
    let placementId
    await t.test('both approved users resolve the same home and read shared profiles/members', async () => {
      for (const uid of [userOne, userTwo]) {
        await asRole('authenticated', uid, async () => {
          assert.deepEqual((await db.query('select id from public.homes')).rows, [{ id: homeId }])
          assert.equal((await db.query('select * from public.profiles')).rows.length, 2)
          assert.equal((await db.query('select * from public.home_members')).rows.length, 2)
          assert.equal((await db.query('select home_id from public.home_members where user_id=$1', [uid])).rows[0].home_id, homeId)
        })
      }
    })

    await t.test('approved users can create shared furniture and placements; creator cannot be spoofed', async () => {
      await asRole('authenticated', userOne, async () => {
        furnitureId = (await db.query('insert into public.furniture(home_id,creator_id,name,voxel_data) values ($1,$2,$3,$4) returning id', [homeId, userOne, 'Probe', '{}'])).rows[0].id
        await denied('insert into public.furniture(home_id,creator_id,name,voxel_data) values ($1,$2,$3,$4)', [homeId, userTwo, 'Spoof', '{}'])
      })
      await asRole('authenticated', userTwo, async () => {
        assert.equal((await db.query('select id from public.furniture')).rows[0].id, furnitureId)
        placementId = (await db.query('insert into public.placed_furniture(home_id,furniture_id,x,z,rotation,created_by) values ($1,$2,0,0,0,$3) returning id', [homeId, furnitureId, userTwo])).rows[0].id
        await denied('insert into public.placed_furniture(home_id,furniture_id,x,z,rotation,created_by) values ($1,$2,0,0,0,$3)', [homeId, furnitureId, userOne])
      })
    })

    await t.test('outsider and authenticated-without-UID cannot read or mutate shared data', async () => {
      for (const uid of [outsider, null]) {
        await asRole('authenticated', uid, async () => {
          for (const table of ['profiles', 'homes', 'home_members', 'furniture', 'placed_furniture']) {
            assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0)
          }
          await denied('insert into public.furniture(home_id,creator_id,name,voxel_data) values ($1,$2,$3,$4)', [homeId, outsider, 'Denied', '{}'])
          assert.equal((await db.query('update public.placed_furniture set x=9 where id=$1 returning id', [placementId])).rows.length, 0)
          assert.equal((await db.query('delete from public.furniture where id=$1 returning id', [furnitureId])).rows.length, 0)
        })
      }
    })

    await t.test('membership and ownership fields cannot be changed through API', async () => {
      await asRole('authenticated', userOne, async () => {
        await denied('insert into public.home_members values ($1,$2)', [homeId, outsider])
        await denied('delete from public.home_members where user_id=$1', [userTwo])
        await denied('update public.homes set name=$1', ['Changed'])
        await denied('update public.profiles set display_name=$1', ['Changed'])
        await denied('update public.furniture set creator_id=$1', [userTwo])
        await denied('update public.furniture set home_id=$1', [homeId])
        await denied('update public.placed_furniture set created_by=$1', [userOne])
        await denied("update public.furniture set updated_at='2000-01-01'")
      })
    })

    await t.test('cross-user edits update timestamps and rotation constraints hold', async () => {
      for (const table of ['furniture', 'placed_furniture']) {
        const result = await db.query(`update public.${table} set updated_at='2000-01-01' returning updated_at > '2000-01-01'::timestamptz as overwritten`)
        assert.ok(result.rows[0].overwritten, 'trigger overwrites attempted timestamp spoof')
      }
      const before = (await db.query('select updated_at::text as updated_at from public.furniture where id=$1', [furnitureId])).rows[0].updated_at
      await asRole('authenticated', userTwo, async () => {
        const updated = await db.query('update public.furniture set name=$1 where id=$2 returning updated_at > $3::timestamptz as refreshed', ['Edited by second member', furnitureId, before])
        assert.ok(updated.rows[0].refreshed)
      })
      await asRole('authenticated', userOne, async () => {
        for (const rotation of [0, 90, 180, 270]) await db.query('update public.placed_furniture set rotation=$1 where id=$2', [rotation, placementId])
        await denied('update public.placed_furniture set rotation=45 where id=$1', [placementId], '23514')
        await denied('update public.furniture set name=$1 where id=$2', ['', furnitureId], '23514')
      })
    })

    await t.test('same-home foreign key blocks cross-home placement', async () => {
      const otherHome = (await db.query("insert into public.homes(name) values ('Isolation fixture') returning id")).rows[0].id
      await db.query('insert into public.profiles(id,display_name) values ($1,$2)', [outsider, 'Outsider'])
      await db.query('insert into public.home_members(home_id,user_id) values ($1,$2)', [otherHome, outsider])
      await asRole('authenticated', outsider, async () => {
        await denied('insert into public.placed_furniture(home_id,furniture_id,x,z,rotation,created_by) values ($1,$2,0,0,0,$3)', [otherHome, furnitureId, outsider], '23503')
      })
    })

    await t.test('either member can delete furniture; placed copies cascade', async () => {
      await asRole('authenticated', userTwo, async () => {
        await db.query('delete from public.furniture where id=$1', [furnitureId])
        assert.equal((await db.query('select * from public.placed_furniture where id=$1', [placementId])).rows.length, 0)
      })
    })

    await t.test('Phase 7 migration enforces rotated bounds/collisions through the authenticated API', async () => {
      await db.exec(readFileSync('supabase/migrations/202609150002_placement_validation.sql', 'utf8'))
      const model = { version: 1,size: [16,16,16],voxels: [
        { x: 4,y: 5,z: 8,color: '#ffffff' },{ x: 15,y: 6,z: 11,color: '#ffffff' },
      ] }
      const id = (await db.query('insert into public.furniture(home_id,creator_id,name,voxel_data) values ($1,$2,$3,$4) returning id', [homeId,userOne,'Bench',JSON.stringify(model)])).rows[0].id
      let placed
      await asRole('authenticated', userOne, async () => {
        placed = (await db.query('insert into public.placed_furniture(home_id,furniture_id,x,z,rotation,created_by) values ($1,$2,2,4,0,$3) returning id', [homeId,id,userOne])).rows[0].id
        await denied('insert into public.placed_furniture(home_id,furniture_id,x,z,rotation,created_by) values ($1,$2,3,4,0,$3)', [homeId,id,userOne], '23514')
        await denied('update public.placed_furniture set x=15,z=15 where id=$1', [placed], '23514')
        for (const rotation of [0,90,180,270]) {
          const sideways = rotation % 180 !== 0
          await db.query('update public.placed_furniture set x=$1,z=$2,rotation=$3 where id=$4', [sideways ? 15 : 13,sideways ? 13 : 15,rotation,placed])
        }
        await db.query('update public.placed_furniture set x=2,z=4,rotation=0 where id=$1', [placed])
      })
      await asRole('authenticated', userTwo, async () => {
        // Edge contact passes; turning this neighboring rectangle would overlap.
        const second = (await db.query('insert into public.placed_furniture(home_id,furniture_id,x,z,rotation,created_by) values ($1,$2,2,3,0,$3) returning id', [homeId,id,userTwo])).rows[0].id
        await denied('update public.placed_furniture set rotation=90 where id=$1', [second], '23514')
        await db.query('delete from public.placed_furniture where id=$1', [second])
        await db.query('update public.placed_furniture set x=8,z=8,rotation=90 where id=$1', [placed])
      })
      await asRole('authenticated', outsider, async () => {
        assert.equal((await db.query('update public.placed_furniture set x=0 where id=$1 returning id', [placed])).rows.length, 0)
      })
      await db.query('delete from public.furniture where id=$1', [id])
    })

    await t.test('Phase 8 migration publishes only shared furniture tables and is repeatable', async () => {
      await db.exec('create publication supabase_realtime')
      const realtimeMigration = readFileSync('supabase/migrations/202609150003_realtime_publication.sql', 'utf8')
      await db.exec(realtimeMigration)
      await db.exec(realtimeMigration)
      const tables = (await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).rows
      assert.deepEqual(tables, [{ tablename: 'furniture' }, { tablename: 'placed_furniture' }])
    })
  } finally { await db.close() }
})
