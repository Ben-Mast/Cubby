import { useLayoutEffect, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, Matrix4, type InstancedMesh } from 'three'
import { EDITOR_SIZE, type Voxel } from './model'

export function VoxelMesh({ voxels, meshRef, capacity = EDITOR_SIZE ** 3, opacity = 1 }: {
  voxels: readonly Voxel[]; meshRef: RefObject<InstancedMesh | null>; capacity?: number; opacity?: number
}) {
  const invalidate = useThree(state => state.invalidate)
  useLayoutEffect(() => {
    const mesh = meshRef.current!
    const matrix = new Matrix4()
    const color = new Color()
    mesh.count = voxels.length
    voxels.forEach((voxel, index) => {
      matrix.makeTranslation(voxel.x + 0.5 - EDITOR_SIZE / 2, voxel.y + 0.5, voxel.z + 0.5 - EDITOR_SIZE / 2)
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, color.set(voxel.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    invalidate()
  }, [voxels, meshRef, invalidate, capacity])
  return <instancedMesh ref={meshRef} args={[undefined, undefined, capacity]}>
    <boxGeometry args={[1, 1, 1]} />
    <meshLambertMaterial transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1} />
  </instancedMesh>
}
