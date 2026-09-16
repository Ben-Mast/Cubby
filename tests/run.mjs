import { build } from 'esbuild'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const outdir = resolve('node_modules/.tmp')
await build({
  entryPoints: ['tests/auth.test.tsx', 'tests/home.test.ts', 'tests/voxel.test.ts', 'tests/editor.test.tsx', 'tests/furniture.test.tsx', 'tests/room.test.tsx', 'tests/placement.test.tsx', 'tests/realtime.test.tsx'], outdir, outExtension: { '.js': '.mjs' }, bundle: true,
  platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  define: { 'import.meta.env.DEV': 'true' },
  plugins: [{
    name: 'auth-test-boundaries',
    setup(build) {
      build.onResolve({ filter: /lib\/supabase\/client$/ }, () => ({ path: resolve('tests/mockSupabase.ts') }))
      build.onResolve({ filter: /features\/room\/SharedRoomScene$/ }, () => ({ path: resolve('tests/mockScene.tsx') }))
      build.onResolve({ filter: /features\/voxel\/VoxelEditorScene$/ }, () => ({ path: resolve('tests/mockVoxelScene.tsx') }))
    },
  }],
})
const result = spawnSync(process.execPath, ['--test', ...['auth', 'home', 'voxel', 'editor', 'furniture', 'room', 'placement', 'realtime'].map(name => resolve(outdir, `${name}.test.mjs`)), 'tests/schema.test.mjs', 'tests/pwa.test.mjs'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
