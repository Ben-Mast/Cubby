import { CanvasTexture, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three'
import { pixelsFromData, type SurfaceDesign } from './model'

export function surfaceTextureRepeat(surface: Pick<SurfaceDesign, 'width' | 'height'>, horizontalCells: number, verticalCells: number): [number, number] {
  return [horizontalCells / surface.width, verticalCells / surface.height]
}

export function makeSurfaceTexture(surface: SurfaceDesign, horizontalCells: number, verticalCells: number): CanvasTexture {
  const pixels = pixelsFromData(surface.pixel_data, surface.width, surface.height)
  const canvas = document.createElement('canvas')
  canvas.width = surface.width; canvas.height = surface.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to render surface pattern.')
  pixels.forEach((color, index) => {
    context.fillStyle = color
    context.fillRect(index % surface.width, Math.floor(index / surface.width), 1, 1)
  })
  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping
  texture.magFilter = NearestFilter; texture.minFilter = NearestFilter
  texture.colorSpace = SRGBColorSpace
  texture.repeat.set(...surfaceTextureRepeat(surface, horizontalCells, verticalCells))
  return texture
}
