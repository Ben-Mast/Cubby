import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../features/auth/AuthProvider'
import { identities } from '../features/auth/identities'
import type { Identity } from '../features/auth/identities'

export function LoginPage() {
  const { signIn } = useAuth()
  const [selectedIdentity, setSelectedIdentity] = useState<Identity | null>(null)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedIdentity || submitting || !password) return
    setSubmitting(true)
    setError(null)
    try {
      await signIn(selectedIdentity.id, password)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to sign in. Please try again.')
    } finally {
      setPassword('')
      setSubmitting(false)
    }
  }

  return (
    <main className="standalone-page">
      <section className="placeholder-card">
        <p className="eyebrow">Cubby</p>
        <h1>{selectedIdentity ? `Welcome home, ${selectedIdentity.displayName}` : 'Who are you?'}</h1>
        {!selectedIdentity ? (
          <div className="identity-picker">
            {identities.map((identity) => (
              <button className="identity-choice" key={identity.id} onClick={() => setSelectedIdentity(identity)}>
                <span aria-hidden="true">{identity.emoji}</span>
                {identity.displayName}
              </button>
            ))}
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" autoFocus required
              value={password} disabled={submitting} onChange={(event) => setPassword(event.target.value)} />
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="button-link" type="submit" disabled={submitting || !password}>
              {submitting ? 'Signing in…' : 'Log in'}
            </button>
            <button className="text-button" type="button" disabled={submitting} onClick={() => {
              setSelectedIdentity(null)
              setPassword('')
              setError(null)
            }}>Choose a different identity</button>
          </form>
        )}
      </section>
    </main>
  )
}
