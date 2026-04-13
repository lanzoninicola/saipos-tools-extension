/**
 * saiposContent.ts — Content script injected into SAIPOS pages.
 *
 * Feature 1: Injects "Conciliar" button in the "Conciliação de itens" modal.
 *            Clicking opens an in-page review modal — no browser popup involved.
 * Feature 2: Adds conciliation status badges per row in the NF list table.
 *            Clicking a "partial" badge shows a popup with item counts and a link to the batch.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface NfeStatus {
  status: 'not_found' | 'partial' | 'complete'
  total_items: number
  processed_items: number
  url: string | null
}

interface Settings {
  baseUrl?:                string
  apiKey?:                string
  extraHeaders?:           string
  endpointConciliacao?:    string
  showConcEstoqColumn?:    boolean
}

interface ItemRow {
  nome: string
  unidade_entrada: string
  quantidade: string
  valor_total: string
}

interface ConciliacaoData {
  fornecedor: string
  numero_nfe: string
  items: ItemRow[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EXT_ATTR = 'data-sxt'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Consolas,monospace"

const AMM_ATTR = `${EXT_ATTR}-amm`

const AMM_CFG: Record<string, { text: string; color: string; title: string; pointer: boolean }> = {
  not_found: { text: 'Não',        color: '#dc2626', title: 'Sem conciliação de estoque no AMM',   pointer: false },
  partial:   { text: 'Parcial',    color: '#d97706', title: 'Conciliação parcial — clique para detalhes', pointer: true  },
  complete:  { text: 'Sim',        color: '#16a34a', title: 'Conciliação de estoque completa',      pointer: true  },
  loading:   { text: 'Carregando', color: '#6b7280', title: 'Verificando…',                         pointer: false },
  error:     { text: 'Erro',       color: '#dc2626', title: 'Erro — clique para detalhes',          pointer: true  },
}

// ── Settings ──────────────────────────────────────────────────────────────────

let _settingsPromise: Promise<Settings> | null = null

function getSettings(): Promise<Settings> {
  if (!_settingsPromise) {
    _settingsPromise = new Promise(resolve =>
      chrome.storage.sync.get(['baseUrl', 'apiKey', 'extraHeaders', 'endpointConciliacao', 'showConcEstoqColumn'], data => resolve(data as Settings))
    )
  }
  return _settingsPromise
}

// ── SAIPOS native column visibility ──────────────────────────────────────────

const SAIPOS_COL_ATTR    = `${EXT_ATTR}-saipos-col`
const SAIPOS_HIDE_STYLE_ID = `${EXT_ATTR}-saipos-col-hide`

function setSaiposColumnVisible(visible: boolean) {
  const existing = document.getElementById(SAIPOS_HIDE_STYLE_ID)
  if (!visible) {
    if (!existing) {
      const style = document.createElement('style')
      style.id = SAIPOS_HIDE_STYLE_ID
      style.textContent = `[${SAIPOS_COL_ATTR}] { display: none !important; }`
      document.head.appendChild(style)
    }
  } else {
    existing?.remove()
  }
}

// Invalidate cache when options are saved and re-evaluate column visibility
chrome.storage.onChanged.addListener(() => {
  _settingsPromise = null
  if (document.querySelector('table.table-store-provider-nfe')) {
    getSettings().then(s => {
      const visible = s.showConcEstoqColumn !== false
      setSaiposColumnVisible(visible)
      if (visible) processTable()
    })
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseExtraHeaders(raw = ''): Record<string, string> {
  const out: Record<string, string> = {}
  raw.split('\n').forEach(line => {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  })
  return out
}

// ── Status API cache ──────────────────────────────────────────────────────────

const statusCache = new Map<string, NfeStatus>()

interface FetchError { status: 'error'; error: string }
type FetchResult = NfeStatus | FetchError

async function fetchStatus(nfeNumber: string): Promise<FetchResult> {
  if (statusCache.has(nfeNumber)) return statusCache.get(nfeNumber)!
  const settings = await getSettings()
  if (!settings.baseUrl || !settings.apiKey || !settings.endpointConciliacao) {
    return { status: 'error', error: 'Base URL, API Key ou endpoint de conciliação não configurados nas opções da extensão' }
  }
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      { action: 'fetchNfeStatus', baseUrl: settings.baseUrl, endpointConciliacao: settings.endpointConciliacao, apiKey: settings.apiKey, nfeNumber },
      (resp: { ok: boolean; data?: NfeStatus; error?: string }) => {
        if (chrome.runtime.lastError) {
          resolve({ status: 'error', error: chrome.runtime.lastError.message ?? 'Erro de comunicação com a extensão' })
          return
        }
        if (!resp.ok) { resolve({ status: 'error', error: resp.error ?? 'Erro desconhecido' }); return }
        statusCache.set(nfeNumber, resp.data!)
        resolve(resp.data!)
      }
    )
  })
}

// ── AMM column cell ───────────────────────────────────────────────────────────

function createAmmCell(): HTMLTableCellElement {
  const td = document.createElement('td')
  td.setAttribute(EXT_ATTR, 'amm-cell')
  td.setAttribute(AMM_ATTR, '1')
  td.style.cssText = 'text-align:center;vertical-align:middle;white-space:nowrap;font-weight:600;'
  return td
}

function applyTdStatus(td: HTMLTableCellElement, key: string) {
  const cfg = AMM_CFG[key] ?? AMM_CFG.error
  td.textContent  = cfg.text
  td.style.color  = cfg.color
  td.style.cursor = cfg.pointer ? 'pointer' : 'default'
  td.title        = cfg.title
}

function injectAmmHeader(table: Element) {
  const headerRow = table.querySelector('thead tr')
  if (!headerRow) return
  if (headerRow.querySelector(`[${AMM_ATTR}]`)) return

  const ths = headerRow.querySelectorAll('th')
  if (ths.length === 0) return

  const th = document.createElement('th')
  th.setAttribute(EXT_ATTR, 'amm-header')
  th.setAttribute(AMM_ATTR, '1')
  th.textContent = 'Conc. Estoq. (AMM)'
  const refTh = ths[ths.length - 2]
  if (refTh?.className) th.className = refTh.className
  th.style.textAlign  = 'center'
  th.style.whiteSpace = 'nowrap'
  headerRow.insertBefore(th, ths[ths.length - 1])
  // tag the column immediately before the AMM header (previousElementSibling after insertion)
  const prevTh = th.previousElementSibling
  if (prevTh) prevTh.setAttribute(SAIPOS_COL_ATTR, '1')
}

// ── Partial popup ─────────────────────────────────────────────────────────────

let activePopup: HTMLElement | null = null

function closePartialPopup() {
  activePopup?.remove()
  activePopup = null
}

function showPartialPopup(anchor: HTMLElement, data: NfeStatus) {
  closePartialPopup()
  const missing = data.total_items - data.processed_items
  const popup = document.createElement('div')
  popup.setAttribute(EXT_ATTR, 'popup')
  popup.style.cssText = [
    'position:fixed', 'z-index:2147483647',
    'background:#fff', 'border:1px solid #fde68a', 'border-radius:6px',
    'padding:10px 12px', 'width:230px',
    'box-shadow:0 4px 16px rgba(0,0,0,0.14)',
    `font-family:${FONT}`,
  ].join(';')

  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:#92400e">Conciliação parcial</span>
      <button type="button" data-close style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:16px;line-height:1;padding:0;margin:0">×</button>
    </div>
    <div style="font-size:12px;color:#374151;margin-bottom:4px">
      <strong>${data.processed_items}</strong> de <strong>${data.total_items}</strong> itens processados
    </div>
    <div style="font-size:11px;color:#6b7280;margin-bottom:${data.url ? '10px' : '0'}">
      ${missing} ${missing === 1 ? 'item faltando' : 'itens faltando'}
    </div>
    ${data.url ? `
      <a href="${data.url}" target="_blank" rel="noopener"
         style="display:flex;align-items:center;gap:5px;font-size:11px;color:#2563eb;text-decoration:none;font-weight:500;padding:6px 8px;background:#eff6ff;border-radius:4px;margin-top:2px">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Abrir lote de importação
      </a>` : ''}
  `

  const rect = anchor.getBoundingClientRect()
  let top  = rect.bottom + window.scrollY + 6
  let left = rect.left + window.scrollX - 105 + rect.width / 2
  left = Math.max(8, Math.min(left, document.documentElement.clientWidth - 238 + window.scrollX))
  popup.style.top  = `${top}px`
  popup.style.left = `${left}px`

  document.body.appendChild(popup)
  activePopup = popup

  popup.querySelector('[data-close]')?.addEventListener('click', closePartialPopup)
  setTimeout(() => {
    function outsideHandler(e: MouseEvent) {
      if (!popup.contains(e.target as Node)) {
        closePartialPopup()
        document.removeEventListener('click', outsideHandler)
      }
    }
    document.addEventListener('click', outsideHandler)
  }, 0)
}

// ── DOM extractor ─────────────────────────────────────────────────────────────

function extractDataFromDOM(): ConciliacaoData | { error: string } {
  const modalTitle = document.querySelector('.modal-title')
  if (!modalTitle?.textContent?.includes('Conciliação de itens')) {
    return { error: 'Modal de Conciliação de itens não encontrado. Abra a modal no SAIPOS e tente novamente.' }
  }

  const fornecedorEl = document.querySelector('.col-md-12.ng-binding')
  const fornecedor = (fornecedorEl?.textContent?.trim() ?? '').replace(/^Fornecedor:\s*/i, '').trim()

  const nfeEl = document.querySelector('.title-item-conciliation.ng-binding')
  const numero_nfe = (nfeEl?.textContent?.trim() ?? '').replace(/^N[ºo°]\s*NFe?:\s*/i, '').trim()

  const rows = document.querySelectorAll('tbody.ui-sortable tr')
  const items: ItemRow[] = []

  rows.forEach(tr => {
    const cells = tr.querySelectorAll('td')
    if (cells.length < 4) return
    const nome            = cells[0].querySelector('a')?.textContent?.trim() ?? ''
    const unidade_entrada = cells[1].querySelector('.chosen-single span')?.textContent?.trim() ?? ''
    const qtdInput        = cells[2].querySelector('input[ng-model="item.quantity_entry"]') as HTMLInputElement | null
    const quantidade      = qtdInput?.value.trim() ?? ''
    const valorInput      = cells[3].querySelector('input[ng-model="item.total_value"]') as HTMLInputElement | null
    const valor_total     = valorInput?.value.trim().replace(/^R\$\s*/, '') ?? ''
    if (nome) items.push({ nome, unidade_entrada, quantidade, valor_total })
  })

  return { fornecedor, numero_nfe, items }
}

