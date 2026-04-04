import React, { useState, useEffect } from 'react'
import { extractorConciliacao, type ConciliacaoResult, type ConciliacaoItem } from '../extractors/extractorConciliacao'
import { Feedback, BtnRow, Btn, Spinner } from '../components/ui'
import { parseExtraHeaders, type Settings } from '../storage'

// ── Types ────────────────────────────────────────────────────────────────────

const FIELDS: Array<{ key: keyof ConciliacaoItem; label: string; width: string }> = [
  { key: 'nome',            label: 'Item',    width: '34%' },
  { key: 'unidade_entrada', label: 'Un. NF',  width: '16%' },
  { key: 'quantidade',      label: 'Qtd.',    width: '14%' },
  { key: 'valor_total',     label: 'Valor',   width: '18%' },
  { key: 'unidade_consumo', label: 'Un. cons.', width: '18%' },
]

interface MeasurementUnit {
  id:   string
  code: string
  name: string
  kind: string | null
}

// Extend ConciliacaoItem to include unidade_consumo
declare module '../extractors/extractorConciliacao' {
  interface ConciliacaoItem {
    unidade_consumo?: string
  }
}

type Status     = 'extracting' | 'ready' | 'sending' | 'sent' | 'error'
type ExtractStep = 'connecting' | 'reading' | 'parsing' | null

interface Props { settings: Settings }

