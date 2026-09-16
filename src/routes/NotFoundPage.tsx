import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="standalone-page">
      <section className="placeholder-card">
        <p className="eyebrow">404</p>
        <h1>That cubby is empty</h1>
        <Link className="button-link" to="/room">Return to the room</Link>
      </section>
    </main>
  )
}

