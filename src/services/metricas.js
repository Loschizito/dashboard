// Monta as respostas do dashboard (RF01–RF04) a partir das agregações SQL do repositório.
// A série temporal (RF02) é agrupada aqui, em JavaScript, para respeitar o fuso de Brasília.
const { STATUS, STATUS_EM_ABERTO, STATUS_ATENDIDOS, PRIORIDADES, SLA_HORAS } = require('../dominio');
const { HORA, DIA, inicioDoBalde, proximoBalde, chaveDoBalde, rotuloDoBalde, horasEntre, dataLocalIso } = require('./tempo');

const arred = (n, casas = 1) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** casas) / 10 ** casas);
const pct = (parte, total) => (total ? arred((parte / total) * 100) : null);
const variacao = (atual, anterior) => (anterior ? arred(((atual - anterior) / anterior) * 100) : null);

// ---------- Chamado individual ----------

const emAberto = (c) => STATUS_EM_ABERTO.includes(c.status);
const atendido = (c) => STATUS_ATENDIDOS.includes(c.status) && Boolean(c.dataResolucao);
const prazoSla = (c) => new Date(Date.parse(c.dataAbertura) + SLA_HORAS[c.prioridade] * HORA).toISOString();

/** Campos calculados anexados a cada chamado nas respostas da API. */
function apresentarChamado(c, agora) {
  const tempoResolucao = atendido(c) ? horasEntre(c.dataAbertura, c.dataResolucao) : null;
  return {
    ...c,
    statusRotulo: STATUS[c.status],
    prioridadeRotulo: PRIORIDADES[c.prioridade],
    prazoSla: prazoSla(c),
    slaCumprido: tempoResolucao == null ? null : tempoResolucao <= SLA_HORAS[c.prioridade],
    atrasado: emAberto(c) && agora > Date.parse(prazoSla(c)),
    tempoPrimeiroAtendimentoHoras: arred(c.dataPrimeiroAtendimento ? horasEntre(c.dataAbertura, c.dataPrimeiroAtendimento) : null),
    tempoResolucaoHoras: arred(tempoResolucao),
  };
}

// ---------- RF01 ----------

function formatarResumo(r) {
  return {
    totalChamados: r.total,
    emAberto: r.emAberto,
    atendidos: r.atendidos,
    cancelados: r.cancelados,
    taxaResolucaoPercentual: pct(r.atendidos, r.total - r.cancelados),
    tempoMedioPrimeiroAtendimentoHoras: arred(r.mediaPrimeiroAtendimento),
    tempoMedioResolucaoHoras: arred(r.mediaResolucao),
    slaCumpridoPercentual: pct(r.noPrazo, r.atendidos),
    satisfacaoMedia: arred(r.satisfacao, 2),
    totalAvaliacoes: r.avaliacoes,
    criticosEmAberto: r.criticosEmAberto,
    atrasadosEmAberto: r.atrasados,
    semTecnico: r.semTecnico,
  };
}

/** Janela imediatamente anterior, com a mesma duração do período filtrado. */
function periodoAnterior(filtros, agora) {
  if (filtros.inicio == null) return null;
  const fim = filtros.fim != null ? filtros.fim : agora;
  const duracao = fim - filtros.inicio;
  return { inicio: filtros.inicio - duracao - 1, fim: filtros.inicio - 1 };
}

/**
 * @param store repositório
 * @param filtros filtros validados
 * @param agora instante atual (ms)
 */
function indicadores(store, filtros, agora) {
  const atual = formatarResumo(store.resumo(filtros, agora));
  const janela = periodoAnterior(filtros, agora);
  let comparativo = null;
  if (janela) {
    const ant = formatarResumo(store.resumo({ ...filtros, inicio: janela.inicio, fim: janela.fim }, agora));
    comparativo = {
      periodoAnterior: { dataInicio: dataLocalIso(janela.inicio), dataFim: dataLocalIso(janela.fim) },
      totalChamados: ant.totalChamados,
      atendidos: ant.atendidos,
      tempoMedioResolucaoHoras: ant.tempoMedioResolucaoHoras,
      slaCumpridoPercentual: ant.slaCumpridoPercentual,
      variacaoTotalPercentual: variacao(atual.totalChamados, ant.totalChamados),
      variacaoAtendidosPercentual: variacao(atual.atendidos, ant.atendidos),
    };
  }
  return { ...atual, comparativo };
}

// ---------- RF02 ----------

const LIMITE_BALDES = 400;

function escolherAgrupamento(inicio, fim) {
  const dias = (fim - inicio) / DIA;
  if (dias <= 45) return 'dia';
  if (dias <= 210) return 'semana';
  return 'mes';
}

