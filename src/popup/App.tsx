import React, { useState, useEffect } from 'react'
import { useSettings } from '../hooks/useSettings'
import { Topbar } from '../components/ui'
import ProviderNfe from './ProviderNfe'
import Conciliacao from './Conciliacao'

type ToolId = 'provider-nfe' | 'conciliacao'

interface Tool {
  id: ToolId
  label: string
  description: string
  icon: React.ReactNode
}

const TOOLS: Tool[] = [
  {
    id: 'provider-nfe',
    label: 'Notas de Entrada',
    description: 'Extrai a tabela de NF-e e baixa como JSON',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
  },
  {
    id: 'conciliacao',
    label: 'Conciliação NF-e',
    description: 'Extrai itens do modal e envia para o sistema',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    ),
  },
]

const SCALE_KEY = 'saipos_popup_scale'
const W_MIN = 420; const W_MAX = 900
const H_MIN = 300; const H_MAX = 800
const S_DEF = 25 // ≈ 540×425 por padrão

function loadScale(): number {
  try {
    const v = localStorage.getItem(SCALE_KEY)
    if (v) { const n = parseInt(v, 10); if (n >= 0 && n <= 100) return n }
  } catch {}
  return S_DEF
}

function scaleToW(s: number) { return Math.round(W_MIN + (W_MAX - W_MIN) * s / 100) }
function scaleToH(s: number) { return Math.round(H_MIN + (H_MAX - H_MIN) * s / 100) }

export default function App() {
  const { settings, loaded, hasConfig } = useSettings()
  const [activeTool, setActiveTool] = useState<ToolId | null>(null)
  const [scale, setScale] = useState(loadScale)

  const width  = scaleToW(scale)
  const height = scaleToH(scale)

  useEffect(() => {
    document.body.style.width     = `${width}px`
    document.body.style.minWidth  = `${width}px`
    document.body.style.height    = `${height}px`
    document.body.style.minHeight = `${height}px`
    document.body.style.overflowY = 'auto'
    try { localStorage.setItem(SCALE_KEY, String(scale)) } catch {}
  }, [scale])

  if (!loaded) return null

  const activeToolDef = TOOLS.find(t => t.id === activeTool)

  const sliderStyle: React.CSSProperties = {
    flex: 1,
    WebkitAppearance: 'none' as React.CSSProperties['WebkitAppearance'],
    appearance: 'none' as React.CSSProperties['appearance'],
    height: 3,
    borderRadius: 2,
    outline: 'none',
    background: `linear-gradient(to right, var(--accent) ${scale}%, var(--border2) ${scale}%)`,
    cursor: 'pointer',
  }

  // Size controls bar — always visible at top
  const SizeBar = () => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '7px 14px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
    }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M3 8V5a2 2 0 0 1 2-2h3M3 16v3a2 2 0 0 0 2 2h3"/>
      </svg>
      <input type="range" min={0} max={100} step={1} value={scale}
        onChange={e => setScale(Number(e.target.value))}
        style={sliderStyle}
        title={`${width}×${height}px`}
      />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-3)', minWidth: 52, textAlign: 'right' }}>{width}×{height}</span>
    </div>
  )

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px; height: 12px;
          border-radius: 50%;
          background: var(--accent);
          cursor: pointer;
          transition: background 0.15s;
        }
        input[type=range]:hover::-webkit-slider-thumb { background: var(--accent-h); }
      `}</style>

      {/* Size sliders — always at top */}
      <SizeBar />

      <Topbar
        title={activeToolDef ? activeToolDef.label : 'SAIPOS Tools'}
        onSettings={activeTool ? () => chrome.runtime.openOptionsPage() : undefined}
        onBack={activeTool ? () => setActiveTool(null) : null}
        backLabel="Menu"
      />

      {/* ── Menu ── */}
      {!activeTool && (
        <div style={{ padding: 14 }}>
          {!hasConfig && (
            <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-2)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '8px 10px', marginBottom: 12, lineHeight: 1.55 }}>
              ⚙ Endpoint e API Key não configurados. A Conciliação NF-e requer configuração.{' '}
              <span onClick={() => chrome.runtime.openOptionsPage()} style={{ color: 'var(--accent-h)', cursor: 'pointer', textDecoration: 'underline' }}>Configurar</span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {TOOLS.map(tool => (
              <button key={tool.id} onClick={() => tool.id === 'conciliacao' ? chrome.runtime.openOptionsPage() : setActiveTool(tool.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s, background 0.15s', width: '100%' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--surface2)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)' }}
              >
                <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{tool.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', marginBottom: 2 }}>{tool.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{tool.description}</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTool === 'provider-nfe' && <ProviderNfe />}
      {activeTool === 'conciliacao' && settings !== null && <Conciliacao settings={settings ?? {}} />}
    </>
  )
}
