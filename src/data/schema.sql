-- Esquema do banco de dados do Thindesk (SQLite).
-- Datas armazenadas como TEXT em ISO 8601 UTC ("2026-11-10T15:00:00.000Z"),
-- o que mantém a ordenação lexicográfica igual à cronológica e é aceito pelas funções de data do SQLite.

PRAGMA foreign_keys = ON;

-- ---------- Tabelas de domínio ----------

CREATE TABLE IF NOT EXISTS status (
  codigo  TEXT    PRIMARY KEY,
  rotulo  TEXT    NOT NULL,
  grupo   TEXT    NOT NULL CHECK (grupo IN ('em_aberto', 'atendido', 'cancelado')),
  ordem   INTEGER NOT NULL UNIQUE,
  final   INTEGER NOT NULL DEFAULT 0 CHECK (final IN (0, 1))
);

CREATE TABLE IF NOT EXISTS prioridades (
  codigo     TEXT    PRIMARY KEY,
  rotulo     TEXT    NOT NULL,
  sla_horas  INTEGER NOT NULL CHECK (sla_horas > 0),
  peso       INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tipos (
  id    INTEGER PRIMARY KEY,
  nome  TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS setores (
  id    INTEGER PRIMARY KEY,
  nome  TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tecnicos (
  id    INTEGER PRIMARY KEY,
  nome  TEXT    NOT NULL UNIQUE
);

-- ---------- Tabelas principais ----------

CREATE TABLE IF NOT EXISTS chamados (
  id                         INTEGER PRIMARY KEY,
  protocolo                  TEXT    NOT NULL UNIQUE,
  titulo                     TEXT    NOT NULL,
  descricao                  TEXT,
  tipo_id                    INTEGER NOT NULL REFERENCES tipos (id),
  prioridade                 TEXT    NOT NULL REFERENCES prioridades (codigo),
  status                     TEXT    NOT NULL REFERENCES status (codigo),
  solicitante                TEXT,
  setor_id                   INTEGER REFERENCES setores (id),
  tecnico_id                 INTEGER REFERENCES tecnicos (id),
  data_abertura              TEXT    NOT NULL,
  data_primeiro_atendimento  TEXT,
  data_resolucao             TEXT,
  avaliacao                  INTEGER CHECK (avaliacao BETWEEN 1 AND 5),
  busca                      TEXT    NOT NULL DEFAULT '', -- texto normalizado (sem acento/caixa) para a busca livre
  CHECK (data_resolucao IS NULL OR data_resolucao >= data_abertura),
  CHECK (data_primeiro_atendimento IS NULL OR data_primeiro_atendimento >= data_abertura)
);

CREATE INDEX IF NOT EXISTS idx_chamados_abertura  ON chamados (data_abertura);
CREATE INDEX IF NOT EXISTS idx_chamados_resolucao ON chamados (data_resolucao);
CREATE INDEX IF NOT EXISTS idx_chamados_status    ON chamados (status);
CREATE INDEX IF NOT EXISTS idx_chamados_tipo      ON chamados (tipo_id);
CREATE INDEX IF NOT EXISTS idx_chamados_tecnico   ON chamados (tecnico_id);

CREATE TABLE IF NOT EXISTS consideracoes_tecnicas (
  id          INTEGER PRIMARY KEY,
  chamado_id  INTEGER NOT NULL REFERENCES chamados (id) ON DELETE CASCADE,
  tecnico_id  INTEGER REFERENCES tecnicos (id),
  data        TEXT    NOT NULL,
  texto       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consideracoes_chamado ON consideracoes_tecnicas (chamado_id, data);

-- Registro de cada carga/importação de dados e do tratamento aplicado (RF07)
CREATE TABLE IF NOT EXISTS importacoes (
  id           INTEGER PRIMARY KEY,
  data         TEXT    NOT NULL,
  origem       TEXT    NOT NULL,
  lidos        INTEGER NOT NULL,
  validos      INTEGER NOT NULL,
  corrigidos   INTEGER NOT NULL,
  descartados  INTEGER NOT NULL,
  ocorrencias  TEXT    NOT NULL DEFAULT '[]' -- JSON com os registros descartados e os motivos
);

-- ---------- Visão usada pelas consultas do dashboard ----------
-- Junta os nomes das tabelas de domínio e calcula os tempos em horas.

CREATE VIEW IF NOT EXISTS vw_chamados AS
SELECT
  c.*,
  t.nome   AS tipo,
  se.nome  AS setor,
  tc.nome  AS tecnico,
  st.rotulo AS status_rotulo,
  st.grupo,
  st.ordem AS status_ordem,
  p.rotulo AS prioridade_rotulo,
  p.sla_horas,
  p.peso   AS prioridade_peso,
  (julianday(c.data_primeiro_atendimento) - julianday(c.data_abertura)) * 24 AS horas_primeiro_atendimento,
  CASE WHEN st.grupo = 'atendido' AND c.data_resolucao IS NOT NULL
       THEN (julianday(c.data_resolucao) - julianday(c.data_abertura)) * 24 END AS horas_resolucao
FROM chamados c
JOIN tipos t         ON t.id = c.tipo_id
JOIN status st       ON st.codigo = c.status
JOIN prioridades p   ON p.codigo = c.prioridade
LEFT JOIN setores se ON se.id = c.setor_id
LEFT JOIN tecnicos tc ON tc.id = c.tecnico_id;
