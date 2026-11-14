// Tratamento de dados (RF07): normaliza registros vindos da base/integração
// e separa os que não podem ser aproveitados.
const { STATUS, PRIORIDADES, TIPOS, SETORES } = require('../dominio');

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = (s) => semAcento(String(s)).trim().toLowerCase().replace(/[\s-]+/g, '_');

function mapaPorChave(valores) {
  const mapa = new Map();
  for (const v of valores) mapa.set(chave(v), v);
  return mapa;
}

function mapaCodigoRotulo(dicionario) {
  const mapa = new Map();
  for (const [codigo, rotulo] of Object.entries(dicionario)) {
    mapa.set(chave(codigo), codigo);
    mapa.set(chave(rotulo), codigo);
  }
  return mapa;
}

const MAPA_TIPOS = mapaPorChave(TIPOS);
const MAPA_SETORES = mapaPorChave(SETORES);
const MAPA_STATUS = mapaCodigoRotulo(STATUS);
const MAPA_PRIORIDADES = mapaCodigoRotulo(PRIORIDADES);

const dataValida = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
// null = vazio; undefined = inválido
const isoOuNull = (v) => (v == null || v === '' ? null : dataValida(v) ? new Date(v).toISOString() : undefined);
const texto = (v) => (v == null ? null : String(v).trim() || null);

const normalizarTipo = (v) => (v == null ? undefined : MAPA_TIPOS.get(chave(v)));
const normalizarStatus = (v) => (v == null ? undefined : MAPA_STATUS.get(chave(v)));
const normalizarPrioridade = (v) => (v == null ? undefined : MAPA_PRIORIDADES.get(chave(v)));
const normalizarSetor = (v) => (v == null ? null : MAPA_SETORES.get(chave(v)) || texto(v));

/**
 * Normaliza um registro bruto.
 * @returns {{registro: object|null, erros: string[], corrigido: boolean}}
 * Se `erros` não estiver vazio, o registro é descartado.
 */
function normalizarChamado(bruto) {
  if (!bruto || typeof bruto !== 'object') return { registro: null, erros: ['registro não é um objeto'], corrigido: false };
  const erros = [];
  const tipo = normalizarTipo(bruto.tipo);
  const status = normalizarStatus(bruto.status);
  const prioridade = normalizarPrioridade(bruto.prioridade);
  const dataAbertura = isoOuNull(bruto.dataAbertura);
  const dataPrimeiroAtendimento = isoOuNull(bruto.dataPrimeiroAtendimento);
  const dataResolucao = isoOuNull(bruto.dataResolucao);

  if (!Number.isInteger(bruto.id)) erros.push('id ausente ou não inteiro');
  if (!tipo) erros.push(`tipo desconhecido: ${JSON.stringify(bruto.tipo)}`);
  if (!status) erros.push(`status desconhecido: ${JSON.stringify(bruto.status)}`);
  if (!prioridade) erros.push(`prioridade desconhecida: ${JSON.stringify(bruto.prioridade)}`);
  if (!dataAbertura) erros.push(`dataAbertura inválida: ${JSON.stringify(bruto.dataAbertura)}`);
  if (dataPrimeiroAtendimento === undefined) erros.push('dataPrimeiroAtendimento inválida');
  if (dataResolucao === undefined) erros.push('dataResolucao inválida');
  if (dataAbertura && dataResolucao && dataResolucao < dataAbertura) erros.push('dataResolucao anterior à dataAbertura');

  if (erros.length) return { registro: null, erros, corrigido: false };

  const registro = {
    id: bruto.id,
    protocolo: texto(bruto.protocolo) || `TD-${String(bruto.id).padStart(6, '0')}`,
    titulo: texto(bruto.titulo) || '(sem título)',
    descricao: texto(bruto.descricao),
    tipo,
    prioridade,
    status,
    solicitante: texto(bruto.solicitante),
    setor: normalizarSetor(bruto.setor),
    tecnico: texto(bruto.tecnico),
    dataAbertura,
    dataPrimeiroAtendimento,
    dataResolucao,
    avaliacao: Number.isInteger(bruto.avaliacao) && bruto.avaliacao >= 1 && bruto.avaliacao <= 5 ? bruto.avaliacao : null,
    consideracoesTecnicas: Array.isArray(bruto.consideracoesTecnicas)
      ? bruto.consideracoesTecnicas
          .filter((c) => c && texto(c.texto))
          .map((c) => ({ data: isoOuNull(c.data) || dataAbertura, tecnico: texto(c.tecnico), texto: texto(c.texto) }))
      : [],
  };

  const corrigido =
    registro.tipo !== bruto.tipo ||
    registro.status !== bruto.status ||
    registro.prioridade !== bruto.prioridade ||
    (bruto.setor != null && registro.setor !== bruto.setor);

  return { registro, erros, corrigido };
}

module.exports = { normalizarChamado, normalizarTipo, normalizarStatus, normalizarPrioridade, normalizarSetor, chave, texto };
