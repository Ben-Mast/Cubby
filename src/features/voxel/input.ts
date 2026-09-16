import { EditGesture } from './targeting'

export function bindEditInput(canvas: HTMLCanvasElement, edit: (x: number, y: number) => void) {
  const gesture = new EditGesture()
  const down = (event: PointerEvent) => {
    gesture.down(event.pointerId, event.clientX, event.clientY, event.button)
    canvas.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent) => gesture.move(event.pointerId, event.clientX, event.clientY)
  const up = (event: PointerEvent) => {
    if (gesture.up(event.pointerId, event.clientX, event.clientY)) edit(event.clientX, event.clientY)
  }
  const cancel = (event: PointerEvent) => gesture.cancel(event.pointerId)
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
