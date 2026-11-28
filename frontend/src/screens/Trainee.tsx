import { useState } from 'react'
import bs58 from 'bs58'
import { Button, Field, Input, Card, Notice, Qr } from '../ui'
import { claim, ApiError } from '../lib/api'
import { explain } from '../lib/errors'
import { createWallet, encryptKey, loadCache, saveCache } from '../lib/keys'
import { shortAddress } from '../lib/format'

// Route: #/join/<eventId>/<code>
// Step 1 – claim: phone + PIN → keypair → encrypt → POST /claim → cache pubkey
// Step 2 – wallet: show wallet address as QR
// Step 3 – TASK 11 placeholder: sign the relayed check_in transaction

type Step = 'claim' | 'wallet' | 'task11'

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

export function Trainee({ eventId: _eventId, code }: { eventId: string; code: string }) {
  const cached = loadCache()
  const initial: Step = cached.walletPublicKey && cached.linkCode === code ? 'wallet' : 'claim'
  const [step, setStep] = useState<Step>(initial)
  const [pubkey, setPubkey] = useState(cached.walletPublicKey ?? '')

  return (
    <div style={SCREEN}>
      <p style={WORDMARK}>PayDay</p>
      {step === 'claim' && (
        <ClaimStep code={code} onDone={pk => { setPubkey(pk); setStep('wallet') }} />
      )}
      {step === 'wallet' && (
        <WalletStep pubkey={pubkey} onCheckIn={() => setStep('task11')} />
      )}
      {step === 'task11' && (
        <Task11Placeholder pubkey={pubkey} />
      )}
    </div>
  )
}

// ── Step 1: Claim ─────────────────────────────────────────────────────────────

function ClaimStep({ code, onDone }: { code: string; onDone: (pk: string) => void }) {
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!/^\d{6}$/.test(pin)) { setErr('PIN must be exactly 6 digits.'); return }
    setBusy(true)
    try {
      const kp = createWallet()
      const wallet = bs58.encode(kp.publicKey)
      const blob = await encryptKey(kp.secretKey, pin)
      await claim({ linkCode: code, phone, pin, wallet, encryptedKeyBlob: blob })
      saveCache({ walletPublicKey: wallet, role: 'trainee', linkCode: code, contact: phone })
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
        Claim your wallet
      </h1>
      <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 24 }}>
        Your wallet is created in this browser and encrypted with your PIN before anything is sent.
      </p>
      {err && <div style={{ marginBottom: 16 }}><Notice variant="danger">{err}</Notice></div>}
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Phone number">
          <Input
            type="tel"
            placeholder="+254 700 000 000"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            required
            autoComplete="tel"
          />
        </Field>
        <Field label="6-digit PIN" hint="You will need this PIN every time you check in.">
          <Input
            type="password"
            inputMode="numeric"
            placeholder="••••••"
            maxLength={6}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
            autoComplete="new-password"
            hasError={!!err}
          />
        </Field>
        <Button variant="primary" large type="submit" disabled={busy} style={{ marginTop: 8 }}>
          {busy ? 'Unlocking…' : 'Claim wallet'}
        </Button>
      </form>
    </Card>
  )
}

// ── Step 2: Wallet QR ─────────────────────────────────────────────────────────

function WalletStep({ pubkey, onCheckIn }: { pubkey: string; onCheckIn: () => void }) {
  return (
    <>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', fontWeight: 500, marginBottom: 8 }}>
          Your wallet
        </h1>
        <p className="small" style={{ color: 'var(--ink-2)' }}>
          Show this QR to your trainer when checking in. Your wallet needs no SOL.
        </p>
      </div>
      <Qr data={pubkey} caption={shortAddress(pubkey)} size={260} />
      <p className="small" style={{ color: 'var(--ink-2)', wordBreak: 'break-all', fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: '0.9em' }}>
        {pubkey}
      </p>
      {/* TASK 11 entry point — trainer posts relay QR, trainee scans and signs */}
      <Button variant="secondary" large onClick={onCheckIn}>
        Sign a check-in
      </Button>
    </>
  )
}

// ── TASK 11 placeholder ───────────────────────────────────────────────────────
// Wire up: GET /relay/:id → verifyRelayedTx → claimUnlock → decryptKey → sign → sendRawTransaction

function Task11Placeholder({ pubkey }: { pubkey: string }) {
  const [relayId, setRelayId] = useState('')

  return (
    <Card style={{ padding: 24 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', fontWeight: 500, marginBottom: 16 }}>
        Sign check-in
      </h1>
      {/* ── TASK 11 ──────────────────────────────────────────────────────────────
          1. Scan trainer's relay QR (camera) or paste the relay id below.
          2. GET /relay/:id → decode tx → verifyRelayedTx (chain.ts).
          3. Prompt PIN → claimUnlock → decryptKey → nacl.sign.
          4. Add second signature → Connection.sendRawTransaction → confirm.
          5. Show "Paid X units for day N".
          Use: getRelay, verifyRelayedTx, claimUnlock, decryptKey from lib/.
      ──────────────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <Notice variant="warn">Check-in signing is not yet available (Task 11).</Notice>
      </div>
      <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 16 }}>
        Wallet:{' '}
        <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: '0.9em' }}>
          {shortAddress(pubkey)}
        </span>
      </p>
      <Field label="Relay ID" hint="Paste the code shown on the trainer's screen.">
        <Input
          placeholder="e.g. relay_abc123"
          value={relayId}
          onChange={e => setRelayId(e.target.value.trim())}
        />
      </Field>
      <Button variant="primary" large disabled style={{ marginTop: 16 }}>
        Verify &amp; sign — Task 11
      </Button>
    </Card>
  )
}
