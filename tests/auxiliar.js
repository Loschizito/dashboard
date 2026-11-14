// Infraestrutura de teste: sobe a API em porta aleatória com dados e relógio controlados.
const { criarApp } = require('../src/app');
const { ChamadosStore } = require('../src/data/store');

// "Agora" fixo: 10/11/2026 12:00 em Brasília
const AGORA = new Date('2026-11-10T15:00:00Z');

// Base pequena com valores conhecidos para conferir os cálculos manualmente.
function dadosFixos() {
  return [
    { id: 1, titulo: 'Sem internet no 3º andar', tipo: 'Rede', prioridade: 'critica', status: 'aberto', solicitante: 'João Silva', setor: 'Financeiro', tecnico: null, dataAbertura: '2026-11-10T12:00:00Z' },
    { id: 2, titulo: 'Monitor sem sinal', tipo: 'Hardware', prioridade: 'alta', status: 'em_andamento', solicitante: 'Maria Rocha', setor: 'RH', tecnico: 'Ana Ribeiro', dataAbertura: '2026-11-09T12:00:00Z', dataPrimeiroAtendimento: '2026-11-09T13:00:00Z', consideracoesTecnicas: [{ data: '2026-11-09T13:00:00Z', tecnico: 'Ana Ribeiro', texto: 'Cabo em teste.' }] },
    { id: 3, titulo: 'Wi-Fi instável', tipo: 'Rede', prioridade: 'media', status: 'resolvido', solicitante: 'Pedro Gomes', setor: 'Comercial', tecnico: 'Carlos Mendes', dataAbertura: '2026-11-05T12:00:00Z', dataPrimeiroAtendimento: '2026-11-05T14:00:00Z', dataResolucao: '2026-11-06T00:00:00Z' },
    { id: 4, titulo: 'VPN não conecta', tipo: 'Rede', prioridade: 'baixa', status: 'fechado', solicitante: 'Luana Alves', setor: 'Comercial', tecnico: 'Ana Ribeiro', dataAbertura: '2026-11-01T12:00:00Z', dataPrimeiroAtendimento: '2026-11-01T16:00:00Z', dataResolucao: '2026-11-05T12:00:00Z', avaliacao: 3 },
    { id: 5, titulo: 'Erro ao abrir o Excel', tipo: 'Software', prioridade: 'alta', status: 'fechado', solicitante: 'Bruno Lima', setor: 'Diretoria', tecnico: 'Carlos Mendes', dataAbertura: '2026-10-20T12:00:00Z', dataPrimeiroAtendimento: '2026-10-20T13:00:00Z', dataResolucao: '2026-10-20T16:00:00Z', avaliacao: 5 },
    { id: 6, titulo: 'Impressora não imprime', tipo: 'Impressoras', prioridade: 'baixa', status: 'cancelado', solicitante: 'Camila Rocha', setor: 'Logística', tecnico: null, dataAbertura: '2026-10-15T12:00:00Z' },
    // registro "sujo", recuperável pelo tratamento de dados
    { id: 7, titulo: '  Caixa de e-mail cheia ', tipo: ' e-mail ', prioridade: 'MÉDIA', status: 'Aberto', solicitante: 'Diego Araújo', setor: ' rh', tecnico: '', dataAbertura: '2026-11-08T12:00:00Z' },
    // registro irrecuperável: deve ser descartado
    { id: 8, titulo: 'Registro corrompido', tipo: 'Rede', prioridade: 'media', status: 'aberto', dataAbertura: '31/02/2026' },
  ];
}

async function iniciarServidor(dados = dadosFixos()) {
  const store = new ChamadosStore({ dados: JSON.parse(JSON.stringify(dados)) });
  const app = criarApp({ store, agora: () => new Date(AGORA) });
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function req(metodo, caminho, corpo, { bruto = false } = {}) {
    const opcoes = { method: metodo, headers: {} };
    if (corpo !== undefined) {
      opcoes.headers['Content-Type'] = 'application/json';
      opcoes.body = bruto ? corpo : JSON.stringify(corpo);
    }
    const r = await fetch(base + caminho, opcoes);
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* não-JSON */ }
    return { status: r.status, headers: r.headers, json, texto };
  }

  return {
    store,
    get: (c) => req('GET', c),
    post: (c, corpo, o) => req('POST', c, corpo, o),
    patch: (c, corpo, o) => req('PATCH', c, corpo, o),
    fechar: () => new Promise((resolve) => servidor.close(resolve)),
  };
}

module.exports = { iniciarServidor, dadosFixos, AGORA };
