/// <reference types="vite/client" />
import { useState } from 'react'
import bs58 from 'bs58'
import { Connection, Keypair, Transaction } from '@solana/web3.js'
import { Button, Field, Input, Card, Notice, Qr } from '../ui'
import { claim, claimUnlock, getRelay, getConfig, ApiError } from '../lib/api'
import { explain } from '../lib/errors'
import { createWallet, encryptKey, decryptKey, loadCache, saveCache } from '../lib/keys'
import { shortAddress, currentDay } from '../lib/format'
import { verifyRelayedTx } from '../lib/chain'

// Route: #/join/<eventId>/<code>
// Step 1 – claim:   phone + PIN → keypair → encrypt → POST /claim → cache pubkey
// Step 2 – wallet:  show wallet address as QR
// Step 3 – sign:    paste relay ID → GET /relay/:id → verifyRelayedTx → PIN →
//                   claimUnlock → decryptKey → add signature → sendRawTransaction → confirm

type Step = 'claim' | 'wallet' | 'sign'

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
        <WalletStep pubkey={pubkey} onCheckIn={() => setStep('sign')} />
      )}
      {step === 'sign' && (
        <SignStep code={code} pubkey={pubkey} onDone={() => setStep('wallet')} />
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
      <Button variant="secondary" large onClick={onCheckIn}>
        Sign a check-in
      </Button>
    </>
  )
}

// ── Step 3: Sign check-in ─────────────────────────────────────────────────────
// Sub-states within this step:
//   'idle'     – waiting for relay ID input
//   'preview'  – tx verified, showing summary, waiting for PIN
//   'signing'  – decrypting key and sending tx
//   'done'     – confirmed, showing result

type SignSubStep = 'idle' | 'preview' | 'signing' | 'done'

interface VerifiedTx {
  txBase64: string
  day: number
  secondsLeft: number
}

