/// <reference types="vite/client" />
import { useState } from 'react'
import bs58 from 'bs58'
import { Connection, PublicKey } from '@solana/web3.js'
import { Button, Field, Input, Card, Notice, Qr, Countdown, Copy } from '../ui'
import { trainerSignup, trainerUnlock, postRelay, getConfig, ApiError, resolveTrainee } from '../lib/api'
import { explain } from '../lib/errors'
import { createWallet, encryptKey, decryptKey, loadCache, saveCache } from '../lib/keys'
import { currentDay } from '../lib/format'
import nacl from 'tweetnacl'
import { buildCheckIn, serialisePartial } from '../lib/chain'

// Route: #/trainer/<eventId>/<code>
// Step 1 – signup:  username + phone + password → keypair → encrypt → POST /trainer/signup
// Step 2 – unlock:  username + password → POST /trainer/unlock → decrypt key into memory
// Step 3 – ready:   paste trainee pubkey → build check_in tx → partial-sign → POST /relay
// Step 4 – relay:   show relay QR + plain ID (paste fallback) + Countdown (60 s)

type Step = 'signup' | 'unlock' | 'ready' | 'relay'

const SCREEN: React.CSSProperties = {
  maxWidth: 440,
  margin: '0 auto',
  padding: '48px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
}

const WORDMARK: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '1.25rem',
  fontWeight: 500,
  color: 'var(--accent)',
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return explain(e.code)
  return explain((e as Error)?.message ?? 'unknown')
}

export function Trainer({ eventId, code }: { eventId: string; code: string }) {
  const cached = loadCache()
  const alreadySignedUp = cached.linkCode === code && !!cached.contact
  const [step, setStep] = useState<Step>(alreadySignedUp ? 'unlock' : 'signup')
  const [trainerWallet, setTrainerWallet] = useState(cached.walletPublicKey ?? '')
  // secretKey held in memory only — never stored
  const [secretKey, setSecretKey] = useState<Uint8Array | null>(null)
  const [relayId, setRelayId] = useState('')
  const [relayExpiry, setRelayExpiry] = useState(0)

  return (
    <div style={SCREEN}>
      <p style={WORDMARK}>PayDay</p>
      {step === 'signup' && (
        <SignupStep
          code={code}
          onDone={wallet => { setTrainerWallet(wallet); setStep('unlock') }}
        />
      )}
      {step === 'unlock' && (
        <UnlockStep
          code={code}
          onDone={(wallet, sk) => { setTrainerWallet(wallet); setSecretKey(sk); setStep('ready') }}
        />
      )}
      {step === 'ready' && secretKey && (
        <ReadyStep
          eventId={eventId}
          trainerWallet={trainerWallet}
          secretKey={secretKey}
          onRelay={(id, expiry) => { setRelayId(id); setRelayExpiry(expiry); setStep('relay') }}
        />
      )}
      {step === 'relay' && (
        <RelayStep
          relayId={relayId}
          expiresAt={relayExpiry}
          onReset={() => setStep('ready')}
        />
      )}
    </div>
  )
}

// ── Step 1: Signup ────────────────────────────────────────────────────────────

function usernameProblem(u: string): string {
  if (u.length < 3) return 'Too short. Use at least 3 characters.'
  if (u.length > 32) return 'Too long. Use at most 32 characters.'
  const bad = Array.from(new Set(u.match(/[^a-z0-9_]/g) ?? []))
  if (bad.length > 0) {
    const shown = bad.map((c) => (c === ' ' ? 'space' : c)).join(' ')
    return 'Not allowed: ' + shown + '. Use lowercase letters, digits and underscores only.'
  }
  return ''
}

function passwordProblem(pw: string): string {
  return pw.length < 8 ? 'Too short. Use at least 8 characters (' + pw.length + ' so far).' : ''
}

