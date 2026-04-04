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
  baseUrl?:              string
  apiKey?:              string
  extraHeaders?:        string
  endpointConciliacao?: string
  endpointUnits?:       string
}

interface ItemRow {
  nome: string
  unidade_entrada: string
  quantidade: string
  valor_total: string
  unidade_consumo: string
}

interface ConciliacaoData {
  fornecedor: string
  numero_nfe: string
  items: ItemRow[]
}

interface MeasurementUnit {
  id: string
  code: string
  name: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EXT_ATTR = 'data-sxt'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Consolas,monospace"

const STATUS_CFG: Record<string, { color: string; label: string; title: string; pointer: boolean }> = {
  not_found: { color: '#dc2626', label: '✕', title: 'Sem conciliação de estoque',                              pointer: false },
  partial:   { color: '#d97706', label: '!', title: 'Conciliação parcial — clique p/ detalhes',                pointer: true  },
  complete:  { color: '#16a34a', label: '✓', title: 'Conciliação de estoque completa',                         pointer: false },
  loading:   { color: '#9ca3af', label: '…', title: 'Verificando…',                                            pointer: false },
  error:     { color: '#dc2626', label: '!', title: 'Erro ao verificar status — clique para detalhes',         pointer: true  },
}

// ── Settings ──────────────────────────────────────────────────────────────────

let _settingsPromise: Promise<Settings> | null = null

function getSettings(): Promise<Settings> {
  if (!_settingsPromise) {
    _settingsPromise = new Promise(resolve =>
      chrome.storage.sync.get(['baseUrl', 'apiKey', 'extraHeaders', 'endpointConciliacao', 'endpointUnits'], data => resolve(data as Settings))
    )
  }
  return _settingsPromise
}

// Invalidate cache when options are saved
chrome.storage.onChanged.addListener(() => { _settingsPromise = null })

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

// ── Badge ─────────────────────────────────────────────────────────────────────

;(function ensureSpinStyle() {
  const id = 'sxt-spin-style'
  if (!document.getElementById(id)) {
    const s = document.createElement('style')
    s.id = id
    s.textContent = `@keyframes sxt-spin { to { transform: rotate(360deg); } } .sxt-spin { display:inline-block; animation: sxt-spin 0.8s linear infinite; }`
    document.head.appendChild(s)
  }
})()

function applyBadgeStatus(badge: HTMLElement, key: string) {
  const cfg = STATUS_CFG[key] ?? STATUS_CFG.error
  badge.style.background = cfg.color
  badge.title            = cfg.title
  badge.style.cursor     = cfg.pointer ? 'pointer' : 'default'
  if (key === 'loading') {
    badge.innerHTML = '<span class="sxt-spin" style="line-height:1;font-size:12px;">↻</span>'
  } else {
    badge.textContent = cfg.label
  }
}

function createBadge(nfeNumber: string): HTMLElement {
  const badge = document.createElement('button')
  badge.setAttribute(EXT_ATTR, 'badge')
  badge.setAttribute(`${EXT_ATTR}-nfe`, nfeNumber)
  badge.type = 'button'
  badge.style.cssText = [
    'display:inline-flex', 'align-items:center', 'justify-content:center',
    'width:20px', 'height:20px', 'border-radius:50%', 'border:none',
    'font-size:10px', 'font-weight:700', 'color:white',
    'margin-right:4px', 'flex-shrink:0', 'vertical-align:middle',
    'transition:opacity 0.15s',
  ].join(';')
  applyBadgeStatus(badge, 'loading')
  return badge
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
    if (nome) items.push({ nome, unidade_entrada, quantidade, valor_total, unidade_consumo: 'UN' })
  })

  return { fornecedor, numero_nfe, items }
}

// ── In-page review modal ──────────────────────────────────────────────────────

let _overlay:    HTMLElement | null = null
let _items:      ItemRow[]          = []
let _extracted:  ConciliacaoData | null = null
let _units:      MeasurementUnit[]  = []

