import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Armchair, House, LogOut } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'

interface HeaderAction {
  content: ReactNode
}

const HeaderActionContext = createContext<(action: HeaderAction | null) => void>(() => {})

export function useHeaderAction() {
  return useContext(HeaderActionContext)
}

export function AppShell() {
  const { pathname } = useLocation()
  const { signOut } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [headerAction, setHeaderAction] = useState<HeaderAction | null>(null)
  const registerHeaderAction = useMemo(() => setHeaderAction, [])
  const immersive = pathname === '/room' || pathname === '/furniture/new' || /^\/furniture\/[^/]+\/edit$/.test(pathname)
  async function logout() {
    if (loggingOut) return
    setLoggingOut(true); setLogoutError('')
    try { await signOut() }
    catch (reason) {
      setLogoutError(reason instanceof Error ? reason.message : 'Unable to log out.')
      setLoggingOut(false)
    }
  }
  return (
    <div className={`app-shell${immersive ? ' immersive-shell' : ''}`}>
      <header className="app-header">
        <nav className="primary-nav" aria-label="Primary navigation">
          <NavLink aria-label="Room" title="Room" className={({ isActive }) => isActive ? 'nav-link nav-link-active' : 'nav-link'} to="/room">
            <House aria-hidden="true" />
          </NavLink>
          <NavLink aria-label="Furniture" title="Furniture" className={({ isActive }) => isActive ? 'nav-link nav-link-active' : 'nav-link'} to="/furniture">
            <Armchair aria-hidden="true" />
          </NavLink>
          {headerAction?.content}
          <button className="nav-link nav-button" aria-label="Log out" title="Log out" disabled={loggingOut} onClick={() => void logout()}>
            <LogOut aria-hidden="true" />
          </button>
        </nav>
      </header>
      {logoutError && <p className="chrome-error" role="alert">{logoutError}</p>}
      <main className="app-main">
        <HeaderActionContext.Provider value={registerHeaderAction}>
          <Outlet />
        </HeaderActionContext.Provider>
      </main>
    </div>
  )
}
