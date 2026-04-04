/**
 * storage.ts — chrome.storage.sync wrapper
 * Permanent: survives cache clears, linked to Chrome account.
 */

export interface Settings {
  baseUrl?:              string  // e.g. https://meu-sistema.com  (sem barra final)
  apiKey?:              string
  extraHeaders?:        string
  endpointConciliacao?: string  // e.g. /api/nfe/conciliacao
  endpointUnits?:       string  // e.g. /api/measurement-units?scope=global&active=true
}

const KEYS: (keyof Settings)[] = ['baseUrl', 'apiKey', 'extraHeaders', 'endpointConciliacao', 'endpointUnits']

export function getSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(KEYS, (data) => {
      resolve((data as Settings) || {})
    })
  })
}

export function saveSettings(settings: Settings): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(settings, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
      else resolve()
    })
  })
}

export function clearSettings(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.clear(() => resolve())
  })
}

export function parseExtraHeaders(raw: string = ''): Record<string, string> {
  const result: Record<string, string> = {}
  raw.split('\n').forEach((line) => {
    const idx = line.indexOf(':')
    if (idx > 0) {
      result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
  })
  return result
}

/** Retorna a URL completa combinando baseUrl + path/endpoint relativo. */
export function buildUrl(baseUrl: string, endpoint: string): string {
  const base = baseUrl.replace(/\/$/, '')
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  return `${base}${path}`
}
