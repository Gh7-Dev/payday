/// <reference types="vite/client" />
import { useState, useEffect, useCallback } from 'react'
import { Connection, PublicKey } from '@solana/web3.js'
import { Button, Card, Notice, Stat, Modal, Copy, DayStrip } from '../ui'
import type { CellState } from '../ui'
import {
  getEvent,
  getChainStatus,
  createLink,
  syncTrainers,
  ApiError,
  type ChainStatus,
} from '../lib/api'
import { explain } from '../lib/errors'
import { formatAmount, shortAddress, currentDay } from '../lib/format'
import { buildReclaim } from '../lib/chain'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Trainer {
  id: string
  name: string
  phone: string
  wallet: string | null
  state: string
}

interface EventDetail {
  id: string
  name: string
  days: number
  decimals: number
  token_mint: string
  start_ts: number
  day_len_seconds: number
  status: string
}

export interface StatusProps {
  /** Event id */
  eventId: string
  /** Organizer wallet (base58) — needed for reclaim */
  organizerWallet: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return explain(e.code)
  const msg = (e as Error)?.message ?? 'unknown'
  const match = /Error Code: (\w+)/.exec(msg) ?? /custom program error: 0x(\w+)/.exec(msg)
  if (match) return explain(match[1])
  return explain(msg)
}

function rpc(): Connection {
  const url = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com'
  return new Connection(url, 'confirmed')
}

async function phantomSignAndSend(
  tx: import('@solana/web3.js').Transaction,
  conn: Connection,
): Promise<string> {
  const phantom = (window as { solana?: { signTransaction: (t: unknown) => Promise<import('@solana/web3.js').Transaction> } }).solana
  if (!phantom) throw new Error('Phantom wallet not found. Install Phantom and refresh.')
  const signed = await phantom.signTransaction(tx)
  const raw = signed.serialize()
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false })
  await conn.confirmTransaction(sig, 'confirmed')
  return sig
}

function phaseLabel(phase: ChainStatus['phase']): string {
  const map: Record<ChainStatus['phase'], string> = {
    not_created: 'Not created',
    not_started: 'Not started',
    running: 'Running',
    ended: 'Ended',
    reclaimed: 'Reclaimed',
  }
  return map[phase]
}

