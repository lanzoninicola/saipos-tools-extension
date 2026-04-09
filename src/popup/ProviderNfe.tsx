import React, { useState } from 'react'
import { humanizeError } from '../errors'
import { extractorProviderNfe, type ProviderNfeResult } from '../extractors/extractorProviderNfe'
import { Feedback, BtnRow, Btn, Notice, Spinner } from '../components/ui'

interface StatRowProps {
  label: string
  value: string | number
  highlight?: boolean
}

function StatRow({ label, value, highlight = false }: StatRowProps) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      fontSize: 12, padding: '4px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ color: 'var(--text-2)' }}>{label}</span>
      <strong style={{ color: highlight ? 'var(--err)' : 'var(--text-1)', fontFamily: 'var(--mono)' }}>
        {value}
      </strong>
    </div>
  )
}

type Status = 'idle' | 'loading' | 'done' | 'error'

export default function ProviderNfe() {
  const [status, setStatus]   = useState<Status>('idle')
  const [data, setData]       = useState<ProviderNfeResult | null>(null)
  const [errMsg, setErrMsg]   = useState('')
  const [preview, setPreview] = useState(false)

  async function handleExtract() {
    setStatus('loading')
    setData(null)
    setErrMsg('')
    setPreview(false)

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: extractorProviderNfe,
      })

      if ('error' in result) {
        setErrMsg(result.error)
        setStatus('error')
      } else if (!result.notas?.length) {
        setErrMsg('Nenhuma nota encontrada na tabela.')
        setStatus('error')
      } else {
        setData(result)
        setStatus('done')
      }
    } catch (e) {
      setErrMsg('Não foi possível acessar a página do SAIPOS. ' + humanizeError(e))
      setStatus('error')
    }
  }

  function handleDownload() {
    if (!data) return
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const ts   = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    chrome.downloads.download({ url, filename: `notas-entrada-${ts}.json`, saveAs: false }, () => {
      URL.revokeObjectURL(url)
    })
  }

  const loading = status === 'loading'

  return (
    <div style={{ padding: 14 }}>
      {status === 'idle' && (
        <Notice>
          Vá até a tabela de <strong>Notas de Entrada</strong> no SAIPOS e clique em Extrair.
        </Notice>
      )}

      {status === 'error' && <Feedback type="err">{errMsg}</Feedback>}

      {status === 'done' && data && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r)',
          padding: '10px 12px',
          marginBottom: 10,
        }}>
          <StatRow label="Total de notas"         value={data.meta.total_notas} />
          <StatRow label="Valor total"             value={data.meta.valor_total_tabela_str ?? '—'} />
          <StatRow label="Conc. Fin. pendentes"    value={data.meta.pendentes_conciliacao_financeira} highlight={data.meta.pendentes_conciliacao_financeira > 0} />
          <StatRow label="Conc. Estoq. pendentes"  value={data.meta.pendentes_conciliacao_estoque}    highlight={data.meta.pendentes_conciliacao_estoque > 0} />
          {data.meta.filtro_data_de && (
            <StatRow label="Período" value={`${data.meta.filtro_data_de} → ${data.meta.filtro_data_ate}`} />
          )}
        </div>
      )}

      {preview && data && (
        <textarea
          readOnly
          value={JSON.stringify({
            meta: data.meta,
            notas: data.notas.slice(0, 3),
            '...': data.notas.length > 3 ? `+${data.notas.length - 3} omitidas` : undefined,
          }, null, 2)}
          style={{
            width: '100%', height: 160,
            fontFamily: 'var(--mono)', fontSize: 10.5,
            background: '#1e1e2e', color: '#cdd6f4',
            border: 'none', borderRadius: 'var(--r)',
            padding: 10, resize: 'none',
            marginBottom: 10, lineHeight: 1.5,
          }}
        />
      )}

      <BtnRow>
        <Btn onClick={handleExtract} disabled={loading}>
          {loading ? <Spinner /> : (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h12M2 7h8M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          )}
          {loading ? 'Extraindo…' : 'Extrair'}
        </Btn>
        <Btn variant="secondary" onClick={() => setPreview(p => !p)} disabled={!data}>
          {preview ? 'Fechar JSON' : 'Ver JSON'}
        </Btn>
        <Btn variant="secondary" onClick={handleDownload} disabled={!data}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v8M5 7l3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Baixar
        </Btn>
      </BtnRow>
    </div>
  )
}
