/// <reference types="vite/client" />
import { useState } from 'react'
import { Connection, PublicKey } from '@solana/web3.js'
import { Button, Card, Notice, Stat, Copy } from '../ui'
import {
  getConfig,
  getEvent,
  syncTrainers,
  ApiError,
  type ConfigResponse,
} from '../lib/api'
import { explain } from '../lib/errors'
import { formatAmount, shortAddress } from '../lib/format'
import {
  buildCreateProgramme,
  buildFund,
  buildAddTrainer,
  programmePda,
} from '../lib/chain'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Trainer {
  id: string
  name: string
  phone: string
  wallet: string | null
  state: string
}

interface EventRow {
  id: string
  name: string
  days: number
  decimals: number
  token_mint: string
  max_participants: number
  start_ts: number
  day_len_seconds: number
  /** grandTotal from CSV upload, base units as string */
  grand_total?: string
}

export interface ProgrammeProps {
  /** Full event row from GET /events/:id */
  event: EventRow
  /** Trainers already added via POST /events/:id/trainers */
  trainers: Trainer[]
  /** Phantom wallet public key (base58) — organizer must be connected */
  organizerWallet: string
  /** Called after programme is created and funded so parent can refresh */
  onDone: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return explain(e.code)
  const msg = (e as Error)?.message ?? 'unknown'
  // surface Anchor / program error names embedded in RPC error messages
  const match = /Error Code: (\w+)/.exec(msg) ?? /custom program error: 0x(\w+)/.exec(msg)
  if (match) return explain(match[1])
  return explain(msg)
}

function rpc(): Connection {
  const url = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com'
  return new Connection(url, 'confirmed')
}

async function phantomSignAndSend(tx: import('@solana/web3.js').Transaction, conn: Connection): Promise<string> {
  const phantom = (window as { solana?: { signTransaction: (t: unknown) => Promise<import('@solana/web3.js').Transaction> } }).solana
  if (!phantom) throw new Error('Phantom wallet not found. Install Phantom and refresh.')
  const signed = await phantom.signTransaction(tx)
  const raw = signed.serialize()
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false })
  await conn.confirmTransaction(sig, 'confirmed')
  return sig
}

// ── Component ─────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'creating' | 'funding' | 'registering' | 'syncing' | 'done'

