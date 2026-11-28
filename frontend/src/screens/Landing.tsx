import { Button, Card, DayStrip } from '../ui'

const GITHUB = 'https://github.com/Gh7-Dev/payday'
const PROGRAM_ID = (import.meta.env.VITE_PROGRAM_ID as string | undefined) || ''
const go = (h: string) => { window.location.hash = h }
const scrollHow = () => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })

const steps = [
  { n: '1', h: 'Fund', p: 'The organizer loads a vault with the stipends for every day. The amounts are fixed before the programme starts.' },
  { n: '2', h: 'Check in', p: 'A trainer and a participant both sign each check-in. The payment is made as soon as the second signature lands.' },
  { n: '3', h: 'Reclaim', p: 'Days nobody checked in for stay in the vault. After the programme ends, the organizer takes them back.' },
]

export function Landing() {
  return (
    <div>
      <header style={{ height: 72, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', maxWidth: 1120, margin: '0 auto' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>PayDay</span>
        <nav style={{ display: 'flex', gap: 24 }}>
          <a href="#/organizer">Organizer</a>
          <a href="#how" onClick={(e) => { e.preventDefault(); scrollHow() }}>How it works</a>
        </nav>
      </header>

      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '80px 24px 120px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 48, alignItems: 'center' }}>
        <div>
          <p className="label" style={{ marginBottom: 16 }}>Stipends for days attended</p>
          <h1 style={{ fontSize: 'clamp(2.75rem, 6vw, 4.75rem)', lineHeight: 1.02, letterSpacing: '-0.02em', marginBottom: 24 }}>
            Pay for the days people actually show up.
          </h1>
          <p className="body-text" style={{ maxWidth: '56ch', color: 'var(--ink-2)', marginBottom: 32 }}>
            Funds sit in a vault no one controls. Each check-in is signed by a trainer and a participant, and pays out right away. What nobody earned goes back to the organizer.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button variant="primary" large onClick={() => go('#/organizer')}>Open organizer app</Button>
            <Button variant="secondary" large onClick={scrollHow}>See how it works</Button>
          </div>
        </div>
        <Card style={{ padding: 24 }}>
          <DayStrip total={7} current={4} cells={['paid', 'paid', 'paid', 'paid', 'missed', 'today', 'future']} />
          <p className="small" style={{ marginTop: 16 }}>Day 5 of 7. 4 paid, 1 missed.</p>
        </Card>
      </section>

      <section id="how" style={{ maxWidth: 1120, margin: '0 auto', padding: '0 24px 120px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 32 }}>
        {steps.map((s) => (
          <div key={s.n}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', color: 'var(--accent)', marginBottom: 8 }}>{s.n}</div>
            <h3 style={{ marginBottom: 8 }}>{s.h}</h3>
            <p className="body-text">{s.p}</p>
          </div>
        ))}
      </section>

      <section style={{ background: 'var(--night)', color: 'var(--on-night)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', lineHeight: 1.2, maxWidth: '32ch', marginBottom: 24 }}>
            PayDay does not prove anyone was in the room. It makes every claim public, two-signed and checkable.
          </p>
          <p className="small" style={{ color: 'var(--on-night)', opacity: 0.7 }}>
            Devnet demo. Test token only. The server sees participant PINs, so this is not non-custodial.
          </p>
        </div>
      </section>

      <footer style={{ maxWidth: 1120, margin: '0 auto', padding: '48px 24px', display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>PayDay</span>
        <span className="small">Built for the Dev3pack Global Hackathon</span>
        <span style={{ display: 'flex', gap: 24 }} className="small">
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
          {PROGRAM_ID && <a href={`https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`} target="_blank" rel="noreferrer">Program on Solana Explorer</a>}
        </span>
      </footer>
    </div>
  )
}
