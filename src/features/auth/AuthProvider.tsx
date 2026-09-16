import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase/client'
import { identities, identityForEmail } from './identities'
import type { Identity } from './identities'

interface AuthState {
  identity: Identity | null
  loading: boolean
  initializationError: string | null
  retryInitialization: () => void
  signIn: (identityId: Identity['id'], password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [initializationError, setInitializationError] = useState<string | null>(null)
  const [initializationAttempt, setInitializationAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let authEventReceived = false
    setLoading(true)
    setInitializationError(null)
    // Subscribe first so restoration cannot overwrite a newer auth event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      authEventReceived = true
      setSession(nextSession)
      setInitializationError(null)
      setLoading(false)
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || authEventReceived) return
      if (error) {
        setSession(null)
        setInitializationError('Unable to restore your session. Check your connection and try again.')
      } else {
        setSession(data.session)
      }
      setLoading(false)
    }).catch(() => {
      if (!active || authEventReceived) return
      setSession(null)
      setInitializationError('Unable to restore your session. Check your connection and try again.')
      setLoading(false)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [initializationAttempt])

  async function signIn(identityId: Identity['id'], password: string) {
    const selectedIdentity = identities.find((identity) => identity.id === identityId)
    if (!selectedIdentity) throw new Error('Choose one of the two identities.')
    const { data, error } = await supabase.auth.signInWithPassword({ email: selectedIdentity.email, password })
    if (error) {
      if (error.code === 'invalid_credentials') throw new Error('Incorrect password. Please try again.')
      if (error.code === 'email_not_confirmed') throw new Error('This identity is not ready. Ask the developer to confirm the account.')
      throw new Error('Unable to sign in. Check your connection and account setup, then try again.')
    }
    setSession(data.session)
    setInitializationError(null)
  }

  async function signOut() {
    // End this device's session without affecting another device.
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw new Error('Unable to log out. Check your connection and try again.')
    setSession(null)
  }

  return (
    <AuthContext.Provider value={{
      identity: identityForEmail(session?.user.email), loading, initializationError,
      retryInitialization: () => setInitializationAttempt((attempt) => attempt + 1), signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside AuthProvider.')
  return auth
}
