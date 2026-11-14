const path = require('path');
const { criarApp } = require('./app');
const { ChamadosStore } = require('./data/store');

const porta = Number(process.env.PORT) || 3000;
const arquivo = process.env.DB_ARQUIVO || path.join(__dirname, '..', 'data', 'thindesk.db');

const store = new ChamadosStore({ arquivo });
const q = store.ultimaImportacao();
console.log(`Banco SQLite: ${arquivo} (${store.contar()} chamados)`);
console.log(`Última importação (${q.origem}): ${q.lidos} lidos, ${q.validos} válidos, ${q.corrigidos} corrigidos, ${q.descartados} descartados.`);

const servidor = criarApp({ store }).listen(porta, () => {
  console.log(`Thindesk Dashboard: http://localhost:${porta}`);
  console.log(`API:                http://localhost:${porta}/api/v1/saude`);
});
servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`A porta ${porta} já está em uso. Encerre o outro processo ou use outra porta: PORT=3001 npm start`);
  else console.error(e);
  store.fechar();
  process.exit(1);
});

// fecha o banco de forma limpa ao encerrar
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    servidor.close();
    store.fechar();
    process.exit(0);
  });
}
