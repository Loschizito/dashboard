# API Thindesk: Documentação dos Endpoints

- **URL base:** `http://localhost:3000/api/v1`
- **Formato:** JSON (UTF-8). Requisições com corpo devem enviar `Content-Type: application/json`.
- **Datas:** respostas em ISO 8601 (UTC). Parâmetros de data no formato `AAAA-MM-DD`, interpretados no fuso de Brasília (UTC−03:00).
- **Cabeçalhos de resposta:** `Cache-Control: no-store` e `Access-Control-Allow-Origin: *`.

## Sumário

| Método | Rota | Finalidade | RF |
|--------|------|-----------|----|
| GET | [`/dashboard/indicadores`](#get-dashboardindicadores) | Indicadores gerais + comparativo com período anterior | RF01 |
| GET | [`/dashboard/periodo`](#get-dashboardperiodo) | Série temporal de abertos × atendidos | RF02 |
| GET | [`/dashboard/status`](#get-dashboardstatus) | Distribuição por status e por prioridade | RF03 |
| GET | [`/dashboard/tipos`](#get-dashboardtipos) | Ranking de tipos mais atendidos | RF04 |
| GET | [`/dashboard/tecnicos`](#get-dashboardtecnicos) | Desempenho por técnico | Complementar |
| GET | [`/chamados`](#get-chamados) | Lista paginada com filtros | RF05 |
| GET | [`/chamados/{id}`](#get-chamadosid) | Detalhe com considerações técnicas | RF03 |
| POST | [`/chamados`](#post-chamados) | Abre um chamado | RF07 |
| PATCH | [`/chamados/{id}`](#patch-chamadosid) | Atualiza status, técnico, consideração, avaliação | RF07 |
| GET | [`/opcoes-filtro`](#get-opcoes-filtro) | Valores aceitos nos filtros | RF05 |
| GET | [`/qualidade-dados`](#get-qualidade-dados) | Relatório do tratamento de dados | RF07 |
| POST | [`/dados/importar`](#post-dadosimportar) | Importa lote de chamados de outro sistema com tratamento | RF07 |
| GET | [`/saude`](#get-saude) | Verificação de disponibilidade | RF06 |

## Envelope de resposta

Sucesso:

```json
{
  "dados": { "...": "conteúdo do endpoint" },
  "meta": {
    "geradoEm": "2026-11-11T00:32:34.023Z",
    "dadosAtualizadosEm": "2026-11-11T00:30:13.003Z",
    "filtros": { "dataInicio": "2026-10-12", "dataFim": "2026-11-10" }
  }
}
```

`meta.filtros` devolve os filtros **já normalizados** (ex.: `status=Em Andamento` aparece como `["em_andamento"]`), o que permite ao cliente confirmar o que foi aplicado.

Erro:

```json
{
  "erro": {
    "status": 400,
    "codigo": "PARAMETRO_INVALIDO",
    "mensagem": "Um ou mais parâmetros são inválidos.",
    "detalhes": [
      { "campo": "dataInicio", "valor": "2026-11-10", "mensagem": "dataInicio deve ser anterior ou igual a dataFim." },
      { "campo": "status", "valor": "pendente", "mensagem": "Valor não reconhecido para \"status\"." }
    ]
  }
}
```

Todos os problemas de validação são reportados de uma vez em `detalhes`.

## Códigos de erro

| HTTP | `codigo` | Quando ocorre |
|------|----------|---------------|
| 400 | `PARAMETRO_INVALIDO` | Query ou corpo com valor inválido (data, enum, inteiro fora do intervalo, campo obrigatório ausente) |
| 400 | `JSON_INVALIDO` | Corpo da requisição não é JSON válido |
| 404 | `NAO_ENCONTRADO` | Chamado com o `id` informado não existe |
| 404 | `ROTA_NAO_ENCONTRADA` | Rota/método inexistente (inclusive sem o prefixo `/v1`) |
| 413 | `CORPO_MUITO_GRANDE` | Corpo acima de 100 KB |
| 422 | `REGRA_DE_NEGOCIO` | Requisição válida, mas viola uma regra (transição de status proibida, falta de técnico, etc.) |
| 500 | `ERRO_INTERNO` | Falha inesperada no servidor |

## Filtros comuns

Aceitos por **todos** os endpoints `/dashboard/*` e por `GET /chamados`. Todos são opcionais e combinados com **E**; listas separadas por vírgula combinam com **OU**.

| Parâmetro | Tipo | Exemplo | Descrição |
|-----------|------|---------|-----------|
| `dataInicio` | `AAAA-MM-DD` | `2026-10-01` | Abertura a partir de 00:00 deste dia |
| `dataFim` | `AAAA-MM-DD` | `2026-10-31` | Abertura até 23:59:59 deste dia |
| `status` | lista | `aberto,em_andamento` | Código ou rótulo (`Em andamento`), sem distinção de caixa/acentos |
| `tipo` | lista | `Rede,E-mail` | Ver `/opcoes-filtro` |
| `prioridade` | lista | `alta,critica` | `baixa`, `media`, `alta`, `critica` |
| `tecnico` | lista | `Ana Ribeiro` | Use `sem_tecnico` para chamados não atribuídos |
| `setor` | lista | `Financeiro` | |
| `busca` | texto (≤100) | `vpn` | Procura em protocolo, título, solicitante e descrição (ignora acentos) |

Erros possíveis: `400 PARAMETRO_INVALIDO` (data em formato errado ou inexistente, `dataInicio > dataFim`, valor de enum desconhecido, busca longa demais).

---

## GET /dashboard/indicadores

Indicadores gerais (RF01). Quando há `dataInicio`, inclui `comparativo` com a janela anterior de mesma duração.

**Parâmetros:** filtros comuns.

**Exemplo**

```http
GET /api/v1/dashboard/indicadores?dataInicio=2026-10-12&dataFim=2026-11-10
```

```json
{
  "dados": {
    "totalChamados": 196,
    "emAberto": 27,
    "atendidos": 162,
    "cancelados": 7,
    "taxaResolucaoPercentual": 85.7,
    "tempoMedioPrimeiroAtendimentoHoras": 5.4,
    "tempoMedioResolucaoHoras": 21.1,
    "slaCumpridoPercentual": 80.2,
    "satisfacaoMedia": 4.1,
    "totalAvaliacoes": 94,
    "criticosEmAberto": 1,
    "atrasadosEmAberto": 18,
    "semTecnico": 12,
    "comparativo": {
      "periodoAnterior": { "dataInicio": "2026-09-12", "dataFim": "2026-10-11" },
      "totalChamados": 169,
      "atendidos": 158,
      "tempoMedioResolucaoHoras": 28.6,
      "slaCumpridoPercentual": 80.4,
      "variacaoTotalPercentual": 16,
      "variacaoAtendidosPercentual": 2.5
    }
  },
  "meta": { "geradoEm": "…", "dadosAtualizadosEm": "…", "filtros": { "dataInicio": "2026-10-12", "dataFim": "2026-11-10" } }
}
```

Métricas sem base de cálculo (ex.: nenhum atendido) retornam `null`. `comparativo` é `null` sem `dataInicio`; as variações são `null` quando o período anterior tem zero chamados.

**Erros:** `400`.

## GET /dashboard/periodo

Série temporal (RF02). *Abertos* contados pela data de abertura e *atendidos* pela data de resolução, ambos dentro do período. Períodos sem movimento aparecem com zero.

| Parâmetro | Tipo | Padrão | Descrição |
|-----------|------|--------|-----------|
| `agrupamento` | `auto` \| `dia` \| `semana` \| `mes` | `auto` | `auto`: dia até 45 dias, semana até 210 dias, senão mês. Semanas começam na segunda-feira. |
| filtros comuns | | | Sem `dataInicio`, a série começa no chamado mais antigo; sem `dataFim`, termina hoje. |

**Exemplo**

```http
GET /api/v1/dashboard/periodo?dataInicio=2026-11-04&dataFim=2026-11-10&agrupamento=dia
```

```json
{
  "dados": {
    "agrupamento": "dia",
    "dataInicio": "2026-11-04",
    "dataFim": "2026-11-10",
    "series": [
      { "periodo": "2026-11-04", "rotulo": "04/11", "inicio": "2026-11-04", "abertos": 7, "atendidos": 8, "atendidosNoPrazo": 7 },
      { "periodo": "2026-11-05", "rotulo": "05/11", "inicio": "2026-11-05", "abertos": 6, "atendidos": 5, "atendidosNoPrazo": 2 },
      "…"
    ],
    "totais": { "abertos": 51, "atendidos": 34, "atendidosNoPrazo": 26 }
  },
  "meta": { "…": "…" }
}
```

`periodo` vale `AAAA-MM-DD` (dia/semana: data do primeiro dia) ou `AAAA-MM` (mês).

**Erros:** `400` para agrupamento inválido ou quando a combinação gera mais de 400 pontos (ex.: 5 anos por dia).

## GET /dashboard/status

Situação dos chamados (RF03).

```http
GET /api/v1/dashboard/status?tipo=Rede
```

```json
{
  "dados": {
    "total": 74,
    "grupos": { "emAberto": 6, "atendidos": 65, "cancelados": 3 },
    "porStatus": [
      { "status": "aberto", "rotulo": "Aberto", "quantidade": 1, "percentual": 1.4 },
      { "status": "em_andamento", "rotulo": "Em andamento", "quantidade": 4, "percentual": 5.4 },
      { "status": "aguardando_usuario", "rotulo": "Aguardando usuário", "quantidade": 1, "percentual": 1.4 },
      { "status": "resolvido", "rotulo": "Resolvido", "quantidade": 9, "percentual": 12.2 },
      { "status": "fechado", "rotulo": "Fechado", "quantidade": 56, "percentual": 75.7 },
      { "status": "cancelado", "rotulo": "Cancelado", "quantidade": 3, "percentual": 4.1 }
    ],
    "porPrioridade": [
      { "prioridade": "baixa", "rotulo": "Baixa", "slaHoras": 72, "quantidade": 16, "emAberto": 2, "atrasados": 2 },
      { "prioridade": "media", "rotulo": "Média", "slaHoras": 24, "quantidade": 38, "emAberto": 4, "atrasados": 3 },
      { "prioridade": "alta", "rotulo": "Alta", "slaHoras": 8, "quantidade": 14, "emAberto": 0, "atrasados": 0 },
      { "prioridade": "critica", "rotulo": "Crítica", "slaHoras": 4, "quantidade": 6, "emAberto": 0, "atrasados": 0 }
    ]
  },
  "meta": { "…": "…" }
}
```

Todos os status e prioridades aparecem sempre, mesmo com quantidade zero.

**Erros:** `400`.

## GET /dashboard/tipos

Ranking de tipos de chamado (RF04).

| Parâmetro | Tipo | Padrão | Descrição |
|-----------|------|--------|-----------|
| `ordenarPor` | `atendidos` \| `total` \| `emAberto` \| `tempoMedio` | `atendidos` | Critério do ranking (decrescente; `tempoMedio` = mais demorados primeiro) |
| `limite` | inteiro 1 a 50 | todos | Quantidade de posições |
| filtros comuns | | | |

```http
GET /api/v1/dashboard/tipos?limite=3
```

```json
{
  "dados": [
    { "posicao": 1, "tipo": "Acesso e Senhas", "total": 152, "atendidos": 139, "emAberto": 6, "participacaoPercentual": 23.7, "tempoMedioResolucaoHoras": 27, "slaCumpridoPercentual": 82 },
    { "posicao": 2, "tipo": "Software", "total": 116, "atendidos": 107, "emAberto": 6, "participacaoPercentual": 18.2, "tempoMedioResolucaoHoras": 27.7, "slaCumpridoPercentual": 82.2 },
    { "posicao": 3, "tipo": "Sistema ERP", "total": 75, "atendidos": 70, "emAberto": 2, "participacaoPercentual": 11.9, "tempoMedioResolucaoHoras": 27.1, "slaCumpridoPercentual": 78.6 }
  ],
  "meta": { "…": "…", "ordenarPor": "atendidos", "limite": 3 }
}
```

`participacaoPercentual` = atendidos do tipo ÷ total de atendidos no recorte.

**Erros:** `400` (limite fora de 1 a 50, `ordenarPor` inválido, filtros).

## GET /dashboard/tecnicos

Desempenho por técnico, ordenado por atendidos. Considera apenas chamados com técnico atribuído.

**Parâmetros:** filtros comuns.

```http
GET /api/v1/dashboard/tecnicos?dataInicio=2026-10-12
```

```json
{
  "dados": [
    { "tecnico": "Ana Ribeiro", "atendidos": 40, "emAndamento": 3, "tempoMedioResolucaoHoras": 20, "slaCumpridoPercentual": 82.5, "satisfacaoMedia": 4.08 },
    { "tecnico": "Marcos Tavares", "atendidos": 30, "emAndamento": 1, "tempoMedioResolucaoHoras": 17.5, "slaCumpridoPercentual": 76.7, "satisfacaoMedia": 4.07 },
    "…"
  ],
  "meta": { "…": "…" }
}
```

**Erros:** `400`.

## GET /chamados

Lista paginada de chamados com os campos calculados.

| Parâmetro | Tipo | Padrão | Descrição |
|-----------|------|--------|-----------|
| `pagina` | inteiro ≥ 1 | 1 | |
| `limite` | inteiro 1 a 100 | 20 | Itens por página |
| `ordenarPor` | `dataAbertura` \| `id` \| `prioridade` \| `status` \| `tipo` | `dataAbertura` | |
| `ordem` | `asc` \| `desc` | `desc` | |
| filtros comuns | | | |

```http
GET /api/v1/chamados?limite=2&status=em_andamento&ordenarPor=prioridade
```

```json
{
  "dados": [
    {
      "id": 637,
      "protocolo": "TD-000637",
      "titulo": "Criação de usuário para novo colaborador",
      "descricao": "Chamado aberto pelo portal Thindesk.",
      "tipo": "Acesso e Senhas",
      "prioridade": "media",
      "status": "em_andamento",
      "solicitante": "Lucas Martins",
      "setor": "Logística",
      "tecnico": "Juliana Costa",
      "dataAbertura": "2026-11-09T15:25:39.208Z",
      "dataPrimeiroAtendimento": "2026-11-09T18:51:56.081Z",
      "dataResolucao": null,
      "avaliacao": null,
      "consideracoesTecnicas": [
        { "data": "2026-11-09T18:51:56.081Z", "tecnico": "Juliana Costa", "texto": "Chamado triado e em análise." }
      ],
      "statusRotulo": "Em andamento",
      "prioridadeRotulo": "Média",
      "prazoSla": "2026-11-10T15:25:39.208Z",
      "slaCumprido": null,
      "atrasado": true,
      "tempoPrimeiroAtendimentoHoras": 3.4,
      "tempoResolucaoHoras": null
    }
  ],
  "paginacao": { "pagina": 1, "limite": 2, "total": 10, "totalPaginas": 5 },
  "meta": { "…": "…", "ordenarPor": "prioridade", "ordem": "desc" }
}
```

**Erros:** `400`.

## GET /chamados/{id}

Detalhe de um chamado, incluindo o histórico de `consideracoesTecnicas`. Mesmo formato de item da listagem.

**Erros:** `400` (id não inteiro positivo), `404 NAO_ENCONTRADO`.

## POST /chamados

Abre um chamado com status `aberto`.

| Campo | Obrigatório | Regra |
|-------|-------------|-------|
| `titulo` | sim | 3 a 120 caracteres |
| `solicitante` | sim | 3 a 80 caracteres |
| `tipo` | sim | Um dos tipos de `/opcoes-filtro` (aceita variações de caixa/acentos) |
| `prioridade` | não | `baixa`, `media` (padrão), `alta`, `critica` |
| `setor` | não | Normalizado quando corresponde a um setor cadastrado |
| `descricao` | não | até 2000 caracteres |

```http
POST /api/v1/chamados
Content-Type: application/json

{ "titulo": "Impressora do RH offline", "tipo": "impressoras", "prioridade": "alta", "solicitante": "Larissa Rocha", "setor": "rh" }
```

Resposta `201 Created`, cabeçalho `Location: /api/v1/chamados/9003`:

```json
{ "dados": { "id": 9003, "protocolo": "TD-009003", "titulo": "Impressora do RH offline", "tipo": "Impressoras", "prioridade": "alta", "status": "aberto", "setor": "RH", "tecnico": null, "prazoSla": "…", "…": "…" } }
```

**Erros:** `400 PARAMETRO_INVALIDO` (lista todos os campos inválidos), `400 JSON_INVALIDO`, `413`.

## PATCH /chamados/{id}

Atualiza o atendimento. Envie um ou mais campos:

| Campo | Regra |
|-------|-------|
| `status` | Deve seguir as transições permitidas (ver [DOCUMENTACAO.md](DOCUMENTACAO.md#diagrama-de-estados-do-chamado)) |
| `tecnico` | Nome do técnico (até 80 caracteres) |
| `consideracao` | Texto (até 1000) acrescentado às considerações técnicas, com data e técnico |
| `avaliacao` | Inteiro 1 a 5, somente no fechamento |

Efeitos automáticos: ao sair de `aberto`, registra `dataPrimeiroAtendimento`; ao `resolvido`, registra `dataResolucao`; reabrir (`resolvido → em_andamento`) limpa `dataResolucao`.

**Exemplo: fluxo completo** (registrado em `evidencias/requisicoes-api.txt`):

| # | Corpo | Resultado |
|---|-------|-----------|
| 1 | `{"status":"em_andamento"}` | `422`: É necessário atribuir um técnico para este status. |
| 2 | `{"status":"em_andamento","tecnico":"Ana Ribeiro","consideracao":"Impressora sem IP; verificando DHCP."}` | `200` |
| 3 | `{"status":"resolvido"}` | `422`: Informe a consideração técnica da solução ao resolver o chamado. |
| 4 | `{"status":"resolvido","consideracao":"Reserva de IP criada no DHCP e fila recriada."}` | `200` |
| 5 | `{"status":"fechado","avaliacao":5}` | `200` |
| 6 | `{"consideracao":"tentativa após fechamento"}` | `422`: Chamado fechado não pode ser alterado. |

Exemplo de erro de regra de negócio:

```json
{
  "erro": {
    "status": 422,
    "codigo": "REGRA_DE_NEGOCIO",
    "mensagem": "Transição de \"aberto\" para \"fechado\" não é permitida.",
    "detalhes": [{ "campo": "status", "permitidos": ["em_andamento", "aguardando_usuario", "cancelado"] }]
  }
}
```

**Erros:** `400` (corpo vazio ou campos inválidos), `404`, `422`.

## GET /opcoes-filtro

Valores para montar os filtros do cliente.

```json
{
  "dados": {
    "status": [{ "valor": "aberto", "rotulo": "Aberto" }, "…"],
    "prioridades": [{ "valor": "baixa", "rotulo": "Baixa" }, "…"],
    "tipos": ["Hardware", "Software", "Rede", "Acesso e Senhas", "Impressoras", "E-mail", "Sistema ERP", "Telefonia"],
    "setores": ["Financeiro", "RH", "Comercial", "Logística", "Jurídico", "Diretoria", "Atendimento", "Produção"],
    "tecnicos": ["Ana Ribeiro", "Carlos Mendes", "Juliana Costa", "Marcos Tavares", "Patrícia Lima", "Rafael Souza"],
    "periodoDisponivel": { "dataInicio": "2026-05-23", "dataFim": "2026-11-10" }
  }
}
```

## GET /qualidade-dados

Resultado do tratamento aplicado na importação mais recente (tabela `importacoes`).

```json
{
  "dados": {
    "origem": "npm run seed",
    "importadoEm": "2026-11-11T00:49:58.120Z",
    "lidos": 652,
    "validos": 650,
    "corrigidos": 4,
    "descartados": 2,
    "ocorrencias": [
      { "id": 651, "erros": ["dataAbertura inválida: \"data-invalida\""] },
      { "id": 652, "erros": ["tipo desconhecido: \"Cafeteira\""] }
    ],
    "dadosAtualizadosEm": "2026-11-11T00:18:10.568Z"
  }
}
```

## POST /dados/importar

Integração com outros sistemas: recebe um **array** de chamados (1 a 5000 itens, corpo até 5 MB), aplica o tratamento de dados e grava no banco em uma única transação. Registros com `id` já existente são substituídos (incluindo suas considerações técnicas). Os campos aceitos são os mesmos do modelo de chamado (`id`, `protocolo`, `titulo`, `descricao`, `tipo`, `prioridade`, `status`, `solicitante`, `setor`, `tecnico`, `dataAbertura`, `dataPrimeiroAtendimento`, `dataResolucao`, `avaliacao`, `consideracoesTecnicas`).

```http
POST /api/v1/dados/importar
Content-Type: application/json

[
  { "id": 9001, "titulo": "Importado do legado", "tipo": "TELEFONIA", "prioridade": "Crítica", "status": "Aberto",
    "solicitante": "Sistema legado", "setor": " comercial", "dataAbertura": "2026-11-10T13:00:00Z" },
  { "id": 9002, "titulo": "Sem data", "tipo": "Rede", "prioridade": "media", "status": "aberto", "dataAbertura": "amanhã" }
]
```

```json
{
  "dados": {
    "lidos": 2,
    "validos": 1,
    "corrigidos": 1,
    "descartados": 1,
    "ocorrencias": [{ "id": 9002, "erros": ["dataAbertura inválida: \"amanhã\""] }],
    "dadosAtualizadosEm": "2026-11-11T00:51:18.862Z"
  }
}
```

Registros descartados **não** fazem a requisição falhar: a resposta é `200` com o relatório, e os válidos são gravados.

**Erros:** `400 PARAMETRO_INVALIDO` (corpo não é array, vazio ou com mais de 5000 itens), `400 JSON_INVALIDO`, `413`.

## GET /saude

```json
{ "dados": { "status": "ok", "versao": "1.0.0", "uptimeSegundos": 14, "banco": "SQLite", "totalChamados": 650, "dadosAtualizadosEm": "2026-11-11T00:25:05.615Z" } }
```
