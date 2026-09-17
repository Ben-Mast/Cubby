import { supabase } from '../../lib/supabase/client'
import { coordinateKey, type VoxelModel } from '../voxel/model'

export const THUMBNAIL_BUCKET = 'furniture-thumbnails'
const IMAGE_SIZE = 256

type Point = { x: number; y: number; z: number }
const project = ({ x, y, z }: Point) => ({ x: (x - z) * Math.sqrt(3) / 2, y: (x + z) / 2 - y })
function shade(hex: string, factor: number): string {
  const channels = [1, 3, 5].map(index => Math.round(parseInt(hex.slice(index, index + 2), 16) * factor))
  return `rgb(${channels.join(',')})`
}

/** One-off, browser-side isometric render. The library only loads the saved image. */
export async function renderFurnitureThumbnail(model: VoxelModel): Promise<Blob> {
  if (!model.size) throw new Error('Empty furniture has no thumbnail.')
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = IMAGE_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable.')
  const voxels = [...model.values()]
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const { x, y, z } of voxels) {
    for (const corner of [
      { x, y, z }, { x: x + 1, y, z }, { x, y: y + 1, z },
      { x, y, z: z + 1 }, { x: x + 1, y: y + 1, z: z + 1 },
    ]) {
      const point = project(corner)
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y)
    }
  }
  const scale = Math.min(216 / Math.max(maxX - minX, 1), 216 / Math.max(maxY - minY, 1))
  const draw = (points: Point[], color: string) => {
    context.fillStyle = color
    context.beginPath()
    points.forEach((point, index) => {
      const projected = project(point)
      const px = IMAGE_SIZE / 2 + (projected.x - (minX + maxX) / 2) * scale
      const py = IMAGE_SIZE / 2 + (projected.y - (minY + maxY) / 2) * scale
      if (index) context.lineTo(px, py); else context.moveTo(px, py)
    })
    context.closePath(); context.fill()
  }
  voxels.sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z))
  for (const voxel of voxels) {
    const { x, y, z, color } = voxel
    const neighbor = (dx: number, dy: number, dz: number) => model.has(coordinateKey({ x: x + dx, y: y + dy, z: z + dz }))
    if (!neighbor(0, 0, 1)) draw([{ x, y, z: z + 1 }, { x: x + 1, y, z: z + 1 }, { x: x + 1, y: y + 1, z: z + 1 }, { x, y: y + 1, z: z + 1 }], shade(color, 0.7))
    if (!neighbor(1, 0, 0)) draw([{ x: x + 1, y, z }, { x: x + 1, y, z: z + 1 }, { x: x + 1, y: y + 1, z: z + 1 }, { x: x + 1, y: y + 1, z }], shade(color, 0.85))
    if (!neighbor(0, 1, 0)) draw([{ x, y: y + 1, z }, { x: x + 1, y: y + 1, z }, { x: x + 1, y: y + 1, z: z + 1 }, { x, y: y + 1, z: z + 1 }], shade(color, 1))
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to encode thumbnail.')), 'image/webp', 0.85))
}

export async function uploadFurnitureThumbnail(homeId: string, furnitureId: string, model: VoxelModel): Promise<string> {
  const blob = await renderFurnitureThumbnail(model)
  const extension = blob.type === 'image/webp' ? 'webp' : 'png'
  const path = `${homeId}/${furnitureId}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from(THUMBNAIL_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false })
  if (error) throw error
  return path
}

export async function removeFurnitureThumbnail(path: string): Promise<void> {
  const { error } = await supabase.storage.from(THUMBNAIL_BUCKET).remove([path])
  if (error) throw error
}

export async function furnitureThumbnailUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(THUMBNAIL_BUCKET).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) throw error ?? new Error('Thumbnail unavailable.')
  return data.signedUrl
}
