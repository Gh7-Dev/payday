import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

// ─── Types ──────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'text'

export type NoticeVariant = 'info' | 'warn' | 'danger'

export type CellState = 'future' | 'today' | 'paid' | 'missed'

// ─── Button ─────────────────────────────────────────────────────────

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  large?: boolean
  children: React.ReactNode
}

export function Button({
  variant = 'primary',
  large = false,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const classes = [
    'btn',
    variant === 'primary' ? 'btn-primary' : '',
    variant === 'secondary' ? 'btn-secondary' : '',
    variant === 'text' ? 'btn-text' : '',
    large ? 'btn-large' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  )
}

// ─── Field ───────────────────────────────────────────────────────────

interface FieldProps {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
  className?: string
}

export function Field({ label, error, hint, children, className = '' }: FieldProps) {
  return (
    <div className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {error && <span className="field-error-message">{error}</span>}
      {!error && hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean
}

export function Input({ hasError, className = '', ...props }: InputProps) {
  const classes = [
    'field-input',
    hasError ? 'field-error' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return <input className={classes} {...props} />
}

// ─── Card ────────────────────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function Card({ children, className = '', style }: CardProps) {
  return <div className={`card ${className}`} style={style}>{children}</div>
}

// ─── Table ───────────────────────────────────────────────────────────

interface TableProps {
  children: React.ReactNode
}

export function Table({ children }: TableProps) {
  return <table className="table">{children}</table>
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return <thead>{children}</thead>
}

export function TableRow({ children }: { children: React.ReactNode }) {
  return <tr>{children}</tr>
}

interface TableCellProps {
  children: React.ReactNode
  numeric?: boolean
  status?: 'accent' | 'warn' | 'neutral'
}

export function TableCell({ children, numeric, status }: TableCellProps) {
  const style: React.CSSProperties = numeric
    ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
    : {}

  const colorStyle: React.CSSProperties =
    status === 'accent'
      ? { color: 'var(--accent)' }
      : status === 'warn'
        ? { color: 'var(--warn)' }
        : status === 'neutral'
          ? { color: 'var(--ink-2)' }
          : {}

  return (
    <td style={{ ...style, ...colorStyle }}>{children}</td>
  )
}

// ─── Stat ────────────────────────────────────────────────────────────

interface StatProps {
  label: string
  value: string
  unit?: string
}

export function Stat({ label, value, unit }: StatProps) {
  return (
    <div className="stat-block">
      <span className="stat-label label">{label}</span>
      <span className="stat-value tabular">{value}</span>
      {unit && <span className="stat-unit small">{unit}</span>}
    </div>
  )
}

// ─── Notice ─────────────────────────────────────────────────────────

interface NoticeProps {
  variant?: NoticeVariant
  children: React.ReactNode
  className?: string
}

export function Notice({ variant = 'info', children, className = '' }: NoticeProps) {
  const variantClass =
    variant === 'warn' ? 'notice-warn' : variant === 'danger' ? 'notice-danger' : ''
  return (
    <div className={`notice ${variantClass} ${className}`.trim()}>
      {children}
    </div>
  )
}

// ─── Modal ───────────────────────────────────────────────────────────

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title" className="modal-title">{title}</h3>
        {children}
      </div>
    </div>
  )
}

// ─── Copy ────────────────────────────────────────────────────────────

interface CopyProps {
  text: string
  children?: React.ReactNode
  className?: string
}

export function Copy({ text, children, className = '' }: CopyProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  return (
    <button
      className={`copy-btn ${className}`.trim()}
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      <CopyIcon />
      {children ?? <span>{copied ? 'Copied' : 'Copy'}</span>}
    </button>
  )
}

function CopyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

// ─── DayStrip ────────────────────────────────────────────────────────

interface DayStripProps {
  total: number
  current: number // 0-based current day index (or -1 before start)
  cells: CellState[] // length must equal total
}

export function DayStrip({ total, current, cells }: DayStripProps) {
  return (
    <div className="day-strip" role="list" aria-label={`Day ${Math.max(0, current + 1)} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="day-unit" role="listitem">
          <div
            className={`day-cell day-cell--${cells[i] ?? 'future'}`}
            aria-label={`Day ${i + 1}: ${cells[i] ?? 'future'}`}
          >
            <DayCellInner state={cells[i] ?? 'future'} />
          </div>
          <span className="day-number small">{i + 1}</span>
        </div>
      ))}
    </div>
  )
}

function DayCellInner({ state }: { state: CellState }) {
  if (state === 'paid') {
    return (
      <svg
        className="day-tick"
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--paper)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    )
  }
  return null
}

// ─── Qr ──────────────────────────────────────────────────────────────

interface QrProps {
  data: string
  caption?: string
  size?: number
}

export function Qr({ data, caption, size = 240 }: QrProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    QRCode.toCanvas(canvas, data, {
      width: size,
      margin: 2, // 8px at 16px base = 2 units
      color: {
        dark: '#17150F',
        light: '#FCFAF5',
      },
    }).catch(() => {
      // QR generation failed — canvas stays blank
    })
  }, [data, size])

  return (
    <Card className="qr-card">
      <canvas ref={canvasRef} style={{ display: 'block', margin: '0 auto' }} />
      {caption && <p className="qr-caption small">{caption}</p>}
    </Card>
  )
}

// ─── Countdown ───────────────────────────────────────────────────────

interface CountdownProps {
  initialSeconds: number
  onExpire: () => void
}

export function Countdown({ initialSeconds, onExpire }: CountdownProps) {
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  useEffect(() => {
    if (secondsLeft <= 0) return

    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(id)
          // Use ref to avoid stale closure
          setTimeout(() => onExpireRef.current(), 0)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(id)
  }, []) // run once on mount

  const isExpired = secondsLeft === 0
  const isWarn = secondsLeft > 0 && secondsLeft <= 10
  const pct = Math.max(0, (secondsLeft / initialSeconds) * 100)

  if (isExpired) {
    return (
      <div className="countdown">
        <p className="countdown-expired">
          <span className="label">Expired</span>
        </p>
      </div>
    )
  }

  return (
    <div className="countdown">
      <span
        className={`countdown-number tabular${isWarn ? ' countdown-warn' : ''}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {secondsLeft}s
      </span>
      <div className="countdown-track" aria-hidden="true">
        <div
          className="countdown-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
