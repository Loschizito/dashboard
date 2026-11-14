// Gera uma massa de chamados realista e determinística (mesma semente => mesmos dados),
// distribuída nos últimos N dias a partir de uma data de referência.
const { SLA_HORAS, TECNICOS, SETORES, STATUS } = require('../dominio');
const { inicioDoBalde } = require('../services/tempo');

const HORA = 3600 * 1000;
const DIA = 24 * HORA;

function prng(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TITULOS = {
  Hardware: ['Computador não liga', 'Monitor sem sinal', 'Teclado com teclas falhando', 'Notebook superaquecendo'],
  Software: ['Erro ao abrir o Excel', 'Instalação de software solicitada', 'Atualização do Windows travada', 'Antivírus bloqueando aplicação'],
  Rede: ['Sem acesso à internet', 'Lentidão na rede', 'Wi-Fi instável na sala de reunião', 'VPN não conecta'],
  'Acesso e Senhas': ['Reset de senha de rede', 'Liberação de acesso a pasta compartilhada', 'Usuário bloqueado', 'Criação de usuário para novo colaborador'],
  Impressoras: ['Impressora não imprime', 'Atolamento de papel recorrente', 'Configurar impressora no notebook', 'Scanner não envia para e-mail'],
  'E-mail': ['Não recebe e-mails externos', 'Caixa de e-mail cheia', 'Configurar e-mail no celular', 'E-mail caindo no spam'],
  'Sistema ERP': ['Erro ao emitir nota fiscal', 'Relatório de vendas não gera', 'Lentidão no ERP', 'Permissão de módulo financeiro'],
  Telefonia: ['Ramal mudo', 'Configurar softphone', 'Transferência de ramal não funciona'],
};

const CONSIDERACOES = {
  Hardware: ['Fonte substituída, equipamento testado.', 'Cabo de vídeo trocado.', 'Limpeza interna e troca de pasta térmica.'],
  Software: ['Reinstalação do pacote realizada.', 'Atualização aplicada manualmente.', 'Exceção adicionada na política do antivírus.'],
  Rede: ['Porta do switch reconfigurada.', 'Access point reiniciado e canal alterado.', 'Certificado da VPN renovado.'],
  'Acesso e Senhas': ['Senha redefinida e usuário orientado.', 'Permissão concedida após aprovação do gestor.', 'Conta desbloqueada no AD.'],
  Impressoras: ['Driver reinstalado.', 'Rolete de tração substituído.', 'Configuração SMTP do scanner corrigida.'],
  'E-mail': ['Regra de transporte ajustada.', 'Arquivamento configurado para liberar espaço.', 'Registro SPF revisado.'],
  'Sistema ERP': ['Chamado escalado ao fornecedor do ERP.', 'Índice do banco reconstruído.', 'Perfil de acesso atualizado.'],
  Telefonia: ['Ramal reprovisionado na central.', 'Softphone configurado e testado.'],
};

const NOMES = ['João', 'Maria', 'Pedro', 'Luana', 'Bruno', 'Camila', 'Felipe', 'Larissa', 'Diego', 'Renata', 'Thiago', 'Beatriz', 'Lucas', 'Fernanda', 'Gustavo', 'Aline'];
const SOBRENOMES = ['Silva', 'Santos', 'Oliveira', 'Pereira', 'Almeida', 'Rocha', 'Barbosa', 'Gomes', 'Martins', 'Araújo'];

// pesos geram um ranking de tipos não uniforme
const PESO_TIPOS = { Hardware: 14, Software: 18, Rede: 12, 'Acesso e Senhas': 22, Impressoras: 10, 'E-mail': 9, 'Sistema ERP': 11, Telefonia: 4 };
const PESO_PRIORIDADE = { baixa: 30, media: 42, alta: 20, critica: 8 };

function escolherPonderado(rand, pesos) {
  const total = Object.values(pesos).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const [chave, peso] of Object.entries(pesos)) {
    r -= peso;
    if (r < 0) return chave;
  }
  return Object.keys(pesos)[0];
}

