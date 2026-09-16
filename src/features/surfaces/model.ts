export type SurfaceType = 'floor' | 'wall'
export interface PixelData { version: 1; pixels: string[] }
export interface SurfaceDesign {
  id: string; home_id: string; creator_id: string; name: string; type: SurfaceType
  pixel_data: PixelData; width: number; height: number; created_at: string; updated_at: string
  creator?: { display_name: string } | null
}
export const DEFAULT_SURFACE_SIZE = 8
export const MAX_SURFACE_SIZE = 24
export const DEFAULT_PIXEL = '#ffffff'
const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
export const validSurfaceSize = (value: number) => Number.isInteger(value) && value >= 2 && value <= MAX_SURFACE_SIZE

export function validatePixels(width: number, height: number, pixels: readonly string[]): PixelData {
  if (!validSurfaceSize(width) || !validSurfaceSize(height)) throw new Error('Pattern size must be 2–24 cells per side.')
  if (pixels.length !== width * height || !pixels.every(validColor)) throw new Error('Pattern needs one valid color per cell.')
  return { version: 1, pixels: [...pixels] }
}
export function validateSurface(name: string, type: SurfaceType, width: number, height: number, pixels: readonly string[]) {
  if (!name.trim()) throw new Error('Enter a surface name.')
  if (type !== 'floor' && type !== 'wall') throw new Error('Choose a floor or wall design.')
  return { name: name.trim(), type, width, height, pixel_data: validatePixels(width, height, pixels) }
}
export function pixelsFromData(data: PixelData, width: number, height: number): string[] {
  if (data?.version !== 1 || !Array.isArray(data.pixels)) throw new Error('Unsupported surface format.')
  return validatePixels(width, height, data.pixels).pixels
}
export function resizePixels(pixels: readonly string[], oldWidth: number, oldHeight: number, width: number, height: number) {
  if (!validSurfaceSize(width) || !validSurfaceSize(height)) throw new Error('Pattern size must be 2–24 cells per side.')
  return Array.from({ length: width * height }, (_, index) => {
    const x = index % width, y = Math.floor(index / width)
    return x < oldWidth && y < oldHeight ? pixels[y * oldWidth + x] : DEFAULT_PIXEL
  })
}

/** Include every crossed cell when a pointer jumps between animation frames. */
export function cellsOnLine(start: number, end: number, width: number): number[] {
  const x0 = start % width, y0 = Math.floor(start / width)
  const x1 = end % width, y1 = Math.floor(end / width)
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  if (!steps) return [start]
  return Array.from({ length: steps + 1 }, (_, step) =>
    Math.round(y0 + (y1 - y0) * step / steps) * width + Math.round(x0 + (x1 - x0) * step / steps))
}

export interface PixelHistory { past: string[][]; present: string[]; future: string[][]; strokeBase: string[] | null }
export type PixelAction = { type: 'start' | 'end' | 'undo' | 'redo' | 'clear' } |
  { type: 'paint'; index: number; color: string } | { type: 'resize'; pixels: string[] }
export const initialPixelHistory = (pixels: string[]): PixelHistory => ({ past: [], present: pixels, future: [], strokeBase: null })
export function pixelReducer(state: PixelHistory, action: PixelAction): PixelHistory {
  if (action.type === 'resize') return initialPixelHistory(action.pixels)
  if (action.type === 'start') return state.strokeBase ? state : { ...state, strokeBase: state.present }
  if (action.type === 'paint') {
    if (!validColor(action.color) || action.index < 0 || action.index >= state.present.length ||
      !Number.isInteger(action.index) || state.present[action.index] === action.color) return state
    const present = [...state.present]; present[action.index] = action.color
    return { ...state, present }
  }
  if (action.type === 'end') {
    if (!state.strokeBase) return state
    return state.strokeBase === state.present ? { ...state, strokeBase: null } :
      { past: [...state.past, state.strokeBase].slice(-100), present: state.present, future: [], strokeBase: null }
  }
  if (action.type === 'clear') {
    if (state.present.every(color => color === DEFAULT_PIXEL)) return state
    return { past: [...state.past, state.present].slice(-100), present: state.present.map(() => DEFAULT_PIXEL), future: [], strokeBase: null }
  }
  if (action.type === 'undo' && state.past.length) return { past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future], strokeBase: null }
  if (action.type === 'redo' && state.future.length) return { past: [...state.past, state.present].slice(-100), present: state.future[0], future: state.future.slice(1), strokeBase: null }
  return state
}
