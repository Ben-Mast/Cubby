import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { fetchCurrentHome } from './currentHome'
import type { SharedHome } from './currentHome'

export function useCurrentHome() {
  const { identity } = useAuth()
  const [home, setHome] = useState<SharedHome | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setHome(null)
    setError(null)
    setLoading(Boolean(identity))
    if (identity) {
      void fetchCurrentHome().then((home) => {
        if (active) setHome(home)
      }).catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : 'Unable to load your shared home.')
      }).finally(() => {
        if (active) setLoading(false)
      })
    }
    return () => { active = false }
  }, [identity, attempt])

  return { home, loading, error, retry: () => setAttempt((value) => value + 1) }
}