/**
 * Série temporal: abertos (pela data de abertura) e atendidos (pela data de resolução)
 * dentro do período, agrupados por dia, semana ou mês no fuso de Brasília.
 * @param eventos linhas {abertura, resolucao, noPrazo} de store.eventosSerie()
 * @returns {{agrupamento, dataInicio, dataFim, series, totais}|{erro}}
 */
function serieTemporal(eventos, filtros, agrupamentoPedido, agora) {
  const inicio = filtros.inicio != null ? filtros.inicio : eventos.reduce((min, e) => Math.min(min, Date.parse(e.abertura)), agora);
  const fim = filtros.fim != null ? filtros.fim : agora;
  const agrupamento = agrupamentoPedido === 'auto' ? escolherAgrupamento(inicio, fim) : agrupamentoPedido;

  const baldes = new Map();
  for (let t = inicioDoBalde(inicio, agrupamento); t <= fim; t = proximoBalde(t, agrupamento)) {
    baldes.set(chaveDoBalde(t, agrupamento), { periodo: chaveDoBalde(t, agrupamento), rotulo: rotuloDoBalde(t, agrupamento), inicio: dataLocalIso(t), abertos: 0, atendidos: 0, atendidosNoPrazo: 0 });
    if (baldes.size > LIMITE_BALDES) return { erro: `O período gera mais de ${LIMITE_BALDES} pontos com agrupamento "${agrupamento}". Use um agrupamento maior.` };
  }

  const dentro = (t) => t >= inicio && t <= fim;
  const balde = (t) => baldes.get(chaveDoBalde(inicioDoBalde(t, agrupamento), agrupamento));
  for (const e of eventos) {
    const ta = Date.parse(e.abertura);
    if (dentro(ta)) {
      const b = balde(ta);
      if (b) b.abertos++;
    }
    if (e.resolucao) {
      const tr = Date.parse(e.resolucao);
      if (dentro(tr)) {
        const b = balde(tr);
        if (b) {
          b.atendidos++;
          if (e.noPrazo) b.atendidosNoPrazo++;
        }
      }
    }
  }

  const series = [...baldes.values()];
  const totais = series.reduce((t, b) => ({ abertos: t.abertos + b.abertos, atendidos: t.atendidos + b.atendidos, atendidosNoPrazo: t.atendidosNoPrazo + b.atendidosNoPrazo }), { abertos: 0, atendidos: 0, atendidosNoPrazo: 0 });
  return { agrupamento, dataInicio: dataLocalIso(inicio), dataFim: dataLocalIso(fim), series, totais };
}

// ---------- RF03 ----------

function situacao(store, filtros, agora) {
  const linhas = store.porStatus(filtros);
  const total = linhas.reduce((s, l) => s + l.quantidade, 0);
  const soma = (grupo) => linhas.filter((l) => l.grupo === grupo).reduce((s, l) => s + l.quantidade, 0);
  return {
    total,
    grupos: { emAberto: soma('em_aberto'), atendidos: store.totalAtendidos(filtros), cancelados: soma('cancelado') },
    porStatus: linhas.map((l) => ({ status: l.status, rotulo: l.rotulo, quantidade: l.quantidade, percentual: pct(l.quantidade, total) || 0 })),
    porPrioridade: store.porPrioridade(filtros, agora),
  };
}

// ---------- RF04 ----------

function rankingTipos(store, filtros, ordenarPor = 'atendidos', limite = null) {
  const linhas = store.porTipo(filtros, ordenarPor);
  const totalAtendidos = linhas.reduce((s, l) => s + l.atendidos, 0);
  const ranking = linhas.map((l, i) => ({
    posicao: i + 1,
    tipo: l.tipo,
    total: l.total,
    atendidos: l.atendidos,
    emAberto: l.emAberto,
    participacaoPercentual: pct(l.atendidos, totalAtendidos) || 0,
    tempoMedioResolucaoHoras: arred(l.tempoMedio),
    slaCumpridoPercentual: pct(l.noPrazo, l.atendidos),
  }));
  return limite ? ranking.slice(0, limite) : ranking;
}

/** Desempenho por técnico (apoio à distribuição da equipe). */
function rankingTecnicos(store, filtros) {
  return store.porTecnico(filtros).map((l) => ({
    tecnico: l.tecnico,
    atendidos: l.atendidos,
    emAndamento: l.emAndamento,
    tempoMedioResolucaoHoras: arred(l.tempoMedio),
    slaCumpridoPercentual: pct(l.noPrazo, l.atendidos),
    satisfacaoMedia: arred(l.satisfacao, 2),
  }));
}

module.exports = { apresentarChamado, indicadores, serieTemporal, situacao, rankingTipos, rankingTecnicos };
