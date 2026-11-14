// Utilitários de data. A operação roda no fuso de Brasília (UTC-03:00, sem horário de verão),
// então dias/semanas/meses são calculados nesse fuso.
const HORA = 3600 * 1000;
const DIA = 24 * HORA;
const OFFSET_BR = -3 * HORA;
const OFFSET_TEXTO = '-03:00';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const pad = (n) => String(n).padStart(2, '0');

/** "2026-11-10" -> Date no início (ou fim) desse dia em Brasília; null se inválida. */
function parseDataLocal(texto, fimDoDia = false) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const [a, m, d] = texto.split('-').map(Number);
  const teste = new Date(Date.UTC(a, m - 1, d));
  if (teste.getUTCFullYear() !== a || teste.getUTCMonth() !== m - 1 || teste.getUTCDate() !== d) return null; // ex.: 2026-02-30
  const hora = fimDoDia ? 'T23:59:59.999' : 'T00:00:00.000';
  return new Date(`${texto}${hora}${OFFSET_TEXTO}`).getTime();
}

/** Converte instante (ms) em partes de data no fuso de Brasília. */
function partesLocais(ms) {
  const d = new Date(ms + OFFSET_BR);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth(), dia: d.getUTCDate(), semana: d.getUTCDay() };
}

const dataLocalIso = (ms) => {
  const p = partesLocais(ms);
  return `${p.ano}-${pad(p.mes + 1)}-${pad(p.dia)}`;
};

/** Início do balde (dia/semana/mes) que contém o instante, em ms. */
function inicioDoBalde(ms, agrupamento) {
  const p = partesLocais(ms);
  if (agrupamento === 'mes') return Date.UTC(p.ano, p.mes, 1) - OFFSET_BR;
  const inicioDia = Date.UTC(p.ano, p.mes, p.dia) - OFFSET_BR;
  if (agrupamento === 'semana') {
    const desdeSegunda = (p.semana + 6) % 7; // semana começa na segunda-feira
    return inicioDia - desdeSegunda * DIA;
  }
  return inicioDia;
}

function proximoBalde(ms, agrupamento) {
  if (agrupamento === 'mes') {
    const p = partesLocais(ms);
    return Date.UTC(p.ano, p.mes + 1, 1) - OFFSET_BR;
  }
  return ms + (agrupamento === 'semana' ? 7 : 1) * DIA;
}

function chaveDoBalde(ms, agrupamento) {
  const p = partesLocais(ms);
  return agrupamento === 'mes' ? `${p.ano}-${pad(p.mes + 1)}` : dataLocalIso(ms);
}

function rotuloDoBalde(ms, agrupamento) {
  const p = partesLocais(ms);
  if (agrupamento === 'mes') return `${MESES[p.mes]}/${p.ano}`;
  return `${pad(p.dia)}/${pad(p.mes + 1)}`;
}

const horasEntre = (inicioIso, fimIso) => (Date.parse(fimIso) - Date.parse(inicioIso)) / HORA;

module.exports = { HORA, DIA, parseDataLocal, dataLocalIso, inicioDoBalde, proximoBalde, chaveDoBalde, rotuloDoBalde, horasEntre };