function SignupStep({ code, onDone }: { code: string; onDone: (wallet: string) => void }) {
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const userMsg = username ? usernameProblem(username) : ''
  const passMsg = password ? passwordProblem(password) : ''
  const formOk = usernameProblem(username) === '' && passwordProblem(password) === '' && phone.trim() !== ''

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const kp = createWallet()
      const wallet = bs58.encode(kp.publicKey)
      const blob = await encryptKey(kp.secretKey, password)
      await trainerSignup({ linkCode: code, username, phone, password, wallet, encryptedKeyBlob: blob })
      saveCache({ walletPublicKey: wallet, role: 'trainer', linkCode: code, contact: username })
      onDone(wallet)
    } catch (e: unknown) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ padding: 24 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', fontWeight: 500, marginBottom: 8 }}>
        Trainer sign-up
      </h1>
      <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 24 }}>
        Your signing key is created in this browser and encrypted with your password.
      </p>
      {err && <div style={{ marginBottom: 16 }}><Notice variant="danger">{err}</Notice></div>}
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Username" hint="3 to 32 characters. Lowercase letters, digits and underscores only, for example mark_anthony." error={userMsg || undefined}>
          <Input
            placeholder="e.g. amara"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
        </Field>
        <Field label="Phone number" hint="Use the number the organizer registered for you.">
          <Input
            type="tel"
            placeholder="+254 700 000 000"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            required
            autoComplete="tel"
          />
        </Field>
        <Field label="Password" hint="At least 8 characters. It encrypts your signing key, so you will need it every time you check in." error={passMsg || undefined}>
          <Input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </Field>
        <Button variant="primary" large type="submit" disabled={busy || !formOk} style={{ marginTop: 8 }}>
          {busy ? 'Unlocking…' : 'Sign up'}
        </Button>
      </form>
    </Card>
  )
}

// ── Step 2: Unlock ────────────────────────────────────────────────────────────

function UnlockStep({
  code,
  onDone,
}: {
  code: string
  onDone: (wallet: string, secretKey: Uint8Array) => void
}) {
  const cached = loadCache()
  const [username, setUsername] = useState(cached.contact ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const res = await trainerUnlock(code, username, password)
      const sk = await decryptKey(res.encryptedKeyBlob, password)
      saveCache({ walletPublicKey: res.wallet, role: 'trainer', linkCode: code, contact: username })
      onDone(res.wallet, sk)
    } catch (e: unknown) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ padding: 24 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', fontWeight: 500, marginBottom: 8 }}>
        Unlock
      </h1>
      <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 24 }}>
        Enter your password to decrypt your signing key. It stays in memory only.
      </p>
      {err && <div style={{ marginBottom: 16 }}><Notice variant="danger">{err}</Notice></div>}
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Username">
          <Input
            placeholder="e.g. amara"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        <Button variant="primary" large type="submit" disabled={busy} style={{ marginTop: 8 }}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </form>
    </Card>
  )
}

// ── Step 3: Ready — enter trainee pubkey, build tx, post relay ────────────────

