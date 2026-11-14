// Endpoints agregados que alimentam o dashboard (RF01–RF04).
const express = require('express');
const { lerFiltros, descreverFiltros, inteiro, opcao } = require('../services/filtros');
const { indicadores, serieTemporal, situacao, rankingTipos, rankingTecnicos } = require('../services/metricas');
const { erroValidacao } = require('../erros');

function rotasDashboard({ store, agora }) {
  const router = express.Router();

  const contexto = (req) => ({ filtros: lerFiltros(req.query), agora: agora().getTime() });
  const meta = (ctx, extra = {}) => ({ geradoEm: new Date(ctx.agora).toISOString(), dadosAtualizadosEm: store.atualizadoEm, filtros: descreverFiltros(ctx.filtros), ...extra });

  router.get('/indicadores', (req, res) => {
    const ctx = contexto(req);
    res.json({ dados: indicadores(store, ctx.filtros, ctx.agora), meta: meta(ctx) });
  });

  router.get('/periodo', (req, res) => {
    const detalhes = [];
    const agrupamento = opcao(req.query, 'agrupamento', ['auto', 'dia', 'semana', 'mes'], 'auto', detalhes);
    if (detalhes.length) throw erroValidacao(detalhes);
    const ctx = contexto(req);
    const resultado = serieTemporal(store.eventosSerie(ctx.filtros), ctx.filtros, agrupamento, ctx.agora);
    if (resultado.erro) throw erroValidacao([{ campo: 'agrupamento', valor: agrupamento, mensagem: resultado.erro }]);
    res.json({ dados: resultado, meta: meta(ctx) });
  });

  router.get('/status', (req, res) => {
    const ctx = contexto(req);
    res.json({ dados: situacao(store, ctx.filtros, ctx.agora), meta: meta(ctx) });
  });

  router.get('/tipos', (req, res) => {
    const detalhes = [];
    const limite = inteiro(req.query, 'limite', { padrao: null, min: 1, max: 50 }, detalhes);
    const ordenarPor = opcao(req.query, 'ordenarPor', ['atendidos', 'total', 'emAberto', 'tempoMedio'], 'atendidos', detalhes);
    if (detalhes.length) throw erroValidacao(detalhes);
    const ctx = contexto(req);
    res.json({ dados: rankingTipos(store, ctx.filtros, ordenarPor, limite), meta: meta(ctx, { ordenarPor, limite }) });
  });

  router.get('/tecnicos', (req, res) => {
    const ctx = contexto(req);
    res.json({ dados: rankingTecnicos(store, ctx.filtros), meta: meta(ctx) });
  });

  return router;
}

module.exports = { rotasDashboard };
