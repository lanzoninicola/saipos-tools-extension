# SAIPOS Tools — Chrome Extension

Extensão Chrome que unifica ferramentas de integração com o sistema SAIPOS.

## Ferramentas

- **Notas de Entrada** — extrai a tabela de NF-e e baixa como JSON
- **Conciliação NF-e** — extrai itens do modal de conciliação, permite edição e envia para endpoint configurável

## Desenvolvimento

```bash
npm install
npm run dev     # build com hot-reload (crxjs)
```

Carregar no Chrome:
1. `chrome://extensions` → ativar **Modo do desenvolvedor**
2. **Carregar sem compactação** → selecionar a pasta `dist/` ⚠️ não a pasta raiz do projeto

## Build para produção

```bash
npm run build   # gera dist/
```

Carregar o `dist/` no Chrome conforme acima.

## Estrutura

```
src/
├── storage.js              # chrome.storage.sync (permanente, não apagado com cache)
├── index.css               # design tokens (CSS vars)
├── components/ui.jsx       # componentes compartilhados
├── extractors/             # funções injetadas nas abas do SAIPOS
│   ├── extractorProviderNfe.js
│   └── extractorConciliacao.js
├── hooks/useSettings.js    # lê configurações do storage
├── popup/                  # UI principal
│   ├── App.jsx             # menu de seleção de ferramenta
│   ├── ProviderNfe.jsx
│   └── Conciliacao.jsx
└── options/                # página de configurações
    └── OptionsApp.jsx
```

## Configurações

Acesse via ícone ⚙ no popup ou `chrome://extensions` → Detalhes → Opções de extensão.

- **Endpoint** — URL que receberá o POST da Conciliação NF-e
- **API Key** — enviada no header `X-Api-Key`
- **Headers adicionais** — opcionais, um por linha (`Nome: valor`)

Salvo em `chrome.storage.sync` — vinculado à conta Google do Chrome, não é apagado ao limpar cache ou dados do SAIPOS.

## Contrato da API (Conciliação NF-e)

### Request
```
POST {endpoint}
X-Api-Key: {apiKey}
Content-Type: application/json
```
```json
{
  "fornecedor": "NOME DO FORNECEDOR",
  "numero_nfe": "1234",
  "items": [
    { "nome": "Pistache", "unidade_entrada": "Quilograma", "quantidade": "0,1080", "valor_total": "29,1600" }
  ],
  "exportado_em": "2026-03-31T14:00:00.000Z"
}
```

### Response
```json
{ "success": true, "url": "https://meu-sistema.com/conciliacao/123", "message": "NF-e registrada." }
```