function closeReviewModal() {
  _overlay?.remove()
  _overlay   = null
  _items     = []
  _extracted = null
  _units     = []
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
  btn.textContent = loading ? 'Enviando…' : 'Enviar'
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

const COLUMNS = [
  { key: 'nome' as keyof ItemRow,            label: 'ITEM NF',     width: '33%' },
  { key: 'unidade_entrada' as keyof ItemRow, label: 'UN. NF',      width: '13%' },
  { key: 'quantidade' as keyof ItemRow,      label: 'QTDE',        width: '12%' },
  { key: 'valor_total' as keyof ItemRow,     label: 'VALOR',       width: '16%' },
  { key: 'unidade_consumo' as keyof ItemRow, label: 'UN. CONSUMO', width: '26%' },
]

function buildItemRow(item: ItemRow, rowIdx: number, units: MeasurementUnit[]): HTMLTableRowElement {
  const tr = document.createElement('tr')
  if (rowIdx % 2 === 1) tr.style.background = '#fafafa'

  COLUMNS.forEach(col => {
    const td = document.createElement('td')
    td.style.cssText = `padding:5px 6px;border-bottom:1px solid #f3f4f6;`

    if (col.key === 'unidade_consumo') {
      const sel = document.createElement('select')
      sel.setAttribute(`${EXT_ATTR}-row`,   String(rowIdx))
      sel.setAttribute(`${EXT_ATTR}-field`, 'unidade_consumo')
      sel.style.cssText = `width:100%;padding:4px 5px;border:1px solid #e5e7eb;border-radius:4px;font-family:${MONO};font-size:12px;background:#fff;color:#374151;outline:none;cursor:pointer;`

      const opts = units.length > 0 ? units : [{ id: 'UN', code: 'UN', name: 'Unidade' }]
      opts.forEach(u => {
        const opt = document.createElement('option')
        opt.value = u.id
        opt.textContent = u.code
        if (item.unidade_consumo === u.id || item.unidade_consumo === u.code) opt.selected = true
        sel.appendChild(opt)
      })
      sel.addEventListener('change', () => { _items[rowIdx].unidade_consumo = sel.value })
      sel.addEventListener('focus', () => { sel.style.borderColor = '#93c5fd' })
      sel.addEventListener('blur',  () => { sel.style.borderColor = '#e5e7eb' })
      td.appendChild(sel)
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
        (_items[rowIdx] as unknown as Record<string, string>)[col.key] = input.value
        // Clear invalid highlight if user is typing
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

function buildTable(items: ItemRow[], units: MeasurementUnit[]): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'border:1px solid #e5e7eb;border-radius:7px;overflow:hidden;margin-bottom:14px;'

  const table = document.createElement('table')
  table.setAttribute(EXT_ATTR, 'items-table')
  table.style.cssText = 'width:100%;border-collapse:collapse;'

  const thead = document.createElement('thead')
  const hr = document.createElement('tr')
  hr.style.cssText = 'background:#f9fafb;border-bottom:2px solid #e5e7eb;'
  COLUMNS.forEach(col => {
    const th = document.createElement('th')
    th.textContent = col.label
    th.style.cssText = `padding:7px 6px;text-align:left;font-family:${MONO};font-size:10px;font-weight:600;letter-spacing:0.8px;color:#9ca3af;width:${col.width};`
    hr.appendChild(th)
  })
  thead.appendChild(hr)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  tbody.setAttribute(EXT_ATTR, 'items-tbody')
  items.forEach((item, i) => tbody.appendChild(buildItemRow(item, i, units)))
  table.appendChild(tbody)
  wrapper.appendChild(table)
  return wrapper
}

function updateSelectsWithUnits(units: MeasurementUnit[]) {
  if (!_overlay) return
  _overlay.querySelectorAll(`select[${EXT_ATTR}-field="unidade_consumo"]`).forEach(el => {
    const sel      = el as HTMLSelectElement
    const rowIdx   = parseInt(sel.getAttribute(`${EXT_ATTR}-row`) ?? '0', 10)
    const current  = _items[rowIdx]?.unidade_consumo ?? 'UN'

    sel.innerHTML = ''
    units.forEach(u => {
      const opt = document.createElement('option')
      opt.value = u.id
      opt.textContent = u.code
      if (current === u.id || current === u.code) opt.selected = true
      sel.appendChild(opt)
    })

    // If the default 'UN' string is set, resolve it to the real unit ID
    if (current === 'UN') {
      const unUnit = units.find(u => u.code === 'UN')
      if (unUnit) {
        _items[rowIdx].unidade_consumo = unUnit.id
        sel.value = unUnit.id
      }
    }
  })
}

async function loadUnitsInModal(settings: Settings) {
  const statusEl = getModalEl('units-status')
  if (statusEl) { statusEl.textContent = '⟳ Carregando unidades de consumo…'; statusEl.style.display = 'block' }

  chrome.runtime.sendMessage(
    { action: 'fetchUnits', baseUrl: settings.baseUrl, endpointUnits: settings.endpointUnits, apiKey: settings.apiKey, extraHeaders: settings.extraHeaders },
    (resp: { ok: boolean; units?: MeasurementUnit[]; error?: string }) => {
      if (!_overlay) return  // modal was closed while loading
      if (chrome.runtime.lastError || !resp.ok) {
        if (statusEl) {
          statusEl.textContent = '⚠ Não foi possível carregar unidades: ' + (resp?.error ?? chrome.runtime.lastError?.message ?? 'Erro desconhecido')
          statusEl.style.display = 'block'
          statusEl.style.color = '#b45309'
        }
        return
      }
      _units = resp.units ?? []
      updateSelectsWithUnits(_units)
      if (statusEl) statusEl.style.display = 'none'
    }
  )
}

// ── Validate ──────────────────────────────────────────────────────────────────

function validate(): boolean {
  if (!_extracted?.fornecedor?.trim()) { setFeedback('Fornecedor não encontrado.', 'err'); return false }
  if (!_extracted?.numero_nfe?.trim()) { setFeedback('Número da NF-e não encontrado.', 'err'); return false }

  let hasInvalid = false
  _overlay?.querySelectorAll(`input[${EXT_ATTR}-field]`).forEach(el => {
    const input = el as HTMLInputElement
    if (!input.value.trim()) {
      input.style.borderColor = '#fca5a5'
      input.style.background  = '#fef2f2'
      input.style.color       = '#dc2626'
      hasInvalid = true
    }
  })

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
    items:        _items,
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
          const url = resp.json.url.startsWith('http')
            ? resp.json.url
            : `${(settings.baseUrl ?? '').replace(/\/$/, '')}${resp.json.url}`
          showRedirectLink(url)
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

  // Units loading status (hidden until visible)
  if (settings.baseUrl) {
    const unitsStatus = document.createElement('div')
    unitsStatus.setAttribute(EXT_ATTR, 'units-status')
    unitsStatus.style.cssText = `display:none;font-size:11px;font-family:${MONO};color:#6b7280;margin-bottom:8px;`
    body.appendChild(unitsStatus)
  }

  // Items table
  body.appendChild(buildTable(_items, []))

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
  cancelBtn.textContent = 'Fechar'
  cancelBtn.style.cssText = `background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:500;cursor:pointer;font-family:${FONT};`
  cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = '#e5e7eb' })
  cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = '#f3f4f6' })
  cancelBtn.addEventListener('click', closeReviewModal)
  footer.appendChild(cancelBtn)

  const sendBtn = document.createElement('button')
  sendBtn.type = 'button'
  sendBtn.setAttribute(EXT_ATTR, 'send-btn')
  sendBtn.textContent = 'Enviar'
  sendBtn.disabled    = !hasConfig
  sendBtn.style.cssText = `background:#2563eb;color:white;border:none;border-radius:6px;padding:8px 20px;font-size:13px;font-weight:500;font-family:${FONT};cursor:${hasConfig ? 'pointer' : 'not-allowed'};opacity:${hasConfig ? '1' : '0.5'};transition:background 0.15s;`
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

  // Load units asynchronously (don't block modal render)
  if (settings.baseUrl && settings.apiKey && settings.endpointUnits) {
    loadUnitsInModal(settings)
  }
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
      btn.textContent    = '⚠ Modal não encontrada'
      btn.style.background = '#d97706'
      setTimeout(() => { btn.textContent = orig; btn.style.background = '#2563eb' }, 3000)
      return
    }
    await showReviewModal(data)
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

