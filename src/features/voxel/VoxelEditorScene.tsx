import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import { MOUSE, TOUCH, type InstancedMesh } from 'three'
import { coordinateKey, type Coordinate, type EditMode, type VoxelModel } from './model'
import { interpolateCoordinates, pickLockedTarget, pickStrokeStart, type StrokeTarget } from './targeting'
import { bindPrimaryPointerInput } from './input'
import { VoxelMesh } from './VoxelMesh'

interface SceneProps {
  model: VoxelModel
  mode: EditMode
  onStrokeStart: () => void
  onStrokeEdit: (at: Coordinate) => void
  onStrokeEnd: () => void
  onStrokeCancel: () => void
}

function EditorScene({ model, mode, onStrokeStart, onStrokeEdit, onStrokeEnd, onStrokeCancel }: SceneProps) {
  const meshRef = useRef<InstancedMesh>(null)
  const voxels = useMemo(() => [...model.values()], [model])
  const latest = useRef({ voxels, mode, onStrokeStart, onStrokeEdit, onStrokeEnd, onStrokeCancel })
  latest.current = { voxels, mode, onStrokeStart, onStrokeEdit, onStrokeEnd, onStrokeCancel }
  const stroke = useRef<{ target: StrokeTarget; last: Coordinate; seen: Set<string>; begun: boolean } | null>(null)
  const { gl, camera } = useThree()

  useEffect(() => bindPrimaryPointerInput(gl.domElement, {
    start: (x, y) => {
      if (!meshRef.current) return false
      const target = pickStrokeStart(x, y, gl.domElement.getBoundingClientRect(), camera,
        meshRef.current, latest.current.voxels, latest.current.mode)
      if (!target) return false
      stroke.current = { target, last: target.at, seen: new Set(), begun: false }
      return true
    },
    move: (x, y) => {
      const active = stroke.current
      if (!active) return
      const at = pickLockedTarget(x, y, gl.domElement.getBoundingClientRect(), camera, active.target)
      if (!at) return
      if (!active.begun) { latest.current.onStrokeStart(); active.begun = true }
      for (const coordinate of [active.last, ...interpolateCoordinates(active.last, at)]) {
        const key = coordinateKey(coordinate)
        if (!active.seen.has(key)) { active.seen.add(key); latest.current.onStrokeEdit(coordinate) }
      }
      active.last = at
    },
    end: () => {
      const active = stroke.current
      if (!active) return
      if (!active.begun) { latest.current.onStrokeStart(); latest.current.onStrokeEdit(active.target.at) }
      latest.current.onStrokeEnd()
      stroke.current = null
    },
    cancel: () => {
      if (stroke.current?.begun) latest.current.onStrokeCancel()
      stroke.current = null
    },
  }), [camera, gl])

  return <>
    <color attach="background" args={['#e8e4ff']} />
    <ambientLight intensity={1.5} />
    <directionalLight position={[12, 22, 10]} intensity={2} />
    <VoxelMesh voxels={voxels} meshRef={meshRef} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]}>
      <planeGeometry args={[16, 16]} />
      <meshLambertMaterial color="#d9d5c8" />
    </mesh>
    <gridHelper args={[16, 16, '#756ca8', '#aaa3cb']} />
    <mesh position={[0, 8, 0]}>
      <boxGeometry args={[16, 16, 16]} />
      <meshBasicMaterial visible={false} />
      <Edges color="#a79dc9" transparent opacity={0.3} depthWrite={false} />
    </mesh>
    <OrbitControls makeDefault enablePan={false} enableDamping={false}
      target={[0, 5, 0]} minDistance={7} maxDistance={60}
      minPolarAngle={0.1} maxPolarAngle={Math.PI / 2 - 0.03}
      mouseButtons={{ LEFT: -1 as MOUSE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
      touches={{ ONE: -1 as TOUCH, TWO: TOUCH.DOLLY_ROTATE }} />
  </>
}

export function VoxelEditorScene(props: SceneProps) {
  return <div className="scene editor-scene" aria-label="Voxel editor: 16 by 16 by 16 construction grid">
    <Canvas camera={{ position: [24, 23, 24], fov: 45, near: 0.1, far: 150 }}
      frameloop="demand" dpr={[1, 1.5]} gl={{ antialias: true }}
      onCreated={({ camera }) => camera.lookAt(0, 5, 0)}>
      <EditorScene {...props} />
    </Canvas>
  </div>
}