function buildDayCells(
  days: number,
  currentDayIdx: number | null,
  phase: ChainStatus['phase'],
): CellState[] {
  return Array.from({ length: days }, (_, i) => {
    if (phase === 'not_created' || phase === 'not_started') return 'future'
    if (currentDayIdx === null) return 'future'
    if (i < currentDayIdx) return 'missed'   // organizer view: no per-day paid data without enrollment scan
    if (i === currentDayIdx) return 'today'
    return 'future'
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Status({ eventId, organizerWallet }: StatusProps) {
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [trainers, setTrainers] = useState<Trainer[]>([])
  const [chainStatus, setChainStatus] = useState<ChainStatus | null>(null)
  const [loadErr, setLoadErr] = useState('')

  // Link modal state
  const [linkModal, setLinkModal] = useState<{ type: 'trainer' | 'trainee'; code: string; url: string } | null>(null)
  const [linkBusy, setLinkBusy] = useState<'trainer' | 'trainee' | null>(null)
  const [linkErr, setLinkErr] = useState('')

  // Reclaim state
  const [reclaimBusy, setReclaimBusy] = useState(false)
  const [reclaimErr, setReclaimErr] = useState('')
  const [reclaimSig, setReclaimSig] = useState('')

  // Sync state
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  const load = useCallback(async () => {
    setLoadErr('')
    try {
      const [evRaw, cs] = await Promise.all([
        getEvent(eventId),
        getChainStatus(eventId).catch(() => null),
      ])
      const ev = evRaw as { event: EventDetail; trainers: { invited: Trainer[]; signed_up: Trainer[]; funded: Trainer[]; registered: Trainer[] } }
      setEvent(ev.event)
      setTrainers([
        ...(ev.trainers.invited ?? []),
        ...(ev.trainers.signed_up ?? []),
        ...(ev.trainers.funded ?? []),
        ...(ev.trainers.registered ?? []),
      ])
      if (cs) setChainStatus(cs)
    } catch (e) {
      setLoadErr(errMsg(e))
    }
  }, [eventId])

  useEffect(() => { void load() }, [load])

  // Poll chain-status every 15 s while running
  useEffect(() => {
    if (chainStatus?.phase !== 'running' && chainStatus?.phase !== 'not_started') return
    const id = setInterval(async () => {
      try {
        const cs = await getChainStatus(eventId)
        setChainStatus(cs)
      } catch { /* ignore */ }
    }, 15_000)
    return () => clearInterval(id)
  }, [eventId, chainStatus?.phase])

  async function handleCreateLink(type: 'trainer' | 'trainee') {
    setLinkErr('')
    setLinkBusy(type)
    try {
      const res = await createLink(eventId, type)
      const base = window.location.origin
      const path = type === 'trainee'
        ? `#/join/${eventId}/${res.code}`
        : `#/trainer/${eventId}/${res.code}`
      setLinkModal({ type, code: res.code, url: `${base}/${path}` })
    } catch (e) {
      setLinkErr(errMsg(e))
    } finally {
      setLinkBusy(null)
    }
  }

  async function handleSync() {
    setSyncBusy(true)
    setSyncMsg('')
    try {
      const res = await syncTrainers(eventId)
      setSyncMsg(`${res.registered} registered, ${res.pending} pending.`)
      await load()
    } catch (e) {
      setSyncMsg(errMsg(e))
    } finally {
      setSyncBusy(false)
    }
  }

  async function handleReclaim() {
    if (!chainStatus?.programme || !event) return
    setReclaimErr('')
    setReclaimBusy(true)
    try {
      const conn = rpc()
      const organizer = new PublicKey(organizerWallet)
      const programme = new PublicKey(chainStatus.programme)
      const mint = new PublicKey(event.token_mint)
      const tx = buildReclaim(organizer, programme, mint)
      const { blockhash } = await conn.getLatestBlockhash()
      tx.recentBlockhash = blockhash
      const sig = await phantomSignAndSend(tx, conn)
      setReclaimSig(sig)
      await load()
    } catch (e) {
      setReclaimErr(errMsg(e))
    } finally {
      setReclaimBusy(false)
    }
  }

  if (loadErr) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Notice variant="danger">{loadErr}</Notice>
        <Button variant="secondary" onClick={load}>Retry</Button>
      </div>
    )
  }

  if (!event) {
    return <p className="small" style={{ color: 'var(--ink-2)' }}>Loading…</p>
  }

  const decimals = event.decimals
  const cs = chainStatus
  const nowSec = Math.floor(Date.now() / 1000)
  const currentDayIdx = cs?.currentDay ?? (
    cs && event.start_ts && event.day_len_seconds
      ? currentDay(nowSec, event.start_ts, event.day_len_seconds)
      : null
  )
  const dayCells = buildDayCells(event.days, currentDayIdx, cs?.phase ?? 'not_created')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 500 }}>
          {event.name}
        </h2>
        {cs && (
          <span className="small" style={{
            color: cs.phase === 'running' ? 'var(--accent)' : cs.phase === 'ended' ? 'var(--warn)' : 'var(--ink-2)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontSize: '0.75rem',
          }}>
            {phaseLabel(cs.phase)}
          </span>
        )}
      </div>

      {/* ── Stats ── */}
      {cs && (
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <Stat
            label="Vault holds"
            value={cs.vaultBalance ? formatAmount(cs.vaultBalance, decimals) : '—'}
            unit="units"
          />
          <Stat
            label="Day"
            value={currentDayIdx !== null ? String(currentDayIdx + 1) : '—'}
            unit={`of ${event.days}`}
          />
          {cs.programme && (
            <Stat label="Programme" value={shortAddress(cs.programme)} />
          )}
        </div>
      )}

      {/* ── Day strip ── */}
      {cs && cs.phase !== 'not_created' && (
        <div>
          <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 8 }}>
            {currentDayIdx !== null
              ? `Day ${currentDayIdx + 1} of ${event.days}.`
              : `${event.days} days total.`}
          </p>
          <DayStrip
            total={event.days}
            current={currentDayIdx ?? -1}
            cells={dayCells}
          />
        </div>
      )}

      {/* ── Programme address ── */}
      {cs?.programme && (
        <Card style={{ padding: 16 }}>
          <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 6 }}>Programme address</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <code style={{
              flex: 1,
              fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
              fontSize: '0.85em',
              wordBreak: 'break-all',
              color: 'var(--ink)',
            }}>
              {cs.programme}
            </code>
            <Copy text={cs.programme} />
          </div>
          <a
            href={`https://explorer.solana.com/address/${cs.programme}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)', fontSize: '0.875rem', marginTop: 8, display: 'inline-block' }}
          >
            View on Explorer ↗
          </a>
        </Card>
      )}

      {/* ── Links ── */}
      <div>
        <h3 style={{ fontSize: '1.0625rem', fontWeight: 600, marginBottom: 12 }}>Links</h3>
        {linkErr && <div style={{ marginBottom: 12 }}><Notice variant="danger">{linkErr}</Notice></div>}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            onClick={() => handleCreateLink('trainee')}
            disabled={linkBusy === 'trainee'}
          >
            {linkBusy === 'trainee' ? 'Creating…' : 'New trainee link'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleCreateLink('trainer')}
            disabled={linkBusy === 'trainer'}
          >
            {linkBusy === 'trainer' ? 'Creating…' : 'New trainer link'}
          </Button>
        </div>
      </div>

      {/* ── Trainers ── */}
      {trainers.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 600 }}>Trainers</h3>
            <Button variant="secondary" onClick={handleSync} disabled={syncBusy}>
              {syncBusy ? 'Syncing…' : 'Sync'}
            </Button>
          </div>
          {syncMsg && <div style={{ marginBottom: 12 }}><Notice>{syncMsg}</Notice></div>}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--sunken)' }}>
                  <th style={TH}>Name</th>
                  <th style={TH}>Phone</th>
                  <th style={TH}>State</th>
                </tr>
              </thead>
              <tbody>
                {trainers.map(t => (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={TD}>{t.name}</td>
                    <td style={{ ...TD, fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: '0.85em' }}>
                      {t.phone}
                    </td>
                    <td style={{ ...TD, color: stateColor(t.state) }}>{t.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* ── Reclaim ── */}
      {cs?.reclaimable && !reclaimSig && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Notice variant="warn">
            The programme has ended. Unclaimed funds can be returned to the organizer.
          </Notice>
          {reclaimErr && <Notice variant="danger">{reclaimErr}</Notice>}
          <Button variant="primary" large onClick={handleReclaim} disabled={reclaimBusy}>
            {reclaimBusy ? 'Reclaiming…' : 'Reclaim funds'}
          </Button>
        </div>
      )}
      {reclaimSig && (
        <Notice>
          Reclaim confirmed.{' '}
          <a
            href={`https://explorer.solana.com/tx/${reclaimSig}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            {shortAddress(reclaimSig)}
          </a>
        </Notice>
      )}

      {/* ── One-time link modal ── */}
      <Modal
        open={!!linkModal}
        onClose={() => setLinkModal(null)}
        title={linkModal?.type === 'trainee' ? 'Trainee link' : 'Trainer link'}
      >
        <p className="small" style={{ color: 'var(--ink-2)', marginBottom: 12 }}>
          {linkModal?.type === 'trainee'
            ? 'Share this link with participants. Each person needs their own link.'
            : 'Share this link with the trainer. They will use it to sign up and check in participants.'}
        </p>
        <code style={{
          display: 'block',
          padding: '12px 16px',
          background: 'var(--sunken)',
          borderRadius: '6px',
          wordBreak: 'break-all',
          fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
          fontSize: '0.9em',
          marginBottom: 8,
        }}>
          {linkModal?.url}
        </code>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Copy text={linkModal?.url ?? ''} />
        </div>
        <p className="small" style={{ color: 'var(--ink-3)' }}>
          This code is shown once.
        </p>
      </Modal>
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
