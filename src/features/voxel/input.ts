export interface PrimaryPointerHandlers {
  start: (x: number, y: number, pointerType: string) => boolean
  move: (x: number, y: number) => void
  end: (x: number, y: number) => void
  cancel: () => void
}

// One primary pointer manipulates content. A second touch cancels that gesture and
// hands both pointers to OrbitControls until every pointer has been released.
export function bindPrimaryPointerInput(canvas: HTMLCanvasElement, handlers: PrimaryPointerHandlers) {
  const pointers = new Set<number>()
  let primary: number | null = null
  let cameraGesture = false

  const down = (event: PointerEvent) => {
    pointers.add(event.pointerId)
    if (event.pointerType === 'touch' && pointers.size > 1) {
      if (primary !== null) handlers.cancel()
      primary = null
      cameraGesture = true
      return
    }
    if (cameraGesture || primary !== null || event.button !== 0) return
    if (handlers.start(event.clientX, event.clientY, event.pointerType)) {
      primary = event.pointerId
      canvas.setPointerCapture(event.pointerId)
    }
  }
  const move = (event: PointerEvent) => {
    if (primary === event.pointerId && !cameraGesture) handlers.move(event.clientX, event.clientY)
  }
  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (primary === event.pointerId) {
      if (cancelled || cameraGesture) handlers.cancel()
      else handlers.end(event.clientX, event.clientY)
      primary = null
    }
    pointers.delete(event.pointerId)
    if (!pointers.size) cameraGesture = false
  }
  const up = (event: PointerEvent) => finish(event, false)
  const cancel = (event: PointerEvent) => finish(event, true)
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', cancel)
  canvas.addEventListener('lostpointercapture', cancel)
  return () => {
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', cancel)
    canvas.removeEventListener('lostpointercapture', cancel)
  }
}