function ReadyStep({
  eventId,
  trainerWallet,
  secretKey,
  onRelay,
}: {
  eventId: string
  trainerWallet: string
  secretKey: Uint8Array
  onRelay: (id: string, expiresAt: number) => void
}) {
  const [traineePhone, setTraineePhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function startCheckIn(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const cfg = await getConfig()
      if (!cfg.programmeAddress || !cfg.mint || !cfg.startTs || !cfg.dayLen || cfg.days == null) {
        setErr('Programme is not configured yet. Ask the organizer to set PROGRAMME_ADDRESS and restart.')
        setBusy(false)
        return
      }

      const nowSec = Math.floor(Date.now() / 1000)
      const startTs = Number(cfg.startTs)
      const dayLen = Number(cfg.dayLen)
      const day = currentDay(nowSec, startTs, dayLen)

      // Warn if within 3 seconds of a day boundary
      const secIntoDay = (nowSec - startTs) % dayLen
      if (secIntoDay < 3 || dayLen - secIntoDay < 3) {
        setErr('Clock is within 3 seconds of a day boundary. Wait a moment and try again.')
        setBusy(false)
        return
      }

      const trainer = new PublicKey(trainerWallet)
      let wallet: string
      try {
        wallet = (await resolveTrainee(eventId, traineePhone)).wallet
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code
        if (code === 'not_on_list') setErr('That number is not on this programme\'s list.')
        else if (code === 'not_claimed') setErr('This trainee has not claimed their wallet yet. Ask them to claim it first.')
        else setErr(errMsg(e))
        setBusy(false)
        return
      }
      const trainee = new PublicKey(wallet)
      const programme = new PublicKey(cfg.programmeAddress)
      const mint = new PublicKey(cfg.mint)

      const tx = buildCheckIn(trainer, trainee, programme, mint, day)

      const rpcUrl = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com'
      const conn = new Connection(rpcUrl, 'confirmed')
      const { blockhash } = await conn.getLatestBlockhash()
      tx.recentBlockhash = blockhash
      tx.feePayer = trainer

      // Partial-sign as trainer (first signer, fee payer)
      const kp = nacl.sign.keyPair.fromSecretKey(secretKey)
      tx.partialSign({ publicKey: trainer, secretKey: kp.secretKey })

      const txBase64 = serialisePartial(tx)
      const relay = await postRelay(eventId, txBase64)
      onRelay(relay.id, relay.expiresAt)
    } catch (e: unknown) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ padding: 24 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', fontWeight: 500, marginBottom: 8 }}>
        Start check-in
      </h1>
      <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 24 }}>
        Ask the trainee to type their phone number below.
      </p>
      {err && <div style={{ marginBottom: 16 }}><Notice variant="danger">{err}</Notice></div>}
      <form onSubmit={startCheckIn} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Trainee phone number" hint="The number the organizer registered for the trainee.">
          <Input
            type="tel"
            placeholder="+254 700 000 000"
            value={traineePhone}
            onChange={e => setTraineePhone(e.target.value)}
            required
            autoComplete="tel"
          />
        </Field>
        <Button variant="primary" large type="submit" disabled={busy || !traineePhone}>
          {busy ? 'Building transaction…' : 'Start check-in'}
        </Button>
      </form>
      <p className="small" style={{ color: 'var(--ink-2)', marginTop: 16, wordBreak: 'break-all', fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: '0.9em' }}>
        Trainer: {trainerWallet}
      </p>
    </Card>
  )
}

// ── Step 4: Relay QR + plain ID + Countdown ───────────────────────────────────

function RelayStep({
  relayId,
  expiresAt,
  onReset,
}: {
  relayId: string
  expiresAt: number
  onReset: () => void
}) {
  const secondsLeft = Math.max(0, expiresAt - Math.floor(Date.now() / 1000))
  const [expired, setExpired] = useState(secondsLeft === 0)

  return (
    <>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', fontWeight: 500, marginBottom: 8 }}>
          Show trainee
        </h1>
        <p className="small" style={{ color: 'var(--ink-2)' }}>
          Ask the trainee to paste the code below. It expires in 60 seconds.
        </p>
      </div>
      {!expired ? (
        <>
          <Qr data={relayId} caption="Relay code" size={260} />
          {/* Plain-text fallback so the trainee can paste without a camera */}
          <Card style={{ padding: 16 }}>
            <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 8 }}>Relay ID</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <code style={{
                flex: 1,
                fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                fontSize: '0.9em',
                wordBreak: 'break-all',
                color: 'var(--ink)',
              }}>
                {relayId}
              </code>
              <Copy text={relayId} />
            </div>
          </Card>
          <Countdown
            key={relayId}
            initialSeconds={secondsLeft}
            onExpire={() => setExpired(true)}
          />
        </>
      ) : (
        <>
          <div><Notice variant="warn">The code has expired. Build a new one.</Notice></div>
          <Button variant="primary" large onClick={onReset}>
            Make a new code
          </Button>
        </>
      )}
    </>
  )
}
