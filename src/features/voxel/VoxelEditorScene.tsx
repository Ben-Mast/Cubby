import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import { MOUSE, TOUCH, Vector3, type InstancedMesh, type PerspectiveCamera } from 'three'
import { coordinateKey, DEFAULT_VOXEL_SIZE, type BrushMode, type Coordinate, type EditMode, type Voxel, type VoxelModel, type VoxelSize } from './model'
import { createStrokeSnapshotMesh, pickFaceTarget, pickLockedTarget, pickStrokeStart, rectangleCoordinates, rectanglePreview,
  strokeCoordinates, supportedStrokeAdd, type FaceTarget, type StrokeTarget } from './targeting'
import { bindPrimaryPointerInput } from './input'
import { VoxelMesh } from './VoxelMesh'

interface SceneProps {
  model: VoxelModel
  size?: VoxelSize
  mode: EditMode | 'camera'
  brushMode: BrushMode
  color: string
  onStrokeStart: () => void
  onStrokeEdit: (at: Coordinate, mode?: EditMode, color?: string) => void
  onStrokeEnd: () => void
  onStrokeCancel: () => void
  onRectangle: (cells: Coordinate[], mode: EditMode, color: string) => void
}

function EditorScene({ model, size = DEFAULT_VOXEL_SIZE, mode, brushMode, color, onStrokeStart, onStrokeEdit, onStrokeEnd, onStrokeCancel, onRectangle }: SceneProps) {
  const meshRef = useRef<InstancedMesh>(null)
  const previewMeshRef = useRef<InstancedMesh>(null)
  const [preview, setPreview] = useState<Voxel[]>([])
  const voxels = useMemo(() => [...model.values()], [model])
  const latest = useRef({ model, size, voxels, mode, brushMode, color, onStrokeStart, onStrokeEdit, onStrokeEnd, onStrokeCancel, onRectangle })
  latest.current = { model, size, voxels, mode, brushMode, color, onStrokeStart, onStrokeEdit, onStrokeEnd, onStrokeCancel, onRectangle }
  const stroke = useRef<{ target: StrokeTarget | null; last: Coordinate; face: FaceTarget | null; seen: Set<string>; begun: boolean;
    snapshotMesh: InstancedMesh | null; snapshotVoxels: readonly Voxel[] | null; snapshotKeys: ReadonlySet<string> | null;
    brushMode: BrushMode; mode: EditMode; color: string } | null>(null)
  const { gl, camera } = useThree()

  useEffect(() => bindPrimaryPointerInput(gl.domElement, {
    start: (x, y) => {
      const { brushMode, mode, color, model, voxels, size } = latest.current
      if (mode === 'camera' || !meshRef.current) return false
      const rect = gl.domElement.getBoundingClientRect()
      const snapshotVoxels = brushMode === 'stroke' && mode === 'add' ? [...voxels] : null
      const snapshotMesh = snapshotVoxels ? createStrokeSnapshotMesh(meshRef.current, snapshotVoxels, size) : null
      const target = brushMode === 'rectangle' ? pickStrokeStart(x, y, rect, camera, meshRef.current, voxels, mode, size) : null
      const face = brushMode === 'stroke' ? pickFaceTarget(x, y, rect, camera, snapshotMesh ?? meshRef.current,
        snapshotVoxels ?? voxels, mode, size) : null
      const start = target?.at ?? face?.at
      if (!start) return false
      stroke.current = { target, last: start, face, seen: new Set(), begun: false, brushMode, mode, color,
        snapshotMesh, snapshotVoxels, snapshotKeys: snapshotVoxels ? new Set(snapshotVoxels.map(coordinateKey)) : null }
      if (target) setPreview(rectanglePreview(start, start, target.lockedAxis, model, mode, color, size))
      return true
    },
    move: (x, y) => {
      const active = stroke.current
      if (!active) return
      if (active.brushMode === 'rectangle') {
        const target = active.target!
        const at = pickLockedTarget(x, y, gl.domElement.getBoundingClientRect(), camera, target, true, latest.current.size)
        if (!at) return
        active.last = at
        setPreview(rectanglePreview(target.at, at, target.lockedAxis,
          latest.current.model, active.mode, active.color, latest.current.size))
        return
      }
      const face = pickFaceTarget(x, y, gl.domElement.getBoundingClientRect(), camera, active.snapshotMesh ?? meshRef.current!,
        active.snapshotVoxels ?? latest.current.voxels, active.mode, latest.current.size)
      if (!face) return
      if (!active.begun) { latest.current.onStrokeStart(); active.begun = true }
      // Interpolate on one face only; Add candidates must be backed by the stroke-start structure.
      const previous = active.face!
      const candidates = [previous, ...strokeCoordinates(previous, face).map(at => ({ ...face, at }))]
      for (const candidate of candidates) {
        const key = coordinateKey(candidate.at)
        if (active.seen.has(key) || (active.snapshotKeys && !supportedStrokeAdd(candidate.at, candidate, active.snapshotKeys))) continue
        active.seen.add(key)
        latest.current.onStrokeEdit(candidate.at, active.mode, active.color)
      }
      active.last = face.at; active.face = face
    },
    end: (x, y) => {
      const active = stroke.current
      if (!active) return
      if (active.brushMode === 'rectangle') {
        const target = active.target!
        const at = pickLockedTarget(x, y, gl.domElement.getBoundingClientRect(), camera, target, true, latest.current.size) ?? active.last
        setPreview([])
        latest.current.onRectangle(rectangleCoordinates(target.at, at, target.lockedAxis, latest.current.size), active.mode, active.color)
        stroke.current = null
        return
      }
      if (!active.begun) { latest.current.onStrokeStart(); latest.current.onStrokeEdit(active.last, active.mode, active.color) }
      latest.current.onStrokeEnd()
      stroke.current = null
    },
    cancel: () => {
      if (stroke.current?.begun) latest.current.onStrokeCancel()
      setPreview([])
      stroke.current = null
    },
  }), [camera, gl])

  return <>
    <FitEditorCamera size={size} />
    <color attach="background" args={['#e8e4ff']} />
    <ambientLight intensity={1.5} />
    <directionalLight position={[12, 22, 10]} intensity={2} />
    <VoxelMesh voxels={voxels} meshRef={meshRef} size={size} />
    {preview.length > 0 && <VoxelMesh voxels={preview} meshRef={previewMeshRef} size={size} capacity={preview.length} opacity={0.5} />}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]}>
      <planeGeometry args={[size[0], size[2]]} />
      <meshLambertMaterial color="#d9d5c8" />
    </mesh>
    <EditorGrid size={size} />
    <mesh position={[0, size[1] / 2, 0]}>
      <boxGeometry args={[size[0], size[1], size[2]]} />
      <meshBasicMaterial visible={false} />
      <Edges color="#a79dc9" transparent opacity={0.3} depthWrite={false} />
    </mesh>
    <OrbitControls makeDefault enablePan={false} enableDamping={false}
      target={[0, size[1] / 3, 0]} minDistance={3} maxDistance={Math.max(...size) * 5}
      minPolarAngle={0.1} maxPolarAngle={Math.PI / 2 - 0.03}
      mouseButtons={{ LEFT: mode === 'camera' ? MOUSE.ROTATE : -1 as MOUSE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
      touches={{ ONE: mode === 'camera' ? TOUCH.ROTATE : -1 as TOUCH, TWO: TOUCH.DOLLY_ROTATE }} />
  </>
}

export function VoxelEditorScene(props: SceneProps) {
  const size = props.size ?? DEFAULT_VOXEL_SIZE
  return <div className="scene editor-scene" aria-label={`Voxel editor: ${size[0]} by ${size[1]} by ${size[2]} construction grid`}>
    <Canvas camera={{ position: [24, 23, 24], fov: 45, near: 0.1, far: 500 }}
      frameloop="demand" dpr={[1, 1.5]} gl={{ antialias: true }}
      onCreated={({ camera }) => camera.lookAt(0, 5, 0)}>
      <EditorScene {...props} />
    </Canvas>
  </div>
}

function FitEditorCamera({ size }: { size: VoxelSize }) {
  const { camera, size: viewport, invalidate } = useThree()
  useLayoutEffect(() => {
    const perspective = camera as PerspectiveCamera
    const vertical = perspective.fov * Math.PI / 360
    const horizontal = Math.atan(Math.tan(vertical) * viewport.width / viewport.height)
    const radius = Math.hypot(size[0] / 2, size[1] / 2, size[2] / 2)
    const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.1
    const target = new Vector3(0, size[1] / 3, 0)
    camera.position.sub(target).normalize().multiplyScalar(distance).add(target)
    camera.lookAt(target)
    invalidate()
  }, [camera, viewport.width, viewport.height, size[0], size[1], size[2], invalidate])
  return null
}

function EditorGrid({ size }: { size: VoxelSize }) {
  const positions = useMemo(() => {
    const lines: number[] = []
    for (let x = 0; x <= size[0]; x++) lines.push(x - size[0] / 2, 0.005, -size[2] / 2, x - size[0] / 2, 0.005, size[2] / 2)
    for (let z = 0; z <= size[2]; z++) lines.push(-size[0] / 2, 0.005, z - size[2] / 2, size[0] / 2, 0.005, z - size[2] / 2)
    return new Float32Array(lines)
  }, [size])
  return <lineSegments><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <lineBasicMaterial color="#aaa3cb" /></lineSegments>
}
