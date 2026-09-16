import { Navigate, Outlet } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useAuth } from './AuthProvider'

function SessionStatus() {
  const { loading, initializationError, retryInitialization } = useAuth()
  return (
    <main className="standalone-page">
      <section className="placeholder-card" aria-live="polite">
        <h1>{loading ? 'Opening your home…' : 'Session unavailable'}</h1>
        {initializationError && <>
          <p role="alert">{initializationError}</p>
          <button className="icon-button primary-icon" aria-label="Retry session" title="Retry" onClick={retryInitialization}><RefreshCw aria-hidden="true" /></button>
        </>}
      </section>
    </main>
  )
}

export function ProtectedRoutes() {
  const { identity, loading, initializationError } = useAuth()
  if (loading || initializationError) return <SessionStatus />
  return identity ? <Outlet /> : <Navigate to="/login" replace />
}

export function LoginRoute() {
  const { identity, loading, initializationError } = useAuth()
  if (loading || initializationError) return <SessionStatus />
  return identity ? <Navigate to="/room" replace /> : <Outlet />
}
