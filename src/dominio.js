// Vocabulário do domínio Thindesk: enums, rótulos e regras de SLA.

const STATUS = {
  aberto: 'Aberto',
  em_andamento: 'Em andamento',
  aguardando_usuario: 'Aguardando usuário',
  resolvido: 'Resolvido',
  fechado: 'Fechado',
  cancelado: 'Cancelado',
};

// Agrupamentos de status usados pelos indicadores
const STATUS_EM_ABERTO = ['aberto', 'em_andamento', 'aguardando_usuario'];
const STATUS_ATENDIDOS = ['resolvido', 'fechado'];
const STATUS_FINAIS = ['fechado', 'cancelado'];

const PRIORIDADES = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
};

// Prazo de resolução (SLA) por prioridade, em horas
const SLA_HORAS = { critica: 4, alta: 8, media: 24, baixa: 72 };

const TIPOS = [
  'Hardware',
  'Software',
  'Rede',
  'Acesso e Senhas',
  'Impressoras',
  'E-mail',
  'Sistema ERP',
  'Telefonia',
];

const SETORES = ['Financeiro', 'RH', 'Comercial', 'Logística', 'Jurídico', 'Diretoria', 'Atendimento', 'Produção'];

const TECNICOS = ['Ana Ribeiro', 'Carlos Mendes', 'Juliana Costa', 'Marcos Tavares', 'Patrícia Lima', 'Rafael Souza'];

// Transições de status permitidas (regra de negócio do PATCH)
const TRANSICOES = {
  aberto: ['em_andamento', 'aguardando_usuario', 'cancelado'],
  em_andamento: ['aguardando_usuario', 'resolvido', 'cancelado'],
  aguardando_usuario: ['em_andamento', 'resolvido', 'cancelado'],
  resolvido: ['fechado', 'em_andamento'],
  fechado: [],
  cancelado: [],
};

module.exports = {
  STATUS,
  STATUS_EM_ABERTO,
  STATUS_ATENDIDOS,
  STATUS_FINAIS,
  PRIORIDADES,
  SLA_HORAS,
  TIPOS,
  SETORES,
  TECNICOS,
  TRANSICOES,
};
