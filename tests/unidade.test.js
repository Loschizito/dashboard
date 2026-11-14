// Testes de unidade: normalização de dados, datas, banco de dados e gerador da base.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizarChamado, normalizarTipo, normalizarStatus } = require('../src/data/normalizador');
const { parseDataLocal, inicioDoBalde, dataLocalIso } = require('../src/services/tempo');
const { gerarChamados } = require('../src/data/gerador');
const { ChamadosStore } = require('../src/data/store');

describe('Normalizador (RF07)', () => {
  it('corrige caixa, espaços, acentos e rótulos', () => {
    assert.equal(normalizarTipo('  e-mail '), 'E-mail');
    assert.equal(normalizarTipo('ACESSO E SENHAS'), 'Acesso e Senhas');
    assert.equal(normalizarStatus('Aguardando Usuário'), 'aguardando_usuario');
    assert.equal(normalizarStatus('em-andamento'), 'em_andamento');
  });

  it('descarta registros com campos essenciais inválidos', () => {
    const { registro, erros } = normalizarChamado({ id: 1, tipo: 'Rede', status: 'xpto', prioridade: 'media', dataAbertura: 'ontem' });
    assert.equal(registro, null);
    assert.equal(erros.length, 2);
  });

  it('descarta resolução anterior à abertura', () => {
    const { registro, erros } = normalizarChamado({ id: 1, tipo: 'Rede', status: 'resolvido', prioridade: 'media', dataAbertura: '2026-11-02T10:00:00Z', dataResolucao: '2026-11-01T10:00:00Z' });
    assert.equal(registro, null);
    assert.match(erros[0], /anterior/);
  });

  it('ignora avaliação fora da escala e considerações vazias', () => {
    const { registro } = normalizarChamado({ id: 1, tipo: 'Rede', status: 'fechado', prioridade: 'media', dataAbertura: '2026-11-02T10:00:00Z', avaliacao: 7, consideracoesTecnicas: [{ texto: '  ' }, { texto: 'ok' }] });
    assert.equal(registro.avaliacao, null);
    assert.equal(registro.consideracoesTecnicas.length, 1);
  });

  it('a importação registra a qualidade da carga no banco', () => {
    const store = new ChamadosStore({ dados: [{ id: 1, tipo: 'rede', status: 'aberto', prioridade: 'media', dataAbertura: '2026-11-02T10:00:00Z' }, { id: 2 }, null] });
    const q = store.ultimaImportacao();
    assert.equal(q.validos, 1);
    assert.equal(q.corrigidos, 1);
    assert.equal(q.descartados, 2);
    assert.equal(store.contar(), 1);
  });
});