const STEP_LABELS: Record<NonNullable<ExtractStep>, string> = {
  connecting: 'Conectando à aba…',
  reading:    'Lendo a modal do SAIPOS…',
  parsing:    'Processando os itens…',
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Conciliacao({ settings }: Props) {
  const [status,       setStatus]       = useState<Status>('extracting')
  const [step,         setStep]         = useState<ExtractStep>('connecting')
  const [extracted,    setExtracted]    = useState<ConciliacaoResult | null>(null)
  const [items,        setItems]        = useState<ConciliacaoItem[]>([])
  const [units,        setUnits]        = useState<MeasurementUnit[]>([])
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [unitsError,   setUnitsError]   = useState<string | null>(null)
  const [invalidSet,   setInvalidSet]   = useState<Set<string>>(new Set())
  const [feedback,       setFeedback]       = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [redirectUrl,    setRedirectUrl]    = useState<string | null>(null)
  const [serverResponse, setServerResponse] = useState<string | null>(null)
  const [showResponse,   setShowResponse]   = useState(false)
  const [valError,       setValError]       = useState('')
  const [showJson,       setShowJson]       = useState(false)

  const hasEndpoint = !!(settings.endpoint && settings.apiKey)

  useEffect(() => {
    const t = setTimeout(() => {
      extract()
      if (settings.baseUrl) loadUnits()
    }, 50)
    return () => clearTimeout(t)
  }, [])

  // ── Fetch measurement units ──────────────────────────────────────────────

  async function loadUnits() {
    setUnitsLoading(true)
    setUnitsError(null)
    try {
      const base = settings.baseUrl!.replace(/\/$/, '')
      const resp = await fetch(`${base}/api/measurement-units?active=true`, {
        headers: {
          'x-api-key': settings.apiKey ?? '',
          ...(settings.extraHeaders ? parseExtraHeaders(settings.extraHeaders) : {}),
        },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json() as { units: MeasurementUnit[] }
      const loadedUnits = data.units ?? []
      setUnits(loadedUnits)
      // Auto-select UN for items that still have the text default
      const unUnit = loadedUnits.find(u => u.code === 'UN')
      if (unUnit) {
        setItems(prev => prev.map(item =>
          item.unidade_consumo === 'UN' ? { ...item, unidade_consumo: unUnit.id } : item
        ))
      }
    } catch (e) {
      setUnitsError('Não foi possível carregar unidades: ' + (e as Error).message)
    } finally {
      setUnitsLoading(false)
    }
  }

  // ── Extract from SAIPOS ──────────────────────────────────────────────────

  async function extract() {
    setStatus('extracting')
    setStep('connecting')
    setFeedback(null)
    setRedirectUrl(null)
    setValError('')
    setInvalidSet(new Set())
    setExtracted(null)
    setItems([])

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      setStep('reading')
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: extractorConciliacao,
      })
      setStep('parsing')

      if ('error' in result) {
        const debugMsg = result.debug ? ` [debug: ${result.debug}]` : ''
        setFeedback({ type: 'err', msg: `Modal de Conciliação de itens não encontrado. Abra a modal no SAIPOS e tente novamente.${debugMsg}` })
        setStatus('error')
        return
      }

      await new Promise(r => setTimeout(r, 250))
      setExtracted(result)
      setItems(result.items.map(i => ({ ...i, unidade_consumo: 'UN' })))
      setStep(null)
      setStatus('ready')
    } catch (e) {
      setFeedback({ type: 'err', msg: 'Erro ao acessar a página: ' + (e as Error).message })
      setStatus('error')
      setStep(null)
    }
  }

  // ── Cell edit ────────────────────────────────────────────────────────────

  function handleCellChange(rowIdx: number, field: keyof ConciliacaoItem, value: string) {
    setItems(prev => prev.map((item, i) => i === rowIdx ? { ...item, [field]: value } : item))
    const key = `${rowIdx}:${field}`
    if (invalidSet.has(key)) {
      setInvalidSet(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }

  // ── Validate ─────────────────────────────────────────────────────────────

  function validate(): boolean {
    const newInvalid = new Set<string>()
    // Validate only editable text fields (not unidade_consumo — it's optional)
    const textFields: Array<keyof ConciliacaoItem> = ['nome', 'unidade_entrada', 'quantidade', 'valor_total']
    items.forEach((item, rowIdx) => {
      textFields.forEach(key => {
        if (!item[key]?.trim()) newInvalid.add(`${rowIdx}:${key}`)
      })
    })
    if (!extracted?.fornecedor?.trim()) { setValError('Fornecedor não encontrado.'); return false }
    if (!extracted?.numero_nfe?.trim()) { setValError('Número da NF-e não encontrado.'); return false }
    setInvalidSet(newInvalid)
    if (newInvalid.size > 0) {
      const rows = new Set([...newInvalid].map(k => k.split(':')[0]))
      setValError(`${rows.size} item(ns) com campos em branco.`)
      return false
    }
    setValError('')
    return true
  }

  // ── Send ─────────────────────────────────────────────────────────────────

  async function handleSend() {
    setFeedback(null)
    setRedirectUrl(null)
    setServerResponse(null)
    setShowResponse(false)
    if (!validate()) return
    setStatus('sending')
    try {
      const payload = {
        fornecedor:   extracted!.fornecedor,
        numero_nfe:   extracted!.numero_nfe,
        items,
        exportado_em: new Date().toISOString(),
      }
      const resp = await fetch(settings.endpoint!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.apiKey!,
          ...(settings.extraHeaders ? parseExtraHeaders(settings.extraHeaders) : {}),
        },
        body: JSON.stringify(payload),
      })
      const rawText = await resp.text()
      setServerResponse(rawText)

      let json: { success: boolean; message?: string; url?: string } | null = null
      try { json = JSON.parse(rawText) } catch {}

      if (resp.ok && json?.success) {
        setFeedback({ type: 'ok', msg: json.message ?? 'Enviado com sucesso.' })
        if (json.url) {
          // Build absolute URL: if url is relative, prefix with baseUrl
          const url = json.url.startsWith('http')
            ? json.url
            : `${(settings.baseUrl ?? '').replace(/\/$/, '')}${json.url}`
          setRedirectUrl(url)
        }
        setStatus('sent')
      } else {
        setFeedback({ type: 'err', msg: json?.message ?? `HTTP ${resp.status}` })
        setStatus('ready')
      }
    } catch (e) {
      setFeedback({ type: 'err', msg: 'Falha: ' + (e as Error).message })
      setStatus('ready')
    }
  }

  const payload = extracted
    ? { fornecedor: extracted.fornecedor, numero_nfe: extracted.numero_nfe, items, exportado_em: new Date().toISOString() }
    : null

  const sending = status === 'sending'
  const invalidRowCount = new Set([...invalidSet].map(k => k.split(':')[0])).size

  // ── Loading skeleton ──────────────────────────────────────────────────────

  if (status === 'extracting') {
    return (
      <div style={{ padding: 14 }}>
        <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

        {/* Main status card */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r)',
          padding: '14px',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Spinner />
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>
              {step ? STEP_LABELS[step] : 'Aguardando…'}
            </div>
          </div>

          {/* Step progress bar */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['connecting', 'reading', 'parsing'] as NonNullable<ExtractStep>[]).map((s, i) => {
              const stepIdx = step ? ['connecting','reading','parsing'].indexOf(step) : -1
              const done    = stepIdx > i
              const active  = stepIdx === i
              return (
                <div key={s} style={{
                  flex: 1, height: 3, borderRadius: 2,
                  background: done ? 'var(--text-1)' : active ? 'var(--text-2)' : 'var(--border)',
                  transition: 'background 0.3s',
                  opacity: done ? 1 : active ? 0.7 : 0.3,
                }} />
              )
            })}
          </div>

          <div style={{ marginTop: 6, fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-3)' }}>
            {step === 'connecting' ? 'Passo 1 de 3 — conectando à aba activa' :
             step === 'reading'    ? 'Passo 2 de 3 — lendo modal do SAIPOS' :
             step === 'parsing'    ? 'Passo 3 de 3 — processando itens' : ''}
          </div>
        </div>

        {/* Skeleton rows */}
        {[1, 2, 3].map(i => (
          <div key={i} style={{
            height: 26,
            borderRadius: 4,
            marginBottom: 6,
            opacity: 1 - (i - 1) * 0.25,
            animation: 'shimmer 1.4s infinite',
            backgroundSize: '200% 100%',
            backgroundImage: 'linear-gradient(90deg,#f0f0ee 0%,#e4e4e0 50%,#f0f0ee 100%)',
          }} />
        ))}
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────

  if (status === 'error') {
    return (
      <div style={{ padding: 14 }}>
        <div style={{
          background: 'var(--err-bg)',
          border: '1px solid var(--err-br)',
          borderRadius: 'var(--r)',
          padding: '12px 14px',
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--err)', marginBottom: 4 }}>
            Não foi possível extrair os dados
          </div>
          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--err)', lineHeight: 1.55 }}>
            {feedback?.msg ?? 'Erro desconhecido.'}
          </div>
        </div>
        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.5 }}>
          Certifique-se de que o modal de <strong style={{ color: 'var(--text-2)' }}>Conciliação de itens</strong> está aberto no SAIPOS e tente novamente.
        </div>
        <Btn onClick={extract}>↺ Tentar novamente</Btn>
      </div>
    )
  }

  // ── Ready / sending / sent ────────────────────────────────────────────────

  return (
    <div style={{ padding: 14 }}>

      {/* Header card */}
      {extracted && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', display: 'flex', marginBottom: 10, overflow: 'hidden' }}>
          <div style={{ flex: 1, padding: '8px 12px', borderRight: '1px solid var(--border)' }}>
            <div style={labelStyle}>Fornecedor</div>
            <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{extracted.fornecedor || '—'}</div>
          </div>
          <div style={{ flexShrink: 0, width: 110, padding: '8px 12px' }}>
            <div style={labelStyle}>NF-e</div>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{extracted.numero_nfe || '—'}</div>
          </div>
        </div>
      )}

      {/* Units load error */}
      {!settings.baseUrl && (
        <div style={{ ...infoBoxStyle, marginBottom: 10 }}>
          ℹ Base URL não configurada — selecione unidades manualmente ou configure nas definições.
        </div>
      )}
      {unitsError && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--err)', background: 'var(--err-bg)', border: '1px solid var(--err-br)', borderRadius: 'var(--r)', padding: '7px 10px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{unitsError}</span>
          <button onClick={loadUnits} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--err)', fontSize: 12, padding: '0 4px' }}>↺</button>
        </div>
      )}

      {/* Items table */}
      {items.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={labelStyle}>Itens</span>
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
              background: invalidSet.size > 0 ? 'var(--err-bg)' : '#f0f0ee',
              color:      invalidSet.size > 0 ? 'var(--err)'    : 'var(--text-2)',
              border:     invalidSet.size > 0 ? '1px solid var(--err-br)' : 'none',
              borderRadius: 3, padding: '1px 7px',
            }}>
              {items.length}{invalidSet.size > 0 ? ` — ${invalidRowCount} inválido(s)` : ''}
            </span>
            {unitsLoading && <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}><Spinner />unidades…</span>}
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden', background: 'var(--surface)' }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f4f4f2', borderBottom: '1px solid var(--border)' }}>
                  {FIELDS.map(f => (
                    <th key={f.key} style={{ padding: '6px 6px', fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-3)', textAlign: 'left', width: f.width }}>
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, rowIdx) => {
                  const rowInvalid = FIELDS.some(f => f.key !== 'unidade_consumo' && invalidSet.has(`${rowIdx}:${f.key}`))
                  return (
                    <tr key={rowIdx} style={{ borderBottom: rowIdx < items.length - 1 ? '1px solid var(--border)' : 'none', background: rowInvalid ? 'var(--invalid)' : 'transparent' }}>
                      {FIELDS.map(({ key }) => {
                        const cellInvalid = invalidSet.has(`${rowIdx}:${key}`)

                        // Unidade de consumo — always a select
                        if (key === 'unidade_consumo') {
                          // When units loaded from API use them; otherwise offer just UN as fallback
                          const options = units.length > 0
                            ? units
                            : [{ id: 'UN', code: 'UN', name: 'Unidade', kind: 'count' }]

                          return (
                            <td key={key} style={{ padding: '3px 4px' }}>
                              <select
                                value={item.unidade_consumo ?? 'UN'}
                                onChange={e => handleCellChange(rowIdx, 'unidade_consumo', e.target.value)}
                                disabled={unitsLoading}
                                style={{
                                  width: '100%',
                                  padding: '3px 4px',
                                  border: '1px solid var(--border)',
                                  borderRadius: 3,
                                  fontFamily: 'var(--mono)',
                                  fontSize: 13,
                                  background: unitsLoading ? '#f4f4f2' : 'var(--surface)',
                                  color: 'var(--text-1)',
                                  outline: 'none',
                                  cursor: unitsLoading ? 'not-allowed' : 'pointer',
                                }}
                                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                                onBlur={e => e.target.style.borderColor = 'var(--border)'}
                              >
                                {options.map(u => (
                                  <option key={u.id} value={u.id}>{u.code}</option>
                                ))}
                              </select>
                            </td>
                          )
                        }

                        // Regular editable text cell
                        return (
                          <td key={key} style={{ padding: '3px 4px' }}>
                            <input
                              type="text"
                              value={item[key] ?? ''}
                              onChange={e => handleCellChange(rowIdx, key, e.target.value)}
                              style={{
                                width: '100%', padding: '3px 5px',
                                border: `1px solid ${cellInvalid ? 'var(--err-br)' : 'transparent'}`,
                                borderRadius: 3,
                                fontFamily: "var(--mono)", fontSize: 13,
                                background: cellInvalid ? 'var(--invalid)' : 'transparent',
                                color: cellInvalid ? 'var(--err)' : 'var(--text-1)',
                                outline: 'none',
                              }}
                              onFocus={e => { if (!cellInvalid) e.target.style.borderColor = 'var(--border2)' }}
                              onBlur={e => { if (!cellInvalid) e.target.style.borderColor = 'transparent' }}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!hasEndpoint && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-3)', background: '#f4f4f2', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '8px 10px', marginBottom: 8, lineHeight: 1.55 }}>
          ⚙ Endpoint e API Key não configurados.{' '}
          <span onClick={() => chrome.runtime.openOptionsPage()} style={{ color: 'var(--text-1)', cursor: 'pointer', textDecoration: 'underline' }}>
            Configurar
          </span>
        </div>
      )}

      {/* Sending progress */}
      {sending && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-2)', background: '#f4f4f2', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '8px 10px', marginBottom: 8 }}>
          <Spinner />Enviando para o sistema…
        </div>
      )}

      {valError && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--err)', background: 'var(--err-bg)', border: '1px solid var(--err-br)', borderRadius: 'var(--r)', padding: '7px 10px', marginBottom: 8 }}>
          ⚠ {valError}
        </div>
      )}

      {feedback && <Feedback type={feedback.type}>{feedback.msg}</Feedback>}

      {/* Server response viewer */}
      {serverResponse && (
        <div style={{ marginBottom: 8 }}>
          <button
            onClick={() => setShowResponse(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: 10,
              color: 'var(--text-3)', padding: '2px 0', marginBottom: showResponse ? 6 : 0,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: showResponse ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            {showResponse ? 'Fechar resposta' : 'Ver resposta do servidor'}
          </button>
          {showResponse && (
            <textarea
              readOnly
              value={(() => { try { return JSON.stringify(JSON.parse(serverResponse), null, 2) } catch { return serverResponse } })()}
              style={{
                width: '100%', height: 160,
                fontFamily: 'var(--mono)', fontSize: 10.5,
                background: '#1e1e2e', color: '#cdd6f4',
                border: '1px solid var(--border)', borderRadius: 'var(--r)',
                padding: 10, resize: 'vertical', lineHeight: 1.5, outline: 'none',
              }}
            />
          )}
        </div>
      )}

      {redirectUrl && (
        <Btn variant="success" href={redirectUrl} target="_blank" style={{ marginBottom: 8, width: '100%', flex: 'none' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          Abrir no sistema
        </Btn>
      )}

      {showJson && payload && (
        <textarea readOnly value={JSON.stringify(payload, null, 2)} style={{ width: '100%', height: 180, fontFamily: 'var(--mono)', fontSize: 10.5, background: 'var(--surface)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 10, resize: 'none', marginBottom: 8, lineHeight: 1.5, outline: 'none' }} />
      )}

      <BtnRow>
        <Btn onClick={handleSend} disabled={sending || !hasEndpoint}>
          {sending ? <><Spinner />Enviando…</> : 'Enviar'}
        </Btn>
        <Btn variant="secondary" onClick={() => setShowJson(p => !p)} disabled={!payload}>
          {showJson ? 'Fechar JSON' : 'Ver JSON'}
        </Btn>
        <Btn variant="secondary" onClick={extract} disabled={sending} style={{ flex: 'none', padding: '9px 12px' }}>↺</Btn>
      </BtnRow>

    </div>
  )
}

// ── Shared micro-styles ───────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9,
  fontWeight: 600, letterSpacing: 1.5,
  textTransform: 'uppercase', color: 'var(--text-3)',
  marginBottom: 3,
}

const infoBoxStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11,
  color: 'var(--text-3)', background: '#f4f4f2',
  border: '1px solid var(--border)', borderRadius: 'var(--r)',
  padding: '8px 10px', lineHeight: 1.5,
}
