import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Field, Input, Card, Notice, Table, TableHead, TableRow, TableCell } from '../ui'
import { authNonce, authVerify, authMe, createEvent, addTrainer, uploadCsv, getEvent } from '../lib/api'
import type { CsvOkResponse, CsvErrorResponse } from '../lib/api'
import Programme from './Programme'
import Status from './Status'

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function b58(bytes: Uint8Array): string {
  const digits: number[] = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let out = ''
  for (const byte of bytes) {
    if (byte === 0) out += '1'
    else break
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]]
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getProvider(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as unknown as { solana?: any; phantom?: { solana?: any } }
  return w.phantom?.solana ?? w.solana ?? null
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const wrap: React.CSSProperties = { maxWidth: 960, margin: '0 auto', padding: '48px 24px' }
const row: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 440 }

function readRecent(): { id: string; name: string }[] {
  try {
    const v = JSON.parse(localStorage.getItem('payday.events') || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function saveRecent(id: string, name: string) {
  try {
    const list = readRecent().filter((e) => e.id !== id)
    list.unshift({ id, name })
    localStorage.setItem('payday.events', JSON.stringify(list.slice(0, 10)))
  } catch {
    /* storage unavailable */
  }
}

function SessionGate({ children }: { children: (wallet: string) => ReactNode }) {
  const [wallet, setWallet] = useState<string | null | undefined>(undefined)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    authMe()
      .then((r) => setWallet(r.wallet))
      .catch(() => setWallet(null))
  }, [])

  const login = async () => {
    setErr('')
    setBusy(true)
    try {
      const prov = getProvider()
      if (!prov) throw new Error('Phantom was not found. Install it or open this page in its browser, then try again.')
      const conn = await prov.connect()
      const addr = conn.publicKey.toString()
      const n = (await authNonce(addr)) as unknown as { message: string }
      const signed = await prov.signMessage(new TextEncoder().encode(n.message), 'utf8')
      await authVerify(addr, b58(signed.signature))
      setWallet(addr)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  if (wallet === undefined) return <div style={wrap}><p className="small">Checking session.</p></div>
  if (wallet === null) {
    return (
      <div style={wrap}>
        <h1 style={{ marginBottom: 16 }}>Organizer</h1>
        <p className="body-text" style={{ maxWidth: 520, marginBottom: 24 }}>
          Sign in by signing one message with Phantom. Nothing is sent on chain and no fee is charged.
        </p>
        {err && <div style={{ marginBottom: 16, maxWidth: 520 }}><Notice variant="danger">{err}</Notice></div>}
        <Button variant="primary" large disabled={busy} onClick={login}>
          {busy ? 'Waiting for Phantom' : 'Sign in with Phantom'}
        </Button>
      </div>
    )
  }
  return <>{children(wallet)}</>
}

function addDays(d: Date, n: number) {
  const x = new Date(d.getTime() + n * 86400000)
  return x.toISOString().slice(0, 10)
}

export function Organizer() {
  return <SessionGate>{(wallet) => <OrganizerHome wallet={wallet} />}</SessionGate>
}

function OrganizerHome({ wallet }: { wallet: string }) {
  const today = new Date()
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(addDays(today, 0))
  const [endDate, setEndDate] = useState(addDays(today, 2))
  const [dayLen, setDayLen] = useState('86400')
  const [decimals, setDecimals] = useState('6')
  const [mint, setMint] = useState('')
  const [maxP, setMaxP] = useState('20')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const recent = readRecent()

  const submit = async () => {
    setErr('')
    setBusy(true)
    try {
      const ev = (await createEvent({
        name: name.trim(),
        startDate,
        endDate,
        dayLenSeconds: Number(dayLen),
        decimals: Number(decimals),
        tokenMint: mint.trim(),
        maxParticipants: Number(maxP),
      } as Parameters<typeof createEvent>[0])) as Record<string, unknown>
      const id = String(ev.id)
      saveRecent(id, name.trim())
      window.location.hash = `#/organizer/${id}`
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={wrap}>
      <p className="label">Signed in</p>
      <p className="mono small" style={{ marginBottom: 32, wordBreak: 'break-all' }}>{wallet}</p>
      {recent.length > 0 && (
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ marginBottom: 16 }}>Your events</h2>
          <Card>
            <Table>
              <tbody>
                {recent.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.name}</TableCell>
                    <TableCell><a href={`#/organizer/${e.id}`}>Open</a></TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </Card>
        </section>
      )}
      <h2 style={{ marginBottom: 16 }}>New event</h2>
      <div style={row}>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Start date" hint="YYYY-MM-DD"><Input value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <Field label="End date" hint="YYYY-MM-DD"><Input value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        <Field label="Day length in seconds" hint="A demo server may override this."><Input value={dayLen} onChange={(e) => setDayLen(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Token mint"><Input value={mint} onChange={(e) => setMint(e.target.value)} /></Field>
        <Field label="Token decimals"><Input value={decimals} onChange={(e) => setDecimals(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Maximum participants"><Input value={maxP} onChange={(e) => setMaxP(e.target.value)} inputMode="numeric" /></Field>
        {err && <Notice variant="danger">{err}</Notice>}
        <Button variant="primary" disabled={busy || !name.trim() || !mint.trim()} onClick={submit}>
          {busy ? 'Creating' : 'Create event'}
        </Button>
      </div>
    </div>
  )
}

const num = (v: unknown, d = 0) => (v === undefined || v === null || v === '' ? d : Number(v))
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))

export function OrganizerEvent({ eventId }: { eventId: string }) {
  return <SessionGate>{(wallet) => <EventPage eventId={eventId} wallet={wallet} />}</SessionGate>
}

function EventPage({ eventId, wallet }: { eventId: string; wallet: string }) {
  const [ev, setEv] = useState<Record<string, unknown> | null>(null)
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0)
  const [csv, setCsv] = useState('')
  const [csvMsg, setCsvMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [csvTotal, setCsvTotal] = useState<string | undefined>(undefined)
  const [tName, setTName] = useState('')
  const [tPhone, setTPhone] = useState('')
  const [tErr, setTErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getEvent(eventId)
      .then((r) => setEv(r))
      .catch((e) => setErr(errMsg(e)))
  }, [eventId, tick])

  const refresh = () => setTick((t) => t + 1)

  const sendCsv = async () => {
    setCsvMsg(null)
    setBusy(true)
    try {
      const r = (await uploadCsv(eventId, csv)) as unknown as CsvOkResponse | CsvErrorResponse
      if (r.ok) {
        setCsvTotal(r.grandTotal)
        setCsvMsg({ ok: true, text: `${r.count} participants loaded. Total to fund: ${r.grandTotal} base units.` })
      } else {
        setCsvMsg({ ok: false, text: `The CSV has ${r.errors.length} problem(s). ${JSON.stringify(r.errors.slice(0, 3))}` })
      }
    } catch (e) {
      setCsvMsg({ ok: false, text: errMsg(e) })
    } finally {
      setBusy(false)
    }
  }

  const onFile = (f: File | undefined) => {
    if (!f) return
    f.text().then(setCsv).catch((e) => setCsvMsg({ ok: false, text: errMsg(e) }))
  }

  const sendTrainer = async () => {
    setTErr('')
    setBusy(true)
    try {
      await addTrainer(eventId, tName.trim(), tPhone.trim())
      setTName('')
      setTPhone('')
      refresh()
    } catch (e) {
      setTErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  if (err) return <div style={wrap}><Notice variant="danger">{err}</Notice><p style={{ marginTop: 16 }}><a href="#/organizer">Back to events</a></p></div>
  if (!ev) return <div style={wrap}><p className="small">Loading event.</p></div>

  const rawTrainers = Array.isArray(ev.trainers) ? (ev.trainers as Record<string, unknown>[]) : []
  const trainers = rawTrainers.map((t) => ({
    id: str(t.id),
    name: str(t.name),
    phone: str(t.phone),
    wallet: t.wallet ? str(t.wallet) : null,
    state: str(t.state),
  }))
  const grand = csvTotal ?? (ev.grand_total ? str(ev.grand_total) : ev.grandTotal ? str(ev.grandTotal) : undefined)
  const event = {
    id: eventId,
    name: str(ev.name),
    days: num(ev.days),
    decimals: num(ev.decimals, 6),
    token_mint: str(ev.token_mint),
    max_participants: num(ev.max_participants),
    start_ts: num(ev.start_ts),
    day_len_seconds: num(ev.day_len_seconds, 86400),
    grand_total: grand,
  }

  return (
    <div style={wrap}>
      <p style={{ marginBottom: 16 }}><a href="#/organizer">All events</a></p>
      <h1 style={{ marginBottom: 8 }}>{event.name}</h1>
      <p className="small" style={{ marginBottom: 48 }}>
        {event.days} days. Status: {str(ev.status) || 'draft'}.
      </p>

      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>1. Trainers</h2>
        {trainers.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <Card>
              <Table>
                <TableHead>
                  <TableRow><th>Name</th><th>Phone</th><th>State</th></TableRow>
                </TableHead>
                <tbody>
                  {trainers.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.name}</TableCell>
                      <TableCell>{t.phone}</TableCell>
                      <TableCell status={t.wallet ? 'accent' : 'warn'}>{t.wallet ? 'Signed up' : t.state || 'Invited'}</TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>
        )}
        <div style={row}>
          <Field label="Trainer name"><Input value={tName} onChange={(e) => setTName(e.target.value)} /></Field>
          <Field label="Trainer phone" hint="Kenyan number, for example 0712 345 678"><Input value={tPhone} onChange={(e) => setTPhone(e.target.value)} inputMode="tel" /></Field>
          {tErr && <Notice variant="danger">{tErr}</Notice>}
          <Button variant="secondary" disabled={busy || !tName.trim() || !tPhone.trim()} onClick={sendTrainer}>Add trainer</Button>
        </div>
      </section>

      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>2. Participants</h2>
        <p className="small" style={{ marginBottom: 16, maxWidth: 560 }}>
          Header: name,email,phone,day1 and so on. The amount for each day goes in its column.
        </p>
        <div style={{ ...row, maxWidth: 560 }}>
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} style={{ minHeight: 44 }} />
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={6}
            className="mono"
            placeholder="name,email,phone,day1,day2,day3"
            style={{ width: '100%', padding: 12, border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--surface)' }}
          />
          {csvMsg && <Notice variant={csvMsg.ok ? 'info' : 'danger'}>{csvMsg.text}</Notice>}
          <Button variant="secondary" disabled={busy || !csv.trim()} onClick={sendCsv}>Upload CSV</Button>
        </div>
      </section>

      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>3. Programme and funding</h2>
        <p className="small" style={{ marginBottom: 16, maxWidth: 560 }}>
          Send each trainer their link first (in the status section below). A trainer needs to sign up before you can add them on chain.
        </p>
        <Programme event={event} trainers={trainers} organizerWallet={wallet} onDone={refresh} />
      </section>

      <section style={{ marginBottom: 48 }}>
        <h2 style={{ marginBottom: 16 }}>4. Status and links</h2>
        <Status eventId={eventId} organizerWallet={wallet} />
      </section>
    </div>
  )
}
