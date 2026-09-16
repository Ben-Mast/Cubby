import { useState } from 'react'
import { useAuth } from '../features/auth/AuthProvider'

export function SettingsPage() {
  const { identity, signOut } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogout() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await signOut()
    } catch {
      setError('Unable to log out. Check your connection and try again.')
      setSubmitting(false)
    }
  }
  return (
    <section className="page placeholder-card">
      <p className="eyebrow">Settings</p>
      <h1>Your settings</h1>
      <p>Signed in as <strong>{identity?.displayName}</strong></p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="button-link" disabled={submitting} onClick={handleLogout}>
        {submitting ? 'Logging out…' : 'Log out'}
      </button>
    </section>
  )
}
