// Repositório de chamados sobre SQLite (better-sqlite3).
// Concentra todo o SQL da aplicação: importação com tratamento de dados, consultas
// filtradas, agregações do dashboard e gravações do fluxo de atendimento.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { STATUS, STATUS_EM_ABERTO, STATUS_ATENDIDOS, STATUS_FINAIS, PRIORIDADES, SLA_HORAS, TIPOS, SETORES } = require('../dominio');
const { normalizarChamado, chave } = require('./normalizador');
const { gerarChamados } = require('./gerador');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const PESO_PRIORIDADE = { baixa: 1, media: 2, alta: 3, critica: 4 };
const EPS = 1e-9; // tolerância de ponto flutuante na comparação de horas com o SLA

// Expressões SQL reutilizadas (sobre vw_chamados)
const SQL_ATENDIDO = 'horas_resolucao IS NOT NULL';
const SQL_NO_PRAZO = `horas_resolucao <= sla_horas + ${EPS}`;
const SQL_ATRASADO = "grupo = 'em_aberto' AND julianday(@agora) > julianday(data_abertura) + sla_horas / 24.0";

const ORDENACAO = {
  dataAbertura: 'data_abertura',
  id: 'id',
  prioridade: 'prioridade_peso',
  status: 'status_ordem',
  tipo: 'tipo COLLATE NOCASE',
};

const grupoDoStatus = (s) => (STATUS_EM_ABERTO.includes(s) ? 'em_aberto' : STATUS_ATENDIDOS.includes(s) ? 'atendido' : 'cancelado');
const textoBusca = (c) => chave([c.protocolo, c.titulo, c.solicitante, c.descricao].filter(Boolean).join(' '));

class ChamadosStore {
  /**
   * @param {object} opcoes
   * @param {string} [opcoes.arquivo] caminho do arquivo .db; omitido => banco em memória (testes)
   * @param {object[]} [opcoes.dados] registros brutos a importar na criação
   * @param {string} [opcoes.origem] descrição da origem dos dados importados
   */
  constructor({ arquivo = null, dados = null, origem = 'carga inicial' } = {}) {
    if (arquivo) fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    this.db = new Database(arquivo || ':memory:');
    if (arquivo) this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.popularDominio();

    if (dados) this.importar(dados, origem);
    else if (this.contar() === 0) this.importar(gerarChamados(), 'base de exemplo gerada automaticamente');
    this.atualizadoEm = new Date().toISOString();
  }

  fechar() {
    this.db.close();
  }

  // ---------- Domínio ----------

  popularDominio() {
    const ins = {
      status: this.db.prepare('INSERT OR IGNORE INTO status (codigo, rotulo, grupo, ordem, final) VALUES (?, ?, ?, ?, ?)'),
      prioridade: this.db.prepare('INSERT OR IGNORE INTO prioridades (codigo, rotulo, sla_horas, peso) VALUES (?, ?, ?, ?)'),
      tipo: this.db.prepare('INSERT OR IGNORE INTO tipos (nome) VALUES (?)'),
      setor: this.db.prepare('INSERT OR IGNORE INTO setores (nome) VALUES (?)'),
    };
    this.db.transaction(() => {
      Object.entries(STATUS).forEach(([codigo, rotulo], i) => ins.status.run(codigo, rotulo, grupoDoStatus(codigo), i + 1, STATUS_FINAIS.includes(codigo) ? 1 : 0));
      Object.entries(PRIORIDADES).forEach(([codigo, rotulo]) => ins.prioridade.run(codigo, rotulo, SLA_HORAS[codigo], PESO_PRIORIDADE[codigo]));
      TIPOS.forEach((t) => ins.tipo.run(t));
      SETORES.forEach((s) => ins.setor.run(s));
    })();
  }

  /** Id de um registro de tabela de nomes (tipos/setores/tecnicos), criando se necessário. */
  idPorNome(tabela, nome) {
    if (!nome) return null;
    this.db.prepare(`INSERT OR IGNORE INTO ${tabela} (nome) VALUES (?)`).run(nome);
    return this.db.prepare(`SELECT id FROM ${tabela} WHERE nome = ?`).get(nome).id;
  }

