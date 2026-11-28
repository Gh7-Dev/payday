import { useState, useEffect } from 'react'

// ─── Routes ──────────────────────────────────────────────────
// #/                     → Landing
// #/organizer            → Organizer login / event list
// #/organizer/<eventId>  → Organizer event page
// #/trainer/<eventId>/<code> → Trainer link
// #/join/<eventId>/<code>    → Trainee link
// #/audit/<programmeAddress>  → Audit page (optional)

type Route =
  | { screen: 'landing' }
  | { screen: 'organizer' }
  | { screen: 'organizer-event'; eventId: string }
  | { screen: 'trainer'; eventId: string; code: string }
  | { screen: 'trainee'; eventId: string; code: string }
  | { screen: 'audit'; programmeAddress: string }

function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, '')
  if (!h || h === '/') return { screen: 'landing' }
  const parts = h.split('/').filter(Boolean)

  if (parts[0] === 'organizer') {
    if (parts[1]) return { screen: 'organizer-event', eventId: parts[1] }
    return { screen: 'organizer' }
  }
  if (parts[0] === 'trainer' && parts[1] && parts[2]) {
    return { screen: 'trainer', eventId: parts[1], code: parts[2] }
  }
  if (parts[0] === 'join' && parts[1] && parts[2]) {
    return { screen: 'trainee', eventId: parts[1], code: parts[2] }
  }
  if (parts[0] === 'audit' && parts[1]) {
    return { screen: 'audit', programmeAddress: parts[1] }
  }
  return { screen: 'landing' }
}

function PlaceholderScreen({ title }: { title: string }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '48px 24px',
      textAlign: 'center',
      gap: '24px',
    }}>
      <h1 style={{
        fontFamily: 'var(--font-display)',
        fontSize: '2.25rem',
        fontWeight: 500,
        color: 'var(--accent)',
      }}>
        PayDay
      </h1>
      <p className="body-text small">{title}</p>
    </div>
  )
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  switch (route.screen) {
    case 'landing':
      return <PlaceholderScreen title="Landing — coming soon" />
    case 'organizer':
      return <PlaceholderScreen title="Organizer — coming soon" />
    case 'organizer-event':
      return <PlaceholderScreen title={`Event ${route.eventId} — coming soon`} />
    case 'trainer':
      return <PlaceholderScreen title={`Trainer link — coming soon`} />
    case 'trainee':
      return <PlaceholderScreen title={`Trainee link — coming soon`} />
    case 'audit':
      return <PlaceholderScreen title={`Audit — coming soon`} />
  }
}
