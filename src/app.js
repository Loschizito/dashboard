// Monta a aplicação Express (API + arquivos estáticos do dashboard).
const path = require('path');
const express = require('express');
const { ErroApi } = require('./erros');
const { STATUS, PRIORIDADES } = require('./dominio');
const { rotasDashboard } = require('./routes/dashboard');
const { rotasChamados } = require('./routes/chamados');
const { dataLocalIso } = require('./services/tempo');
const pacote = require('../package.json');

/**
 * @param {object} deps
 * @param {import('./data/store').ChamadosStore} deps.store
 * @param {() => Date} [deps.agora] relógio injetável (testes)
 */
function criarApp({ store, agora = () => new Date() }) {
  const app = express();
  app.disable('x-powered-by');
  // importação aceita lotes maiores; demais rotas, até 100 KB
  app.use('/api/v1/dados/importar', express.json({ limit: '5mb' }));
  app.use(express.json({ limit: '100kb' }));

  // Cabeçalhos da API: sem cache (dados operacionais) e CORS liberado para integração com outros sistemas.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const api = express.Router();

  api.get('/saude', (req, res) => {
    res.json({
      dados: {
        status: 'ok',
        versao: pacote.version,
        uptimeSegundos: Math.round(process.uptime()),
        banco: 'SQLite',
        totalChamados: store.contar(),
        dadosAtualizadosEm: store.atualizadoEm,
      },
    });
  });

  api.get('/opcoes-filtro', (req, res) => {
    const o = store.opcoesFiltro();
    res.json({
      dados: {
        status: Object.entries(STATUS).map(([valor, rotulo]) => ({ valor, rotulo })),
        prioridades: Object.entries(PRIORIDADES).map(([valor, rotulo]) => ({ valor, rotulo })),
        tipos: o.tipos,
        setores: o.setores,
        tecnicos: o.tecnicos,
        periodoDisponivel: o.periodo.inicio ? { dataInicio: dataLocalIso(Date.parse(o.periodo.inicio)), dataFim: dataLocalIso(Date.parse(o.periodo.fim)) } : null,
      },
    });
  });

  api.get('/qualidade-dados', (req, res) => {
    res.json({ dados: { ...store.ultimaImportacao(), dadosAtualizadosEm: store.atualizadoEm } });
  });

  // Importa um lote de chamados de outro sistema, aplicando o tratamento de dados (RF07).
  api.post('/dados/importar', (req, res) => {
    const lote = req.body;
    if (!Array.isArray(lote) || lote.length === 0 || lote.length > 5000) {
      throw new ErroApi(400, 'PARAMETRO_INVALIDO', 'Envie um array JSON com 1 a 5000 chamados.');
    }
    const relatorio = store.importar(lote, 'POST /api/v1/dados/importar');
    res.json({ dados: { ...relatorio, dadosAtualizadosEm: store.atualizadoEm } });
  });

  api.use('/dashboard', rotasDashboard({ store, agora }));
  api.use('/chamados', rotasChamados({ store, agora }));

  api.use((req, res, next) => next(new ErroApi(404, 'ROTA_NAO_ENCONTRADA', `Rota ${req.method} ${req.originalUrl} não existe.`)));

  app.use('/api/v1', api);
  app.use('/api', (req, res, next) => next(new ErroApi(404, 'ROTA_NAO_ENCONTRADA', `Rota ${req.method} ${req.originalUrl} não existe. Use o prefixo /api/v1.`)));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Tratamento centralizado de erros: sempre no formato { erro: { status, codigo, mensagem, detalhes } }
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let erro = err;
    if (err.type === 'entity.parse.failed') erro = new ErroApi(400, 'JSON_INVALIDO', 'O corpo da requisição não é um JSON válido.');
    else if (err.type === 'entity.too.large') erro = new ErroApi(413, 'CORPO_MUITO_GRANDE', 'O corpo da requisição excede 100 KB.');
    else if (!(err instanceof ErroApi)) {
      console.error(err);
      erro = new ErroApi(500, 'ERRO_INTERNO', 'Erro inesperado no servidor.');
    }
    const corpo = { erro: { status: erro.status, codigo: erro.codigo, mensagem: erro.message } };
    if (erro.detalhes) corpo.erro.detalhes = erro.detalhes;
    res.status(erro.status).json(corpo);
  });

  return app;
}

module.exports = { criarApp };