// ── Feature 2: Status badges in NF list table ─────────────────────────────────

async function processRow(row: Element) {
  const cells = row.querySelectorAll('td')
  if (cells.length < 9) return

  const actionCell = cells[cells.length - 1] as HTMLElement
  if (actionCell.querySelector(`[${EXT_ATTR}="badge"]`)) return

  const nfeNumber = cells[0].textContent?.trim()
  if (!nfeNumber) return

  const settings = await getSettings()
  if (!settings.baseUrl || !settings.apiKey || !settings.endpointConciliacao) return

  const badge = createBadge(nfeNumber)

  actionCell.insertBefore(badge, actionCell.firstChild)

  let fetching   = false
  let lastError  = ''
  let fetchedAt  = ''

  async function doFetch() {
    if (fetching) return
    fetching = true
    closePartialPopup()
    applyBadgeStatus(badge, 'loading')
    statusCache.delete(nfeNumber)
    fetchedAt = new Date().toISOString()

    const result = await fetchStatus(nfeNumber)
    fetching = false

    if (result.status === 'error') {
      lastError = result.error
      applyBadgeStatus(badge, 'error')
      badge.title = result.error + ' — clique para detalhes'
      return
    }

    // Success — swap badge for a clean clone without error listeners
    const fresh = badge.cloneNode(true) as HTMLElement
    badge.replaceWith(fresh)
    applyBadgeStatus(fresh, result.status)
    if (result.status === 'partial') {
      fresh.addEventListener('click', (e) => {
        e.stopPropagation()
        e.preventDefault()
        showPartialPopup(fresh, result)
      }, true)
    }
  }

  badge.addEventListener('click', async (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (lastError) {
      showErrorPopup(badge, lastError, fetchedAt, settings, nfeNumber, doFetch)
    } else {
      await doFetch()
    }
  }, true /* capture: intercepts before SAIPOS row handlers */)
  await doFetch()
}

function processTable() {
  document.querySelectorAll(
    'table.table-store-provider-nfe tbody tr[data-qa="provider-nfes-value"]'
  ).forEach(row => processRow(row))
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
    processTable()
  }
}

let _debounce: ReturnType<typeof setTimeout> | null = null
const observer = new MutationObserver(() => {
  if (_debounce) clearTimeout(_debounce)
  _debounce = setTimeout(checkPage, 150)
})

observer.observe(document.body, { childList: true, subtree: true })
checkPage()
