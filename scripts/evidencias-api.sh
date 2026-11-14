#!/usr/bin/env bash
# Executa requisições reais contra a API em execução e registra requisição + resposta.
# Uso: npm start (em outro terminal) e depois: bash scripts/evidencias-api.sh > docs/evidencias/requisicoes-api.txt
BASE="${BASE:-http://localhost:3000/api/v1}"

req() {
  local metodo="$1" caminho="$2" corpo="$3"
  echo "================================================================"
  echo "$metodo $caminho"
  [ -n "$corpo" ] && echo "Body: $corpo"
  echo "----------------------------------------------------------------"
  if [ -n "$corpo" ]; then
    curl -s -w '\nHTTP %{http_code}\n' -X "$metodo" -H 'Content-Type: application/json' -d "$corpo" "$BASE$caminho"
  else
    curl -s -w '\nHTTP %{http_code}\n' -X "$metodo" "$BASE$caminho"
  fi
  echo
}

echo "Evidências de requisições à API Thindesk — $(date '+%d/%m/%Y %H:%M:%S')"
echo

req GET "/saude"
req GET "/opcoes-filtro"
req GET "/dashboard/indicadores?dataInicio=2026-10-12&dataFim=2026-11-10"
req GET "/dashboard/periodo?dataInicio=2026-11-04&dataFim=2026-11-10&agrupamento=dia"
req GET "/dashboard/status?tipo=Rede"
req GET "/dashboard/tipos?limite=3"
req GET "/dashboard/tecnicos?dataInicio=2026-10-12"
req GET "/chamados?limite=2&status=em_andamento&ordenarPor=prioridade"
req GET "/qualidade-dados"

# Importação de lote externo com tratamento de dados (RF07)
req POST "/dados/importar" '[{"id":9001,"titulo":"Importado do legado","tipo":"TELEFONIA","prioridade":"Crítica","status":"Aberto","solicitante":"Sistema legado","setor":" comercial","dataAbertura":"2026-11-10T13:00:00Z"},{"id":9002,"titulo":"Sem data","tipo":"Rede","prioridade":"media","status":"aberto","dataAbertura":"amanhã"}]'
req POST "/dados/importar" '{"id":1}'

# Fluxo completo de atendimento
CORPO='{"titulo":"Impressora do RH offline","tipo":"impressoras","prioridade":"alta","solicitante":"Larissa Rocha","setor":"rh"}'
NOVO=$(curl -s -i -X POST -H 'Content-Type: application/json' -d "$CORPO" "$BASE/chamados")
ID=$(echo "$NOVO" | tail -1 | sed -E 's/.*"id":([0-9]+).*/\1/')
echo "================================================================"
echo "POST /chamados"
echo "Body: $CORPO"
echo "----------------------------------------------------------------"
echo "$NOVO" | grep -iE '^location:' | tr -d '\r'
echo "$NOVO" | tail -1
echo "$NOVO" | head -1 | tr -d '\r' | sed -E 's#HTTP/1.1 ([0-9]+).*#HTTP \1#'
echo
req PATCH "/chamados/$ID" '{"status":"em_andamento"}'
req PATCH "/chamados/$ID" '{"status":"em_andamento","tecnico":"Ana Ribeiro","consideracao":"Impressora sem IP; verificando DHCP."}'
req PATCH "/chamados/$ID" '{"status":"resolvido"}'
req PATCH "/chamados/$ID" '{"status":"resolvido","consideracao":"Reserva de IP criada no DHCP e fila recriada."}'
req PATCH "/chamados/$ID" '{"status":"fechado","avaliacao":5}'
req PATCH "/chamados/$ID" '{"consideracao":"tentativa após fechamento"}'

# Erros
req GET "/dashboard/indicadores?dataInicio=2026-11-10&dataFim=2026-11-01&status=pendente"
req GET "/dashboard/periodo?agrupamento=ano"
req GET "/chamados/99999"
req GET "/chamados/abc"
req POST "/chamados" '{"titulo":"x"}'
req POST "/chamados" '{"titulo": '
req GET "/rota-inexistente"
