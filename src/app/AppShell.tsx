import { NavLink, Outlet } from 'react-router-dom'

const navigation = [
  { to: '/room', label: 'Room' },
  { to: '/furniture', label: 'Furniture' },
  { to: '/settings', label: 'Settings' },
]

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink className="brand" to="/room" aria-label="Cubby room">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>Cubby</span>
        </NavLink>
        <nav className="primary-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <NavLink
              className={({ isActive }) => isActive ? 'nav-link nav-link-active' : 'nav-link'}
              key={item.to}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

