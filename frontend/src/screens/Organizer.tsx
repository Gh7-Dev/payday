import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Field, Input, Card, Notice, Table, TableHead, TableRow, TableCell } from '../ui'
import { authNonce, authVerify, authMe, createEvent, addTrainer, uploadCsv, getEvent, listTrainers } from '../lib/api'
import type { CsvOkResponse, CsvErrorResponse, TrainerRowApi } from '../lib/api'
import Programme from './Programme'
import Status from './Status'
import { formatAmount } from '../lib/format'

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

const errMsg = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e)
  if (m === 'unauthorized') window.dispatchEvent(new Event('payday-auth-lost'))
  return m
}
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

function removeRecent(id: string) {
  try {
    const list = readRecent().filter((e) => e.id !== id)
    localStorage.setItem('payday.events', JSON.stringify(list))
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

  useEffect(() => {
    const lost = () => {
      setWallet(null)
      setErr('Your session ended. Sign in again to continue.')
    }
    window.addEventListener('payday-auth-lost', lost)
    return () => window.removeEventListener('payday-auth-lost', lost)
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
  const [recent, setRecent] = useState(readRecent())

  useEffect(() => {
    readRecent().forEach((e) => {
      getEvent(e.id).catch((x) => {
        if (errMsg(x) === 'not_found') {
          removeRecent(e.id)
          setRecent(readRecent())
        }
      })
    })
  }, [])

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
      <h2 style={{ marginBottom: 8 }}>New event</h2>
      <p className="small" style={{ marginBottom: 16, maxWidth: 560 }}>An event is one stipend programme. Fill this in, then follow the numbered steps on the next page.</p>
      <div style={row}>
        <Field label="Event name" hint="For your own reference, for example Nairobi cohort 3."><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Start date" hint="YYYY-MM-DD"><Input value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <Field label="End date" hint="YYYY-MM-DD"><Input value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        <Field label="Day length in seconds" hint="A demo server may override this."><Input value={dayLen} onChange={(e) => setDayLen(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Token mint" hint="The address of the test token you will pay stipends in."><Input value={mint} onChange={(e) => setMint(e.target.value)} /></Field>
        <Field label="Token decimals" hint="Decimal places of that token. Most test tokens use 6."><Input value={decimals} onChange={(e) => setDecimals(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Maximum participants" hint="The most people who can enrol. Set it at or above your CSV count."><Input value={maxP} onChange={(e) => setMaxP(e.target.value)} inputMode="numeric" /></Field>
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
const TOKEN = 'test tokens'

const STATE_TEXT: Record<string, string> = {
  invited: 'Waiting for sign-up',
  signed_up: 'Signed up',
  funded: 'Signed up, fee balance added',
  registered: 'Registered on chain',
}

type StepStatus = 'done' | 'next' | 'locked'

function Step({ n, title, status, help, children }: { n: number; title: string; status: StepStatus; help: string; children: ReactNode }) {
  const color = status === 'done' ? 'var(--accent)' : status === 'next' ? 'var(--warn)' : 'var(--ink-3)'
  const word = status === 'done' ? 'Done' : status === 'next' ? 'Do this next' : 'Not yet'
  return (
    <section style={{ marginBottom: 48 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--accent)' }}>{n}</span>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="label" style={{ color }}>{word}</span>
      </div>
      <p className="small" style={{ margin: '8px 0 16px', maxWidth: 560 }}>{help}</p>
      {children}
    </section>
  )
}

export function OrganizerEvent({ eventId }: { eventId: string }) {
  return <SessionGate>{(wallet) => <EventPage eventId={eventId} wallet={wallet} />}</SessionGate>
}

function EventPage({ eventId, wallet }: { eventId: string; wallet: string }) {
  const [ev, setEv] = useState<Record<string, unknown> | null>(null)
  const [pCounts, setPCounts] = useState<Record<string, number>>({})
  const [trainers, setTrainers] = useState<TrainerRowApi[]>([])
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0)
  const [csv, setCsv] = useState('')
  const [csvMsg, setCsvMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [csvTotal, setCsvTotal] = useState<string | undefined>(undefined)
  const [tName, setTName] = useState('')
  const [tPhone, setTPhone] = useState('')
  const [tErr, setTErr] = useState('')
  const [tOk, setTOk] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all([
      getEvent(eventId),
      listTrainers(eventId).catch(() => ({ trainers: [] as TrainerRowApi[] })),
    ])
      .then(([d, t]) => {
        if (!live) return
        const raw = d as unknown as { event?: Record<string, unknown>; participants?: Record<string, number> }
        setEv(raw.event ?? (d as Record<string, unknown>))
        setPCounts(raw.participants ?? {})
        setTrainers(t.trainers ?? [])
      })
      .catch((e) => {
        if (!live) return
        const m = errMsg(e)
        if (m === 'not_found') removeRecent(eventId)
        setErr(m)
      })
    return () => { live = false }
  }, [eventId, tick])

  const refresh = () => setTick((t) => t + 1)
  const decimals = ev ? num(ev.decimals, 6) : 6

  const sendCsv = async () => {
    setCsvMsg(null)
    setBusy(true)
    try {
      const r = (await uploadCsv(eventId, csv)) as unknown as CsvOkResponse | CsvErrorResponse
      if (r.ok) {
        setCsvTotal(r.grandTotal)
        setCsvMsg({ ok: true, text: `${r.count} participants loaded. The vault will need ${formatAmount(r.grandTotal, decimals)} ${TOKEN} in total.` })
        refresh()
      } else {
        setCsvMsg({ ok: false, text: `The CSV has ${r.errors.length} problem(s). Fix them and upload again. ${JSON.stringify(r.errors.slice(0, 3))}` })
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
    setTOk('')
    setBusy(true)
    const added = tName.trim()
    try {
      await addTrainer(eventId, added, tPhone.trim())
      setTName('')
      setTPhone('')
      setTOk(`Added ${added}. Next, create the trainer link in step 3 and send it to them.`)
      refresh()
    } catch (e) {
      setTErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  if (err) return (
    <div style={wrap}>
      <Notice variant="danger">
        {err === 'not_found'
          ? 'This event is not on the server any more. It was probably created before the server was reset. It has been removed from your list. Create a new event to continue.'
          : err}
      </Notice>
      <p style={{ marginTop: 16 }}><a href="#/organizer">Back to events</a></p>
    </div>
  )
  if (!ev) return <div style={wrap}><p className="small">Loading event.</p></div>

  const pTotal = Object.values(pCounts).reduce((a, b) => a + Number(b || 0), 0)
  const csvDone = pTotal > 0 || csvTotal !== undefined
  const signedUp = trainers.filter((t) => t.wallet).length
  const grand = csvTotal ?? (ev.grand_total ? str(ev.grand_total) : ev.grandTotal ? str(ev.grandTotal) : undefined)
  const funded = str(ev.status) === 'funded'
  const days = num(ev.days)
  const startTs = num(ev.start_ts)
  const event = {
    id: eventId,
    name: str(ev.name),
    days,
    decimals,
    token_mint: str(ev.token_mint),
    max_participants: num(ev.max_participants),
    start_ts: startTs,
    day_len_seconds: num(ev.day_len_seconds, 86400),
    grand_total: grand,
  }

  const s1: StepStatus = trainers.length > 0 ? 'done' : 'next'
  const s2: StepStatus = csvDone ? 'done' : 'next'
  const s3: StepStatus = signedUp > 0 ? 'done' : trainers.length > 0 && csvDone ? 'next' : 'locked'
  const s4: StepStatus = funded ? 'done' : csvDone && signedUp > 0 ? 'next' : 'locked'

  return (
    <div style={wrap}>
      <p style={{ marginBottom: 16 }}><a href="#/organizer">All events</a></p>
      <h1 style={{ marginBottom: 8 }}>{event.name}</h1>
      <p className="small" style={{ marginBottom: 32 }}>
        {days} day{days === 1 ? '' : 's'}
        {startTs > 0 ? `, starting ${new Date(startTs * 1000).toISOString().slice(0, 10)}` : ''}.
        {grand ? ` The vault needs ${formatAmount(grand, decimals)} ${TOKEN}.` : ''}
      </p>

      <div style={{ marginBottom: 48, maxWidth: 640 }}>
        <Card style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 8 }}>How this works</h3>
          <p className="small">
            You set the stipend for each day and put that money in a vault. A trainer and a participant both sign each check-in, and the day's stipend is paid straight away. Anything nobody earned goes back to you at the end. Work through the four steps below in order.
          </p>
        </Card>
      </div>

      <Step n={1} title="Add your trainers" status={s1} help="Trainers run the daily check-in. Add each one by name and phone number. They will use the phone number to sign up.">
        {trainers.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <Card>
              <Table>
                <TableHead>
                  <TableRow><th>Name</th><th>Phone</th><th>Progress</th></TableRow>
                </TableHead>
                <tbody>
                  {trainers.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.name}</TableCell>
                      <TableCell>{t.phone}</TableCell>
                      <TableCell status={t.state === 'invited' ? 'warn' : 'accent'}>{STATE_TEXT[t.state] ?? t.state}</TableCell>
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
          {tOk && <Notice>{tOk}</Notice>}
          <Button variant="secondary" disabled={busy || !tName.trim() || !tPhone.trim()} onClick={sendTrainer}>
            {busy ? 'Adding' : 'Add trainer'}
          </Button>
        </div>
      </Step>

      <Step n={2} title="Upload your participants" status={s2} help={`Upload a CSV with one row per participant. Each day column holds the stipend for that day, in ${TOKEN}. The total of all rows is what the vault must hold.`}>
        <div style={{ ...row, maxWidth: 560 }}>
          <p className="small">Columns: name, email, phone, day1, day2 and so on. Example row: Amina Wanjiku,amina@example.com,0712000001,100,100,100</p>
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
          {csvDone && !csvMsg && <Notice>{pTotal} participants are loaded.</Notice>}
          <Button variant="secondary" disabled={busy || !csv.trim()} onClick={sendCsv}>{busy ? 'Uploading' : 'Upload CSV'}</Button>
        </div>
      </Step>

      <Step n={3} title="Send links and check status" status={s3} help="Create the trainer link below and send it to each trainer. They open it, make a login and a wallet, and show up here as signed up. Come back to this section after step 4 to create the participant link and follow payments.">
        <Status eventId={eventId} organizerWallet={wallet} />
      </Step>

      <Step n={4} title="Create the programme and fund the vault" status={s4} help="This puts the programme on Solana devnet, moves the stipend money into the vault, and registers the trainers who have signed up. Phantom will ask you to approve each transaction.">
        {!csvDone ? (
          <Notice variant="warn">Upload your participants in step 2 first. The vault amount comes from that file.</Notice>
        ) : (
          <>
            {signedUp === 0 && (
              <div style={{ marginBottom: 16 }}>
                <Notice variant="warn">No trainer has signed up yet. Only trainers who have signed up can be registered on chain, so the create button appears here once one has signed up (step 3).</Notice>
              </div>
            )}
            {signedUp > 0 && <Programme event={event} trainers={trainers} organizerWallet={wallet} onDone={refresh} />}
          </>
        )}
      </Step>
    </div>
  )
}