// ── In-page review modal ──────────────────────────────────────────────────────

let _overlay:      HTMLElement | null = null
let _items:        ItemRow[]          = []
let _extracted:    ConciliacaoData | null = null
let _ignoredRows:  Set<number>        = new Set()
let _freteUnits:   number             = 0  // valor × 100 (ex: R$ 12,34 → 1234)

function closeReviewModal() {
  _overlay?.remove()
  _overlay      = null
  _items        = []
  _extracted    = null
  _ignoredRows  = new Set()
  _freteUnits   = 0
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function getModalEl(attr: string): HTMLElement | null {
  return _overlay?.querySelector(`[${EXT_ATTR}="${attr}"]`) as HTMLElement | null
}

function setFeedback(msg: string, type: 'ok' | 'err' | 'info') {
  const el = getModalEl('feedback')
  if (!el) return
  const colors = {
    ok:   `color:#16a34a;background:#f0fdf4;border-color:#bbf7d0`,
    err:  `color:#dc2626;background:#fef2f2;border-color:#fecaca`,
    info: `color:#6b7280;background:#f9fafb;border-color:#e5e7eb`,
  }
  el.style.cssText = `font-size:12px;font-family:${MONO};padding:8px 10px;border-radius:5px;border:1px solid;${colors[type]};flex:1;`
  el.textContent = msg
}

function clearFeedback() {
  const el = getModalEl('feedback')
  if (el) { el.style.cssText = 'flex:1;'; el.textContent = '' }
}

function setSendBtnLoading(loading: boolean) {
  const btn = getModalEl('send-btn') as HTMLButtonElement | null
  if (!btn) return
  btn.disabled = loading
  btn.textContent = loading ? 'ENVIANDO…' : 'ENVIAR'
  btn.style.opacity = loading ? '0.7' : '1'
  btn.style.cursor  = loading ? 'not-allowed' : 'pointer'
}

function showRedirectLink(url: string) {
  const footer = getModalEl('review-footer')
  if (!footer || footer.querySelector(`[${EXT_ATTR}="redirect-link"]`)) return
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener'
  link.setAttribute(EXT_ATTR, 'redirect-link')
  link.style.cssText = `display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#2563eb;text-decoration:none;font-weight:500;padding:7px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;white-space:nowrap;`
  link.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Abrir no sistema`
  const cancelBtn = footer.querySelector(`[${EXT_ATTR}="cancel-btn"]`)
  if (cancelBtn) footer.insertBefore(link, cancelBtn)
  else footer.appendChild(link)
}

// ── Table builder ─────────────────────────────────────────────────────────────

const COLUMNS: Array<{ key: keyof ItemRow | null; label: string; width: string }> = [
  { key: 'nome',            label: 'ITEM NF', width: '50%' },
  { key: 'unidade_entrada', label: 'UN. NF',  width: '13%' },
  { key: 'quantidade',      label: 'QTDE',    width: '12%' },
  { key: 'valor_total',     label: 'VALOR',   width: '20%' },
  { key: null,              label: '',         width: '5%'  },
]

function applyIgnoredStyle(tr: HTMLTableRowElement, ignored: boolean) {
  tr.style.opacity = ignored ? '0.35' : '1'
  tr.style.pointerEvents = ignored ? 'none' : ''
  // Keep the ignore button interactive even when row is ignored
  const ignBtn = tr.querySelector(`[${EXT_ATTR}="ignore-btn"]`) as HTMLElement | null
  if (ignBtn) {
    ignBtn.style.pointerEvents = 'auto'
    ignBtn.title  = ignored ? 'Incluir linha' : 'Ignorar linha'
    ignBtn.style.color = ignored ? '#16a34a' : '#9ca3af'
    ignBtn.textContent = ignored ? '↩' : '×'
  }
}

function buildItemRow(item: ItemRow, rowIdx: number): HTMLTableRowElement {
  const tr = document.createElement('tr')
  tr.style.cssText = 'border-bottom:1px solid #f3f4f6;transition:opacity 0.15s;'
  tr.addEventListener('mouseenter', () => { if (!_ignoredRows.has(rowIdx)) tr.style.background = '#f9fafb' })
  tr.addEventListener('mouseleave', () => { tr.style.background = 'transparent' })

  COLUMNS.forEach((col, i) => {
    const td = document.createElement('td')
    const isLast = i === COLUMNS.length - 1
    td.style.cssText = `padding:6px 8px;vertical-align:middle;${!isLast ? 'border-right:1px solid #f0f0f0;' : ''}`

    if (col.key === 'nome' || col.key === 'unidade_entrada') {
      // Read-only display cell
      td.style.cssText += 'line-height:1.35;'
      td.style.fontSize = '12px'
      td.style.color = '#111827'
      td.textContent = item[col.key] ?? ''
      const input = document.createElement('input')
      input.type = 'hidden'
      input.value = item[col.key] ?? ''
      input.setAttribute(`${EXT_ATTR}-row`,   String(rowIdx))
      input.setAttribute(`${EXT_ATTR}-field`, col.key)
      td.appendChild(input)
    } else if (col.key === null) {
      // Ignore toggle button
      td.style.cssText += 'text-align:center;'
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute(EXT_ATTR, 'ignore-btn')
      btn.textContent = '×'
      btn.title = 'Ignorar linha'
      btn.style.cssText = `background:none;border:none;cursor:pointer;font-size:16px;line-height:1;color:#9ca3af;padding:2px 4px;border-radius:3px;transition:color 0.15s;`
      btn.addEventListener('mouseenter', () => { if (!_ignoredRows.has(rowIdx)) btn.style.color = '#dc2626' })
      btn.addEventListener('mouseleave', () => { btn.style.color = _ignoredRows.has(rowIdx) ? '#16a34a' : '#9ca3af' })
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (_ignoredRows.has(rowIdx)) {
          _ignoredRows.delete(rowIdx)
        } else {
          _ignoredRows.add(rowIdx)
        }
        applyIgnoredStyle(tr, _ignoredRows.has(rowIdx))
      })
      td.appendChild(btn)
    } else {
      const input = document.createElement('input')
      input.type  = 'text'
      input.value = item[col.key] ?? ''
      input.setAttribute(`${EXT_ATTR}-row`,   String(rowIdx))
      input.setAttribute(`${EXT_ATTR}-field`, col.key)
      input.style.cssText = `width:100%;padding:4px 5px;border:1px solid transparent;border-radius:4px;font-family:${MONO};font-size:12px;background:transparent;color:#374151;outline:none;`
      input.addEventListener('focus', () => { input.style.borderColor = '#93c5fd'; input.style.background = '#fff' })
      input.addEventListener('blur',  () => { input.style.borderColor = 'transparent'; input.style.background = 'transparent' })
      input.addEventListener('input', () => {
        (_items[rowIdx] as unknown as Record<string, string>)[col.key!] = input.value
        if (input.style.borderColor === '#fca5a5') {
          input.style.borderColor = '#93c5fd'
          input.style.background  = '#fff'
          input.style.color       = '#374151'
        }
      })
      td.appendChild(input)
    }
    tr.appendChild(td)
  })

  return tr
}