export default function Programme({ event, trainers, organizerWallet, onDone }: ProgrammeProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState('')
  const [programmeAddress, setProgrammeAddress] = useState('')
  const [configMatch, setConfigMatch] = useState(false)
  const [syncResult, setSyncResult] = useState<{ registered: number; pending: number } | null>(null)

  // Check whether /config already reports this programme (backend restarted)
  async function checkConfig(addr: string) {
    try {
      const cfg = await getConfig()
      setConfigMatch(cfg.programmeAddress === addr)
    } catch {
      setConfigMatch(false)
    }
  }

  async function run() {
    setErr('')
    setPhase('creating')

    let cfg: ConfigResponse
    try {
      cfg = await getConfig()
    } catch (e) {
      setErr(errMsg(e))
      setPhase('idle')
      return
    }

    const conn = rpc()
    const organizer = new PublicKey(organizerWallet)
    const mint = new PublicKey(event.token_mint)
    const programmeId = BigInt(Date.now())
    const backendKey = new PublicKey(cfg.backendKey)
    const startTs = BigInt(event.start_ts)
    const dayLen = BigInt(event.day_len_seconds)

    // ── 1. create_programme ───────────────────────────────────────────────────
    try {
      const tx = buildCreateProgramme(
        organizer,
        programmeId,
        backendKey,
        startTs,
        dayLen,
        event.days,
        event.max_participants,
        mint,
      )
      const { blockhash } = await conn.getLatestBlockhash()
      tx.recentBlockhash = blockhash
      await phantomSignAndSend(tx, conn)
    } catch (e) {
      setErr(errMsg(e))
      setPhase('idle')
      return
    }

    const progAddr = programmePda(organizer, programmeId).toBase58()
    setProgrammeAddress(progAddr)

    // ── 2. fund ───────────────────────────────────────────────────────────────
    setPhase('funding')
    try {
      // Use grandTotal from CSV if available; fall back to fetching event totals
      let amount: bigint
      if (event.grand_total) {
        amount = BigInt(event.grand_total)
      } else {
        const ev = await getEvent(event.id) as { grand_total?: string; grandTotal?: string }
        amount = BigInt((ev.grand_total ?? ev.grandTotal ?? '0') as string)
      }
      const tx = buildFund(organizer, programmeId, amount, mint)
      const { blockhash } = await conn.getLatestBlockhash()
      tx.recentBlockhash = blockhash
      await phantomSignAndSend(tx, conn)
    } catch (e) {
      setErr(errMsg(e))
      setPhase('idle')
      return
    }

    // ── 3. add_trainer for each trainer that has a wallet ────────────────────
    setPhase('registering')
    const walleted = trainers.filter(t => t.wallet && t.state !== 'registered')
    for (const trainer of walleted) {
      try {
        const tx = buildAddTrainer(organizer, programmeId, new PublicKey(trainer.wallet!))
        const { blockhash } = await conn.getLatestBlockhash()
        tx.recentBlockhash = blockhash
        await phantomSignAndSend(tx, conn)
      } catch (e) {
        // Non-fatal: trainer may already be registered; log and continue
        console.warn(`add_trainer for ${trainer.name}:`, errMsg(e))
      }
    }

    // ── 4. sync ───────────────────────────────────────────────────────────────
    setPhase('syncing')
    try {
      const result = await syncTrainers(event.id)
      setSyncResult(result)
    } catch (e) {
      // Non-fatal: sync can be retried
      console.warn('sync:', errMsg(e))
    }

    await checkConfig(progAddr)
    setPhase('done')
    onDone()
  }

  const busy = phase !== 'idle' && phase !== 'done'

  const phaseLabel: Record<Phase, string> = {
    idle: 'Create programme',
    creating: 'Creating programme…',
    funding: 'Funding vault…',
    registering: 'Registering trainers…',
    syncing: 'Syncing…',
    done: 'Done',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500, marginBottom: 4 }}>
          Programme
        </h2>
        <p className="small" style={{ color: 'var(--ink-2)' }}>
          Creates the programme on chain, funds the vault, and registers any trainers who have signed up.
        </p>
      </div>

      {/* Event summary */}
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <Stat label="Days" value={String(event.days)} />
        <Stat label="Trainers" value={String(trainers.length)} />
        <Stat
          label="Grand total"
          value={event.grand_total ? formatAmount(event.grand_total, event.decimals) : '—'}
          unit="test tokens"
        />
      </div>

      {err && (
        <div><Notice variant="danger">{err}</Notice></div>
      )}

      {/* PROGRAMME_ADDRESS notice — shown after creation until config matches */}
      {programmeAddress && (
        <Card style={{ padding: 20 }}>
          <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 8 }}>
            Programme address
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <code style={{
              flex: 1,
              fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
              fontSize: '0.9em',
              wordBreak: 'break-all',
              color: 'var(--ink)',
            }}>
              {programmeAddress}
            </code>
            <Copy text={programmeAddress} />
          </div>
          {!configMatch ? (
            <Notice variant="warn">
              Set PROGRAMME_ADDRESS to this address on the backend and restart it.
              Links and claims will not work until you do.
            </Notice>
          ) : (
            <Notice>Backend is configured with this programme address.</Notice>
          )}
          {!configMatch && (
            <Button
              variant="secondary"
              onClick={() => checkConfig(programmeAddress)}
              style={{ marginTop: 12 }}
            >
              Check again
            </Button>
          )}
        </Card>
      )}

      {/* Sync result */}
      {syncResult && (
        <div>
          <Notice>
            Sync complete. {syncResult.registered} trainer{syncResult.registered !== 1 ? 's' : ''} registered
            {syncResult.pending > 0 ? `, ${syncResult.pending} pending` : ''}.
          </Notice>
        </div>
      )}

      {/* Trainer list */}
      {trainers.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--sunken)' }}>
                <th style={TH}>Name</th>
                <th style={TH}>Wallet</th>
                <th style={TH}>State</th>
              </tr>
            </thead>
            <tbody>
              {trainers.map(t => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={TD}>{t.name}</td>
                  <td style={{ ...TD, fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: '0.85em' }}>
                    {t.wallet ? shortAddress(t.wallet) : <span style={{ color: 'var(--ink-3)' }}>not signed up</span>}
                  </td>
                  <td style={{ ...TD, color: stateColor(t.state) }}>{t.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Button
        variant="primary"
        large
        onClick={run}
        disabled={busy || phase === 'done'}
      >
        {phaseLabel[phase]}
      </Button>
    </div>
  )
}

const TH: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 16px',
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--ink-2)',
}

const TD: React.CSSProperties = {
  padding: '14px 16px',
  fontSize: '0.875rem',
  color: 'var(--ink)',
}

function stateColor(state: string): string {
  if (state === 'registered') return 'var(--accent)'
  if (state === 'funded' || state === 'signed_up') return 'var(--warn)'
  return 'var(--ink-2)'
}
