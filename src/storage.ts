/**
 * storage.ts — chrome.storage.sync wrapper
 * Permanent: survives cache clears, linked to Chrome account.
 */

export interface Settings {
  baseUrl?:      string  // e.g. https://meu-sistema.com  (no trailing slash)
  endpoint?:     string  // full URL for POST conciliacao
  apiKey?:       string
  extraHeaders?: string
}

export function getSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['baseUrl', 'endpoint', 'apiKey', 'extraHeaders'], (data) => {
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
