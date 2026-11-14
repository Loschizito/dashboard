// Testes de integração dos endpoints de chamados e de sistema (RF05–RF07).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./auxiliar');

describe('Endpoints de chamados', () => {
  let api;
  before(async () => { api = await iniciarServidor(); });
  after(() => api.fechar());

  describe('GET /api/v1/chamados', () => {
    it('lista com paginação e campos calculados', async () => {
      const r = await api.get('/api/v1/chamados?limite=2');
      assert.equal(r.status, 200);
      assert.equal(r.json.dados.length, 2);
      assert.deepEqual(r.json.paginacao, { pagina: 1, limite: 2, total: 7, totalPaginas: 4 });
      const primeiro = r.json.dados[0];
      assert.equal(primeiro.id, 1); // mais recente primeiro
      assert.equal(primeiro.statusRotulo, 'Aberto');
      assert.equal(primeiro.prazoSla, '2026-11-10T16:00:00.000Z');
      assert.equal(primeiro.atrasado, false);
    });

    it('ordena por prioridade', async () => {
      const r = await api.get('/api/v1/chamados?ordenarPor=prioridade&ordem=desc&limite=1');
      assert.equal(r.json.dados[0].prioridade, 'critica');
    });

    it('busca por protocolo, título ou solicitante ignorando acentos', async () => {
      const r = await api.get('/api/v1/chamados?busca=diego%20araujo');
      assert.deepEqual(r.json.dados.map((c) => c.id), [7]);
      const r2 = await api.get('/api/v1/chamados?busca=TD-000003');
      assert.deepEqual(r2.json.dados.map((c) => c.id), [3]);
    });

    it('valida paginação e ordenação', async () => {
      const r = await api.get('/api/v1/chamados?limite=500&ordenarPor=cor');
      assert.equal(r.status, 400);
      assert.deepEqual(r.json.erro.detalhes.map((d) => d.campo).sort(), ['limite', 'ordenarPor']);
    });
  });

  describe('GET /api/v1/chamados/:id', () => {
    it('retorna o detalhe com considerações técnicas', async () => {
      const r = await api.get('/api/v1/chamados/2');
      assert.equal(r.status, 200);
      assert.equal(r.json.dados.consideracoesTecnicas[0].texto, 'Cabo em teste.');
      assert.equal(r.json.dados.atrasado, true);
    });

    it('retorna 404 para chamado inexistente', async () => {
      const r = await api.get('/api/v1/chamados/999');
      assert.equal(r.status, 404);
      assert.equal(r.json.erro.codigo, 'NAO_ENCONTRADO');
    });

    it('retorna 400 para id inválido', async () => {
      const r = await api.get('/api/v1/chamados/abc');
      assert.equal(r.status, 400);
    });
  });

  describe('POST /api/v1/chamados', () => {
    it('abre um chamado e devolve 201 com Location', async () => {
      const r = await api.post('/api/v1/chamados', { titulo: 'Teclado sem resposta', tipo: 'hardware', prioridade: 'Alta', solicitante: 'Renata Gomes', setor: 'produção' });
      assert.equal(r.status, 201);
      assert.equal(r.headers.get('location'), '/api/v1/chamados/8');
      assert.equal(r.json.dados.tipo, 'Hardware');
      assert.equal(r.json.dados.prioridade, 'alta');
      assert.equal(r.json.dados.setor, 'Produção');
      assert.equal(r.json.dados.status, 'aberto');
      const total = await api.get('/api/v1/dashboard/indicadores');
      assert.equal(total.json.dados.totalChamados, 8); // indicadores refletem o novo chamado
    });

    it('valida campos obrigatórios', async () => {
      const r = await api.post('/api/v1/chamados', { titulo: 'x', tipo: 'Cafeteira' });
      assert.equal(r.status, 400);
      assert.deepEqual(r.json.erro.detalhes.map((d) => d.campo).sort(), ['solicitante', 'tipo', 'titulo']);
    });

    it('retorna 400 para JSON malformado', async () => {
      const r = await api.post('/api/v1/chamados', '{"titulo": ', { bruto: true });
      assert.equal(r.status, 400);
      assert.equal(r.json.erro.codigo, 'JSON_INVALIDO');
    });
  });

  describe('PATCH /api/v1/chamados/:id (fluxo de atendimento)', () => {
    it('exige técnico para iniciar o atendimento', async () => {
      const r = await api.patch('/api/v1/chamados/1', { status: 'em_andamento' });
      assert.equal(r.status, 422);
      assert.equal(r.json.erro.codigo, 'REGRA_DE_NEGOCIO');
    });

    it('bloqueia transição inválida', async () => {
      const r = await api.patch('/api/v1/chamados/1', { status: 'fechado' });
      assert.equal(r.status, 422);
      assert.deepEqual(r.json.erro.detalhes[0].permitidos, ['em_andamento', 'aguardando_usuario', 'cancelado']);
    });

    it('inicia o atendimento registrando o primeiro atendimento', async () => {
      const r = await api.patch('/api/v1/chamados/1', { status: 'em_andamento', tecnico: 'Rafael Souza', consideracao: 'Switch do 3º andar reiniciado.' });
      assert.equal(r.status, 200);
      assert.equal(r.json.dados.status, 'em_andamento');
      assert.equal(r.json.dados.dataPrimeiroAtendimento, '2026-11-10T15:00:00.000Z');
      assert.equal(r.json.dados.tempoPrimeiroAtendimentoHoras, 3);
      assert.equal(r.json.dados.consideracoesTecnicas.at(-1).tecnico, 'Rafael Souza');
    });

    it('exige consideração técnica para resolver', async () => {
      const r = await api.patch('/api/v1/chamados/1', { status: 'resolvido' });
      assert.equal(r.status, 422);
    });

    it('resolve, fecha com avaliação e depois bloqueia alterações', async () => {
      const resolvido = await api.patch('/api/v1/chamados/1', { status: 'resolvido', consideracao: 'Porta do switch substituída.' });
      assert.equal(resolvido.status, 200);
      assert.equal(resolvido.json.dados.slaCumprido, true); // 3h < 4h
      const avaliacaoCedo = await api.patch('/api/v1/chamados/3', { avaliacao: 4 });
      assert.equal(avaliacaoCedo.status, 422); // só no fechamento
      const fechado = await api.patch('/api/v1/chamados/1', { status: 'fechado', avaliacao: 5 });
      assert.equal(fechado.status, 200);
      assert.equal(fechado.json.dados.avaliacao, 5);
      const depois = await api.patch('/api/v1/chamados/1', { consideracao: 'Nova nota' });
      assert.equal(depois.status, 422);
    });

    it('reabre um chamado resolvido limpando a data de resolução', async () => {
      const r = await api.patch('/api/v1/chamados/3', { status: 'em_andamento', consideracao: 'Usuário relatou recorrência.' });
      assert.equal(r.status, 200);
      assert.equal(r.json.dados.dataResolucao, null);
    });

    it('valida o corpo da atualização', async () => {
      const vazio = await api.patch('/api/v1/chamados/2', {});
      assert.equal(vazio.status, 400);
      const invalido = await api.patch('/api/v1/chamados/2', { status: 'pendente', avaliacao: 9 });
      assert.equal(invalido.status, 400);
      assert.deepEqual(invalido.json.erro.detalhes.map((d) => d.campo).sort(), ['avaliacao', 'status']);
      const naoExiste = await api.patch('/api/v1/chamados/999', { tecnico: 'Ana Ribeiro' });
      assert.equal(naoExiste.status, 404);
    });
  });
});

