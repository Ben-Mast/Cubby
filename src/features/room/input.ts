import { Plane, Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three'
import { snapFloorPoint } from './placement'
import { DEFAULT_ROOM_DIMENSIONS, type RoomDimensions } from './config'

type ViewRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
const raycaster = new Raycaster()
const pointer = new Vector2()
const floorPlane = new Plane(new Vector3(0,1,0),0)
const intersection = new Vector3()
function pointerRay(x: number, y: number, rect: ViewRect, camera: Camera) {
  pointer.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  return raycaster
}
export function pickRoomPosition(x: number, y: number, rect: ViewRect, camera: Camera, dimensions: RoomDimensions = DEFAULT_ROOM_DIMENSIONS) {
  const point = pointerRay(x,y,rect,camera).ray.intersectPlane(floorPlane, intersection)
  return point ? snapFloorPoint(point.x,point.z,dimensions) : null
}
export function pickRoomItem(x: number, y: number, rect: ViewRect, camera: Camera, scene: Object3D): string | null {
  for (const hit of pointerRay(x,y,rect,camera).intersectObject(scene,true)) {
    let object: Object3D | null = hit.object
    while (object) {
      if (typeof object.userData.placementId === 'string') return object.userData.placementId
      object = object.parent
    }
  }
  return null
}

export interface RoomPointerHandlers {
  pick: (x: number, y: number) => { id: string | null; position: { x: number; z: number } | null; selectedId?: string; placing: boolean }
  position: (x: number, y: number) => { x: number; z: number } | null
  setCameraDrag: (enabled: boolean) => void
  select: (id: string) => void
  startDrag: (id: string | null, position: { x: number; z: number } | null) => boolean
  drag: (position: { x: number; z: number }) => void
  endDrag: (position: { x: number; z: number } | null) => void
  cancelDrag: () => void
}

const TAP_DISTANCE = 8

export function bindRoomPointerInput(canvas: HTMLCanvasElement, handlers: RoomPointerHandlers) {
  const pointers = new Set<number>()
  const endTarget = canvas.ownerDocument ?? canvas
  let gesture: { pointerId: number; x: number; y: number; id: string | null; position: { x: number; z: number } | null;
    kind: 'camera' | 'selected' | 'placement'; moved: boolean; dragging: boolean } | null = null
  const down = (event: PointerEvent) => {
    pointers.add(event.pointerId)
    if (event.pointerType === 'touch' && pointers.size > 1) {
      if (gesture?.dragging) handlers.cancelDrag()
      gesture = null
      handlers.setCameraDrag(true)
      return
    }
    if (gesture || event.button !== 0) return
    const hit = handlers.pick(event.clientX, event.clientY)
    const kind = hit.placing ? 'placement' : hit.id && hit.id === hit.selectedId ? 'selected' : 'camera'
    const dragging = kind === 'placement' && handlers.startDrag(hit.id, hit.position)
    gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, id: hit.id, position: hit.position,
      kind: dragging ? 'placement' : kind === 'placement' ? 'camera' : kind, moved: false, dragging }
    handlers.setCameraDrag(gesture.kind === 'camera')
    if (gesture.kind !== 'camera') canvas.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent) => {
    const current = gesture
    if (!current || current.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) >= TAP_DISTANCE) current.moved = true
    if (current.kind === 'selected' && current.moved && !current.dragging)
      current.dragging = handlers.startDrag(current.id, current.position)
    if (current.dragging) {
      handlers.setCameraDrag(false)
      const position = handlers.position(event.clientX, event.clientY)
      if (position) handlers.drag(position)
    }
  }
  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (gesture?.pointerId === event.pointerId) {
      const current = gesture
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) >= TAP_DISTANCE) current.moved = true
      if (cancelled) { if (current.dragging) handlers.cancelDrag() }
      else if (current.dragging) handlers.endDrag(handlers.position(event.clientX, event.clientY))
      else if (!current.moved) handlers.select(current.id ?? '')
      gesture = null
      handlers.setCameraDrag(true)
    }
    pointers.delete(event.pointerId)
  }
  const up = (event: PointerEvent) => finish(event, false)
  const cancel = (event: PointerEvent) => finish(event, true)
  canvas.addEventListener('pointerdown', down, true)
  canvas.addEventListener('pointermove', move)
  endTarget.addEventListener('pointerup', up)
  endTarget.addEventListener('pointercancel', cancel)
  canvas.addEventListener('lostpointercapture', cancel)
  return () => {
    canvas.removeEventListener('pointerdown', down, true)
    canvas.removeEventListener('pointermove', move)
    endTarget.removeEventListener('pointerup', up)
    endTarget.removeEventListener('pointercancel', cancel)
    canvas.removeEventListener('lostpointercapture', cancel)
    handlers.setCameraDrag(true)
  }
}
