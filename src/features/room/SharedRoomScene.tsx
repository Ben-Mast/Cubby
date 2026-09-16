import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { MOUSE, TOUCH, Vector3, type InstancedMesh, type PerspectiveCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { EDITOR_SIZE } from '../voxel/model'
import { VoxelMesh } from '../voxel/VoxelMesh'
import { ROOM_DEPTH, ROOM_WIDTH, ROOM_WALL_HEIGHT, VOXEL_UNIT } from './config'
import { roomTransform, type RoomInstance } from './model'
import { placementBounds } from './placement'
import { bindRoomPointerInput, pickRoomItem, pickRoomPosition } from './input'

function FitRoomCamera() {
  const { camera, size, invalidate } = useThree()
  useLayoutEffect(() => {
    const perspective = camera as PerspectiveCamera
    const verticalHalfFov = perspective.fov * Math.PI / 360
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * size.width / size.height)
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
export function PlacedVoxelModel({ instance, opacity = 1 }: { instance: RoomInstance; opacity?: number }) {
  const meshRef = useRef<InstancedMesh>(null)
  const transform = roomTransform(instance.placement, instance.model)
  return <group position={transform.position} rotation={[0, transform.rotation, 0]} scale={transform.scale}
    userData={{ placementId: instance.placement.id }}>
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
  instances: readonly RoomInstance[]
  selectedId?: string
  preview?: RoomInstance | null
  previewInvalid?: boolean
  disabled?: boolean
  onSelect?: (id: string) => void
  onDragStart?: (id: string | null, position: { x: number; z: number } | null) => boolean
  onDrag?: (position: { x: number; z: number }) => void
  onDragEnd?: (position: { x: number; z: number } | null) => void
  onDragCancel?: () => void
}
function RoomInput(props: Pick<SharedRoomSceneProps, 'disabled' | 'selectedId' | 'preview' | 'onSelect' | 'onDragStart' | 'onDrag' | 'onDragEnd' | 'onDragCancel'> & {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
}) {
  const { gl, camera, scene } = useThree()
  const latest = useRef(props)
  latest.current = props
  useEffect(() => bindRoomPointerInput(gl.domElement, {
    pick: (x, y) => {
      const rect = gl.domElement.getBoundingClientRect()
      scene.updateMatrixWorld(true)
      const id = pickRoomItem(x, y, rect, camera, scene)
      const position = pickRoomPosition(x, y, rect, camera)
      return { id, position, selectedId: latest.current.selectedId,
        placing: Boolean(latest.current.preview) && !latest.current.disabled }
    },
    position: (x, y) => pickRoomPosition(x, y, gl.domElement.getBoundingClientRect(), camera),
    setCameraDrag: enabled => {
      const controls = latest.current.controlsRef.current
      if (controls) {
        controls.mouseButtons.LEFT = enabled ? MOUSE.ROTATE : -1 as MOUSE
        controls.touches.ONE = enabled ? TOUCH.ROTATE : -1 as TOUCH
      }
    },
    select: id => { if (!latest.current.disabled) latest.current.onSelect?.(id) },
    startDrag: (id, position) => latest.current.onDragStart?.(id, position) ?? false,
    drag: position => latest.current.onDrag?.(position),
    endDrag: position => latest.current.onDragEnd?.(position),
    cancelDrag: () => latest.current.onDragCancel?.(),
  }), [camera, gl, scene])
  return null
}
export function SharedRoomScene({ instances, selectedId, preview, previewInvalid = false, ...input }: SharedRoomSceneProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const mouseButtons = useMemo(() => ({ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }), [])
  const touches = useMemo(() => ({ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE }), [])
  return <div className="scene room-scene" aria-label="Shared 3D room with floor grid and furniture">
    <Canvas camera={{ position: [15, 14, 15], fov: 45, near: 0.1, far: 120 }} dpr={[1, 1.5]}
      frameloop="demand" gl={{ antialias: true }} onCreated={({ camera }) => camera.lookAt(0, 1, 0)}>
      <color attach="background" args={['#e8e4ff']} />
      <FitRoomCamera />
      <ambientLight intensity={1.5} /><directionalLight position={[10, 15, 8]} intensity={2} />
      <mesh position={[0, -0.1, 0]}><boxGeometry args={[ROOM_WIDTH, 0.2, ROOM_DEPTH]} /><meshLambertMaterial color="#d9d5c8" /></mesh>
      <FloorGrid />
      <RoomInput {...input} selectedId={selectedId} preview={preview} controlsRef={controlsRef} />
      <mesh position={[0, ROOM_WALL_HEIGHT / 2, -ROOM_DEPTH / 2 - 0.075]}>
        <boxGeometry args={[ROOM_WIDTH, ROOM_WALL_HEIGHT, 0.15]} /><meshLambertMaterial color="#b9b1da" transparent opacity={0.4} depthWrite={false} /></mesh>
      <mesh position={[-ROOM_WIDTH / 2 - 0.075, ROOM_WALL_HEIGHT / 2, 0]}>
        <boxGeometry args={[0.15, ROOM_WALL_HEIGHT, ROOM_DEPTH]} /><meshLambertMaterial color="#b9b1da" transparent opacity={0.4} depthWrite={false} /></mesh>
      {instances.map(instance => <PlacedVoxelModel key={instance.placement.id} instance={instance} />)}
      {instances.filter(instance => instance.placement.id === selectedId).map(instance => <Footprint key={instance.placement.id} instance={instance} color="#5b4bdb" />)}
      {preview && <><PlacedVoxelModel instance={preview} opacity={0.65} />
        <Footprint instance={preview} color={previewInvalid ? '#c3304b' : '#13834b'} /></>}
      <OrbitControls ref={controlsRef} makeDefault enablePan={false} enableDamping={false} target={[0, 1, 0]}
        minDistance={4} maxDistance={80} minPolarAngle={0.15} maxPolarAngle={Math.PI / 2 - 0.03}
        mouseButtons={mouseButtons} touches={touches} />
    </Canvas>
  </div>
}
