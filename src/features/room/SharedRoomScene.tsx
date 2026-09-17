import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { MOUSE, TOUCH, Vector3, type InstancedMesh, type Mesh, type MeshLambertMaterial, type PerspectiveCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { VoxelMesh } from '../voxel/VoxelMesh'
import { DEFAULT_ROOM_DIMENSIONS, VOXEL_UNIT, type RoomDimensions } from './config'
import { roomTransform, type RoomInstance } from './model'
import { placementBounds } from './placement'
import { bindRoomPointerInput, pickRoomItem, pickRoomPosition } from './input'
import { hiddenWallsForCamera, ROOM_WALLS, roomWallBoxes, skipWallRaycast, type RoomWall } from './walls'
import { makeSurfaceTexture } from '../surfaces/texture'
import type { SurfaceDesign } from '../surfaces/model'

const WALL_FADE_SECONDS = 0.14

function useSurfaceTexture(surface: SurfaceDesign | null | undefined, horizontal: number, vertical: number) {
  const texture = useMemo(() => surface ? makeSurfaceTexture(surface, horizontal, vertical) : null,
    [surface, horizontal, vertical])
  useEffect(() => () => { texture?.dispose() }, [texture])
  return texture
}

function RoomWalls({ dimensions, surface }: { dimensions: RoomDimensions; surface?: SurfaceDesign | null }) {
  const { camera, invalidate } = useThree()
  const widthTexture = useSurfaceTexture(surface, dimensions.width, dimensions.height)
  const depthTexture = useSurfaceTexture(surface, dimensions.depth, dimensions.height)
  const hidden = useRef(hiddenWallsForCamera(camera.position.x, camera.position.z))
  const meshes = useRef<Record<RoomWall, Mesh | null>>({ front: null, back: null, left: null, right: null })
  const materials = useRef<Record<RoomWall, MeshLambertMaterial | null>>({ front: null, back: null, left: null, right: null })
  const boxes = useMemo(() => roomWallBoxes(dimensions), [dimensions.width, dimensions.depth, dimensions.height])

  useEffect(() => {
    // A map arriving after the first frame changes the material shader defines.
    // In demand-render mode, neither that change nor a new CanvasTexture draws a frame by itself.
    for (const wall of ROOM_WALLS) if (materials.current[wall]) materials.current[wall]!.needsUpdate = true
    invalidate()
  }, [widthTexture, depthTexture, invalidate])

  useFrame(({ camera }, delta) => {
    hidden.current = hiddenWallsForCamera(camera.position.x, camera.position.z, hidden.current)
    for (const wall of ROOM_WALLS) {
      const mesh = meshes.current[wall], material = materials.current[wall]
      if (!mesh || !material) continue
      const target = wall === hidden.current.x || wall === hidden.current.z ? 0 : 1
      const next = material.opacity + Math.sign(target - material.opacity) *
        Math.min(Math.abs(target - material.opacity), delta / WALL_FADE_SECONDS)
      if (next !== material.opacity) {
        const solid = next === 1
        if (material.transparent === solid) {
          material.transparent = !solid
          material.depthWrite = solid
          material.needsUpdate = true
        }
        material.opacity = next
        mesh.visible = next > 0
        invalidate()
      }
    }
  })

  return <>{ROOM_WALLS.map(wall => {
    const initiallyHidden = wall === hidden.current.x || wall === hidden.current.z
    return <mesh key={wall} ref={mesh => { meshes.current[wall] = mesh }} position={boxes[wall].position}
      visible={!initiallyHidden} raycast={skipWallRaycast} userData={{ roomWall: wall }}>
      <boxGeometry args={boxes[wall].size} />
      <meshLambertMaterial ref={material => { materials.current[wall] = material }}
        color={surface ? '#ffffff' : '#c8c1df'} map={surface ? (wall === 'front' || wall === 'back' ? widthTexture : depthTexture) : null}
        opacity={initiallyHidden ? 0 : 1} transparent={initiallyHidden} depthWrite={!initiallyHidden} />
    </mesh>
  })}</>
}

function RoomFloor({ dimensions, surface }: { dimensions: RoomDimensions; surface?: SurfaceDesign | null }) {
  const texture = useSurfaceTexture(surface, dimensions.width, dimensions.depth)
  const { invalidate } = useThree()
  const material = useRef<MeshLambertMaterial>(null)
  useEffect(() => {
    if (material.current) material.current.needsUpdate = true
    invalidate()
  }, [texture, invalidate])
  return <mesh position={[0, -0.1, 0]}>
    <boxGeometry args={[dimensions.width * VOXEL_UNIT, 0.2, dimensions.depth * VOXEL_UNIT]} />
    <meshLambertMaterial ref={material} color={surface ? '#ffffff' : '#d9d5c8'} map={texture} />
  </mesh>
}

function FitRoomCamera({ dimensions }: { dimensions: RoomDimensions }) {
  const { camera, size, invalidate } = useThree()
  useLayoutEffect(() => {
    const perspective = camera as PerspectiveCamera
    const verticalHalfFov = perspective.fov * Math.PI / 360
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * size.width / size.height)
    const radius = Math.hypot(dimensions.width * VOXEL_UNIT / 2, dimensions.depth * VOXEL_UNIT / 2,
      Math.max(1, dimensions.height * VOXEL_UNIT - 1))
    const distance = radius / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov)) * 1.05
    const target = new Vector3(0, Math.min(1, dimensions.height * VOXEL_UNIT / 2), 0)
    camera.position.sub(target).normalize().multiplyScalar(distance).add(target)
    camera.lookAt(target)
    invalidate()
  }, [camera, size.width, size.height, dimensions.width, dimensions.depth, dimensions.height, invalidate])
  return null
}