describe('Endpoints de sistema e tratamento de dados (RF06/RF07)', () => {
  let api;
  before(async () => { api = await iniciarServidor(); });
  after(() => api.fechar());

  it('GET /saude informa o estado da API', async () => {
    const r = await api.get('/api/v1/saude');
    assert.equal(r.status, 200);
    assert.equal(r.json.dados.status, 'ok');
    assert.equal(r.json.dados.totalChamados, 7);
  });

  it('GET /qualidade-dados relata registros corrigidos e descartados', async () => {
    const r = await api.get('/api/v1/qualidade-dados');
    assert.equal(r.json.dados.lidos, 8);
    assert.equal(r.json.dados.validos, 7);
    assert.equal(r.json.dados.corrigidos, 1);
    assert.equal(r.json.dados.descartados, 1);
    assert.equal(r.json.dados.ocorrencias[0].id, 8);
  });

  it('GET /opcoes-filtro devolve os valores aceitos nos filtros', async () => {
    const r = await api.get('/api/v1/opcoes-filtro');
    assert.ok(r.json.dados.tipos.includes('Rede'));
    assert.deepEqual(r.json.dados.tecnicos, ['Ana Ribeiro', 'Carlos Mendes']);
    assert.deepEqual(r.json.dados.periodoDisponivel, { dataInicio: '2026-10-15', dataFim: '2026-11-10' });
  });

  it('POST /dados/importar trata o lote e atualiza os indicadores', async () => {
    const lote = [
      { id: 100, titulo: 'Importado', tipo: 'TELEFONIA', prioridade: 'Crítica', status: 'aberto', solicitante: 'Sistema legado', dataAbertura: '2026-11-10T13:00:00Z' },
      { id: 101, titulo: 'Inválido', tipo: 'Rede', prioridade: 'media', status: 'aberto', dataAbertura: 'amanhã' },
    ];
    const r = await api.post('/api/v1/dados/importar', lote);
    assert.equal(r.status, 200);
    assert.equal(r.json.dados.validos, 1);
    assert.equal(r.json.dados.corrigidos, 1);
    assert.equal(r.json.dados.descartados, 1);
    const ind = await api.get('/api/v1/dashboard/indicadores?tipo=Telefonia');
    assert.equal(ind.json.dados.criticosEmAberto, 1);
    const q = await api.get('/api/v1/qualidade-dados');
    assert.equal(q.json.dados.origem, 'POST /api/v1/dados/importar');
  });

  it('POST /dados/importar rejeita corpo que não é lista', async () => {
    const r = await api.post('/api/v1/dados/importar', { id: 1 });
    assert.equal(r.status, 400);
  });

  it('respostas da API não são cacheadas e permitem CORS', async () => {
    const r = await api.get('/api/v1/dashboard/status');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
  });

  it('rotas inexistentes retornam 404 padronizado', async () => {
    const r = await api.get('/api/v1/nao-existe');
    assert.equal(r.status, 404);
    assert.equal(r.json.erro.codigo, 'ROTA_NAO_ENCONTRADA');
    const semVersao = await api.get('/api/dashboard/status');
    assert.equal(semVersao.status, 404);
  });

  it('serve o dashboard na raiz', async () => {
    const r = await api.get('/');
    assert.equal(r.status, 200);
    assert.match(r.texto, /Painel de Chamados/);
  });
});
