// Cliente da API Thindesk (RF06). Centraliza URL base, timeout e tratamento de erros.
(function () {
  const BASE = '/api/v1';
  const TIMEOUT_MS = 10000;

  class ErroApiCliente extends Error {
    constructor(mensagem, { status = 0, codigo = 'FALHA_DE_REDE', detalhes } = {}) {
      super(mensagem);
      this.status = status;
      this.codigo = codigo;
      this.detalhes = detalhes;
    }
  }

  function montarQuery(params = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') q.set(k, v);
    }
    const s = q.toString();
    return s ? `?${s}` : '';
  }

  async function requisitar(caminho, { metodo = 'GET', params, corpo, sinal } = {}) {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT_MS);
    if (sinal) sinal.addEventListener('abort', () => controle.abort(sinal.reason), { once: true });
    let resposta;
    try {
      resposta = await fetch(BASE + caminho + montarQuery(params), {
        method: metodo,
        headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: controle.signal,
      });
    } catch (e) {
      if (sinal && sinal.aborted) throw e; // cancelada por uma requisição mais nova
      const timeout = e && e.name === 'TimeoutError' || (controle.signal.reason && controle.signal.reason.name === 'TimeoutError');
      throw new ErroApiCliente(timeout ? 'A API demorou demais para responder.' : 'Não foi possível conectar à API.', { codigo: timeout ? 'TIMEOUT' : 'FALHA_DE_REDE' });
    } finally {
      clearTimeout(timer);
    }

    let json = null;
    try {
      json = await resposta.json();
    } catch {
      throw new ErroApiCliente(`Resposta inválida da API (HTTP ${resposta.status}).`, { status: resposta.status, codigo: 'RESPOSTA_INVALIDA' });
    }
    if (!resposta.ok) {
      const erro = (json && json.erro) || {};
      throw new ErroApiCliente(erro.mensagem || `Erro HTTP ${resposta.status}`, { status: resposta.status, codigo: erro.codigo, detalhes: erro.detalhes });
    }
    return json;
  }

  window.ThindeskApi = {
    ErroApiCliente,
    saude: () => requisitar('/saude'),
    opcoesFiltro: () => requisitar('/opcoes-filtro'),
    qualidadeDados: () => requisitar('/qualidade-dados'),
    indicadores: (filtros, sinal) => requisitar('/dashboard/indicadores', { params: filtros, sinal }),
    periodo: (filtros, agrupamento, sinal) => requisitar('/dashboard/periodo', { params: { ...filtros, agrupamento }, sinal }),
    status: (filtros, sinal) => requisitar('/dashboard/status', { params: filtros, sinal }),
    tipos: (filtros, sinal) => requisitar('/dashboard/tipos', { params: filtros, sinal }),
    tecnicos: (filtros, sinal) => requisitar('/dashboard/tecnicos', { params: filtros, sinal }),
    chamados: (params, sinal) => requisitar('/chamados', { params, sinal }),
    chamado: (id) => requisitar(`/chamados/${encodeURIComponent(id)}`),
  };
})();
