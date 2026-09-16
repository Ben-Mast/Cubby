import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import { TOUCH, type InstancedMesh } from 'three'
import { type Coordinate, type EditMode, type VoxelModel } from './model'
import { pickTarget } from './targeting'
import { bindEditInput } from './input'
import { VoxelMesh } from './VoxelMesh'

interface SceneProps { model: VoxelModel; mode: EditMode; cameraMode: boolean; onEdit: (at: Coordinate) => void }
function EditorScene({ model, mode, cameraMode, onEdit }: SceneProps) {
  const meshRef = useRef<InstancedMesh>(null)
  const voxels = useMemo(() => [...model.values()], [model])
  const { gl, camera } = useThree()
  useEffect(() => {
    if (cameraMode) return
    const canvas = gl.domElement
    return bindEditInput(canvas, (x, y) => {
      if (meshRef.current) {
        const at = pickTarget(x, y, canvas.getBoundingClientRect(), camera, meshRef.current, voxels, mode)
        if (at) onEdit(at)
      }
    })
  }, [cameraMode, camera, gl, voxels, mode, onEdit])
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
    <OrbitControls makeDefault enabled={cameraMode} enablePan={false} enableDamping={false}
      target={[0, 5, 0]} minDistance={7} maxDistance={60}
      minPolarAngle={0.1} maxPolarAngle={Math.PI / 2 - 0.03}
      touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE }} />
  </>
}
export function VoxelEditorScene(props: SceneProps) {
  return <div className={`scene editor-scene ${props.cameraMode ? 'camera-active' : 'edit-active'}`}
    aria-label="Voxel editor: 16 by 16 by 16 construction grid">
    <Canvas camera={{ position: [24, 23, 24], fov: 45, near: 0.1, far: 150 }}
      frameloop="demand" dpr={[1, 1.5]} gl={{ antialias: true }}
      onCreated={({ camera }) => camera.lookAt(0, 5, 0)}>
      <EditorScene {...props} />
    </Canvas>
  </div>
}
