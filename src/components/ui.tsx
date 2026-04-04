import React from 'react'

/* ── Topbar ─────────────────────────────────────────────────────────────── */
interface TopbarProps {
  title: string
  subtitle?: string
  onSettings?: () => void
  onBack?: (() => void) | null
  backLabel?: string
}

export function Topbar({ title, subtitle, onSettings, onBack, backLabel }: TopbarProps) {
  return (
    <div style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      padding: '11px 14px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {onBack && (
          <button onClick={onBack} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-3)', fontSize: 13, padding: '2px 4px',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            {backLabel ?? 'Voltar'}
          </button>
        )}
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 500, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-3)' }}>
            SAIPOS
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>
            {title}
            {subtitle && <span style={{ color: 'var(--text-3)', marginLeft: 6, fontWeight: 400 }}>{subtitle}</span>}
          </div>
        </div>
      </div>
      {onSettings && (
        <IconBtn onClick={onSettings} title="Configurações">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </IconBtn>
      )}
    </div>
  )
}

/* ── IconBtn ─────────────────────────────────────────────────────────────── */
interface IconBtnProps {
  onClick: () => void
  title?: string
  children: React.ReactNode
}

export function IconBtn({ onClick, title, children }: IconBtnProps) {
  return (
    <button onClick={onClick} title={title} style={{
      background: 'none',
      border: '1px solid var(--border)',
      borderRadius: 4,
      width: 28, height: 28,
      cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-3)',
      flexShrink: 0,
    }}
    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-1)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)' }}
    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)' }}
    >
      <span style={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </span>
    </button>
  )
}

/* ── Btn ─────────────────────────────────────────────────────────────────── */
type BtnVariant = 'primary' | 'secondary' | 'success' | 'danger'

interface BtnProps {
  onClick?: () => void
  disabled?: boolean
  variant?: BtnVariant
  href?: string
  target?: string
  children: React.ReactNode
  style?: React.CSSProperties
}

export function Btn({ onClick, disabled, variant = 'primary', href, target, children, style }: BtnProps) {
  const base: React.CSSProperties = {
    flex: 1,
    padding: '9px 14px',
    borderRadius: 'var(--r)',
    border: '1px solid transparent',
    fontFamily: 'var(--sans)',
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.15s',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    textDecoration: 'none',
    ...style,
  }

  const variants: Record<BtnVariant, React.CSSProperties> = {
    primary:   { background: disabled ? 'var(--border2)' : 'var(--accent)', color: disabled ? 'var(--text-3)' : 'var(--fg)', borderColor: disabled ? 'var(--border2)' : 'var(--accent)' },
    secondary: { background: 'var(--surface)', color: 'var(--text-2)', borderColor: 'var(--border)' },
    success:   { background: 'var(--ok-bg)', color: 'var(--ok)', borderColor: 'var(--ok-br)', fontWeight: 600 },
    danger:    { background: 'none', color: 'var(--err)', borderColor: '#e8d5d3' },
  }

  const combined = { ...base, ...variants[variant] }

  if (href) {
    return <a href={href} target={target} style={combined}>{children}</a>
  }

  return (
    <button onClick={onClick} disabled={disabled} style={combined}>
      {children}
    </button>
  )
}

/* ── BtnRow ──────────────────────────────────────────────────────────────── */
interface BtnRowProps {
  children: React.ReactNode
  style?: React.CSSProperties
}

export function BtnRow({ children, style }: BtnRowProps) {
  return (
    <div style={{ display: 'flex', gap: 8, ...style }}>
      {children}
    </div>
  )
}

/* ── Notice ──────────────────────────────────────────────────────────────── */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 12,
      fontFamily: 'var(--mono)',
      color: 'var(--text-2)',
      lineHeight: 1.55,
      padding: '12px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r)',
      marginBottom: 12,
    }}>
      {children}
    </div>
  )
}

/* ── Feedback ────────────────────────────────────────────────────────────── */
interface FeedbackProps {
  type: 'ok' | 'err'
  children?: React.ReactNode
}

export function Feedback({ type, children }: FeedbackProps) {
  if (!children) return null
  const styles: Record<string, React.CSSProperties> = {
    ok:  { background: 'var(--ok-bg)',  color: 'var(--ok)',  border: '1px solid var(--ok-br)'  },
    err: { background: 'var(--err-bg)', color: 'var(--err)', border: '1px solid var(--err-br)' },
  }
  return (
    <div style={{
      fontSize: 11,
      fontFamily: 'var(--mono)',
      padding: '9px 10px',
      borderRadius: 'var(--r)',
      marginBottom: 10,
      lineHeight: 1.5,
      ...styles[type],
    }}>
      {children}
    </div>
  )
}

/* ── Spinner ─────────────────────────────────────────────────────────────── */
export function Spinner() {
  return (
    <span style={{
      display: 'inline-block',
      width: 12, height: 12,
      border: '1.5px solid rgba(255,255,255,0.35)',
      borderTopColor: 'rgba(255,255,255,0.9)',
      borderRadius: '50%',
      animation: 'spin 0.65s linear infinite',
    }} />
  )
}

/* ── SectionLabel ────────────────────────────────────────────────────────── */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: 'var(--text-3)',
      fontFamily: 'var(--mono)',
      marginBottom: 16,
      paddingBottom: 8,
      borderBottom: '1px solid var(--border)',
    }}>
      {children}
    </div>
  )
}

/* ── Field ───────────────────────────────────────────────────────────────── */
interface FieldProps {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}

export function Field({ label, hint, children }: FieldProps) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint && (
        <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)', marginTop: 5, lineHeight: 1.5 }}>
          {hint}
        </p>
      )}
    </div>
  )
}

/* ── Input ───────────────────────────────────────────────────────────────── */
interface InputProps {
  type?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  style?: React.CSSProperties
}

export function Input({ type = 'text', value, onChange, placeholder, style }: InputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{
        width: '100%',
        padding: '10px 12px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        fontFamily: 'var(--mono)',
        fontSize: 12.5,
        background: 'var(--surface)',
        color: 'var(--text-1)',
        outline: 'none',
        ...style,
      }}
      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
      onBlur={e => e.target.style.borderColor = 'var(--border)'}
    />
  )
}

/* ── Textarea ────────────────────────────────────────────────────────────── */
interface TextareaProps {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  rows?: number
}

export function Textarea({ value, onChange, placeholder, rows = 4 }: TextareaProps) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: '100%',
        padding: '10px 12px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        fontFamily: 'var(--mono)',
        fontSize: 12,
        background: 'var(--surface)',
        color: 'var(--text-1)',
        outline: 'none',
        resize: 'vertical',
        lineHeight: 1.6,
      }}
      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
      onBlur={e => e.target.style.borderColor = 'var(--border)'}
    />
  )
}
