// Dev-server-only harness, excluded from the production entry/build. No auth or backend.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { LocalVoxelEditor } from '../src/routes/FurnitureEditorPage'
import { VoxelEditorScene } from '../src/features/voxel/VoxelEditorScene'
import { coordinateKey, editModel, type VoxelModel } from '../src/features/voxel/model'
import '../src/styles.css'

const chair = new Map()
for (let x = 2; x < 14; x++) for (let y = 0; y < 16; y++) for (let z = 2; z < 14; z++) {
  if ((y >= 7 && y <= 9) || (y > 9 && z < 5) ||
      (y < 7 && (x < 5 || x > 10) && (z < 5 || z > 10))) {
    const voxel = { x, y, z, color: y > 9 ? '#5b4bdb' : '#8b5e3c' }
    chair.set(coordinateKey(voxel), voxel)
  }
}
function Harness() {
  const [benchmark, setBenchmark] = useState(false)
  const [model, setModel] = useState<VoxelModel>(chair)
  return <MemoryRouter><main className="app-main">
    <button onClick={() => setBenchmark(!benchmark)}>{benchmark ? 'Local editor test' : 'Detailed chair performance test'}</button>
    {benchmark ? <><h1>Detailed chair: {model.size} voxels</h1>
      <VoxelEditorScene model={model} mode="paint" onStrokeStart={() => {}}
        onStrokeEdit={at => setModel(previous => editModel(previous, 'paint', at, '#e781a0'))}
        onStrokeEnd={() => {}} onStrokeCancel={() => {}} /></>
      : <LocalVoxelEditor />}
  </main></MemoryRouter>
}
createRoot(document.getElementById('root')!).render(<Harness />)
