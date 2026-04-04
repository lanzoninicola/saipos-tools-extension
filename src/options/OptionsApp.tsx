import React, { useState, useEffect } from 'react'
import { getSettings, saveSettings, clearSettings } from '../storage'
import { SectionLabel, Field, Input, Textarea, Btn, BtnRow } from '../components/ui'

export default function OptionsApp() {
  const [baseUrl,              setBaseUrl]              = useState('')
  const [apiKey,               setApiKey]               = useState('')
  const [extraHeaders,         setExtraHeaders]         = useState('')
  const [endpointConciliacao,  setEndpointConciliacao]  = useState('')
  const [endpointUnits,        setEndpointUnits]        = useState('')
  const [showKey,              setShowKey]              = useState(false)
  const [feedback,             setFeedback]             = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => {
    getSettings().then(s => {
      if (s.baseUrl)             setBaseUrl(s.baseUrl)
      if (s.apiKey)              setApiKey(s.apiKey)
      if (s.extraHeaders)        setExtraHeaders(s.extraHeaders)
      if (s.endpointConciliacao) setEndpointConciliacao(s.endpointConciliacao)
      if (s.endpointUnits)       setEndpointUnits(s.endpointUnits)
    })
  }, [])

  function flash(type: 'ok' | 'err', msg: string) {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 4000)
  }

  async function handleSave() {
    if (!baseUrl.trim()) { flash('err', 'O campo Base URL é obrigatório.'); return }
    try { new URL(baseUrl) } catch { flash('err', 'Base URL inválida. Use https://...'); return }
    if (!apiKey.trim()) { flash('err', 'O campo API Key é obrigatório.'); return }
    if (!endpointConciliacao.trim()) { flash('err', 'O endpoint de Conciliação NF-e é obrigatório.'); return }
    if (!endpointUnits.trim()) { flash('err', 'O endpoint de Unidades de consumo é obrigatório.'); return }
    try {
      await saveSettings({
        baseUrl:             baseUrl.trim(),
        apiKey:              apiKey.trim(),
        extraHeaders:        extraHeaders.trim(),
        endpointConciliacao: endpointConciliacao.trim(),
        endpointUnits:       endpointUnits.trim(),
      })
      flash('ok', 'Configurações salvas.')
    } catch (e) {
      flash('err', 'Erro ao salvar: ' + (e as Error).message)
    }
  }

  async function handleClear() {
    if (!confirm('Apagar todas as configurações?')) return
    await clearSettings()
    setBaseUrl(''); setApiKey(''); setExtraHeaders('')
    setEndpointConciliacao(''); setEndpointUnits('')
    flash('ok', 'Configurações apagadas.')
  }

  const mono: React.CSSProperties = { fontFamily: "'DM Mono', monospace" }
  const code: React.CSSProperties = { ...mono, background: '#f0f0ee', padding: '1px 5px', borderRadius: 3, fontSize: '0.95em' }

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--bg); padding: 48px 20px 80px; display: flex; justify-content: center; }
        .wrap { width: 100%; max-width: 500px; }
      `}</style>

      <div className="wrap">

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40 }}>
          <span style={{ ...mono, fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-3)' }}>SAIPOS</span>
          <div style={{ width: 1, height: 12, background: 'var(--border2)' }} />
          <span style={{ ...mono, fontSize: 11, fontWeight: 500, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-2)' }}>Configurações</span>
        </div>

        {/* ── Seção 1: Geral ── */}
        <div style={{ marginBottom: 36 }}>
          <SectionLabel>Geral</SectionLabel>

          <Field
            label="Base URL"
            hint={<>URL base do sistema, sem barra final. Ex: <code style={code}>https://meu-sistema.com</code></>}
          >
            <Input
              type="url"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://meu-sistema.com"
            />
          </Field>

          <Field
            label="API Key"
            hint={<>Enviada no header <code style={code}>x-api-key</code> em todas as requisições.</>}
          >
            <div style={{ position: 'relative' }}>
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                style={{ paddingRight: 40 }}
              />
              <button
                onClick={() => setShowKey(v => !v)}
                style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 40, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {showKey
                  ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </Field>
        </div>

        {/* ── Seção 2: Endpoints ── */}
        <div style={{ marginBottom: 36 }}>
          <SectionLabel>Endpoints</SectionLabel>

          <Field
            label="Conciliação NF-e"
            hint={<>Caminho relativo para envio da conciliação via <code style={code}>POST</code>. Ex: <code style={code}>/api/nfe/conciliacao</code></>}
          >
            <Input
              type="text"
              value={endpointConciliacao}
              onChange={e => setEndpointConciliacao(e.target.value)}
              placeholder="/api/nfe/conciliacao"
            />
          </Field>

          <Field
            label="Unidades de consumo"
            hint={<>Caminho relativo para carregar as unidades via <code style={code}>GET</code>. Ex: <code style={code}>/api/measurement-units?scope=global&active=true</code></>}
          >
            <Input
              type="text"
              value={endpointUnits}
              onChange={e => setEndpointUnits(e.target.value)}
              placeholder="/api/measurement-units?scope=global&active=true"
            />
          </Field>

          <Field
            label="Verificação de status NF-e"
            hint={<>Caminho relativo usado para checar o status de cada NF-e na tabela via <code style={code}>GET</code>. O número da NF é anexado como <code style={code}>?numero_nfe=…</code><br/>Fixo: usa o mesmo endpoint de Conciliação NF-e acima.</>}
          >
            <Input
              type="text"
              value={endpointConciliacao}
              onChange={e => setEndpointConciliacao(e.target.value)}
              placeholder="/api/nfe/conciliacao"
              disabled
              style={{ opacity: 0.5 }}
            />
          </Field>
        </div>

        {/* ── Seção 3: Avançado ── */}
        <div style={{ marginBottom: 36 }}>
          <SectionLabel>Avançado</SectionLabel>
          <Field
            label="Headers adicionais"
            hint={<>Um por linha — <code style={code}>Header-Name: valor</code></>}
          >
            <Textarea
              value={extraHeaders}
              onChange={e => setExtraHeaders(e.target.value)}
              placeholder={'Authorization: Bearer token\nX-Tenant-Id: 123'}
            />
          </Field>
        </div>

        {/* Actions */}
        <BtnRow>
          <Btn onClick={handleSave}>Salvar</Btn>
          <Btn variant="danger" onClick={handleClear}>Apagar tudo</Btn>
        </BtnRow>

        {feedback && (
          <div style={{
            marginTop: 16, fontSize: 11, ...mono,
            padding: '10px 12px', borderRadius: 'var(--r)',
            background: feedback.type === 'ok' ? 'var(--ok-bg)' : 'var(--err-bg)',
            color:      feedback.type === 'ok' ? 'var(--ok)'    : 'var(--err)',
            border:     feedback.type === 'ok' ? '1px solid var(--ok-br)' : '1px solid var(--err-br)',
          }}>
            {feedback.msg}
          </div>
        )}

        <div style={{ marginTop: 32, padding: '12px 14px', background: '#f4f4f2', borderRadius: 'var(--r)', fontSize: 11, ...mono, color: 'var(--text-3)', lineHeight: 1.6 }}>
          Salvo em <strong style={{ color: 'var(--text-2)' }}>chrome.storage.sync</strong> — vinculado à conta Chrome, não ao cache local.<br />
          Não é apagado ao limpar dados de navegação ou cache do SAIPOS.
        </div>

      </div>
    </>
  )
}
