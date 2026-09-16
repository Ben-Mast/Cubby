export const EDITOR_SIZE = 16
export interface Coordinate { x: number; y: number; z: number }
export interface Voxel extends Coordinate { color: string }
export interface VoxelData { version: 1; size: [16, 16, 16]; voxels: Voxel[] }
export type VoxelModel = ReadonlyMap<string, Voxel>
export type EditMode = 'add' | 'delete' | 'paint'
export const coordinateKey = ({ x, y, z }: Coordinate) => `${x},${y},${z}`
export const inBounds = ({ x, y, z }: Coordinate) =>
  [x, y, z].every(value => Number.isInteger(value) && value >= 0 && value < EDITOR_SIZE)
export const validColor = (color: string) => /^#[\da-f]{6}$/i.test(color)

export function editModel(model: VoxelModel, mode: EditMode, at: Coordinate, color: string): VoxelModel {
  if (!inBounds(at) || !validColor(color)) return model
  const key = coordinateKey(at)
  const existing = model.get(key)
  if ((mode === 'add' && existing) || (mode !== 'add' && !existing) ||
      (mode === 'paint' && existing?.color === color)) return model
  const next = new Map(model)
  if (mode === 'delete') next.delete(key)
  else next.set(key, { x: at.x, y: at.y, z: at.z, color })
  return next
}

export function serializeModel(model: VoxelModel): string {
  const data: VoxelData = { version: 1, size: [16, 16, 16],
    voxels: [...model.values()].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z) }
  const json = JSON.stringify(data)
  deserializeModel(json)
  return json
}

export function deserializeModel(json: string): VoxelModel {
  const data = JSON.parse(json)
  if (!data || data.version !== 1 || !Array.isArray(data.size) || data.size.length !== 3 ||
      !data.size.every((value: unknown) => value === EDITOR_SIZE) || !Array.isArray(data.voxels) ||
      data.voxels.length > EDITOR_SIZE ** 3) throw new Error('Unsupported voxel format.')
  const model = new Map<string, Voxel>()
  for (const voxel of data.voxels) {
    if (!voxel || !inBounds(voxel) || typeof voxel.color !== 'string' || !validColor(voxel.color))
      throw new Error('Voxels need integer coordinates 0–15 and a six-digit hex color.')
    const key = coordinateKey(voxel)
    if (model.has(key)) throw new Error('Duplicate voxel coordinates.')
    model.set(key, { x: voxel.x, y: voxel.y, z: voxel.z, color: voxel.color })
  }
  return model
}

export interface History { past: VoxelModel[]; present: VoxelModel; future: VoxelModel[] }
export type HistoryAction = { type: 'edit'; mode: EditMode; at: Coordinate; color: string }
  | { type: 'restore'; model: VoxelModel } | { type: 'undo' | 'redo' | 'clear' }
export const HISTORY_LIMIT = 100
export const emptyHistory = (): History => ({ past: [], present: new Map(), future: [] })
export function historyReducer(state: History, action: HistoryAction): History {
  if (action.type === 'undo') {
    if (!state.past.length) return state
    return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] }
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state
    return { past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: state.future[0], future: state.future.slice(1) }
  }
  const next = action.type === 'edit' ? editModel(state.present, action.mode, action.at, action.color)
    : action.type === 'restore' ? action.model : state.present.size ? new Map<string, Voxel>() : state.present
  if (next === state.present) return state
  return { past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: next, future: [] }
}
