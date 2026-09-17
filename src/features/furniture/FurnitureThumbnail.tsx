import { useEffect, useState } from 'react'
import { Armchair } from 'lucide-react'
import { furnitureThumbnailUrl } from './thumbnail'

export function FurnitureThumbnail({ path, name }: { path: string | null; name: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    setUrl(null); setFailed(false)
    if (path) void furnitureThumbnailUrl(path).then(value => { if (active) setUrl(value) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [path])
  return <div className="library-preview furniture-preview">
    {url && !failed ? <img src={url} alt={`${name} preview`} loading="lazy" onError={() => setFailed(true)} />
      : <Armchair aria-hidden="true" />}
  </div>
}
