// CRUD parcial de chamados: listagem com filtros, detalhe, abertura e atualização (RF05, RF07).
const express = require('express');
const { STATUS, PRIORIDADES, STATUS_FINAIS, TRANSICOES } = require('../dominio');
const { lerFiltros, descreverFiltros, inteiro, opcao } = require('../services/filtros');
const { apresentarChamado } = require('../services/metricas');
const { normalizarTipo, normalizarPrioridade, normalizarSetor, normalizarStatus, texto } = require('../data/normalizador');
const { erroValidacao, erroNaoEncontrado, erroRegraNegocio } = require('../erros');

const CAMPOS_ORDENACAO = ['dataAbertura', 'id', 'prioridade', 'status', 'tipo'];

function lerId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw erroValidacao([{ campo: 'id', valor: req.params.id, mensagem: 'O id deve ser um inteiro positivo.' }]);
  return id;
}

function textoObrigatorio(body, campo, { min = 1, max }, detalhes) {
  const v = texto(body[campo]);
  if (!v) detalhes.push({ campo, mensagem: 'Campo obrigatório.' });
  else if (v.length < min || v.length > max) detalhes.push({ campo, mensagem: `Deve ter entre ${min} e ${max} caracteres.` });
  return v;
}

function rotasChamados({ store, agora }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const detalhes = [];
    const pagina = inteiro(req.query, 'pagina', { padrao: 1, min: 1, max: 100000 }, detalhes);
    const limite = inteiro(req.query, 'limite', { padrao: 20, min: 1, max: 100 }, detalhes);
    const ordenarPor = opcao(req.query, 'ordenarPor', CAMPOS_ORDENACAO, 'dataAbertura', detalhes);
    const ordem = opcao(req.query, 'ordem', ['asc', 'desc'], 'desc', detalhes);
    let filtros;
    try {
      filtros = lerFiltros(req.query);
    } catch (e) {
      throw erroValidacao([...detalhes, ...(e.detalhes || [])]);
    }
    if (detalhes.length) throw erroValidacao(detalhes);

    const t = agora().getTime();
    const { total, itens } = store.paginar(filtros, { pagina, limite, ordenarPor, ordem });
    res.json({
      dados: itens.map((c) => apresentarChamado(c, t)),
      paginacao: { pagina, limite, total, totalPaginas: Math.max(1, Math.ceil(total / limite)) },
      meta: { geradoEm: new Date(t).toISOString(), dadosAtualizadosEm: store.atualizadoEm, filtros: descreverFiltros(filtros), ordenarPor, ordem },
    });
  });

  router.get('/:id', (req, res) => {
    const id = lerId(req);
    const chamado = store.buscar(id);
    if (!chamado) throw erroNaoEncontrado(`Chamado ${id} não encontrado.`);
    res.json({ dados: apresentarChamado(chamado, agora().getTime()) });
  });

  router.post('/', (req, res) => {
    const body = req.body || {};
    const detalhes = [];
    const titulo = textoObrigatorio(body, 'titulo', { min: 3, max: 120 }, detalhes);
    const solicitante = textoObrigatorio(body, 'solicitante', { min: 3, max: 80 }, detalhes);
    const descricao = texto(body.descricao);
    if (descricao && descricao.length > 2000) detalhes.push({ campo: 'descricao', mensagem: 'Máximo de 2000 caracteres.' });
    const tipo = normalizarTipo(body.tipo);
    if (!tipo) detalhes.push({ campo: 'tipo', valor: body.tipo, mensagem: 'Tipo obrigatório e deve ser um dos tipos cadastrados (GET /api/v1/opcoes-filtro).' });
    const prioridade = body.prioridade == null ? 'media' : normalizarPrioridade(body.prioridade);
    if (!prioridade) detalhes.push({ campo: 'prioridade', valor: body.prioridade, mensagem: `Valores aceitos: ${Object.keys(PRIORIDADES).join(', ')}.` });
    if (detalhes.length) throw erroValidacao(detalhes);

    const chamado = store.criar({
      titulo,
      descricao,
      tipo,
      prioridade,
      status: 'aberto',
      solicitante,
      setor: normalizarSetor(body.setor),
      tecnico: null,
      dataAbertura: agora().toISOString(),
    });
    res.status(201).location(`/api/v1/chamados/${chamado.id}`).json({ dados: apresentarChamado(chamado, agora().getTime()) });
  });

  router.patch('/:id', (req, res) => {
    const id = lerId(req);
    const body = req.body || {};
    const chamado = store.buscar(id);
    if (!chamado) throw erroNaoEncontrado(`Chamado ${id} não encontrado.`);

    const detalhes = [];
    const campos = ['status', 'tecnico', 'consideracao', 'avaliacao'].filter((c) => body[c] !== undefined);
    if (!campos.length) detalhes.push({ mensagem: 'Informe ao menos um dos campos: status, tecnico, consideracao, avaliacao.' });
    const novoStatus = body.status !== undefined ? normalizarStatus(body.status) : undefined;
    if (body.status !== undefined && !novoStatus) detalhes.push({ campo: 'status', valor: body.status, mensagem: `Valores aceitos: ${Object.keys(STATUS).join(', ')}.` });
    const tecnico = body.tecnico !== undefined ? texto(body.tecnico) : undefined;
    if (body.tecnico !== undefined && (!tecnico || tecnico.length > 80)) detalhes.push({ campo: 'tecnico', mensagem: 'Informe o nome do técnico (até 80 caracteres).' });
    const consideracao = body.consideracao !== undefined ? texto(body.consideracao) : undefined;
    if (body.consideracao !== undefined && (!consideracao || consideracao.length > 1000)) detalhes.push({ campo: 'consideracao', mensagem: 'Texto obrigatório de até 1000 caracteres.' });
    if (body.avaliacao !== undefined && !(Number.isInteger(body.avaliacao) && body.avaliacao >= 1 && body.avaliacao <= 5)) detalhes.push({ campo: 'avaliacao', valor: body.avaliacao, mensagem: 'Inteiro de 1 a 5.' });
    if (detalhes.length) throw erroValidacao(detalhes);

    // Regras de negócio
    if (STATUS_FINAIS.includes(chamado.status)) {
      throw erroRegraNegocio(`Chamado ${STATUS[chamado.status].toLowerCase()} não pode ser alterado.`, [{ campo: 'status', valor: chamado.status }]);
    }
    const statusFinal = novoStatus || chamado.status;
    if (novoStatus && novoStatus !== chamado.status && !TRANSICOES[chamado.status].includes(novoStatus)) {
      throw erroRegraNegocio(`Transição de "${chamado.status}" para "${novoStatus}" não é permitida.`, [{ campo: 'status', permitidos: TRANSICOES[chamado.status] }]);
    }
    const tecnicoFinal = tecnico || chamado.tecnico;
    if (['em_andamento', 'resolvido', 'aguardando_usuario'].includes(statusFinal) && !tecnicoFinal) {
      throw erroRegraNegocio('É necessário atribuir um técnico para este status.', [{ campo: 'tecnico' }]);
    }
    if (novoStatus === 'resolvido' && !consideracao) {
      throw erroRegraNegocio('Informe a consideração técnica da solução ao resolver o chamado.', [{ campo: 'consideracao' }]);
    }
    if (body.avaliacao !== undefined && statusFinal !== 'fechado') {
      throw erroRegraNegocio('A avaliação só pode ser registrada no fechamento do chamado.', [{ campo: 'avaliacao' }]);
    }

    // Aplicação
    const agoraIso = agora().toISOString();
    if (tecnico) chamado.tecnico = tecnico;
    if (novoStatus && novoStatus !== chamado.status) {
      if (['em_andamento', 'aguardando_usuario', 'resolvido'].includes(novoStatus) && !chamado.dataPrimeiroAtendimento) chamado.dataPrimeiroAtendimento = agoraIso;
      if (novoStatus === 'resolvido') chamado.dataResolucao = agoraIso;
      if (chamado.status === 'resolvido' && novoStatus === 'em_andamento') chamado.dataResolucao = null; // reabertura
      chamado.status = novoStatus;
    }
    if (body.avaliacao !== undefined) chamado.avaliacao = body.avaliacao;
    const nova = consideracao ? { data: agoraIso, tecnico: chamado.tecnico, texto: consideracao } : null;

    const atualizado = store.atualizar(chamado, nova);
    res.json({ dados: apresentarChamado(atualizado, agora().getTime()) });
  });

  return router;
}

module.exports = { rotasChamados };