describe('Banco de dados SQLite', () => {
  const base = [{ id: 1, titulo: 'Teste', tipo: 'Rede', status: 'aberto', prioridade: 'alta', setor: 'RH', dataAbertura: '2026-11-02T10:00:00Z', consideracoesTecnicas: [{ data: '2026-11-02T11:00:00Z', tecnico: 'Ana Ribeiro', texto: 'Primeira análise.' }] }];

  it('persiste os dados em arquivo entre execuções', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thindesk-'));
    const arquivo = path.join(dir, 'teste.db');
    try {
      const s1 = new ChamadosStore({ arquivo, dados: base });
      const criado = s1.criar({ titulo: 'Novo chamado', tipo: 'Hardware', prioridade: 'baixa', status: 'aberto', solicitante: 'Fulano', setor: null, tecnico: null, dataAbertura: '2026-11-03T10:00:00.000Z' });
      s1.atualizar({ ...criado, status: 'em_andamento', tecnico: 'Carlos Mendes', dataPrimeiroAtendimento: '2026-11-03T11:00:00.000Z' }, { data: '2026-11-03T11:00:00.000Z', tecnico: 'Carlos Mendes', texto: 'Em análise.' });
      s1.fechar();

      const s2 = new ChamadosStore({ arquivo }); // reabre sem importar nada
      assert.equal(s2.contar(), 2);
      const reaberto = s2.buscar(criado.id);
      assert.equal(reaberto.protocolo, 'TD-000002');
      assert.equal(reaberto.status, 'em_andamento');
      assert.equal(reaberto.tecnico, 'Carlos Mendes');
      assert.deepEqual(reaberto.consideracoesTecnicas.map((c) => c.texto), ['Em análise.']);
      assert.equal(s2.buscar(1).consideracoesTecnicas[0].tecnico, 'Ana Ribeiro');
      s2.fechar();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reimportar o mesmo id substitui o registro e suas considerações', () => {
    const store = new ChamadosStore({ dados: base });
    store.importar([{ ...base[0], titulo: 'Atualizado', consideracoesTecnicas: [] }], 'teste');
    assert.equal(store.contar(), 1);
    assert.equal(store.buscar(1).titulo, 'Atualizado');
    assert.equal(store.buscar(1).consideracoesTecnicas.length, 0);
  });

  it('as restrições do esquema impedem dados inconsistentes', () => {
    const store = new ChamadosStore({ dados: base });
    const inserir = (sql) => () => store.db.prepare(sql).run();
    assert.throws(inserir("INSERT INTO chamados (protocolo, titulo, tipo_id, prioridade, status, data_abertura) VALUES ('X1', 't', 1, 'urgente', 'aberto', '2026-11-01T00:00:00.000Z')"), /FOREIGN KEY/);
    assert.throws(inserir("INSERT INTO chamados (protocolo, titulo, tipo_id, prioridade, status, data_abertura, data_resolucao) VALUES ('X2', 't', 1, 'alta', 'resolvido', '2026-11-02T00:00:00.000Z', '2026-11-01T00:00:00.000Z')"), /CHECK/);
    assert.throws(inserir("INSERT INTO chamados (protocolo, titulo, tipo_id, prioridade, status, data_abertura, avaliacao) VALUES ('X3', 't', 1, 'alta', 'fechado', '2026-11-02T00:00:00.000Z', 9)"), /CHECK/);
    assert.throws(inserir("INSERT INTO chamados (protocolo, titulo, tipo_id, prioridade, status, data_abertura) VALUES ('TD-000001', 't', 1, 'alta', 'aberto', '2026-11-02T00:00:00.000Z')"), /UNIQUE/);
  });

  it('a visão calcula os tempos em horas', () => {
    const store = new ChamadosStore({ dados: [{ id: 1, tipo: 'Rede', status: 'fechado', prioridade: 'media', dataAbertura: '2026-11-02T10:00:00Z', dataPrimeiroAtendimento: '2026-11-02T11:30:00Z', dataResolucao: '2026-11-03T10:00:00Z' }] });
    const v = store.db.prepare('SELECT horas_primeiro_atendimento AS p, horas_resolucao AS r, sla_horas AS s FROM vw_chamados').get();
    assert.ok(Math.abs(v.p - 1.5) < 1e-6);
    assert.ok(Math.abs(v.r - 24) < 1e-6);
    assert.equal(v.s, 24);
  });
});

describe('Datas no fuso de Brasília', () => {
  it('interpreta AAAA-MM-DD como dia local', () => {
    assert.equal(new Date(parseDataLocal('2026-11-10')).toISOString(), '2026-11-10T03:00:00.000Z');
    assert.equal(new Date(parseDataLocal('2026-11-10', true)).toISOString(), '2026-11-11T02:59:59.999Z');
    assert.equal(parseDataLocal('2026-02-29'), null); // 2026 não é bissexto
    assert.equal(parseDataLocal('10/11/2026'), null);
  });

  it('calcula início de semana (segunda) e mês', () => {
    const domingo = Date.parse('2026-11-01T15:00:00Z');
    assert.equal(dataLocalIso(inicioDoBalde(domingo, 'semana')), '2026-10-26');
    assert.equal(dataLocalIso(inicioDoBalde(domingo, 'mes')), '2026-11-01');
    // 01/11 01:00 UTC ainda é 31/10 em Brasília
    assert.equal(dataLocalIso(inicioDoBalde(Date.parse('2026-11-01T01:00:00Z'), 'dia')), '2026-10-31');
  });
});

describe('Gerador da base de exemplo', () => {
  const referencia = new Date('2026-11-10T15:00:00Z');

  it('é determinístico para a mesma semente', () => {
    assert.deepEqual(gerarChamados({ referencia, quantidade: 50 }), gerarChamados({ referencia, quantidade: 50 }));
  });

  it('gera dados consistentes', () => {
    const store = new ChamadosStore({ dados: gerarChamados({ referencia, quantidade: 400 }) });
    assert.equal(store.ultimaImportacao().descartados, 2); // os dois registros propositalmente corrompidos
    assert.equal(store.ultimaImportacao().corrigidos, 4);
    for (const c of store.listar()) {
      assert.ok(Date.parse(c.dataAbertura) <= referencia.getTime(), `abertura futura em ${c.id}`);
      if (c.dataResolucao) assert.ok(c.dataResolucao >= c.dataAbertura);
      if (c.dataPrimeiroAtendimento) assert.ok(c.dataPrimeiroAtendimento >= c.dataAbertura);
      if (['resolvido', 'fechado'].includes(c.status)) assert.ok(c.dataResolucao, `atendido sem resolução em ${c.id}`);
      if (['em_andamento', 'aguardando_usuario', 'resolvido', 'fechado'].includes(c.status)) assert.ok(c.tecnico, `sem técnico em ${c.id}`);
    }
  });
});