export function PlacedVoxelModel({ instance, dimensions = DEFAULT_ROOM_DIMENSIONS, opacity = 1 }: { instance: RoomInstance; dimensions?: RoomDimensions; opacity?: number }) {
  const meshRef = useRef<InstancedMesh>(null)
  const transform = roomTransform(instance.placement, instance.model, dimensions)
  return <group position={transform.position} rotation={[0, transform.rotation, 0]} scale={transform.scale}
    userData={{ placementId: instance.placement.id }}>
    <group position={[instance.model.size[0] / 2, 0, instance.model.size[2] / 2]}>
      <VoxelMesh voxels={instance.model.voxels} size={instance.model.size} meshRef={meshRef} capacity={instance.model.voxels.length} opacity={opacity} />
    </group>
  </group>
}
function Footprint({ instance, color, dimensions }: { instance: RoomInstance; color: string; dimensions: RoomDimensions }) {
  const bounds = placementBounds(instance.model, instance.placement)
  return <mesh position={[(bounds.x + bounds.maxX) * VOXEL_UNIT / 2 - dimensions.width * VOXEL_UNIT / 2,
    bounds.y * VOXEL_UNIT + 0.03, (bounds.z + bounds.maxZ) * VOXEL_UNIT / 2 - dimensions.depth * VOXEL_UNIT / 2]}>
    <boxGeometry args={[(bounds.maxX - bounds.x) * VOXEL_UNIT, 0.04, (bounds.maxZ - bounds.z) * VOXEL_UNIT]} />
    <meshBasicMaterial color={color} wireframe depthTest={false} />
  </mesh>
}
export interface SharedRoomSceneProps {
  dimensions?: RoomDimensions
  floorSurface?: SurfaceDesign | null
  wallSurface?: SurfaceDesign | null
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
function RoomInput(props: Pick<SharedRoomSceneProps, 'dimensions' | 'disabled' | 'selectedId' | 'preview' | 'onSelect' | 'onDragStart' | 'onDrag' | 'onDragEnd' | 'onDragCancel'> & {
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
      const position = pickRoomPosition(x, y, rect, camera, latest.current.dimensions)
      return { id, position, selectedId: latest.current.selectedId,
        placing: Boolean(latest.current.preview) && !latest.current.disabled }
    },
    position: (x, y) => pickRoomPosition(x, y, gl.domElement.getBoundingClientRect(), camera, latest.current.dimensions),
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
export function SharedRoomScene({ instances, dimensions = DEFAULT_ROOM_DIMENSIONS, floorSurface, wallSurface,
  selectedId, preview, previewInvalid = false, ...input }: SharedRoomSceneProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const mouseButtons = useMemo(() => ({ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }), [])
  const touches = useMemo(() => ({ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE }), [])
  return <div className="scene room-scene" aria-label="Shared 3D room with furniture">
    <Canvas camera={{ position: [15, 14, 15], fov: 45, near: 0.1, far: 500 }} dpr={[1, 1.5]}
      frameloop="demand" gl={{ antialias: true }} onCreated={({ camera }) => camera.lookAt(0, 1, 0)}>
      <color attach="background" args={['#e8e4ff']} />
      <FitRoomCamera dimensions={dimensions} />
      <ambientLight intensity={1.5} /><directionalLight position={[10, 15, 8]} intensity={2} />
      <RoomFloor dimensions={dimensions} surface={floorSurface} />
      <RoomInput {...input} dimensions={dimensions} selectedId={selectedId} preview={preview} controlsRef={controlsRef} />
      <RoomWalls dimensions={dimensions} surface={wallSurface} />
      {instances.map(instance => <PlacedVoxelModel key={instance.placement.id} instance={instance} dimensions={dimensions} />)}
      {instances.filter(instance => instance.placement.id === selectedId).map(instance => <Footprint key={instance.placement.id} instance={instance} color="#5b4bdb" dimensions={dimensions} />)}
      {preview && <><PlacedVoxelModel instance={preview} dimensions={dimensions} opacity={0.65} />
        <Footprint instance={preview} dimensions={dimensions} color={previewInvalid ? '#c3304b' : '#13834b'} /></>}
      <OrbitControls ref={controlsRef} makeDefault enablePan={false} enableDamping={false} target={[0, Math.min(1, dimensions.height * VOXEL_UNIT / 2), 0]}
        minDistance={2} maxDistance={Math.max(dimensions.width, dimensions.depth, dimensions.height) * VOXEL_UNIT * 6} minPolarAngle={0.15} maxPolarAngle={Math.PI / 2 - 0.03}
        mouseButtons={mouseButtons} touches={touches} />
    </Canvas>
  </div>
}
