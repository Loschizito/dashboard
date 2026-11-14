// Dashboard administrativo Thindesk — consome a API (RF06), aplica filtros (RF05)
// e mantém os dados atualizados com tratamento de falhas (RF07).
(function () {
  const api = window.ThindeskApi;
  const $ = (sel) => document.querySelector(sel);
  const INTERVALO_ATUALIZACAO = 60000;

  const estado = {
    agrupamento: 'auto',
    pagina: 1,
    ordenacao: 'dataAbertura:desc',
    controle: null,
    timer: null,
    graficos: {},
    ultimo: {}, // últimas respostas válidas, mantidas na tela se uma atualização falhar
  };

  // ---------- Utilitários ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('pt-BR');
  const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const num = (v) => (v == null ? '–' : nf.format(v));
  const pct = (v) => (v == null ? '–' : `${nf1.format(v)}%`);
  const horas = (h) => {
    if (h == null) return '–';
    if (h < 1) return `${Math.round(h * 60)} min`;
    if (h < 48) return `${nf1.format(h)} h`;
    return `${nf1.format(h / 24)} dias`;
  };
  const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '–');
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cor = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

  const COR_STATUS = {
    aberto: '--alerta',
    em_andamento: '--acento',
    aguardando_usuario: '--serio',
    resolvido: '--bom',
    fechado: '--texto-3',
    cancelado: '--grupo-cancelado',
  };
  const selo = (codigo, rotulo) => `<span class="selo" style="--cor: var(${COR_STATUS[codigo] || '--texto-3'})">${esc(rotulo)}</span>`;

  // ---------- Filtros (RF05) ----------
  const form = $('#filtros');

  function filtrosAtuais() {
    const f = Object.fromEntries(new FormData(form));
    const periodo = f.periodo;
    delete f.periodo;
    if (periodo !== 'personalizado') {
      f.dataInicio = '';
      f.dataFim = '';
      if (periodo !== 'todos') {
        const hoje = new Date();
        const inicio = new Date(hoje);
        inicio.setDate(hoje.getDate() - (Number(periodo) - 1));
        f.dataInicio = isoLocal(inicio);
        f.dataFim = isoLocal(hoje);
      }
    }
    for (const k of Object.keys(f)) if (!f[k]) delete f[k];
    return f;
  }

  function sincronizarUrl() {
    const q = new URLSearchParams();
    for (const [k, v] of new FormData(form)) {
      if (v && !(k === 'periodo' && v === '30') && !(['dataInicio', 'dataFim'].includes(k) && $('#f-periodo').value !== 'personalizado')) q.set(k, v);
    }
    if (estado.agrupamento !== 'auto') q.set('agrupamento', estado.agrupamento);
    history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
  }

  function restaurarDaUrl() {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of q) {
      const el = form.elements[k];
      if (el) el.value = v;
    }
    if (q.get('agrupamento')) estado.agrupamento = q.get('agrupamento');
    alternarDatas();
  }

  function alternarDatas() {
    const personalizado = $('#f-periodo').value === 'personalizado';
    document.querySelectorAll('.campo-data').forEach((el) => (el.hidden = !personalizado));
    if (personalizado && !$('#f-inicio').value) {
      const hoje = new Date();
      const inicio = new Date(hoje);
      inicio.setDate(hoje.getDate() - 29);
      $('#f-inicio').value = isoLocal(inicio);
      $('#f-fim').value = isoLocal(hoje);
    }
  }

  function preencherOpcoes(opcoes) {
    const add = (sel, itens) => {
      const el = $(sel);
      const atual = el.value;
      for (const it of itens) {
        const valor = typeof it === 'string' ? it : it.valor;
        if ([...el.options].some((o) => o.value === valor)) continue;
        el.add(new Option(typeof it === 'string' ? it : it.rotulo, valor));
      }
      el.value = atual;
    };
    add('#f-status', opcoes.status);
    add('#f-tipo', opcoes.tipos);
    add('#f-prioridade', opcoes.prioridades);
    add('#f-tecnico', opcoes.tecnicos);
    add('#f-setor', opcoes.setores);
  }

  // ---------- Gráficos ----------
  const planoCrosshair = {
    id: 'crosshair',
    afterDatasetsDraw(chart) {
      const ativo = chart.tooltip && chart.tooltip.getActiveElements();
      if (!ativo || !ativo.length) return;
      const x = ativo[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = cor('--texto-3');
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  const planoRotulosBarra = {
    id: 'rotulosBarra',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = cor('--texto-2');
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      chart.getDatasetMeta(0).data.forEach((barra, i) => {
        const valor = chart.data.datasets[0].data[i];
        ctx.fillText(nf.format(valor), barra.x + 6, barra.y);
      });
      ctx.restore();
    },
  };

  function opcoesBase() {
    const texto3 = cor('--texto-3');
    const grade = cor('--grade');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cor('--superficie'),
          titleColor: cor('--texto'),
          bodyColor: cor('--texto-2'),
          borderColor: cor('--borda'),
          borderWidth: 1,
          padding: 10,
          boxPadding: 4,
          usePointStyle: true,
        },
      },
      scales: {
        x: { grid: { color: grade, drawTicks: false }, border: { display: false }, ticks: { color: texto3, padding: 6 } },
        y: { grid: { color: grade, drawTicks: false }, border: { display: false }, ticks: { color: texto3, padding: 6, precision: 0 }, beginAtZero: true },
      },
    };
  }

  function graficoPeriodo(dados) {
    const rotulos = dados.series.map((s) => (dados.agrupamento === 'semana' ? `Sem. ${s.rotulo}` : s.rotulo));
    const ds = [
      { label: 'Abertos', data: dados.series.map((s) => s.abertos), borderColor: cor('--serie-1'), backgroundColor: cor('--serie-1') },
      { label: 'Atendidos', data: dados.series.map((s) => s.atendidos), borderColor: cor('--serie-2'), backgroundColor: cor('--serie-2') },
    ].map((d) => ({ ...d, borderWidth: 2, pointRadius: dados.series.length <= 16 ? 3 : 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: cor('--superficie'), cubicInterpolationMode: 'monotone' }));

    const opcoes = opcoesBase();
    opcoes.interaction = { mode: 'index', intersect: false };
    opcoes.scales.x.grid.display = false;
    opcoes.scales.x.ticks.maxRotation = 0;
    opcoes.scales.x.ticks.autoSkipPadding = 14;
    opcoes.plugins.tooltip.callbacks = {
      title: (itens) => {
        const s = dados.series[itens[0].dataIndex];
        return dados.agrupamento === 'semana' ? `Semana de ${s.rotulo}` : s.rotulo;
      },
      afterBody: (itens) => {
        const s = dados.series[itens[0].dataIndex];
        return s.atendidos ? `No prazo: ${s.atendidosNoPrazo} de ${s.atendidos}` : '';
      },
    };
    desenhar('periodo', '#g-periodo', { type: 'line', data: { labels: rotulos, datasets: ds }, options: opcoes, plugins: [planoCrosshair] });

    $('#legenda-periodo').innerHTML =
      `<span><i style="background:${cor('--serie-1')}"></i>Abertos <b>${num(dados.totais.abertos)}</b></span>` +
      `<span><i style="background:${cor('--serie-2')}"></i>Atendidos <b>${num(dados.totais.atendidos)}</b></span>` +
      `<span class="texto-3">${dados.agrupamento === 'dia' ? 'por dia' : dados.agrupamento === 'semana' ? 'por semana' : 'por mês'} · ${dados.dataInicio.split('-').reverse().join('/')} a ${dados.dataFim.split('-').reverse().join('/')}</span>`;

    $('#tab-periodo').innerHTML =
      '<thead><tr><th>Período</th><th class="num">Abertos</th><th class="num">Atendidos</th><th class="num">No prazo</th></tr></thead><tbody>' +
      dados.series.map((s) => `<tr><td>${esc(s.rotulo)}</td><td class="num">${s.abertos}</td><td class="num">${s.atendidos}</td><td class="num">${s.atendidosNoPrazo}</td></tr>`).join('') +
      '</tbody>';
  }

  function graficoBarras(chave, seletor, rotulos, valores, tooltipExtra) {
    const opcoes = opcoesBase();
    opcoes.indexAxis = 'y';
    opcoes.layout = { padding: { right: 36 } };
    opcoes.scales.y.grid.display = false;
    opcoes.scales.y.ticks.color = cor('--texto-2');
    opcoes.scales.x.ticks.precision = 0;
    opcoes.plugins.tooltip.callbacks = { label: (item) => ` ${nf.format(item.raw)} chamados`, afterLabel: tooltipExtra };
    desenhar(chave, seletor, {
      type: 'bar',
      data: { labels: rotulos, datasets: [{ data: valores, backgroundColor: cor('--barra'), hoverBackgroundColor: cor('--acento-texto'), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22, categoryPercentage: 0.8 }] },
      options: opcoes,
      plugins: [planoRotulosBarra],
    });
  }

  function desenhar(chave, seletor, config) {
    if (!window.Chart) return;
    const atual = estado.graficos[chave];
    if (atual && atual.config.type === config.type) {
      atual.data = config.data;
      atual.options = config.options;
      atual.update();
      return;
    }
    if (atual) atual.destroy();
    estado.graficos[chave] = new window.Chart($(seletor), config);
  }

  // ---------- Renderização ----------
  function delta(v, { inverso = false } = {}) {
    if (v == null) return '';
    const seta = v > 0 ? '▲' : v < 0 ? '▼' : '■';
    const classe = v === 0 ? 'delta-sobe' : (v > 0) !== inverso ? 'delta-bom' : 'delta-ruim';
    return `<span class="${classe}">${seta} ${nf1.format(Math.abs(v))}%</span>`;
  }

  function renderIndicadores(d) {
    const set = (k, valor, nota) => {
      const el = document.querySelector(`[data-kpi="${k}"]`);
      el.querySelector('.kpi-valor').innerHTML = valor;
      el.querySelector('.kpi-nota').innerHTML = nota;
    };
    const c = d.comparativo;
    // mais chamados abertos não é "bom" nem "ruim": usa cor neutra
    set('total', num(d.totalChamados), c ? `<span class="delta-sobe">${c.variacaoTotalPercentual == null ? '' : (c.variacaoTotalPercentual >= 0 ? '▲ ' : '▼ ') + nf1.format(Math.abs(c.variacaoTotalPercentual)) + '%'}</span> vs. ${num(c.totalChamados)} no período anterior` : 'todo o histórico');
    set('emAberto', num(d.emAberto), `${num(d.atrasadosEmAberto)} fora do prazo · ${num(d.semTecnico)} sem técnico`);
    set('atendidos', num(d.atendidos), `${pct(d.taxaResolucaoPercentual)} de resolução${c ? ' · ' + delta(c.variacaoAtendidosPercentual) : ''}`);
    set('tempo', horas(d.tempoMedioResolucaoHoras), `1º atendimento em ${horas(d.tempoMedioPrimeiroAtendimentoHoras)}`);
    set('sla', pct(d.slaCumpridoPercentual), c && c.slaCumpridoPercentual != null ? `${pct(c.slaCumpridoPercentual)} no período anterior` : 'dos chamados atendidos');
    set('satisfacao', d.satisfacaoMedia == null ? '–' : `${nf1.format(d.satisfacaoMedia)}<small>/5</small>`, `${num(d.totalAvaliacoes)} avaliações`);

    const chips = [];
    if (d.criticosEmAberto) chips.push(`<span class="chip"><span class="ponto" style="background:var(--critico)"></span>⚠ ${d.criticosEmAberto} crítico(s) em aberto</span>`);
    if (d.atrasadosEmAberto) chips.push(`<span class="chip"><span class="ponto" style="background:var(--serio)"></span>⏱ ${d.atrasadosEmAberto} em aberto com SLA vencido</span>`);
    if (d.semTecnico) chips.push(`<span class="chip"><span class="ponto" style="background:var(--alerta)"></span>${d.semTecnico} aguardando atribuição de técnico</span>`);
    $('#alertas').innerHTML = chips.join('');
  }

  function renderStatus(d) {
    const g = d.grupos;
    const total = g.emAberto + g.atendidos + g.cancelados || 1;
    const partes = [
      ['Em aberto', g.emAberto, '--grupo-aberto'],
      ['Atendidos', g.atendidos, '--grupo-atendido'],
      ['Cancelados', g.cancelados, '--grupo-cancelado'],
    ];
    $('#barra-grupos').innerHTML = partes.filter((p) => p[1]).map(([, v, c]) => `<div style="flex:${v};background:var(${c})"></div>`).join('');
    $('#legenda-grupos').innerHTML = partes.map(([r, v, c]) => `<span><i class="quadrado" style="background:var(${c})"></i>${r} <b>${num(v)}</b> <span class="texto-3">${nf1.format((v / total) * 100)}%</span></span>`).join('');
    graficoBarras('status', '#g-status', d.porStatus.map((s) => s.rotulo), d.porStatus.map((s) => s.quantidade), (item) => `${nf1.format(d.porStatus[item.dataIndex].percentual)}% do total`);

    $('#tab-prioridades').innerHTML =
      '<thead><tr><th>Prioridade</th><th class="num">SLA</th><th class="num">Total</th><th class="num">Em aberto</th><th class="num">Fora do prazo</th></tr></thead><tbody>' +
      d.porPrioridade
        .slice()
        .reverse()
        .map((p) => `<tr><td>${esc(p.rotulo)}</td><td class="num texto-2">${p.slaHoras} h</td><td class="num">${num(p.quantidade)}</td><td class="num">${num(p.emAberto)}</td><td class="num">${p.atrasados ? `<span class="selo-atrasado">${p.atrasados}</span>` : '0'}</td></tr>`)
        .join('') +
      '</tbody>';
  }

  function renderTipos(lista) {
    if (!lista.length) {
      desenhar('tipos', '#g-tipos', { type: 'bar', data: { labels: [], datasets: [] }, options: opcoesBase() });
      $('#tab-tipos').innerHTML = '<tbody><tr><td class="vazio">Nenhum chamado no recorte.</td></tr></tbody>';
      return;
    }
    graficoBarras('tipos', '#g-tipos', lista.map((t) => t.tipo), lista.map((t) => t.atendidos), (item) => {
      const t = lista[item.dataIndex];
      return [`${nf1.format(t.participacaoPercentual)}% dos atendimentos`, `Tempo médio: ${horas(t.tempoMedioResolucaoHoras)}`];
    });
    $('#tab-tipos').innerHTML =
      '<thead><tr><th>#</th><th>Tipo</th><th class="num">Atendidos</th><th class="num">Em aberto</th><th class="num">Tempo médio</th><th class="num">No prazo</th></tr></thead><tbody>' +
      lista.map((t) => `<tr><td class="texto-3">${t.posicao}º</td><td>${esc(t.tipo)}</td><td class="num">${num(t.atendidos)}</td><td class="num">${num(t.emAberto)}</td><td class="num">${horas(t.tempoMedioResolucaoHoras)}</td><td class="num">${pct(t.slaCumpridoPercentual)}</td></tr>`).join('') +
      '</tbody>';
  }

  function renderTecnicos(lista) {
    $('#tab-tecnicos').innerHTML = lista.length
      ? '<thead><tr><th>Técnico</th><th class="num">Atendidos</th><th class="num">Em aberto</th><th class="num">Tempo médio</th><th class="num">No prazo</th><th class="num">Satisfação</th></tr></thead><tbody>' +
        lista.map((t) => `<tr><td>${esc(t.tecnico)}</td><td class="num">${num(t.atendidos)}</td><td class="num">${num(t.emAndamento)}</td><td class="num">${horas(t.tempoMedioResolucaoHoras)}</td><td class="num">${pct(t.slaCumpridoPercentual)}</td><td class="num">${t.satisfacaoMedia == null ? '–' : nf1.format(t.satisfacaoMedia)}</td></tr>`).join('') +
        '</tbody>'
      : '<tbody><tr><td class="vazio">Nenhum técnico com chamados no recorte.</td></tr></tbody>';
  }

  function renderChamados(resp) {
    const { dados, paginacao } = resp;
    $('#tab-chamados').innerHTML = dados.length
      ? '<thead><tr><th>Protocolo</th><th>Título</th><th>Tipo</th><th>Prioridade</th><th>Status</th><th>Técnico</th><th>Abertura</th></tr></thead><tbody>' +
        dados
          .map(
            (c) => `<tr data-id="${c.id}" tabindex="0">
              <td class="texto-2">${esc(c.protocolo)}</td>
              <td>${esc(c.titulo)}<div class="texto-3">${esc(c.solicitante || '')}${c.setor ? ' · ' + esc(c.setor) : ''}</div></td>
              <td>${esc(c.tipo)}</td>
              <td>${esc(c.prioridadeRotulo)}</td>
              <td>${selo(c.status, c.statusRotulo)}${c.atrasado ? ' <span class="selo-atrasado" title="SLA vencido">atrasado</span>' : ''}</td>
              <td>${c.tecnico ? esc(c.tecnico) : '<span class="texto-3">—</span>'}</td>
              <td class="texto-2">${dataHora(c.dataAbertura)}</td>
            </tr>`,
          )
          .join('') +
        '</tbody>'
      : '<tbody><tr><td class="vazio">Nenhum chamado encontrado com os filtros atuais.</td></tr></tbody>';
    $('#pag-info').textContent = `Página ${paginacao.pagina} de ${paginacao.totalPaginas} · ${num(paginacao.total)} chamados`;
    $('#pag-anterior').disabled = paginacao.pagina <= 1;
    $('#pag-proxima').disabled = paginacao.pagina >= paginacao.totalPaginas;
  }

  async function abrirDetalhe(id) {
    const dialogo = $('#detalhe');
    const alvo = $('#detalhe-conteudo');
    alvo.innerHTML = '<p class="texto-2">Carregando…</p>';
    if (!dialogo.open) dialogo.showModal();
    try {
      const { dados: c } = await api.chamado(id);
      const linhas = c.consideracoesTecnicas.length
        ? `<ol class="linha-tempo">${c.consideracoesTecnicas
            .map((n) => `<li><div class="quando">${dataHora(n.data)}${n.tecnico ? ' · ' + esc(n.tecnico) : ''}</div>${esc(n.texto)}</li>`)
            .join('')}</ol>`
        : '<p class="texto-3">Nenhuma consideração técnica registrada.</p>';
      alvo.innerHTML = `
        <div class="detalhe detalhe-cab">
          <div class="texto-3">${esc(c.protocolo)}</div>
          <h2 id="detalhe-titulo">${esc(c.titulo)}</h2>
          <div class="selos">${selo(c.status, c.statusRotulo)}<span class="selo">Prioridade ${esc(c.prioridadeRotulo)}</span><span class="selo">${esc(c.tipo)}</span>${c.atrasado ? '<span class="selo selo-atrasado">SLA vencido</span>' : ''}</div>
        </div>
        <dl class="detalhe-grade">
          <div><dt>Solicitante</dt><dd>${esc(c.solicitante || '—')}${c.setor ? ' · ' + esc(c.setor) : ''}</dd></div>
          <div><dt>Técnico</dt><dd>${esc(c.tecnico || 'Não atribuído')}</dd></div>
          <div><dt>Abertura</dt><dd>${dataHora(c.dataAbertura)}</dd></div>
          <div><dt>Prazo (SLA)</dt><dd>${dataHora(c.prazoSla)}</dd></div>
          <div><dt>1º atendimento</dt><dd>${c.dataPrimeiroAtendimento ? `${dataHora(c.dataPrimeiroAtendimento)} <span class="texto-3">(${horas(c.tempoPrimeiroAtendimentoHoras)})</span>` : '—'}</dd></div>
          <div><dt>Resolução</dt><dd>${c.dataResolucao ? `${dataHora(c.dataResolucao)} <span class="texto-3">(${horas(c.tempoResolucaoHoras)}, ${c.slaCumprido ? 'no prazo' : 'fora do prazo'})</span>` : '—'}</dd></div>
          ${c.avaliacao ? `<div><dt>Avaliação do usuário</dt><dd>${'★'.repeat(c.avaliacao)}${'☆'.repeat(5 - c.avaliacao)} <span class="texto-3">${c.avaliacao}/5</span></dd></div>` : ''}
          ${c.descricao ? `<div><dt>Descrição</dt><dd>${esc(c.descricao)}</dd></div>` : ''}
        </dl>
        <div class="detalhe"><h3>Considerações técnicas</h3>${linhas}</div>`;
    } catch (e) {
      alvo.innerHTML = `<p class="texto-2">Não foi possível carregar o chamado: ${esc(e.message)}</p>`;
    }
  }

  // ---------- Carregamento e atualização (RF06/RF07) ----------
  function definirEstado(tipo, texto) {
    const el = $('#estado-conexao');
    el.dataset.estado = tipo;
    el.textContent = texto;
  }

  function mostrarErro(mensagem) {
    $('#aviso-erro').hidden = !mensagem;
    $('#aviso-erro-texto').textContent = mensagem || '';
  }

  async function carregarChamados(filtros, sinal) {
    const [ordenarPor, ordem] = estado.ordenacao.split(':');
    const resp = await api.chamados({ ...filtros, pagina: estado.pagina, limite: 10, ordenarPor, ordem }, sinal);
    // se a página ficou fora do intervalo após mudar filtros, volta para a última válida
    if (resp.paginacao.pagina > resp.paginacao.totalPaginas) {
      estado.pagina = resp.paginacao.totalPaginas;
      return carregarChamados(filtros, sinal);
    }
    return resp;
  }

  async function carregar({ apenasChamados = false } = {}) {
    if (estado.controle) estado.controle.abort();
    const controle = new AbortController();
    estado.controle = controle;
    const sinal = controle.signal;
    const filtros = filtrosAtuais();
    sincronizarUrl();
    definirEstado('carregando', 'Atualizando…');
    document.body.classList.add('carregando');

    const tarefas = apenasChamados
      ? { chamados: carregarChamados(filtros, sinal) }
      : {
          indicadores: api.indicadores(filtros, sinal),
          periodo: api.periodo(filtros, estado.agrupamento, sinal),
          status: api.status(filtros, sinal),
          tipos: api.tipos(filtros, sinal),
          tecnicos: api.tecnicos(filtros, sinal),
          chamados: carregarChamados(filtros, sinal),
          qualidade: api.qualidadeDados(),
        };
    const chaves = Object.keys(tarefas);
    const resultados = await Promise.allSettled(Object.values(tarefas));
    if (sinal.aborted) return; // uma requisição mais nova já está em andamento

    const render = {
      indicadores: (r) => renderIndicadores(r.dados),
      periodo: (r) => graficoPeriodo(r.dados),
      status: (r) => renderStatus(r.dados),
      tipos: (r) => renderTipos(r.dados),
      tecnicos: (r) => renderTecnicos(r.dados),
      chamados: (r) => renderChamados(r),
      qualidade: (r) => renderRodape(r.dados),
    };
    const falhas = [];
    resultados.forEach((res, i) => {
      const chave = chaves[i];
      if (res.status === 'fulfilled') {
        estado.ultimo[chave] = res.value;
        try {
          render[chave](res.value);
        } catch (e) {
          console.error(e);
          falhas.push(`erro ao exibir ${chave}`);
        }
      } else {
        falhas.push(res.reason && res.reason.message ? res.reason.message : String(res.reason));
      }
    });

    document.body.classList.remove('carregando');
    const hora = new Date().toLocaleTimeString('pt-BR');
    if (falhas.length) {
      const unicas = [...new Set(falhas)];
      const temAnteriores = Object.keys(estado.ultimo).length > 0;
      mostrarErro(`${unicas.join(' ')} ${temAnteriores ? 'Exibindo os últimos dados válidos.' : ''}`);
      definirEstado('erro', `Falha na atualização às ${hora}`);
    } else {
      mostrarErro('');
      definirEstado('ok', `Atualizado às ${hora}`);
    }
  }

  function renderRodape(q) {
    $('#rodape').innerHTML =
      `<span>Base: ${num(q.validos)} registros válidos · ${num(q.corrigidos)} normalizados · ${num(q.descartados)} descartados por inconsistência</span>` +
      `<span>Fonte: <a href="/api/v1/saude" target="_blank" rel="noopener">API Thindesk v1</a> · dados de ${dataHora(q.dadosAtualizadosEm)}</span>`;
  }

  function agendar() {
    clearInterval(estado.timer);
    if ($('#auto-atualizar').checked) {
      estado.timer = setInterval(() => {
        if (document.visibilityState === 'visible') carregar();
      }, INTERVALO_ATUALIZACAO);
    }
  }

  // ---------- Tema ----------
  function aplicarTema(tema) {
    if (tema) document.documentElement.dataset.theme = tema;
    // os gráficos leem as cores das variáveis CSS: redesenha com a paleta do tema
    Object.values(estado.graficos).forEach((g) => g.destroy());
    estado.graficos = {};
    if (estado.ultimo.periodo) graficoPeriodo(estado.ultimo.periodo.dados);
    if (estado.ultimo.status) renderStatus(estado.ultimo.status.dados);
    if (estado.ultimo.tipos) renderTipos(estado.ultimo.tipos.dados);
  }

  // ---------- Eventos ----------
  function iniciar() {
    try {
      const tema = localStorage.getItem('thindesk-tema');
      if (tema) document.documentElement.dataset.theme = tema;
    } catch { /* armazenamento indisponível */ }
    const temaUrl = new URLSearchParams(location.search).get('tema'); // ?tema=light|dark
    if (temaUrl === 'light' || temaUrl === 'dark') document.documentElement.dataset.theme = temaUrl;

    restaurarDaUrl();
    document.querySelectorAll('#agrupamento button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valor === estado.agrupamento)));

    let debounce;
    form.addEventListener('input', (e) => {
      if (e.target.name === 'periodo') alternarDatas();
      estado.pagina = 1;
      clearTimeout(debounce);
      debounce = setTimeout(carregar, e.target.type === 'search' ? 350 : 0);
    });
    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('reset', () => {
      setTimeout(() => {
        $('#f-periodo').value = '30';
        alternarDatas();
        estado.pagina = 1;
        carregar();
      });
    });

    $('#agrupamento').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      estado.agrupamento = b.dataset.valor;
      document.querySelectorAll('#agrupamento button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      carregar();
    });

    $('#ordenacao').addEventListener('change', (e) => {
      estado.ordenacao = e.target.value;
      estado.pagina = 1;
      carregar({ apenasChamados: true });
    });
    $('#pag-anterior').addEventListener('click', () => {
      estado.pagina--;
      carregar({ apenasChamados: true });
    });
    $('#pag-proxima').addEventListener('click', () => {
      estado.pagina++;
      carregar({ apenasChamados: true });
    });

    const tabela = $('#tab-chamados');
    tabela.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) abrirDetalhe(tr.dataset.id);
    });
    tabela.addEventListener('keydown', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        abrirDetalhe(tr.dataset.id);
      }
    });

    $('#btn-atualizar').addEventListener('click', () => carregar());
    $('#btn-tentar-novamente').addEventListener('click', () => carregar());
    $('#auto-atualizar').addEventListener('change', agendar);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && $('#auto-atualizar').checked) carregar();
    });
    $('#btn-tema').addEventListener('click', () => {
      const escuroAgora = getComputedStyle(document.documentElement).colorScheme === 'dark';
      const tema = escuroAgora ? 'light' : 'dark';
      try { localStorage.setItem('thindesk-tema', tema); } catch { /* ignora */ }
      aplicarTema(tema);
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => aplicarTema());

    api.opcoesFiltro()
      .then((r) => {
        preencherOpcoes(r.dados);
        restaurarDaUrl(); // reaplica valores da URL agora que as opções existem
      })
      .catch(() => { /* os filtros continuam funcionando com as opções já presentes */ })
      .finally(() => {
        // link direto para um chamado: ?chamado=123 (lido antes de carregar(), que reescreve a URL)
        const id = new URLSearchParams(location.search).get('chamado');
        carregar();
        agendar();
        if (id) abrirDetalhe(id);
      });
  }

  if (window.Chart) iniciar();
  else window.addEventListener('load', iniciar);
})();
