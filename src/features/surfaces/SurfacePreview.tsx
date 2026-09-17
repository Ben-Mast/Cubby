import { useEffect, useRef } from 'react'
import { pixelsFromData, type SurfaceDesign } from './model'

export function drawSurfacePreview(context: CanvasRenderingContext2D, surface: SurfaceDesign) {
  const pixels = pixelsFromData(surface.pixel_data, surface.width, surface.height)
  const tile = document.createElement('canvas')
  tile.width = surface.width; tile.height = surface.height
  const tileContext = tile.getContext('2d')
  if (!tileContext) return
  pixels.forEach((color, index) => {
    tileContext.fillStyle = color
    tileContext.fillRect(index % surface.width, Math.floor(index / surface.width), 1, 1)
  })
  const pattern = context.createPattern(tile, 'repeat')
  if (!pattern) return
  context.imageSmoothingEnabled = false
  // At least two repeats are visible, including on the largest allowed pattern.
  const cell = Math.max(2, Math.floor(128 / (2 * Math.max(surface.width, surface.height))))
  context.clearRect(0, 0, 128, 128)
  context.save(); context.scale(cell, cell)
  context.fillStyle = pattern
  context.fillRect(0, 0, 128 / cell, 128 / cell)
  context.restore()
}

export function SurfacePreview({ surface }: { surface: SurfaceDesign }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    drawSurfacePreview(context, surface)
  }, [surface.pixel_data, surface.width, surface.height])
  return <canvas ref={canvas} className="library-preview surface-preview" width="128" height="128" role="img" aria-label={`${surface.name} repeating pattern preview`} />
}
