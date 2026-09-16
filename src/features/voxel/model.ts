export const EDITOR_SIZE = 16
export const MAX_EDITOR_DIMENSION = 24
export type VoxelSize = [number, number, number]
export const DEFAULT_VOXEL_SIZE: VoxelSize = [EDITOR_SIZE, EDITOR_SIZE, EDITOR_SIZE]
export interface Coordinate { x: number; y: number; z: number }
export interface Voxel extends Coordinate { color: string }
export interface VoxelData { version: 1; size: VoxelSize; voxels: Voxel[] }
export type VoxelModel = ReadonlyMap<string, Voxel>
export type EditMode = 'add' | 'delete' | 'paint'
export type BrushMode = 'stroke' | 'rectangle'
export const coordinateKey = ({ x, y, z }: Coordinate) => `${x},${y},${z}`
export const validVoxelSize = (size: readonly number[]) => size.length === 3 &&
  size.every(value => Number.isInteger(value) && value >= 1 && value <= MAX_EDITOR_DIMENSION)
export const inBounds = ({ x, y, z }: Coordinate, size: VoxelSize = DEFAULT_VOXEL_SIZE) =>
  [x, y, z].every((value, axis) => Number.isInteger(value) && value >= 0 && value < size[axis])
export const validColor = (color: string) => /^#[\da-f]{6}$/i.test(color)

export function editModel(model: VoxelModel, mode: EditMode, at: Coordinate, color: string,
  size: VoxelSize = DEFAULT_VOXEL_SIZE): VoxelModel {
  if (!inBounds(at, size) || !validColor(color)) return model
  const key = coordinateKey(at)
  const existing = model.get(key)
  if ((mode === 'add' && existing) || (mode !== 'add' && !existing) ||
      (mode === 'paint' && existing?.color === color)) return model
  const next = new Map(model)
  if (mode === 'delete') next.delete(key)
  else next.set(key, { x: at.x, y: at.y, z: at.z, color })
  return next
}

export function editRectangle(model: VoxelModel, mode: EditMode, cells: readonly Coordinate[], color: string,
  size: VoxelSize = DEFAULT_VOXEL_SIZE): VoxelModel {
  if (!validColor(color)) return model
  let next: Map<string, Voxel> | null = null
  for (const at of cells) {
    if (!inBounds(at, size)) continue
    const key = coordinateKey(at)
    const existing = (next ?? model).get(key)
    if ((mode === 'add' && existing) || (mode !== 'add' && !existing) ||
        (mode === 'paint' && existing?.color === color)) continue
    next ??= new Map(model)
    if (mode === 'delete') next.delete(key)
    else next.set(key, { ...at, color })
  }
  return next ?? model
}

export function serializeModel(model: VoxelModel, size: VoxelSize = DEFAULT_VOXEL_SIZE): string {
  const data: VoxelData = { version: 1, size,
    voxels: [...model.values()].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z) }
  const json = JSON.stringify(data)
  deserializeModel(json)
  return json
}

export function deserializeModel(json: string): VoxelModel {
  const data = JSON.parse(json)
  if (!data || data.version !== 1 || !Array.isArray(data.size) || data.size.length !== 3 ||
      !validVoxelSize(data.size) || !Array.isArray(data.voxels) ||
      data.voxels.length > data.size[0] * data.size[1] * data.size[2]) throw new Error('Unsupported voxel format.')
  const model = new Map<string, Voxel>()
  for (const voxel of data.voxels) {
    if (!voxel || !inBounds(voxel, data.size) || typeof voxel.color !== 'string' || !validColor(voxel.color))
      throw new Error('Voxels need in-bounds integer coordinates and a six-digit hex color.')
    const key = coordinateKey(voxel)
    if (model.has(key)) throw new Error('Duplicate voxel coordinates.')
    model.set(key, { x: voxel.x, y: voxel.y, z: voxel.z, color: voxel.color })
  }
  return model
}

export interface History {
  past: VoxelModel[]
  present: VoxelModel
  future: VoxelModel[]
  strokeBase: VoxelModel | null
}
export type HistoryAction = { type: 'edit' | 'stroke-edit'; mode: EditMode; at: Coordinate; color: string; size?: VoxelSize }
  | { type: 'rectangle'; mode: EditMode; cells: Coordinate[]; color: string; size?: VoxelSize }
  | { type: 'stroke-start' | 'stroke-end' | 'stroke-cancel' }
  | { type: 'restore'; model: VoxelModel }
  | { type: 'undo' | 'redo' | 'clear' | 'dimension-change' }
export const HISTORY_LIMIT = 100
export const emptyHistory = (): History => ({ past: [], present: new Map(), future: [], strokeBase: null })
export function historyReducer(state: History, action: HistoryAction): History {
  if (action.type === 'dimension-change') return { past: [], present: state.present, future: [], strokeBase: null }
  if (action.type === 'stroke-start') {
    if (state.strokeBase) return state
    return { ...state, strokeBase: state.present }
  }
  if (action.type === 'stroke-edit') {
    if (!state.strokeBase) return state
    return { ...state, present: editModel(state.present, action.mode, action.at, action.color, action.size) }
  }
  if (action.type === 'stroke-cancel') {
    if (!state.strokeBase) return state
    return { ...state, present: state.strokeBase, strokeBase: null }
  }
  if (action.type === 'stroke-end') {
    if (!state.strokeBase) return state
    if (state.strokeBase === state.present) return { ...state, strokeBase: null }
    return {
      past: [...state.past, state.strokeBase].slice(-HISTORY_LIMIT),
      present: state.present,
      future: [],
      strokeBase: null,
    }
  }
  if (action.type === 'undo') {
    if (state.strokeBase || !state.past.length) return state
    return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future], strokeBase: null }
  }
  if (action.type === 'redo') {
    if (state.strokeBase || !state.future.length) return state
    return { past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: state.future[0], future: state.future.slice(1), strokeBase: null }
  }
  const next = action.type === 'edit' ? editModel(state.present, action.mode, action.at, action.color, action.size)
    : action.type === 'rectangle' ? editRectangle(state.present, action.mode, action.cells, action.color, action.size)
    : action.type === 'restore' ? action.model : state.present.size ? new Map<string, Voxel>() : state.present
  if (next === state.present) return state
  return { past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: next, future: [], strokeBase: null }
}
