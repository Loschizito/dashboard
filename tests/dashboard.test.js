// Testes de integração dos endpoints do dashboard (RF01–RF05).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./auxiliar');

describe('Endpoints do dashboard', () => {
  let api;
  before(async () => { api = await iniciarServidor(); });
  after(() => api.fechar());

  describe('GET /api/v1/dashboard/indicadores (RF01)', () => {
    it('calcula os indicadores gerais sobre toda a base', async () => {
      const r = await api.get('/api/v1/dashboard/indicadores');
      assert.equal(r.status, 200);
      const d = r.json.dados;
      assert.equal(d.totalChamados, 7);
      assert.equal(d.emAberto, 3);
      assert.equal(d.atendidos, 3);
      assert.equal(d.cancelados, 1);
      assert.equal(d.taxaResolucaoPercentual, 50); // 3 de 6 não cancelados
      assert.equal(d.tempoMedioResolucaoHoras, 37.3); // (12 + 96 + 4) / 3
      assert.equal(d.tempoMedioPrimeiroAtendimentoHoras, 2); // (1 + 2 + 4 + 1) / 4
      assert.equal(d.slaCumpridoPercentual, 66.7); // 2 de 3 no prazo
      assert.equal(d.satisfacaoMedia, 4);
      assert.equal(d.criticosEmAberto, 1);
      assert.equal(d.atrasadosEmAberto, 2); // #2 (alta, 8h) e #7 (média, 24h)
      assert.equal(d.semTecnico, 2);
      assert.equal(d.comparativo, null);
    });

    it('aplica período e devolve comparativo com a janela anterior', async () => {
      const r = await api.get('/api/v1/dashboard/indicadores?dataInicio=2026-11-01&dataFim=2026-11-10');
      assert.equal(r.status, 200);
      assert.equal(r.json.dados.totalChamados, 5);
      assert.deepEqual(r.json.dados.comparativo.periodoAnterior, { dataInicio: '2026-10-22', dataFim: '2026-10-31' });
      assert.equal(r.json.dados.comparativo.totalChamados, 0);
      assert.equal(r.json.dados.comparativo.variacaoTotalPercentual, null);
      assert.deepEqual(r.json.meta.filtros, { dataInicio: '2026-11-01', dataFim: '2026-11-10' });
    });

    it('calcula a variação quando há dados no período anterior', async () => {
      const r = await api.get('/api/v1/dashboard/indicadores?dataInicio=2026-10-21&dataFim=2026-11-10');
      // atual: 1,2,3,4,7 (5) | anterior (30/09 a 20/10): 5 e 6 (2)
      assert.equal(r.json.dados.totalChamados, 5);
      assert.equal(r.json.dados.comparativo.totalChamados, 2);
      assert.equal(r.json.dados.comparativo.variacaoTotalPercentual, 150);
    });

    it('combina filtros de tipo e prioridade', async () => {
      const r = await api.get('/api/v1/dashboard/indicadores?tipo=Rede&prioridade=media,baixa');
      assert.equal(r.json.dados.totalChamados, 2);
    });
  });

  describe('GET /api/v1/dashboard/periodo (RF02)', () => {
    it('agrupa por dia no fuso de Brasília, preenchendo dias vazios', async () => {
      const r = await api.get('/api/v1/dashboard/periodo?dataInicio=2026-11-01&dataFim=2026-11-07&agrupamento=dia');
      assert.equal(r.status, 200);
      const { series, totais, agrupamento } = r.json.dados;
      assert.equal(agrupamento, 'dia');
      assert.equal(series.length, 7);
      const dia = (p) => series.find((s) => s.periodo === p);
      assert.equal(dia('2026-11-01').abertos, 1);
      // #3 resolvido em 06/11 00:00 UTC = 05/11 21:00 em Brasília
      assert.equal(dia('2026-11-05').atendidos, 2);
      assert.equal(dia('2026-11-05').atendidosNoPrazo, 1);
      assert.equal(dia('2026-11-06').atendidos, 0);
      assert.deepEqual(totais, { abertos: 2, atendidos: 2, atendidosNoPrazo: 1 });
    });

    it('agrupa por semana iniciando na segunda-feira', async () => {
      const r = await api.get('/api/v1/dashboard/periodo?dataInicio=2026-11-01&dataFim=2026-11-10&agrupamento=semana');
      const series = r.json.dados.series;
      assert.deepEqual(series.map((s) => s.periodo), ['2026-10-26', '2026-11-02', '2026-11-09']);
      // eventos no meio da semana caem no balde da segunda-feira correspondente
      assert.deepEqual(series.map((s) => s.abertos), [1, 2, 2]); // #4 | #3, #7 | #1, #2
      assert.deepEqual(series.map((s) => s.atendidos), [0, 2, 0]);
      assert.equal(r.json.dados.totais.abertos, 5);
    });

    it('agrupa por mês', async () => {
      const r = await api.get('/api/v1/dashboard/periodo?agrupamento=mes');
      const s = r.json.dados.series;
      assert.deepEqual(s.map((x) => x.periodo), ['2026-10', '2026-11']);
      assert.equal(s[0].abertos, 2);
      assert.equal(s[1].abertos, 5);
    });

    it('escolhe o agrupamento automaticamente', async () => {
      const r = await api.get('/api/v1/dashboard/periodo?dataInicio=2026-11-01&dataFim=2026-11-10');
      assert.equal(r.json.dados.agrupamento, 'dia');
      const r2 = await api.get('/api/v1/dashboard/periodo?dataInicio=2025-01-01&dataFim=2026-11-10');
      assert.equal(r2.json.dados.agrupamento, 'mes');
    });

    it('rejeita agrupamento inválido', async () => {
      const r = await api.get('/api/v1/dashboard/periodo?agrupamento=ano');
      assert.equal(r.status, 400);
      assert.equal(r.json.erro.codigo, 'PARAMETRO_INVALIDO');
      assert.equal(r.json.erro.detalhes[0].campo, 'agrupamento');
    });

    it('rejeita períodos que gerariam pontos demais', async () => {
      const r = await api.get('/api/v1/dashboard/periodo?dataInicio=2020-01-01&dataFim=2026-11-10&agrupamento=dia');
      assert.equal(r.status, 400);
    });
  });

  describe('GET /api/v1/dashboard/status (RF03)', () => {
    it('distribui os chamados por status e prioridade', async () => {
      const r = await api.get('/api/v1/dashboard/status');
      assert.equal(r.status, 200);
      const porStatus = Object.fromEntries(r.json.dados.porStatus.map((s) => [s.status, s.quantidade]));
      assert.deepEqual(porStatus, { aberto: 2, em_andamento: 1, aguardando_usuario: 0, resolvido: 1, fechado: 2, cancelado: 1 });
      assert.deepEqual(r.json.dados.grupos, { emAberto: 3, atendidos: 3, cancelados: 1 });
      const alta = r.json.dados.porPrioridade.find((p) => p.prioridade === 'alta');
      assert.deepEqual(alta, { prioridade: 'alta', rotulo: 'Alta', slaHoras: 8, quantidade: 2, emAberto: 1, atrasados: 1 });
    });
  });

  describe('GET /api/v1/dashboard/tipos (RF04)', () => {
    it('ordena os tipos pelos mais atendidos', async () => {
      const r = await api.get('/api/v1/dashboard/tipos');
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.dados.map((t) => t.tipo), ['Rede', 'Software', 'E-mail', 'Hardware', 'Impressoras']);
      const rede = r.json.dados[0];
      assert.equal(rede.posicao, 1);
      assert.equal(rede.atendidos, 2);
      assert.equal(rede.participacaoPercentual, 66.7);
      assert.equal(rede.tempoMedioResolucaoHoras, 54); // (12 + 96) / 2
      assert.equal(rede.slaCumpridoPercentual, 50);
    });

    it('respeita limite e ordenarPor', async () => {
      const r = await api.get('/api/v1/dashboard/tipos?limite=2&ordenarPor=total');
      assert.equal(r.json.dados.length, 2);
      assert.equal(r.json.dados[0].tipo, 'Rede');
      assert.equal(r.json.meta.limite, 2);
    });

    it('valida o limite', async () => {
      const r = await api.get('/api/v1/dashboard/tipos?limite=0');
      assert.equal(r.status, 400);
    });
  });

  describe('GET /api/v1/dashboard/tecnicos', () => {
    it('resume o desempenho por técnico', async () => {
      const r = await api.get('/api/v1/dashboard/tecnicos');
      assert.deepEqual(r.json.dados.map((t) => [t.tecnico, t.atendidos, t.emAndamento]), [['Ana Ribeiro', 1, 1], ['Carlos Mendes', 2, 0]].sort((a, b) => b[1] - a[1]));
    });
  });

  describe('Validação de filtros (RF05)', () => {
    const casos = [
      ['data em formato errado', '?dataInicio=10/11/2026', 'dataInicio'],
      ['data inexistente', '?dataFim=2026-02-30', 'dataFim'],
      ['início depois do fim', '?dataInicio=2026-11-10&dataFim=2026-11-01', 'dataInicio'],
      ['status desconhecido', '?status=pendente', 'status'],
      ['tipo desconhecido', '?tipo=Cafeteira', 'tipo'],
      ['prioridade desconhecida', '?prioridade=urgente', 'prioridade'],
    ];
    for (const [nome, query, campo] of casos) {
      it(`retorna 400 para ${nome}`, async () => {
        const r = await api.get(`/api/v1/dashboard/indicadores${query}`);
        assert.equal(r.status, 400);
        assert.equal(r.json.erro.codigo, 'PARAMETRO_INVALIDO');
        assert.equal(r.json.erro.detalhes[0].campo, campo);
      });
    }

    it('aceita valores com caixa, acento e rótulo em vez do código', async () => {
      const r = await api.get('/api/v1/dashboard/indicadores?status=Em%20Andamento&prioridade=ALTA&tipo=hardware');
      assert.equal(r.status, 200);
      assert.equal(r.json.dados.totalChamados, 1);
    });

    it('filtra por técnico, incluindo "sem_tecnico"', async () => {
      const r = await api.get('/api/v1/dashboard/indicadores?tecnico=sem_tecnico');
      assert.equal(r.json.dados.totalChamados, 3); // #1, #6, #7
      const r2 = await api.get('/api/v1/dashboard/indicadores?tecnico=ana%20ribeiro');
      assert.equal(r2.json.dados.totalChamados, 2);
    });

    it('filtra por setor normalizado', async () => {
      const r = await api.get('/api/v1/dashboard/indicadores?setor=RH');
      assert.equal(r.json.dados.totalChamados, 2); // #2 e #7 (" rh" normalizado)
    });
  });
});