function buildTable(items: ItemRow[]): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'margin-bottom:14px;overflow-y:auto;max-height:340px;'

  const table = document.createElement('table')
  table.setAttribute(EXT_ATTR, 'items-table')
  table.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;'

  const thead = document.createElement('thead')
  const hr = document.createElement('tr')
  COLUMNS.forEach((col, i) => {
    const th = document.createElement('th')
    th.textContent = col.label
    const isLast = i === COLUMNS.length - 1
    th.style.cssText = [
      `padding:6px 8px`, `text-align:left`,
      `font-family:${MONO}`, `font-size:10px`, `font-weight:600`,
      `letter-spacing:0.8px`, `color:#9ca3af`, `width:${col.width}`,
      `position:sticky`, `top:0`, `z-index:1`, `background:#fff`,
      `border-bottom:2px solid #e5e7eb`,
      !isLast ? 'border-right:1px solid #e5e7eb' : '',
    ].filter(Boolean).join(';')
    hr.appendChild(th)
  })
  thead.appendChild(hr)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  tbody.setAttribute(EXT_ATTR, 'items-tbody')
  items.forEach((item, i) => tbody.appendChild(buildItemRow(item, i)))
  table.appendChild(tbody)
  wrapper.appendChild(table)

  return wrapper
}

// ── Validate ──────────────────────────────────────────────────────────────────

