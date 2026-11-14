// Recria o banco com a base de exemplo: npm run seed -- --quantidade 800 --dias 365
// Atenção: apaga o banco atual (data/thindesk.db).
const fs = require('fs');
const path = require('path');
const { gerarChamados } = require('../src/data/gerador');
const { ChamadosStore } = require('../src/data/store');

const args = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? Number(args[i + 1]) : padrao;
};

const arquivo = process.env.DB_ARQUIVO || path.join(__dirname, '..', 'data', 'thindesk.db');
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });

const store = new ChamadosStore({
  arquivo,
  dados: gerarChamados({ quantidade: arg('quantidade', 650), dias: arg('dias', 180) }),
  origem: 'npm run seed',
});
const q = store.ultimaImportacao();
console.log(`Banco recriado em ${arquivo}: ${q.validos} chamados válidos, ${q.corrigidos} corrigidos, ${q.descartados} descartados.`);
store.fechar();
