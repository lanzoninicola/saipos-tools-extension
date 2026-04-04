/**
 * background.ts — Service worker
 * Handles messages from content scripts that require extension-level APIs.
 * Fetches are done here to avoid CORS restrictions in content scripts.
 */

function parseExtraHeaders(raw = ''): Record<string, string> {
  const out: Record<string, string> = {}
  raw.split('\n').forEach(line => {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  })
  return out
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── Open popup ────────────────────────────────────────────────────────────
  if (msg.action === 'openPopup') {
    chrome.action.openPopup()
      .then(() => sendResponse({ ok: true }))
      .catch((e: Error) => sendResponse({ ok: false, error: e.message }))
    return true
  }

  // ── Fetch NF-e status ─────────────────────────────────────────────────────
  // msg: { action: 'fetchNfeStatus', baseUrl, apiKey, nfeNumber }
  if (msg.action === 'fetchNfeStatus') {
    const { baseUrl, apiKey, nfeNumber } = msg
    const base = (baseUrl as string).replace(/\/$/, '')
    fetch(
      `${base}/api/nfe/conciliacao?numero_nfe=${encodeURIComponent(nfeNumber)}`,
      { headers: { 'x-api-key': apiKey } }
    )
      .then(async resp => {
        if (!resp.ok) {
          sendResponse({ ok: false, error: `HTTP ${resp.status} — ${resp.statusText || base}` })
          return
        }
        const data = await resp.json()
        sendResponse({ ok: true, data })
      })
      .catch((e: Error) => sendResponse({ ok: false, error: e.message ?? 'Erro de rede desconhecido' }))
    return true
  }

  // ── Fetch measurement units ───────────────────────────────────────────────
  // msg: { action: 'fetchUnits', baseUrl, apiKey, extraHeaders }
  if (msg.action === 'fetchUnits') {
    const { baseUrl, apiKey, extraHeaders } = msg
    const base = (baseUrl as string).replace(/\/$/, '')
    fetch(
      `${base}/api/measurement-units?active=true`,
      {
        headers: {
          'x-api-key': apiKey,
          ...(extraHeaders ? parseExtraHeaders(extraHeaders) : {}),
        },
      }
    )
      .then(async resp => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json()
        sendResponse({ ok: true, units: data.units ?? [] })
      })
      .catch((e: Error) => sendResponse({ ok: false, error: e.message }))
    return true
  }

  // ── Send conciliacao payload ──────────────────────────────────────────────
  // msg: { action: 'sendConciliacao', endpoint, apiKey, extraHeaders, payload }
  if (msg.action === 'sendConciliacao') {
    const { endpoint, apiKey, extraHeaders, payload } = msg
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        ...(extraHeaders ? parseExtraHeaders(extraHeaders) : {}),
      },
      body: JSON.stringify(payload),
    })
      .then(async resp => {
        const rawText = await resp.text()
        let json: { success: boolean; message?: string; url?: string } | null = null
        try { json = JSON.parse(rawText) } catch { /* non-JSON */ }
        sendResponse({ ok: resp.ok, status: resp.status, json, rawText })
      })
      .catch((e: Error) => sendResponse({ ok: false, error: e.message }))
    return true
  }
})