function SignStep({
  code,
  pubkey,
  onDone,
}: {
  code: string
  pubkey: string
  onDone: () => void
}) {
  const [sub, setSub] = useState<SignSubStep>('idle')
  const [relayId, setRelayId] = useState('')
  const [pin, setPin] = useState('')
  const [verified, setVerified] = useState<VerifiedTx | null>(null)
  const [txSig, setTxSig] = useState('')
  const [paidDay, setPaidDay] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // ── Phase 1: fetch and verify the relay transaction ──────────────────────────
  async function fetchAndVerify(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const cfg = await getConfig()
      if (!cfg.programmeAddress || !cfg.mint || !cfg.startTs || !cfg.dayLen || cfg.days == null) {
        setErr('Programme is not configured yet. Ask the organizer to set PROGRAMME_ADDRESS and restart.')
        return
      }

      const relay = await getRelay(relayId.trim())

      if (relay.secondsLeft <= 0) {
        setErr(explain('expired'))
        return
      }

      const nowSec = Math.floor(Date.now() / 1000)
      const expectedDay = currentDay(nowSec, Number(cfg.startTs), Number(cfg.dayLen))

      const check = verifyRelayedTx(relay.tx, {
        programId: cfg.programId,
        expectedDay,
        traineePubkey: pubkey,
        programme: cfg.programmeAddress,
        mint: cfg.mint,
      })

      if (!check.ok) {
        setErr(`Transaction check failed: ${check.reason}. Do not sign.`)
        return
      }

      setVerified({ txBase64: relay.tx, day: expectedDay, secondsLeft: relay.secondsLeft })
      setSub('preview')
    } catch (e: unknown) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  // ── Phase 2: unlock key, add signature, send ─────────────────────────────────
  async function signAndSend(e: React.FormEvent) {
    e.preventDefault()
    if (!verified) return
    setErr('')
    setSub('signing')
    try {
      const cfg = await getConfig()
      if (!cfg.programmeAddress) throw new Error('programme_not_created')

      // Unlock: server verifies PIN attempt count, returns encrypted blob
      const cached = loadCache()
      const unlocked = await claimUnlock(code, cached.contact ?? '', pin)

      // Decrypt key — throws 'wrong_pin' if PIN is wrong
      const secretKey = await decryptKey(unlocked.encryptedKeyBlob, pin)
      const kp = Keypair.fromSecretKey(secretKey)

      // Deserialise the partially-signed transaction from the relay
      const tx = Transaction.from(Buffer.from(verified.txBase64, 'base64'))

      // Add trainee's signature (second signer)
      tx.partialSign(kp)

      const rpcUrl = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com'
      const conn = new Connection(rpcUrl, 'confirmed')

      // sendRawTransaction — trainee wallet needs no SOL; trainer already paid the fee
      const rawTx = tx.serialize()
      const sig = await conn.sendRawTransaction(rawTx, { skipPreflight: false })
      await conn.confirmTransaction(sig, 'confirmed')

      setTxSig(sig)
      setPaidDay(verified.day)
      setSub('done')
    } catch (e: unknown) {
      const msg = errMsg(e)
      setErr(msg)
      setSub('preview')
    }
  }

  // ── idle: relay ID input ──────────────────────────────────────────────────────
  if (sub === 'idle') {
    return (
      <Card style={{ padding: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', fontWeight: 500, marginBottom: 8 }}>
          Sign check-in
        </h1>
        <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 24 }}>
          Paste the relay code shown on the trainer's screen.
        </p>
        {err && <div style={{ marginBottom: 16 }}><Notice variant="danger">{err}</Notice></div>}
        <form onSubmit={fetchAndVerify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Relay ID" hint="The trainer's screen shows this code after they start a check-in.">
            <Input
              placeholder="e.g. relay_abc123"
              value={relayId}
              onChange={e => setRelayId(e.target.value.trim())}
              required
              autoComplete="off"
              style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: '0.9em' }}
            />
          </Field>
          <Button variant="primary" large type="submit" disabled={busy || !relayId}>
            {busy ? 'Checking…' : 'Fetch and verify'}
          </Button>
        </form>
        <Button variant="text" onClick={onDone} style={{ marginTop: 8 }}>
          Back
        </Button>
      </Card>
    )
  }

  // ── preview: show what will be signed, ask for PIN ───────────────────────────
  if (sub === 'preview' && verified) {
    return (
      <Card style={{ padding: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', fontWeight: 500, marginBottom: 16 }}>
          Confirm check-in
        </h1>
        <div style={{ marginBottom: 16 }}>
          <Notice>
            Transaction verified. Day {verified.day + 1}. Code expires in {verified.secondsLeft}s.
          </Notice>
        </div>
        <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 8 }}>
          Your wallet:{' '}
          <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: '0.9em' }}>
            {shortAddress(pubkey)}
          </span>
        </p>
        {err && <div style={{ marginBottom: 16 }}><Notice variant="danger">{err}</Notice></div>}
        <form onSubmit={signAndSend} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="6-digit PIN" hint="Unlocking takes about a second.">
            <Input
              type="password"
              inputMode="numeric"
              placeholder="••••••"
              maxLength={6}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              autoComplete="current-password"
              hasError={!!err}
            />
          </Field>
          <Button variant="primary" large type="submit" disabled={!pin}>
            Sign and send
          </Button>
        </form>
        <Button variant="text" onClick={() => { setSub('idle'); setVerified(null); setErr('') }} style={{ marginTop: 8 }}>
          Cancel
        </Button>
      </Card>
    )
  }

  // ── signing: in-progress ──────────────────────────────────────────────────────
  if (sub === 'signing') {
    return (
      <Card style={{ padding: 24 }}>
        <p className="small" style={{ color: 'var(--ink-2)' }}>Unlocking…</p>
      </Card>
    )
  }

  // ── done: success ─────────────────────────────────────────────────────────────
  return (
    <Card style={{ padding: 24 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.25rem', fontWeight: 500, marginBottom: 16 }}>
        Checked in
      </h1>
      <div style={{ marginBottom: 16 }}>
        <Notice>Day {paidDay + 1} check-in confirmed.</Notice>
      </div>
      <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 16 }}>
        Transaction:{' '}
        <a
          href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent)', fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: '0.9em' }}
        >
          {shortAddress(txSig)}
        </a>
      </p>
      <Button variant="secondary" large onClick={onDone}>
        Back to wallet
      </Button>
    </Card>
  )
}
