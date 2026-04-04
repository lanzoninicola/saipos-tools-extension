export interface ConciliacaoItem {
  nome: string
  unidade_entrada: string
  quantidade: string
  valor_total: string
}

export interface ConciliacaoResult {
  fornecedor: string
  numero_nfe: string
  items: ConciliacaoItem[]
}

export interface ConciliacaoError {
  error: string
  debug?: string
}

/**
 * Injected into the SAIPOS tab via chrome.scripting.executeScript.
 * Mirrors exactly the working implementation from the old vanilla extension.
 */
export function extractorConciliacao(): ConciliacaoResult | ConciliacaoError {
  // Mirror old working code exactly — single querySelector, no Array.from
  const modalTitle = document.querySelector('.modal-title')
  if (!modalTitle || !modalTitle.textContent || !modalTitle.textContent.includes('Conciliação de itens')) {
    // Return debug info to help diagnose
    const allTitles = Array.from(document.querySelectorAll('.modal-title')).map(el => el.textContent?.trim())
    const hasSortable = !!document.querySelector('tbody.ui-sortable')
    return {
      error: 'not_on_page',
      debug: JSON.stringify({ allTitles, hasSortable, url: location.href.slice(0, 80) })
    }
  }

  const fornecedorEl = document.querySelector('.col-md-12.ng-binding')
  const fornecedor = (fornecedorEl?.textContent?.trim() ?? '')
    .replace(/^Fornecedor:\s*/i, '').trim()

  const nfeEl = document.querySelector('.title-item-conciliation.ng-binding')
  const numero_nfe = (nfeEl?.textContent?.trim() ?? '')
    .replace(/^N[ºo°]\s*NFe?:\s*/i, '').trim()

  const rows = document.querySelectorAll('tbody.ui-sortable tr')
  const items: ConciliacaoItem[] = []

  rows.forEach((tr) => {
    const cells = tr.querySelectorAll('td')
    if (cells.length < 4) return

    const nome            = cells[0].querySelector('a')?.textContent?.trim() ?? ''
    const unidade_entrada = cells[1].querySelector('.chosen-single span')?.textContent?.trim() ?? ''
    const qtdInput        = cells[2].querySelector('input[ng-model="item.quantity_entry"]') as HTMLInputElement | null
    const quantidade      = qtdInput ? qtdInput.value.trim() : ''
    const valorInput      = cells[3].querySelector('input[ng-model="item.total_value"]') as HTMLInputElement | null
    const valor_total     = valorInput
      ? valorInput.value.trim().replace(/^R\$\s*/, '')
      : ''

    if (nome) items.push({ nome, unidade_entrada, quantidade, valor_total })
  })

  return { fornecedor, numero_nfe, items }
}
