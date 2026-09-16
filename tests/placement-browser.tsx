// Dev-only real UI/renderer fixture. All actions stay in memory, no hosted writes.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { RoomWorkspace } from '../src/routes/RoomPage'
import { reconstructRoomModel, type PlacedFurniture, type RoomInstance } from '../src/features/room/model'
import { type FurnitureRecord } from '../src/features/furniture/data'
import { type FloorPosition } from '../src/features/room/placement'
import { type Voxel } from '../src/features/voxel/model'
import '../src/styles.css'

const voxels: Voxel[] = []
for (let x = 2; x < 14; x++) for (let y = 0; y < 16; y++) for (let z = 2; z < 14; z++) {
  if ((y >= 7 && y <= 9) || (y > 9 && z < 5) || (y < 7 && (x < 5 || x > 10) && (z < 5 || z > 10)))
    voxels.push({ x,y,z,color: y > 9 ? '#5b4bdb' : '#8b5e3c' })
}
const design: FurnitureRecord = { id: 'chair',home_id: 'test',creator_id: 'test',name: 'Test chair',created_at: '',updated_at: '',
  voxel_data: { version: 1,size: [16,16,16],voxels } }
const model = reconstructRoomModel(design.voxel_data)
let nextId = 2
function Harness() {
  const [picked, setPicked] = useState<FurnitureRecord | null>(null)
  const [instances, setInstances] = useState<RoomInstance[]>([{ name: design.name,model,
    placement: { id: '1',home_id: 'test',furniture_id: 'chair',x: 3,z: 3,rotation: 0 } }])
  const [saved, setSaved] = useState('No fixture mutation yet')
  const actions = {
    async create(_id: string, position: FloorPosition): Promise<PlacedFurniture> {
      const placement = { id: String(nextId++),home_id: 'test',furniture_id: 'chair',...position }
      setInstances(items => [...items,{ name: design.name,model,placement }]); setSaved('Created fixture placement')
      return placement
    },
    async update(id: string, _furnitureId: string, position: FloorPosition): Promise<PlacedFurniture> {
      const placement = { id,home_id: 'test',furniture_id: 'chair',...position }
      setInstances(items => items.map(item => item.placement.id === id ? { ...item,placement } : item)); setSaved('Updated fixture placement')
      return placement
    },
    async remove(id: string) {
      setInstances(items => items.filter(item => item.placement.id !== id)); setSaved('Removed fixture placement')
    },
  }
  return <MemoryRouter><main className="app-main"><h1>Room placement test</h1>
    <button className="text-button" onClick={() => setPicked({ ...design })}>Place test chair</button>
    <p role="status">{saved}; {instances.length} saved fixture items. No Supabase writes.</p>
    <RoomWorkspace room={{ home: { id: 'test',name: 'Test',created_at: '' },instances,warnings: [] }} design={picked}
      refresh={() => {}} clearDesign={() => setPicked(null)} actions={actions} />
  </main></MemoryRouter>
}
createRoot(document.getElementById('root')!).render(<Harness />)
