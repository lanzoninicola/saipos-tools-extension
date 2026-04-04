export interface NotaFiscal {
  numero: string
  fornecedor: string
  cnpj: string
  valor_total: number
  valor_total_str: string
  data_entrada: string
  data_emissao: string
  data_cadastro: string
  conciliacao_financeira: boolean
  conciliacao_estoque: boolean
}

export interface ProviderNfeMeta {
  gerado_em: string
  total_notas: number
  valor_total_tabela: number | null
  valor_total_tabela_str: string | null
  filtro_data_de: string | null
  filtro_data_ate: string | null
  pendentes_conciliacao_financeira: number
  pendentes_conciliacao_estoque: number
}

export interface ProviderNfeResult {
  meta: ProviderNfeMeta
  notas: NotaFiscal[]
}

export interface ProviderNfeError {
  error: string
}

/**
 * Injected into the SAIPOS tab via chrome.scripting.executeScript.
 * Must be self-contained (no imports).
 */
export function extractorProviderNfe(): ProviderNfeResult | ProviderNfeError {
  const rows = document.querySelectorAll(
    'table.table-store-provider-nfe tbody tr[data-qa="provider-nfes-value"]'
  )

  if (!rows || rows.length === 0) {
    return { error: 'Tabela de Notas de Entrada não encontrada. Certifique-se de estar na página correta no SAIPOS.' }
  }

  const getText = (cell: Element | null): string =>
    cell ? cell.textContent?.trim() ?? '' : ''

  const getLabel = (cell: Element | null): string => {
    const label = cell?.querySelector('label')
    return label ? label.textContent?.trim() ?? '' : ''
  }

  const parseValor = (str: string): number =>
    parseFloat(str.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0

  const notas: NotaFiscal[] = []

  rows.forEach((row) => {
    const cells = row.querySelectorAll('td')
    if (cells.length < 9) return
    notas.push({
      numero:                 getText(cells[0]),
      fornecedor:             getText(cells[1]),
      cnpj:                   getText(cells[2]),
      valor_total:            parseValor(getText(cells[3])),
      valor_total_str:        getText(cells[3]),
      data_entrada:           getText(cells[4]),
      data_emissao:           getText(cells[5]),
      data_cadastro:          getText(cells[6]),
      conciliacao_financeira: getLabel(cells[7]) === 'Sim',
      conciliacao_estoque:    getLabel(cells[8]) === 'Sim',
    })
  })

  const totalSpan = document.querySelector('[data-qa="total-of-all-nfe"]')
  const totalStr  = totalSpan ? totalSpan.textContent?.trim() ?? null : null

  const dateInputs = document.querySelectorAll('input[type="text"]')
  const dateValues: string[] = []
  dateInputs.forEach((i) => {
    const v = (i as HTMLInputElement).value.trim()
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) dateValues.push(v)
  })

  return {
    meta: {
      gerado_em:                        new Date().toISOString(),
      total_notas:                      notas.length,
      valor_total_tabela:               totalStr ? parseValor(totalStr) : null,
      valor_total_tabela_str:           totalStr,
      filtro_data_de:                   dateValues[0] ?? null,
      filtro_data_ate:                  dateValues[1] ?? null,
      pendentes_conciliacao_financeira: notas.filter((n) => !n.conciliacao_financeira).length,
      pendentes_conciliacao_estoque:    notas.filter((n) => !n.conciliacao_estoque).length,
    },
    notas,
  }
}
