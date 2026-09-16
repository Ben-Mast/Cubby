import { Link } from 'react-router-dom'
import { House } from 'lucide-react'

export function NotFoundPage() {
  return (
    <main className="standalone-page">
      <section className="placeholder-card">
        <p className="eyebrow">404</p>
        <h1>That cubby is empty</h1>
        <Link className="icon-button primary-icon" aria-label="Return to room" title="Room" to="/room"><House aria-hidden="true" /></Link>
      </section>
    </main>
  )
}
