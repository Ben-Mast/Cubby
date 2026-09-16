import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { TOUCH, Vector3, type InstancedMesh, type PerspectiveCamera } from 'three'
import { EDITOR_SIZE } from '../voxel/model'
import { VoxelMesh } from '../voxel/VoxelMesh'
import { ROOM_DEPTH, ROOM_WIDTH, ROOM_WALL_HEIGHT, VOXEL_UNIT } from './config'
import { roomTransform, type RoomInstance } from './model'
import { placementBounds } from './placement'
import { bindEditInput } from '../voxel/input'
import { pickRoomItem, pickRoomPosition } from './input'

function FitRoomCamera() {
  const { camera, size, invalidate } = useThree()
  useLayoutEffect(() => {
    const perspective = camera as PerspectiveCamera
    const verticalHalfFov = perspective.fov * Math.PI / 360
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * size.width / size.height)
    // Fit the floor plus up to a full 16-voxel-tall model in portrait and landscape.
    const radius = Math.hypot(ROOM_WIDTH / 2, ROOM_DEPTH / 2,
      Math.max(1, EDITOR_SIZE * VOXEL_UNIT - 1, ROOM_WALL_HEIGHT - 1))
    const distance = radius / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov)) * 1.05
    const target = new Vector3(0, 1, 0)
    camera.position.sub(target).normalize().multiplyScalar(distance).add(target)
    camera.lookAt(target)
    invalidate()
  }, [camera, size.width, size.height, invalidate])
  return null
}

function FloorGrid() {
  const positions = useMemo(() => {
    const lines: number[] = []
    for (let x = 0; x <= ROOM_WIDTH; x++) lines.push(x - ROOM_WIDTH / 2, 0.005, -ROOM_DEPTH / 2, x - ROOM_WIDTH / 2, 0.005, ROOM_DEPTH / 2)
    for (let z = 0; z <= ROOM_DEPTH; z++) lines.push(-ROOM_WIDTH / 2, 0.005, z - ROOM_DEPTH / 2, ROOM_WIDTH / 2, 0.005, z - ROOM_DEPTH / 2)
    return new Float32Array(lines)
  }, [])
  return <lineSegments><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <lineBasicMaterial color="#aaa3cb" /></lineSegments>
}
export function PlacedVoxelModel({ instance, opacity = 1 }: {
  instance: RoomInstance; opacity?: number
}) {
  const meshRef = useRef<InstancedMesh>(null)
  const transform = roomTransform(instance.placement, instance.model)
  return <group position={transform.position} rotation={[0, transform.rotation, 0]} scale={transform.scale}
    userData={{ placementId: instance.placement.id }}>
    {/* Undo the editor renderer's X/Z centering; stored integer cells stay unchanged. */}
    <group position={[EDITOR_SIZE / 2, 0, EDITOR_SIZE / 2]}>
      <VoxelMesh voxels={instance.model.voxels} meshRef={meshRef} capacity={instance.model.voxels.length} opacity={opacity} />
    </group>
  </group>
}
function Footprint({ instance, color }: { instance: RoomInstance; color: string }) {
  const bounds = placementBounds(instance.model, instance.placement)
  return <mesh position={[(bounds.x + bounds.maxX) / 2 - ROOM_WIDTH / 2, 0.03, (bounds.z + bounds.maxZ) / 2 - ROOM_DEPTH / 2]}>
    <boxGeometry args={[bounds.maxX - bounds.x, 0.04, bounds.maxZ - bounds.z]} />
    <meshBasicMaterial color={color} wireframe depthTest={false} />
  </mesh>
}
export interface SharedRoomSceneProps {
  instances: readonly RoomInstance[]; selectedId?: string; preview?: RoomInstance | null; previewInvalid?: boolean
  cameraEnabled?: boolean; onSelect?: (id: string) => void; onPosition?: (position: { x: number; z: number }) => void
}
function RoomInput({ onSelect, onPosition }: Pick<SharedRoomSceneProps, 'onSelect' | 'onPosition'>) {
  const { gl, camera, scene } = useThree()
  useEffect(() => {
    if (!onSelect && !onPosition) return
    // Reuse editor tap/drag/multi-touch handling. Edits occur on release only.
    return bindEditInput(gl.domElement, (x,y) => {
      const rect = gl.domElement.getBoundingClientRect()
      scene.updateMatrixWorld(true)
      if (onPosition) {
        const at = pickRoomPosition(x,y,rect,camera)
        if (at) onPosition(at)
      } else if (onSelect) {
        const id = pickRoomItem(x,y,rect,camera,scene)
        onSelect(id ?? '')
      }
    })
  }, [gl,camera,scene,onSelect,onPosition])
  return null
}
export function SharedRoomScene({ instances, selectedId, preview, previewInvalid = false,
  cameraEnabled = true, onSelect, onPosition }: SharedRoomSceneProps) {
  return <div className={`scene room-scene ${cameraEnabled ? 'camera-active' : 'edit-active'}`} aria-label="Shared 3D room with floor grid and furniture">
    <Canvas camera={{ position: [15, 14, 15], fov: 45, near: 0.1, far: 120 }} dpr={[1, 1.5]}
      frameloop="demand" gl={{ antialias: true }} onCreated={({ camera }) => camera.lookAt(0, 1, 0)}>
      <color attach="background" args={['#e8e4ff']} />
      <FitRoomCamera />
      <ambientLight intensity={1.5} /><directionalLight position={[10, 15, 8]} intensity={2} />
      <mesh position={[0, -0.1, 0]}><boxGeometry args={[ROOM_WIDTH, 0.2, ROOM_DEPTH]} /><meshLambertMaterial color="#d9d5c8" /></mesh>
      <FloorGrid />
      <RoomInput onSelect={onSelect} onPosition={onPosition} />
      <mesh position={[0, ROOM_WALL_HEIGHT / 2, -ROOM_DEPTH / 2 - 0.075]}>
        <boxGeometry args={[ROOM_WIDTH, ROOM_WALL_HEIGHT, 0.15]} /><meshLambertMaterial color="#b9b1da" transparent opacity={0.4} depthWrite={false} /></mesh>
      <mesh position={[-ROOM_WIDTH / 2 - 0.075, ROOM_WALL_HEIGHT / 2, 0]}>
        <boxGeometry args={[0.15, ROOM_WALL_HEIGHT, ROOM_DEPTH]} /><meshLambertMaterial color="#b9b1da" transparent opacity={0.4} depthWrite={false} /></mesh>
      {instances.map(instance => <PlacedVoxelModel key={instance.placement.id} instance={instance} />)}
      {instances.filter(instance => instance.placement.id === selectedId).map(instance => <Footprint key={instance.placement.id} instance={instance} color="#5b4bdb" />)}
      {preview && <><PlacedVoxelModel instance={preview} opacity={0.65} />
        <Footprint instance={preview} color={previewInvalid ? '#c3304b' : '#13834b'} /></>}
      {/* No residual camera damping after switching into an editing mode. */}
      <OrbitControls makeDefault enabled={cameraEnabled} enablePan={false} enableDamping={false} target={[0, 1, 0]}
        minDistance={4} maxDistance={80} minPolarAngle={0.15} maxPolarAngle={Math.PI / 2 - 0.03}
        touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }} />
    </Canvas>
  </div>
}
