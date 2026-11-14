// RF05 — Leitura e validação dos filtros de consulta comuns a todos os endpoints.
// A conversão para SQL fica em ChamadosStore.where().
const { erroValidacao } = require('../erros');
const { normalizarStatus, normalizarTipo, normalizarPrioridade, normalizarSetor, chave } = require('../data/normalizador');
const { parseDataLocal, dataLocalIso } = require('./tempo');

const lista = (valor) => {
  if (valor == null || valor === '') return [];
  const bruto = Array.isArray(valor) ? valor.join(',') : String(valor);
  return bruto.split(',').map((v) => v.trim()).filter(Boolean);
};

function listaEnum(query, nome, normalizar, detalhes) {
  const valores = lista(query[nome]);
  if (!valores.length) return null;
  const aceitos = new Set();
  for (const v of valores) {
    const n = normalizar(v);
    if (!n) detalhes.push({ campo: nome, valor: v, mensagem: `Valor não reconhecido para "${nome}".` });
    else aceitos.add(n);
  }
  return aceitos;
}

/**
 * Converte a query string em um objeto de filtros validado.
 * Lança ErroApi 400 com a lista de problemas encontrados.
 */
function lerFiltros(query = {}) {
  const detalhes = [];
  const filtros = { inicio: null, fim: null, status: null, tipo: null, prioridade: null, setor: null, tecnico: null, busca: null };

  if (query.dataInicio != null && query.dataInicio !== '') {
    filtros.inicio = parseDataLocal(String(query.dataInicio));
    if (filtros.inicio == null) detalhes.push({ campo: 'dataInicio', valor: query.dataInicio, mensagem: 'Use o formato AAAA-MM-DD com uma data existente.' });
  }
  if (query.dataFim != null && query.dataFim !== '') {
    filtros.fim = parseDataLocal(String(query.dataFim), true);
    if (filtros.fim == null) detalhes.push({ campo: 'dataFim', valor: query.dataFim, mensagem: 'Use o formato AAAA-MM-DD com uma data existente.' });
  }
  if (filtros.inicio != null && filtros.fim != null && filtros.inicio > filtros.fim) {
    detalhes.push({ campo: 'dataInicio', valor: query.dataInicio, mensagem: 'dataInicio deve ser anterior ou igual a dataFim.' });
  }

  filtros.status = listaEnum(query, 'status', normalizarStatus, detalhes);
  filtros.tipo = listaEnum(query, 'tipo', normalizarTipo, detalhes);
  filtros.prioridade = listaEnum(query, 'prioridade', normalizarPrioridade, detalhes);

  const setores = lista(query.setor);
  if (setores.length) filtros.setor = new Set(setores.map((s) => chave(normalizarSetor(s))));
  const tecnicos = lista(query.tecnico);
  if (tecnicos.length) filtros.tecnico = new Set(tecnicos.map(chave));

  if (query.busca != null && String(query.busca).trim() !== '') {
    const busca = String(query.busca).trim();
    if (busca.length > 100) detalhes.push({ campo: 'busca', valor: busca.slice(0, 20) + '…', mensagem: 'A busca aceita no máximo 100 caracteres.' });
    else filtros.busca = chave(busca);
  }

  if (detalhes.length) throw erroValidacao(detalhes);
  return filtros;
}

/** Representação dos filtros aplicados, devolvida em `meta.filtros`. */
function descreverFiltros(f) {
  const arr = (s) => (s ? [...s] : undefined);
  return {
    dataInicio: f.inicio != null ? dataLocalIso(f.inicio) : undefined,
    dataFim: f.fim != null ? dataLocalIso(f.fim) : undefined,
    status: arr(f.status),
    tipo: arr(f.tipo),
    prioridade: arr(f.prioridade),
    setor: arr(f.setor),
    tecnico: arr(f.tecnico),
    busca: f.busca || undefined,
  };
}

/** Inteiro em [min, max] ou padrão; registra erro em `detalhes` quando inválido. */
function inteiro(query, nome, { padrao, min, max }, detalhes) {
  const v = query[nome];
  if (v == null || v === '') return padrao;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    detalhes.push({ campo: nome, valor: v, mensagem: `Informe um inteiro entre ${min} e ${max}.` });
    return padrao;
  }
  return n;
}

function opcao(query, nome, permitidas, padrao, detalhes) {
  const v = query[nome];
  if (v == null || v === '') return padrao;
  if (!permitidas.includes(String(v))) {
    detalhes.push({ campo: nome, valor: v, mensagem: `Valores aceitos: ${permitidas.join(', ')}.` });
    return padrao;
  }
  return String(v);
}

module.exports = { lerFiltros, descreverFiltros, inteiro, opcao };
