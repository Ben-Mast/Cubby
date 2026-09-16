// Dev-only fixture, absent from production. Exercises the actual renderer without backend/auth.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SharedRoomScene } from '../src/features/room/SharedRoomScene'
import { reconstructRoomModel, type RoomInstance } from '../src/features/room/model'
import { type Voxel, type VoxelData } from '../src/features/voxel/model'
import '../src/styles.css'

const voxels: Voxel[] = []
for (let x = 2; x < 14; x++) for (let y = 0; y < 16; y++) for (let z = 2; z < 14; z++) {
  if ((y >= 7 && y <= 9) || (y > 9 && z < 5) || (y < 7 && (x < 5 || x > 10) && (z < 5 || z > 10)))
    voxels.push({ x, y, z, color: y > 9 ? '#5b4bdb' : '#8b5e3c' })
}
const data: VoxelData = { version: 1, size: [16,16,16], voxels }
const model = reconstructRoomModel(data)
const instances: RoomInstance[] = ([0,90,180,270] as const).map((rotation, index) => ({
  placement: { id: String(index), home_id: 'test', furniture_id: 'test-design', x: index % 2 ? 9 : 3, z: index < 2 ? 3 : 9, rotation }, model,
}))
function Harness() {
  const [empty, setEmpty] = useState(true)
  return <main className="app-main"><h1>Room rendering test</h1>
    <button onClick={() => setEmpty(!empty)}>{empty ? 'Show rotation fixtures' : 'Show empty room'}</button>
    <p>{empty ? 'Empty room' : 'Four 900-voxel chairs: 0° at (3,3), 90° at (9,3), 180° at (3,9), 270° at (9,9).'}</p>
    <SharedRoomScene instances={empty ? [] : instances} /></main>
}
createRoot(document.getElementById('root')!).render(<Harness />)
