/**
 * Converts technical fetch/HTTP error messages into natural-language Portuguese.
 */
export function humanizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)

  // Network-level errors (browser-specific strings)
  if (
    /failed to fetch/i.test(msg) ||
    /networkerror/i.test(msg) ||
    /load failed/i.test(msg) ||
    /network request failed/i.test(msg)
  ) {
    return 'Não foi possível conectar ao servidor. Verifique se o endereço (Base URL) está correto e se o servidor está acessível.'
  }

  // HTTP status codes
  const httpMatch = msg.match(/HTTP (\d{3})/)
  if (httpMatch) {
    const code = Number(httpMatch[1])
    if (code === 401) return 'Acesso negado. A API Key pode estar incorreta — verifique nas configurações.'
    if (code === 403) return 'Sem permissão para acessar este recurso. Verifique as configurações de acesso.'
    if (code === 404) return 'Endereço não encontrado. Verifique o endpoint nas configurações.'
    if (code === 422) return 'Os dados enviados foram rejeitados pelo servidor. Verifique o preenchimento e tente novamente.'
    if (code >= 500)  return `O servidor encontrou um erro interno (${code}). Tente novamente mais tarde.`
    return `O servidor respondeu com erro ${code}. Verifique as configurações e tente novamente.`
  }

  return msg
}
