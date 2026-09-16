export function SharedRoomScene({ instances, ...props }: { instances: readonly unknown[]; [key: string]: any }) {
  return <div data-scene-props={props}>Room scene boundary: {instances.length} instances</div>
}