function validate(): boolean {
  if (!_extracted?.fornecedor?.trim()) { setFeedback('Fornecedor não encontrado.', 'err'); return false }
  if (!_extracted?.numero_nfe?.trim()) { setFeedback('Número da NF-e não encontrado.', 'err'); return false }

  let hasInvalid = false
  // Validate only non-ignored editable inputs
  _overlay?.querySelectorAll(`input[type="text"][${EXT_ATTR}-field]`).forEach(el => {
    const input = el as HTMLInputElement
    const rowIdx = parseInt(input.getAttribute(`${EXT_ATTR}-row`) ?? '0', 10)
    if (_ignoredRows.has(rowIdx)) return
    if (!input.value.trim()) {
      input.style.borderColor = '#fca5a5'
      input.style.background  = '#fef2f2'
      input.style.color       = '#dc2626'
      hasInvalid = true
    }
  })
  // Validate nome from _items for non-ignored rows
  _items.forEach((item, i) => { if (!_ignoredRows.has(i) && !item.nome?.trim()) hasInvalid = true })

  if (hasInvalid) { setFeedback('Há campos obrigatórios em branco.', 'err'); return false }
  clearFeedback()
  return true
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function handleSend(settings: Settings) {
  clearFeedback()
  if (!validate()) return
  setSendBtnLoading(true)

  const payload = {
    fornecedor:   _extracted!.fornecedor,
    numero_nfe:   _extracted!.numero_nfe,
    valor_frete:  _freteUnits / 100,
    items:        _items.filter((_, i) => !_ignoredRows.has(i)),
    exportado_em: new Date().toISOString(),
  }

  chrome.runtime.sendMessage(
    { action: 'sendConciliacao', baseUrl: settings.baseUrl, endpointConciliacao: settings.endpointConciliacao, apiKey: settings.apiKey, extraHeaders: settings.extraHeaders, payload },
    (resp: { ok: boolean; status?: number; json?: { success: boolean; message?: string; url?: string } | null; rawText?: string; error?: string }) => {
      setSendBtnLoading(false)
      if (chrome.runtime.lastError || resp.error) {
        setFeedback('Falha na requisição: ' + (resp?.error ?? chrome.runtime.lastError?.message ?? 'Erro desconhecido'), 'err')
        return
      }
      if (resp.ok && resp.json?.success) {
        setFeedback('✓ ' + (resp.json.message ?? 'Enviado com sucesso.'), 'ok')
        if (resp.json.url) {
          try {
            const url = new URL(resp.json.url, settings.baseUrl ?? '').href
            showRedirectLink(url)
          } catch { /* invalid URL, skip */ }
        }
      } else {
        setFeedback('Erro: ' + (resp.json?.message ?? `HTTP ${resp.status}`), 'err')
      }
    }
  )
}

// ── Show review modal ─────────────────────────────────────────────────────────

async function showReviewModal(data: ConciliacaoData) {
  closeReviewModal()

  _extracted = data
  _items     = data.items.map(i => ({ ...i }))

  const settings  = await getSettings()
  const hasConfig = !!(settings.baseUrl && settings.apiKey && settings.endpointConciliacao)

  // Overlay backdrop
  const overlay = document.createElement('div')
  overlay.setAttribute(EXT_ATTR, 'review-modal')
  overlay.style.cssText = `position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font-family:${FONT};`
  overlay.addEventListener('click', e => { if (e.target === overlay) closeReviewModal() })

  // Dialog
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.style.cssText = 'background:#fff;border-radius:10px;box-shadow:0 25px 60px rgba(0,0,0,0.25);width:92vw;max-width:840px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;'

  // ── Header
  const header = document.createElement('div')
  header.style.cssText = 'padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0;'

  const headerLeft = document.createElement('div')

  const titleEl = document.createElement('div')
  titleEl.style.cssText = 'font-size:15px;font-weight:600;color:#111827;margin-bottom:4px;'
  titleEl.textContent = 'Revisão — Conciliação NF-e'

  const subtitleEl = document.createElement('div')
  subtitleEl.style.cssText = 'font-size:12px;color:#6b7280;'
  subtitleEl.innerHTML = `<strong style="color:#374151">${data.fornecedor || '—'}</strong><span style="color:#d1d5db;margin:0 6px">·</span>NF-e <strong style="color:#374151">${data.numero_nfe || '—'}</strong><span style="color:#9ca3af;font-size:11px;font-family:${MONO};margin-left:8px">${data.items.length} itens</span>`

  headerLeft.appendChild(titleEl)
  headerLeft.appendChild(subtitleEl)

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.textContent = '×'
  closeBtn.style.cssText = 'background:none;border:none;font-size:22px;line-height:1;cursor:pointer;color:#9ca3af;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:5px;flex-shrink:0;margin-left:12px;'
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = '#f3f4f6'; closeBtn.style.color = '#374151' })
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'none';    closeBtn.style.color = '#9ca3af'  })
  closeBtn.addEventListener('click', closeReviewModal)

  header.appendChild(headerLeft)
  header.appendChild(closeBtn)

  // ── Body
  const body = document.createElement('div')
  body.style.cssText = 'overflow:auto;flex:1;padding:16px 20px;'

  // No-config warning
  if (!hasConfig) {
    const warn = document.createElement('div')
    warn.style.cssText = `font-size:12px;font-family:${MONO};color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:10px 12px;margin-bottom:14px;line-height:1.55;`
    warn.textContent = '⚙ Endpoint e API Key não configurados. Configure a extensão antes de enviar os dados.'
    body.appendChild(warn)
  }

  // Frete input
  _freteUnits = 0
  const freteWrap = document.createElement('div')
  freteWrap.style.cssText = 'margin-bottom:14px;'

  const freteLabel = document.createElement('div')
  freteLabel.style.cssText = `font-family:${MONO};font-size:9px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:4px;`
  freteLabel.textContent = 'Valor de frete'

  const freteInput = document.createElement('input')
  freteInput.type = 'text'
  freteInput.inputMode = 'numeric'
  freteInput.value = (0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  freteInput.style.cssText = `width:160px;padding:5px 8px;border:1px solid #e5e7eb;border-radius:6px;font-family:${MONO};font-size:12px;background:#fff;color:#111827;outline:none;text-align:right;`
  freteInput.addEventListener('focus', () => { freteInput.style.borderColor = '#93c5fd' })
  freteInput.addEventListener('blur',  () => { freteInput.style.borderColor = '#e5e7eb' })
  freteInput.addEventListener('keydown', (e: KeyboardEvent) => {
    const k = e.key
    if (e.metaKey || e.ctrlKey || k === 'Enter' || k === 'Tab' || k.startsWith('Arrow')) return
    e.preventDefault()
    if (/^\d$/.test(k)) {
      _freteUnits = Math.min(_freteUnits * 10 + Number(k), 999_999_999_99)
    } else if (k === 'Backspace') {
      _freteUnits = Math.floor(_freteUnits / 10)
    } else if (k === 'Delete') {
      _freteUnits = 0
    } else {
      return
    }
    freteInput.value = (_freteUnits / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  })
  freteInput.addEventListener('paste', (e: ClipboardEvent) => {
    e.preventDefault()
    const raw = (e.clipboardData?.getData('text') ?? '').replace(/[^\d,.-]/g, '')
    const n = parseFloat(raw.replace(',', '.'))
    if (Number.isFinite(n) && n >= 0) {
      _freteUnits = Math.round(n * 100)
      freteInput.value = (_freteUnits / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
  })

  freteWrap.appendChild(freteLabel)
  freteWrap.appendChild(freteInput)
  body.appendChild(freteWrap)

  // Items table
  body.appendChild(buildTable(_items))

  // ── Footer
  const footer = document.createElement('div')
  footer.setAttribute(EXT_ATTR, 'review-footer')
  footer.style.cssText = 'padding:12px 20px;border-top:1px solid #e5e7eb;display:flex;align-items:center;gap:8px;flex-shrink:0;background:#f9fafb;flex-wrap:wrap;'

  const feedbackEl = document.createElement('div')
  feedbackEl.setAttribute(EXT_ATTR, 'feedback')
  feedbackEl.style.cssText = 'flex:1;min-width:0;'
  footer.appendChild(feedbackEl)

  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.setAttribute(EXT_ATTR, 'cancel-btn')
  cancelBtn.textContent = 'FECHAR'
  cancelBtn.style.cssText = `background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;border-radius:6px;padding:8px 16px;font-size:12px;font-weight:600;letter-spacing:0.5px;cursor:pointer;font-family:${FONT};`
  cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = '#e5e7eb' })
  cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = '#f3f4f6' })
  cancelBtn.addEventListener('click', closeReviewModal)
  footer.appendChild(cancelBtn)

  const sendBtn = document.createElement('button')
  sendBtn.type = 'button'
  sendBtn.setAttribute(EXT_ATTR, 'send-btn')
  sendBtn.textContent = 'ENVIAR'
  sendBtn.disabled    = !hasConfig
  sendBtn.style.cssText = `background:#2563eb;color:white;border:none;border-radius:6px;padding:8px 20px;font-size:12px;font-weight:600;letter-spacing:0.5px;font-family:${FONT};cursor:${hasConfig ? 'pointer' : 'not-allowed'};opacity:${hasConfig ? '1' : '0.5'};transition:background 0.15s;`
  sendBtn.addEventListener('mouseenter', () => { if (!sendBtn.disabled) sendBtn.style.background = '#1d4ed8' })
  sendBtn.addEventListener('mouseleave', () => { if (!sendBtn.disabled) sendBtn.style.background = '#2563eb' })
  sendBtn.addEventListener('click', () => handleSend(settings))
  footer.appendChild(sendBtn)

  dialog.appendChild(header)
  dialog.appendChild(body)
  dialog.appendChild(footer)
  overlay.appendChild(dialog)
  document.body.appendChild(overlay)
  _overlay = overlay

  // Dismiss on Escape
  const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') { closeReviewModal(); document.removeEventListener('keydown', escHandler) } }
  document.addEventListener('keydown', escHandler)
}

