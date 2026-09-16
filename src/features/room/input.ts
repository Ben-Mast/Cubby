import { Plane, Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three'
import { snapFloorPoint } from './placement'

type ViewRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
function pointerRay(x: number, y: number, rect: ViewRect, camera: Camera) {
  const raycaster = new Raycaster()
  raycaster.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), camera)
  return raycaster
}
export function pickRoomPosition(x: number, y: number, rect: ViewRect, camera: Camera) {
  const point = pointerRay(x,y,rect,camera).ray.intersectPlane(new Plane(new Vector3(0,1,0),0), new Vector3())
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