function gerarChamados({ quantidade = 650, dias = 180, referencia = new Date(), semente = 2026, comRegistrosSujos = true } = {}) {
  const rand = prng(semente);
  const pick = (lista) => lista[Math.floor(rand() * lista.length)];
  const agora = referencia.getTime();
  const hojeBr = inicioDoBalde(agora, 'dia'); // 00:00 de hoje em Brasília
  const chamados = [];

  for (let i = 0; i < quantidade; i++) {
    // densidade linear: chamados recentes ~2x mais frequentes que os mais antigos (crescimento da operação);
    // horário comercial de Brasília (08h-18h). Horários ainda no futuro são sorteados de novo.
    let abertura;
    do {
      const diasAtras = Math.floor(dias * (1 - Math.sqrt(1 - rand())));
      abertura = hojeBr - diasAtras * DIA + (8 + rand() * 10) * HORA;
    } while (abertura > agora);

    const tipo = escolherPonderado(rand, PESO_TIPOS);
    const prioridade = escolherPonderado(rand, PESO_PRIORIDADE);
    const sla = SLA_HORAS[prioridade];
    const idadeHoras = (agora - abertura) / HORA;

    // a chance de já ter sido atendido cresce com a idade do chamado
    const chanceResolvido = Math.min(0.95, idadeHoras / (sla * 5));
    const r = rand();
    let status;
    if (r < 0.04) status = 'cancelado';
    else if (r < 0.04 + chanceResolvido) status = rand() < (idadeHoras > 24 * 7 ? 0.85 : 0.4) ? 'fechado' : 'resolvido';
    else status = pick(['aberto', 'em_andamento', 'em_andamento', 'aguardando_usuario']);

    const tecnico = status === 'aberto' || (status === 'cancelado' && rand() < 0.5) ? null : pick(TECNICOS);
    let primeiroAtendimento = null;
    let resolucao = null;
    if (tecnico) {
      primeiroAtendimento = abertura + Math.min(idadeHoras * 0.5, 0.1 + rand() * sla * 0.4) * HORA;
    }
    if (status === 'resolvido' || status === 'fechado') {
      // ~82% dentro do SLA, cauda longa fora dele
      const fator = rand() < 0.82 ? 0.15 + rand() * 0.8 : 1.05 + rand() * 2.5;
      const horas = Math.min(Math.max(0.25, sla * fator), idadeHoras * 0.95);
      resolucao = abertura + horas * HORA;
      if (primeiroAtendimento > resolucao) primeiroAtendimento = abertura + (resolucao - abertura) / 3;
    }

    const consideracoes = [];
    if (primeiroAtendimento) {
      consideracoes.push({ data: new Date(primeiroAtendimento).toISOString(), tecnico, texto: 'Chamado triado e em análise.' });
    }
    if (status === 'aguardando_usuario') {
      consideracoes.push({ data: new Date(primeiroAtendimento + 60 * 1000).toISOString(), tecnico, texto: 'Aguardando retorno do usuário com mais informações.' });
    }
    if (resolucao) {
      consideracoes.push({ data: new Date(resolucao).toISOString(), tecnico, texto: pick(CONSIDERACOES[tipo]) });
    }

    const foraDoSla = resolucao && resolucao - abertura > sla * HORA;
    chamados.push({
      id: 0,
      protocolo: '',
      titulo: pick(TITULOS[tipo]),
      descricao: 'Chamado aberto pelo portal Thindesk.',
      tipo,
      prioridade,
      status,
      solicitante: `${pick(NOMES)} ${pick(SOBRENOMES)}`,
      setor: pick(SETORES),
      tecnico,
      dataAbertura: new Date(abertura).toISOString(),
      dataPrimeiroAtendimento: primeiroAtendimento ? new Date(primeiroAtendimento).toISOString() : null,
      dataResolucao: resolucao ? new Date(resolucao).toISOString() : null,
      avaliacao: status === 'fechado' && rand() < 0.75 ? Math.max(1, Math.min(5, Math.round(3.6 + rand() * 1.8 - (foraDoSla ? 1.4 : 0)))) : null,
      consideracoesTecnicas: consideracoes,
    });
  }

  // ordem cronológica => ids e protocolos sequenciais
  chamados.sort((a, b) => a.dataAbertura.localeCompare(b.dataAbertura));
  chamados.forEach((c, idx) => {
    c.id = idx + 1;
    c.protocolo = `TD-${String(idx + 1).padStart(6, '0')}`;
  });

  if (comRegistrosSujos) {
    // Problemas típicos de integração, para exercitar o tratamento de dados (RF07)
    const n = chamados.length;
    chamados[n - 5].tipo = '  rede '; // caixa/espaços -> "Rede"
    chamados[n - 8].prioridade = 'ALTA'; // caixa -> "alta"
    chamados[n - 12].status = STATUS[chamados[n - 12].status].toUpperCase(); // rótulo em vez do código
    chamados[n - 15].setor = ' financeiro'; // espaços/caixa -> "Financeiro"
    chamados.push({ id: n + 1, protocolo: `TD-${String(n + 1).padStart(6, '0')}`, titulo: 'Registro corrompido', tipo: 'Rede', prioridade: 'media', status: 'aberto', dataAbertura: 'data-invalida' });
    chamados.push({ id: n + 2, protocolo: `TD-${String(n + 2).padStart(6, '0')}`, titulo: 'Tipo desconhecido', tipo: 'Cafeteira', prioridade: 'baixa', status: 'aberto', dataAbertura: new Date(agora - DIA).toISOString() });
  }

  return chamados;
}

module.exports = { gerarChamados, prng };