// ── Inline confirmation node ──────────────────────────────────────────────────

function removeInlineConfirm(modal: Element) {
  modal.querySelector(`[${EXT_ATTR}="inline-confirm"]`)?.remove()
}

function showInlineConfirm(modal: Element, data: ConciliacaoData, settings: Settings) {
  removeInlineConfirm(modal)

  const hasConfig = !!(settings.baseUrl && settings.apiKey && settings.endpointConciliacao)

  // frete state (centavos)
  let freteUnits = 0

  const wrap = document.createElement('div')
  wrap.setAttribute(EXT_ATTR, 'inline-confirm')
  wrap.style.cssText = [
    `font-family:${FONT}`,
    'padding:10px 16px',
    'background:#f0fdf4',
    'border-bottom:1px solid #bbf7d0',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'flex-wrap:wrap',
    'gap:8px',
  ].join(';')

  // Left: checks + item count + frete
  const left = document.createElement('div')
  left.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;'

  const mkCheck = (label: string, value: string) => {
    const span = document.createElement('span')
    span.style.cssText = 'font-size:12px;color:#166534;display:flex;align-items:center;gap:4px;'
    span.innerHTML = `<span style="color:#16a34a;font-weight:700;">✓</span> <span style="color:#374151">${label}:</span> <strong style="color:#111827">${value || '—'}</strong>`
    return span
  }

  const mkInfo = (label: string, value: string) => {
    const span = document.createElement('span')
    span.style.cssText = 'font-size:12px;color:#374151;display:flex;align-items:center;gap:4px;'
    span.innerHTML = `<span style="color:#6b7280">${label}:</span> <strong style="color:#111827">${value}</strong>`
    return span
  }

  left.appendChild(mkCheck('Fornecedor', data.fornecedor))
  left.appendChild(mkCheck('Nº nota', data.numero_nfe))
  left.appendChild(mkInfo('Itens', String(data.items.length)))

  // Frete inline input
  const freteWrap = document.createElement('span')
  freteWrap.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;color:#374151;'
  freteWrap.innerHTML = `<span style="color:#6b7280">Frete:</span>`
  const freteInput = document.createElement('input')
  freteInput.type      = 'text'
  freteInput.inputMode = 'numeric'
  freteInput.value     = (0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  freteInput.style.cssText = `width:80px;padding:2px 5px;border:1px solid #d1fae5;border-radius:4px;font-family:${MONO};font-size:12px;background:#fff;color:#111827;outline:none;text-align:right;`
  freteInput.addEventListener('focus', () => { freteInput.style.borderColor = '#6ee7b7' })
  freteInput.addEventListener('blur',  () => { freteInput.style.borderColor = '#d1fae5' })
  freteInput.addEventListener('keydown', (e: KeyboardEvent) => {
    const k = e.key
    if (e.metaKey || e.ctrlKey || k === 'Enter' || k === 'Tab' || k.startsWith('Arrow')) return
    e.preventDefault()
    if (/^\d$/.test(k)) {
      freteUnits = Math.min(freteUnits * 10 + Number(k), 999_999_999_99)
    } else if (k === 'Backspace') {
      freteUnits = Math.floor(freteUnits / 10)
    } else if (k === 'Delete') {
      freteUnits = 0
    } else { return }
    freteInput.value = (freteUnits / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  })
  freteInput.addEventListener('paste', (e: ClipboardEvent) => {
    e.preventDefault()
    const raw = (e.clipboardData?.getData('text') ?? '').replace(/[^\d,.-]/g, '')
    const n = parseFloat(raw.replace(',', '.'))
    if (Number.isFinite(n) && n >= 0) {
      freteUnits = Math.round(n * 100)
      freteInput.value = (freteUnits / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
  })
  freteWrap.appendChild(freteInput)
  left.appendChild(freteWrap)

  wrap.appendChild(left)

  // Right: feedback + buttons
  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;'

  const feedback = document.createElement('span')
  feedback.setAttribute(EXT_ATTR, 'inline-feedback')
  feedback.style.cssText = `font-size:11px;font-family:${MONO};`
  actions.appendChild(feedback)

  const reviewBtn = document.createElement('button')
  reviewBtn.type = 'button'
  reviewBtn.textContent = 'REVISAR'
  reviewBtn.style.cssText = `background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:4px;padding:4px 10px;font-size:11px;font-weight:600;letter-spacing:0.5px;cursor:pointer;font-family:${FONT};transition:background 0.15s;`
  reviewBtn.addEventListener('mouseenter', () => { reviewBtn.style.background = '#e5e7eb' })
  reviewBtn.addEventListener('mouseleave', () => { reviewBtn.style.background = '#f3f4f6' })
  reviewBtn.addEventListener('click', () => {
    removeInlineConfirm(modal)
    showReviewModal(data)
  })
  actions.appendChild(reviewBtn)

  const sendBtn = document.createElement('button')
  sendBtn.type = 'button'
  sendBtn.setAttribute(EXT_ATTR, 'inline-send-btn')
  sendBtn.textContent = 'ENVIAR'
  sendBtn.disabled = !hasConfig
  sendBtn.style.cssText = `background:#2563eb;color:white;border:none;border-radius:4px;padding:4px 12px;font-size:11px;font-weight:600;letter-spacing:0.5px;cursor:${hasConfig ? 'pointer' : 'not-allowed'};opacity:${hasConfig ? '1' : '0.5'};font-family:${FONT};transition:background 0.15s;`
  sendBtn.addEventListener('mouseenter', () => { if (!sendBtn.disabled) sendBtn.style.background = '#1d4ed8' })
  sendBtn.addEventListener('mouseleave', () => { if (!sendBtn.disabled) sendBtn.style.background = '#2563eb' })

  sendBtn.addEventListener('click', async () => {
    if (sendBtn.disabled) return
    sendBtn.disabled      = true
    sendBtn.textContent   = 'ENVIANDO…'
    sendBtn.style.opacity = '0.7'
    sendBtn.style.cursor  = 'not-allowed'
    reviewBtn.disabled    = true
    feedback.textContent  = ''

    const payload = {
      fornecedor:   data.fornecedor,
      numero_nfe:   data.numero_nfe,
      valor_frete:  freteUnits / 100,
      items:        data.items,
      exportado_em: new Date().toISOString(),
    }

    const showInlineError = (msg: string) => {
      wrap.style.background  = '#fef2f2'
      wrap.style.borderColor = '#fecaca'
      feedback.style.color   = '#dc2626'
      feedback.textContent   = '✗ ' + msg
      sendBtn.disabled      = false
      sendBtn.textContent   = 'ENVIAR'
      sendBtn.style.opacity = '1'
      sendBtn.style.cursor  = 'pointer'
      reviewBtn.disabled    = false
    }

    chrome.runtime.sendMessage(
      { action: 'sendConciliacao', baseUrl: settings.baseUrl, endpointConciliacao: settings.endpointConciliacao, apiKey: settings.apiKey, extraHeaders: settings.extraHeaders, payload },
      (resp: { ok: boolean; status?: number; json?: { success: boolean; message?: string; url?: string } | null; rawText?: string; error?: string }) => {
        if (chrome.runtime.lastError || resp.error) {
          showInlineError(resp?.error ?? chrome.runtime.lastError?.message ?? 'Erro desconhecido')
          return
        }
        if (resp.ok && resp.json?.success) {
          wrap.style.background  = '#f0fdf4'
          wrap.style.borderColor = '#86efac'
          feedback.style.color   = '#16a34a'
          feedback.textContent   = '✓ ' + (resp.json.message ?? 'Enviado com sucesso.')
          sendBtn.textContent      = 'ENVIADO'
          sendBtn.style.background = '#16a34a'
          sendBtn.style.opacity    = '1'
          if (resp.json.url) {
            try {
              const url = new URL(resp.json.url, settings.baseUrl ?? '').href
              const link = document.createElement('a')
              link.href   = url
              link.target = '_blank'
              link.rel    = 'noopener'
              link.style.cssText = `font-size:11px;color:#2563eb;text-decoration:none;font-weight:500;`
              link.textContent   = '↗ Abrir no sistema'
              actions.insertBefore(link, sendBtn)
            } catch { /* invalid URL */ }
          }
        } else {
          showInlineError(resp.json?.message ?? `HTTP ${resp.status}`)
        }
      }
    )
  })

  if (!hasConfig) {
    feedback.style.color = '#92400e'
    feedback.textContent = '⚙ Configure endpoint e API Key nas opções'
  }

  actions.appendChild(sendBtn)
  wrap.appendChild(actions)

  // Insert after .modal-header
  const header = modal.querySelector('.modal-header')
  if (header?.nextSibling) header.parentNode!.insertBefore(wrap, header.nextSibling)
  else modal.appendChild(wrap)
}

// ── Feature 1: "Conciliar" button in the SAIPOS modal ────────────────────────

function injectModalButton(modal: Element) {
  if (modal.querySelector(`[${EXT_ATTR}="modal-btn"]`)) return

  const header = modal.querySelector('.modal-header')
  if (!header) return

  const btn = document.createElement('button')
  btn.setAttribute(EXT_ATTR, 'modal-btn')
  btn.type = 'button'
  btn.textContent = 'Conciliar'
  btn.style.cssText = [
    'background:#2563eb', 'color:white', 'border:none', 'border-radius:4px',
    'padding:4px 10px', 'font-size:12px', 'cursor:pointer', 'font-weight:500',
    'margin-left:10px', 'vertical-align:middle', 'transition:background 0.15s',
    `font-family:${FONT}`,
  ].join(';')
  btn.addEventListener('mouseenter', () => { btn.style.background = '#1d4ed8' })
  btn.addEventListener('mouseleave', () => { btn.style.background = '#2563eb' })

  btn.addEventListener('click', async () => {
    const data = extractDataFromDOM()
    if ('error' in data) {
      const orig = btn.textContent!
      btn.textContent      = '⚠ Modal não encontrada'
      btn.style.background = '#d97706'
      setTimeout(() => { btn.textContent = orig; btn.style.background = '#2563eb' }, 3000)
      return
    }
    // Remove any existing inline confirm before re-opening
    removeInlineConfirm(modal)
    const settings = await getSettings()
    showInlineConfirm(modal, data, settings)
  })

  const titleEl = header.querySelector('.modal-title')
  if (titleEl) titleEl.appendChild(btn)
  else header.appendChild(btn)
}

// ── Error debug popover ───────────────────────────────────────────────────────

function showErrorPopup(
  anchor: HTMLElement,
  errorMsg: string,
  fetchedAt: string,
  settings: Settings,
  nfeNumber: string,
  retry: () => void,
) {
  closePartialPopup()

  const popup = document.createElement('div')
  popup.setAttribute(EXT_ATTR, 'popup')
  popup.style.cssText = [
    'position:fixed', 'z-index:2147483647',
    'background:#fff', 'border:1px solid #fecaca', 'border-radius:6px',
    'padding:12px', 'width:260px',
    'box-shadow:0 4px 16px rgba(0,0,0,0.14)',
    `font-family:${FONT}`,
  ].join(';')

  // Mask API key for safety
  const maskedKey = settings.apiKey
    ? settings.apiKey.slice(0, 4) + '…' + settings.apiKey.slice(-3)
    : '(não configurada)'

  const diagnosticObj = {
    timestamp:  fetchedAt,
    nfe:        nfeNumber,
    endpoint:   settings.baseUrl ?? '(não configurado)',
    api_key:    maskedKey,
    error:      errorMsg,
    url:        location.href.slice(0, 120),
    user_agent: navigator.userAgent,
  }
  const diagnosticStr = JSON.stringify(diagnosticObj, null, 2)

  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:#dc2626">Erro ao verificar status</span>
      <button type="button" data-close style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:16px;line-height:1;padding:0;margin:0">×</button>
    </div>
    <div style="font-size:11px;color:#6b7280;font-family:${MONO};background:#fef2f2;border:1px solid #fecaca;border-radius:4px;padding:7px 8px;margin-bottom:10px;word-break:break-all;line-height:1.5;">
      ${errorMsg}
    </div>
    <div style="display:flex;gap:6px;">
      <button type="button" data-retry style="flex:1;background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;border-radius:5px;padding:6px 0;font-size:11px;font-weight:500;cursor:pointer;font-family:${FONT};">
        ↺ Tentar novamente
      </button>
      <button type="button" data-copy style="flex:1;background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;border-radius:5px;padding:6px 0;font-size:11px;font-weight:500;cursor:pointer;font-family:${FONT};">
        Copiar diagnóstico
      </button>
    </div>
  `

  // Position below anchor
  const rect = anchor.getBoundingClientRect()
  let top  = rect.bottom + window.scrollY + 6
  let left = rect.left + window.scrollX - 130 + rect.width / 2
  left = Math.max(8, Math.min(left, document.documentElement.clientWidth - 268 + window.scrollX))
  popup.style.top  = `${top}px`
  popup.style.left = `${left}px`

  document.body.appendChild(popup)
  activePopup = popup

  popup.querySelector('[data-close]')?.addEventListener('click', closePartialPopup)

  popup.querySelector('[data-retry]')?.addEventListener('click', () => {
    closePartialPopup()
    retry()
  })

  const copyBtn = popup.querySelector('[data-copy]') as HTMLButtonElement | null
  copyBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(diagnosticStr).then(() => {
      if (copyBtn) { copyBtn.textContent = '✓ Copiado!'; copyBtn.style.color = '#16a34a' }
      setTimeout(() => { if (copyBtn) { copyBtn.textContent = 'Copiar diagnóstico'; copyBtn.style.color = '#374151' } }, 2000)
    }).catch(() => {
      // Fallback for older browsers
      const ta = document.createElement('textarea')
      ta.value = diagnosticStr
      ta.style.position = 'fixed'
      ta.style.opacity  = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      if (copyBtn) { copyBtn.textContent = '✓ Copiado!'; copyBtn.style.color = '#16a34a' }
      setTimeout(() => { if (copyBtn) { copyBtn.textContent = 'Copiar diagnóstico'; copyBtn.style.color = '#374151' } }, 2000)
    })
  })

  setTimeout(() => {
    function outsideHandler(e: MouseEvent) {
      if (!popup.contains(e.target as Node)) {
        closePartialPopup()
        document.removeEventListener('click', outsideHandler)
      }
    }
    document.addEventListener('click', outsideHandler)
  }, 0)
}

// ── Feature 2: AMM column in NF list table ───────────────────────────────────

async function processRow(row: Element) {
  const cells = row.querySelectorAll('td')
  if (cells.length < 9) return
  if (row.querySelector(`[${AMM_ATTR}]`)) return

  const nfeNumber = cells[0].textContent?.trim()
  if (!nfeNumber) return

  const settings = await getSettings()
  if (!settings.baseUrl || !settings.apiKey || !settings.endpointConciliacao) return

  const td = createAmmCell()
  applyTdStatus(td, 'loading')
  row.insertBefore(td, cells[cells.length - 1])
  // tag the cell immediately before the AMM cell (previousElementSibling after insertion)
  const prevTd = td.previousElementSibling
  if (prevTd) prevTd.setAttribute(SAIPOS_COL_ATTR, '1')

  let fetching      = false
  let lastError     = ''
  let fetchedAt     = ''
  let currentStatus = 'loading'
  let lastData:   NfeStatus | null = null

  async function doFetch() {
    if (fetching) return
    fetching      = true
    lastError     = ''
    lastData      = null
    currentStatus = 'loading'
    closePartialPopup()
    applyTdStatus(td, 'loading')
    statusCache.delete(nfeNumber)
    fetchedAt = new Date().toISOString()

    const result = await fetchStatus(nfeNumber)
    fetching = false

    if (result.status === 'error') {
      lastError     = result.error
      currentStatus = 'error'
      applyTdStatus(td, 'error')
      td.title = result.error + ' — clique para detalhes'
      return
    }

    lastData      = result
    currentStatus = result.status
    applyTdStatus(td, result.status)
    if (result.status === 'complete' && !result.url) td.style.cursor = 'default'
  }

  td.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (currentStatus === 'error' && lastError) {
      showErrorPopup(td, lastError, fetchedAt, settings, nfeNumber, doFetch)
    } else if (currentStatus === 'partial' && lastData) {
      showPartialPopup(td, lastData)
    } else if (currentStatus === 'complete' && lastData?.url) {
      window.open(lastData.url, '_blank', 'noopener')
    }
  }, true)

  await doFetch()
}

function processTable() {
  const table = document.querySelector('table.table-store-provider-nfe')
  if (!table) return
  injectAmmHeader(table)
  table.querySelectorAll('tbody tr[data-qa="provider-nfes-value"]').forEach(row => processRow(row))
}

// ── Page observer ─────────────────────────────────────────────────────────────

function checkPage() {
  // Feature 1 — conciliation modal
  const openModal =
    document.querySelector('.modal.in') ??
    document.querySelector('.modal[style*="display: block"]')

  if (openModal) {
    const titleEl = openModal.querySelector('.modal-title')
    if (titleEl?.textContent?.includes('Conciliação de itens')) {
      injectModalButton(openModal)
    }
  }

  // Feature 2 — NF list table
  if (document.querySelector('table.table-store-provider-nfe')) {
    getSettings().then(s => {
      const visible = s.showConcEstoqColumn !== false
      setSaiposColumnVisible(visible)
      if (visible) processTable()
    })
  }
}

let _debounce: ReturnType<typeof setTimeout> | null = null
const observer = new MutationObserver(() => {
  if (_debounce) clearTimeout(_debounce)
  _debounce = setTimeout(checkPage, 150)
})

observer.observe(document.body, { childList: true, subtree: true })
checkPage()