  // ---------- Importação com tratamento de dados (RF07) ----------

  /**
   * Normaliza e grava registros brutos (insere ou substitui pelo id).
   * Registros inválidos são descartados e reportados. O resultado fica salvo em `importacoes`.
   */
  importar(brutos, origem = 'importação') {
    const relatorio = { lidos: brutos.length, validos: 0, corrigidos: 0, descartados: 0, ocorrencias: [] };
    const apagar = this.db.prepare('DELETE FROM chamados WHERE id = ?');
    const inserirCons = this.db.prepare('INSERT INTO consideracoes_tecnicas (chamado_id, tecnico_id, data, texto) VALUES (?, ?, ?, ?)');

    this.db.transaction(() => {
      for (const bruto of brutos) {
        const { registro: c, erros, corrigido } = normalizarChamado(bruto);
        if (!c) {
          relatorio.descartados++;
          relatorio.ocorrencias.push({ id: bruto && bruto.id != null ? bruto.id : null, erros });
          continue;
        }
        apagar.run(c.id);
        this.inserirLinha(c);
        for (const n of c.consideracoesTecnicas) inserirCons.run(c.id, this.idPorNome('tecnicos', n.tecnico), n.data, n.texto);
        relatorio.validos++;
        if (corrigido) relatorio.corrigidos++;
      }
      this.db
        .prepare('INSERT INTO importacoes (data, origem, lidos, validos, corrigidos, descartados, ocorrencias) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(new Date().toISOString(), origem, relatorio.lidos, relatorio.validos, relatorio.corrigidos, relatorio.descartados, JSON.stringify(relatorio.ocorrencias));
    })();

    this.atualizadoEm = new Date().toISOString();
    return relatorio;
  }

  inserirLinha(c) {
    const info = this.db
      .prepare(
        `INSERT INTO chamados (id, protocolo, titulo, descricao, tipo_id, prioridade, status, solicitante, setor_id, tecnico_id,
           data_abertura, data_primeiro_atendimento, data_resolucao, avaliacao, busca)
         VALUES (@id, @protocolo, @titulo, @descricao, @tipoId, @prioridade, @status, @solicitante, @setorId, @tecnicoId,
           @dataAbertura, @dataPrimeiroAtendimento, @dataResolucao, @avaliacao, @busca)`,
      )
      .run({
        id: c.id ?? null,
        protocolo: c.protocolo,
        titulo: c.titulo,
        descricao: c.descricao ?? null,
        tipoId: this.idPorNome('tipos', c.tipo),
        prioridade: c.prioridade,
        status: c.status,
        solicitante: c.solicitante ?? null,
        setorId: this.idPorNome('setores', c.setor),
        tecnicoId: this.idPorNome('tecnicos', c.tecnico),
        dataAbertura: c.dataAbertura,
        dataPrimeiroAtendimento: c.dataPrimeiroAtendimento ?? null,
        dataResolucao: c.dataResolucao ?? null,
        avaliacao: c.avaliacao ?? null,
        busca: textoBusca(c),
      });
    return Number(info.lastInsertRowid);
  }

  /** Resultado da importação mais recente. */
  ultimaImportacao() {
    const r = this.db.prepare('SELECT * FROM importacoes ORDER BY id DESC LIMIT 1').get();
    if (!r) return { lidos: 0, validos: 0, corrigidos: 0, descartados: 0, ocorrencias: [] };
    return { origem: r.origem, importadoEm: r.data, lidos: r.lidos, validos: r.validos, corrigidos: r.corrigidos, descartados: r.descartados, ocorrencias: JSON.parse(r.ocorrencias) };
  }

  // ---------- Filtros (RF05) -> SQL ----------

  /**
   * Converte os filtros validados em cláusula WHERE parametrizada.
   * @returns {{sql: string, params: object}}
   */
  where(f, { ignorarPeriodo = false, extra = [] } = {}) {
    const cond = [...extra];
    const params = {};
    const lista = (nome, coluna, valores) => {
      const nomes = [...valores].map((v, i) => {
        params[`${nome}${i}`] = v;
        return `@${nome}${i}`;
      });
      cond.push(nomes.length ? `${coluna} IN (${nomes.join(', ')})` : '0');
    };
    // nomes comparados sem acento/caixa: resolve para ids na tabela de domínio
    const idsPorChave = (tabela, chaves) => this.db.prepare(`SELECT id, nome FROM ${tabela}`).all().filter((r) => chaves.has(chave(r.nome))).map((r) => r.id);

    if (!ignorarPeriodo) {
      if (f.inicio != null) {
        cond.push('data_abertura >= @inicio');
        params.inicio = new Date(f.inicio).toISOString();
      }
      if (f.fim != null) {
        cond.push('data_abertura <= @fim');
        params.fim = new Date(f.fim).toISOString();
      }
    }
    if (f.status) lista('st', 'status', f.status);
    if (f.tipo) lista('tp', 'tipo', f.tipo);
    if (f.prioridade) lista('pr', 'prioridade', f.prioridade);
    if (f.setor) lista('se', 'setor_id', idsPorChave('setores', f.setor));
    if (f.tecnico) {
      const ids = idsPorChave('tecnicos', f.tecnico).map((id, i) => {
        params[`tc${i}`] = id;
        return `@tc${i}`;
      });
      const partes = [];
      if (ids.length) partes.push(`tecnico_id IN (${ids.join(', ')})`);
      if (f.tecnico.has('sem_tecnico')) partes.push('tecnico_id IS NULL');
      cond.push(partes.length ? `(${partes.join(' OR ')})` : '0');
    }
    if (f.busca) {
      cond.push('instr(busca, @busca) > 0');
      params.busca = f.busca;
    }
    return { sql: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
  }

  // ---------- Leitura de chamados ----------

  contar() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM chamados').get().n;
  }

  linhaParaChamado(r, consideracoes = []) {
    return {
      id: r.id,
      protocolo: r.protocolo,
      titulo: r.titulo,
      descricao: r.descricao,
      tipo: r.tipo,
      prioridade: r.prioridade,
      status: r.status,
      solicitante: r.solicitante,
      setor: r.setor,
      tecnico: r.tecnico,
      dataAbertura: r.data_abertura,
      dataPrimeiroAtendimento: r.data_primeiro_atendimento,
      dataResolucao: r.data_resolucao,
      avaliacao: r.avaliacao,
      consideracoesTecnicas: consideracoes,
    };
  }

  consideracoesDe(ids) {
    const mapa = new Map(ids.map((id) => [id, []]));
    if (!ids.length) return mapa;
    const linhas = this.db
      .prepare(
        `SELECT ct.chamado_id, ct.data, ct.texto, t.nome AS tecnico
           FROM consideracoes_tecnicas ct LEFT JOIN tecnicos t ON t.id = ct.tecnico_id
          WHERE ct.chamado_id IN (SELECT value FROM json_each(?))
          ORDER BY ct.data, ct.id`,
      )
      .all(JSON.stringify(ids));
    for (const l of linhas) mapa.get(l.chamado_id).push({ data: l.data, tecnico: l.tecnico, texto: l.texto });
    return mapa;
  }

  /** Todos os chamados que atendem aos filtros (objetos completos). */
  listar(filtros = {}) {
    const w = this.where(filtros);
    const linhas = this.db.prepare(`SELECT * FROM vw_chamados ${w.sql} ORDER BY id`).all(w.params);
    const cons = this.consideracoesDe(linhas.map((l) => l.id));
    return linhas.map((l) => this.linhaParaChamado(l, cons.get(l.id)));
  }

  buscar(id) {
    const linha = this.db.prepare('SELECT * FROM vw_chamados WHERE id = ?').get(id);
    if (!linha) return null;
    return this.linhaParaChamado(linha, this.consideracoesDe([id]).get(id));
  }

  /** Página de chamados ordenada (ORDER BY / LIMIT / OFFSET no banco). */
  paginar(filtros, { pagina, limite, ordenarPor, ordem }) {
    const w = this.where(filtros);
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM vw_chamados ${w.sql}`).get(w.params).n;
    const direcao = ordem === 'asc' ? 'ASC' : 'DESC';
    const linhas = this.db
      .prepare(`SELECT * FROM vw_chamados ${w.sql} ORDER BY ${ORDENACAO[ordenarPor]} ${direcao}, id DESC LIMIT @limite OFFSET @offset`)
      .all({ ...w.params, limite, offset: (pagina - 1) * limite });
    const cons = this.consideracoesDe(linhas.map((l) => l.id));
    return { total, itens: linhas.map((l) => this.linhaParaChamado(l, cons.get(l.id))) };
  }

  // ---------- Agregações do dashboard (RF01–RF04) ----------

  /** Totais e médias para os indicadores gerais. */
  resumo(filtros, agora, opcoes) {
    const w = this.where(filtros, opcoes);
    return this.db
      .prepare(
        `SELECT COUNT(*)                                             AS total,
                COALESCE(SUM(grupo = 'em_aberto'), 0)                AS emAberto,
                COALESCE(SUM(${SQL_ATENDIDO}), 0)                    AS atendidos,
                COALESCE(SUM(grupo = 'cancelado'), 0)                AS cancelados,
                AVG(horas_primeiro_atendimento)                      AS mediaPrimeiroAtendimento,
                AVG(horas_resolucao)                                 AS mediaResolucao,
                COALESCE(SUM(${SQL_NO_PRAZO}), 0)                    AS noPrazo,
                AVG(avaliacao)                                       AS satisfacao,
                COUNT(avaliacao)                                     AS avaliacoes,
                COALESCE(SUM(grupo = 'em_aberto' AND prioridade = 'critica'), 0) AS criticosEmAberto,
                COALESCE(SUM(${SQL_ATRASADO}), 0)                    AS atrasados,
                COALESCE(SUM(grupo = 'em_aberto' AND tecnico_id IS NULL), 0)     AS semTecnico
           FROM vw_chamados ${w.sql}`,
      )
      .get({ ...w.params, agora: new Date(agora).toISOString() });
  }

  porStatus(filtros) {
    const w = this.where(filtros);
    return this.db
      .prepare(
        `SELECT s.codigo AS status, s.rotulo, s.grupo, COUNT(c.id) AS quantidade
           FROM status s LEFT JOIN (SELECT id, status FROM vw_chamados ${w.sql}) c ON c.status = s.codigo
          GROUP BY s.codigo ORDER BY s.ordem`,
      )
      .all(w.params);
  }

  porPrioridade(filtros, agora) {
    const w = this.where(filtros);
    return this.db
      .prepare(
        `SELECT p.codigo AS prioridade, p.rotulo, p.sla_horas AS slaHoras,
                COUNT(c.id) AS quantidade,
                COALESCE(SUM(c.grupo = 'em_aberto'), 0) AS emAberto,
                COALESCE(SUM(c.atrasado), 0) AS atrasados
           FROM prioridades p
           LEFT JOIN (SELECT id, prioridade, grupo, (${SQL_ATRASADO}) AS atrasado FROM vw_chamados ${w.sql}) c ON c.prioridade = p.codigo
          GROUP BY p.codigo ORDER BY p.peso`,
      )
      .all({ ...w.params, agora: new Date(agora).toISOString() });
  }

  totalAtendidos(filtros) {
    const w = this.where(filtros);
    return this.db.prepare(`SELECT COUNT(*) AS n FROM vw_chamados ${w.sql ? w.sql + ' AND' : 'WHERE'} ${SQL_ATENDIDO}`).get(w.params).n;
  }

  porTipo(filtros, ordenarPor) {
    const w = this.where(filtros);
    const ordem = { atendidos: 'atendidos', total: 'total', emAberto: 'emAberto', tempoMedio: 'tempoMedio' }[ordenarPor];
    return this.db
      .prepare(
        `SELECT tipo,
                COUNT(*)                           AS total,
                COALESCE(SUM(${SQL_ATENDIDO}), 0)  AS atendidos,
                COALESCE(SUM(grupo = 'em_aberto'), 0) AS emAberto,
                AVG(horas_resolucao)               AS tempoMedio,
                COALESCE(SUM(${SQL_NO_PRAZO}), 0)  AS noPrazo
           FROM vw_chamados ${w.sql}
          GROUP BY tipo_id
          ORDER BY ${ordem} DESC, tipo COLLATE NOCASE ASC`,
      )
      .all(w.params);
  }

  porTecnico(filtros) {
    const w = this.where(filtros, { extra: ['tecnico_id IS NOT NULL'] });
    return this.db
      .prepare(
        `SELECT tecnico,
                COALESCE(SUM(${SQL_ATENDIDO}), 0)     AS atendidos,
                COALESCE(SUM(grupo = 'em_aberto'), 0) AS emAndamento,
                AVG(horas_resolucao)                  AS tempoMedio,
                COALESCE(SUM(${SQL_NO_PRAZO}), 0)     AS noPrazo,
                AVG(avaliacao)                        AS satisfacao
           FROM vw_chamados ${w.sql}
          GROUP BY tecnico_id
          ORDER BY atendidos DESC, tecnico COLLATE NOCASE ASC`,
      )
      .all(w.params);
  }

  /** Eventos para a série temporal (RF02): datas de abertura e de resolução dos atendidos. */
  eventosSerie(filtros) {
    const w = this.where(filtros, { ignorarPeriodo: true });
    return this.db
      .prepare(
        `SELECT data_abertura AS abertura,
                CASE WHEN ${SQL_ATENDIDO} THEN data_resolucao END AS resolucao,
                COALESCE(${SQL_NO_PRAZO}, 0) AS noPrazo
           FROM vw_chamados ${w.sql}`,
      )
      .all(w.params);
  }

  opcoesFiltro() {
    const nomes = (tabela) => this.db.prepare(`SELECT nome FROM ${tabela} ORDER BY id`).all().map((r) => r.nome);
    const tecnicos = this.db.prepare('SELECT DISTINCT tecnico FROM vw_chamados WHERE tecnico IS NOT NULL').all().map((r) => r.tecnico);
    const periodo = this.db.prepare('SELECT MIN(data_abertura) AS inicio, MAX(data_abertura) AS fim FROM chamados').get();
    return {
      tipos: nomes('tipos'),
      setores: nomes('setores'),
      tecnicos: tecnicos.sort((a, b) => a.localeCompare(b, 'pt-BR')),
      periodo,
    };
  }

  // ---------- Gravação (fluxo de atendimento) ----------

  /** Abre um chamado; id e protocolo são gerados pelo banco. */
  criar(dados) {
    const id = this.db.transaction(() => {
      const novoId = this.inserirLinha({ ...dados, id: null, protocolo: `TMP-${Date.now()}-${Math.random()}` });
      const protocolo = `TD-${String(novoId).padStart(6, '0')}`;
      this.db.prepare('UPDATE chamados SET protocolo = ?, busca = ? WHERE id = ?').run(protocolo, textoBusca({ ...dados, protocolo }), novoId);
      return novoId;
    })();
    this.atualizadoEm = new Date().toISOString();
    return this.buscar(id);
  }

  /** Persiste o estado do chamado e, se houver, uma nova consideração técnica. */
  atualizar(chamado, novaConsideracao = null) {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE chamados SET status = @status, tecnico_id = @tecnicoId, data_primeiro_atendimento = @dataPrimeiroAtendimento,
                  data_resolucao = @dataResolucao, avaliacao = @avaliacao WHERE id = @id`,
        )
        .run({
          id: chamado.id,
          status: chamado.status,
          tecnicoId: this.idPorNome('tecnicos', chamado.tecnico),
          dataPrimeiroAtendimento: chamado.dataPrimeiroAtendimento,
          dataResolucao: chamado.dataResolucao,
          avaliacao: chamado.avaliacao,
        });
      if (novaConsideracao) {
        this.db
          .prepare('INSERT INTO consideracoes_tecnicas (chamado_id, tecnico_id, data, texto) VALUES (?, ?, ?, ?)')
          .run(chamado.id, this.idPorNome('tecnicos', novaConsideracao.tecnico), novaConsideracao.data, novaConsideracao.texto);
      }
    })();
    this.atualizadoEm = new Date().toISOString();
    return this.buscar(chamado.id);
  }
}

module.exports = { ChamadosStore };
