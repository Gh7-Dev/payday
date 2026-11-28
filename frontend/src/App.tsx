import { useState, useEffect } from 'react'
import { Trainee } from './screens/Trainee'
import { Trainer } from './screens/Trainer'
import {
  Button,
  Field,
  Input,
  Card,
  Table,
  TableHead,
  TableRow,
  TableCell,
  Stat,
  Notice,
  Modal,
  Copy,
  DayStrip,
  Qr,
  Countdown,
} from './ui'

// ─── Routes ──────────────────────────────────────────────────
// #/                     → Landing
// #/organizer            → Organizer login / event list
// #/organizer/<eventId>  → Organizer event page
// #/trainer/<eventId>/<code> → Trainer link
// #/join/<eventId>/<code>    → Trainee link
// #/audit/<programmeAddress>  → Audit page (optional)
// #/kit                   → UI component kit (hidden)

type Route =
  | { screen: 'landing' }
  | { screen: 'organizer' }
  | { screen: 'organizer-event'; eventId: string }
  | { screen: 'trainer'; eventId: string; code: string }
  | { screen: 'trainee'; eventId: string; code: string }
  | { screen: 'audit'; programmeAddress: string }
  | { screen: 'kit' }

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
  if (parts[0] === 'kit') {
    return { screen: 'kit' }
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
      return <Trainer eventId={route.eventId} code={route.code} />
    case 'trainee':
      return <Trainee eventId={route.eventId} code={route.code} />
    case 'audit':
      return <PlaceholderScreen title="Audit — coming soon" />
    case 'kit':
      return <Kit />
  }
}

// ─── Kit — hidden route to preview all components ─────────────────

function Kit() {
  const [modalOpen, setModalOpen] = useState(false)
  const [countdownKey, setCountdownKey] = useState(0)
  const [countdownExpired, setCountdownExpired] = useState(false)

  const resetCountdown = () => {
    setCountdownKey((k) => k + 1)
    setCountdownExpired(false)
  }

  return (
    <div style={{ padding: '48px 24px', maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 48 }}>Component kit</h1>

      {/* ── Buttons ── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>Button</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="primary">Primary</Button>
          <Button variant="primary" disabled>Primary disabled</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="secondary" disabled>Secondary disabled</Button>
          <Button variant="text">Text button</Button>
          <Button variant="text" disabled>Text disabled</Button>
          <Button variant="primary" large>Large primary</Button>
        </div>
      </section>

      {/* ── Field ── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>Field</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 360 }}>
          <Field label="Default field" hint="A helpful hint">
            <Input placeholder="Type something" />
          </Field>
          <Field label="Field with error" error="This field is required.">
            <Input placeholder="Required field" hasError />
          </Field>
        </div>
      </section>

      {/* ── Card ── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>Card</h2>
        <Card style={{ padding: 24, maxWidth: 360 }}>
          <p>A simple card with a 1px border, no shadow.</p>
        </Card>
      </section>

      {/* ── Table ── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>Table</h2>
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <th>Name</th>
                <th>Day</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
              </TableRow>
            </TableHead>
            <tbody>
              <TableRow>
                <TableCell>Amina Wanjiku</TableCell>
                <TableCell>Day 3 of 7</TableCell>
                <TableCell numeric>120,000</TableCell>
                <TableCell status="accent">Paid</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Kenji Sato</TableCell>
                <TableCell>Day 1 of 7</TableCell>
                <TableCell numeric>120,000</TableCell>
                <TableCell status="warn">Pending</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Fatima Osei</TableCell>
                <TableCell>Day 5 of 7</TableCell>
                <TableCell numeric>0</TableCell>
                <TableCell status="neutral">Unclaimed</TableCell>
              </TableRow>
            </tbody>
          </Table>
        </Card>
      </section>

      {/* ── Stat ── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>Stat</h2>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <Stat label="Vault holds" value="847,200" unit="units" />
          <Stat label="Paid out" value="2,400,000" unit="units" />
          <Stat label="Still committed" value="612,000" unit="units" />
          <Stat label="Day" value="4" unit="of 7" />
        </div>
      </section>

      {/* ── Notice ── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>Notice</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
          <Notice>
            The programme vault has been funded. Trainers and trainees can now proceed.
          </Notice>
          <Notice variant="warn">
            This code expires in 47 seconds. Make sure the trainee is ready before scanning.
          </Notice>
          <Notice variant="danger">
            Wrong PIN. You have 3 attempts remaining.
          </Notice>
        </div>
      </section>

      {/* ── Modal ── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>Modal</h2>
        <Button variant="secondary" onClick={() => setModalOpen(true)}>
          Open modal
        </Button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Share link"
        >
          <p className="body-text small">
            Share this link with the trainer. They will use it to sign up and
            check in participants.
          </p>
          <code
            className="mono"
            style={{
              display: 'block',
              padding: '12px 16px',
              background: 'var(--sunken)',
              borderRadius: 'var(--radius)',
              wordBreak: 'break-all',
            }}
          >
            payday.example.com/trainer/EV001/abc123xyz
          </code>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Copy text="payday.example.com/trainer/EV001/abc123xyz" />
          </div>
          <p className="small" style={{ color: 'var(--ink-3)' }}>
            This code is shown once.
          </p>
        </Modal>
      </section>

      {/* ── Copy ── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>Copy</h2>
        <Copy text="payday.example.com/organizer/evt_abc123xyz">
          Copy link
        </Copy>
      </section>

      {/* ── DayStrip ── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>DayStrip</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <p className="small" style={{ marginBottom: 8 }}>
              Day 5 of 7. 4 paid, 1 missed.
            </p>
            <DayStrip
              total={7}
              current={4}
              cells={['paid', 'paid', 'paid', 'paid', 'missed', 'today', 'future']}
            />
          </div>
          <div>
            <p className="small" style={{ marginBottom: 8 }}>Before start</p>
            <DayStrip
              total={5}
              current={-1}
              cells={['future', 'future', 'future', 'future', 'future']}
            />
          </div>
        </div>
      </section>

      {/* ── QR ── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>Qr</h2>
        <Qr
          data="payday.example.com/trainer/EV001/abc123xyz"
          caption="Scan to open trainer sign-up"
          size={240}
        />
      </section>

      {/* ── Countdown ── */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>Countdown</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
          {!countdownExpired ? (
            <Countdown
              key={countdownKey}
              initialSeconds={47}
              onExpire={() => setCountdownExpired(true)}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <p className="countdown-expired">
                <span className="label">Expired</span>
              </p>
              <Button variant="primary" onClick={resetCountdown}>
                Make a new code
              </Button>
            </div>
          )}
          <p className="small">
            Shows the large tabular number, shrinking progress line and warning state at 10s.
          </p>
        </div>
      </section>
    </div>
  )
}
