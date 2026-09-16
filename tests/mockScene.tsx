import { useEffect } from 'react'

export const sceneLifecycle = { mounts: 0, unmounts: 0 }
export function SharedRoomScene({ instances, ...props }: { instances: readonly unknown[]; [key: string]: any }) {
  useEffect(() => { sceneLifecycle.mounts++; return () => { sceneLifecycle.unmounts++ } }, [])
  return <div data-scene-props={{ instances, ...props }}>Room scene boundary: {instances.length} instances</div>
}
