import { Plane, Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three'
import { snapFloorPoint } from './placement'

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
export function pickRoomPosition(x: number, y: number, rect: ViewRect, camera: Camera) {
  const point = pointerRay(x,y,rect,camera).ray.intersectPlane(floorPlane, intersection)
  return point ? snapFloorPoint(point.x,point.z) : null
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
