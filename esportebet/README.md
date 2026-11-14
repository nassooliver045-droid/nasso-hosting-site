# EsporteBet — central esportiva demonstrativa

Central de agenda e placares reais de futebol, alimentada pela API-Football (API-Sports).

## Competições
- Premier League (ID 39)
- La Liga (ID 140)
- Serie A italiana (ID 135)
- Bundesliga (ID 78)
- Ligue 1 (ID 61)
- Brasileirão Série A (ID 71)
- Competições internacionais de seleções e amistosos, conforme a classificação e cobertura retornadas pelo provedor.

## Configuração local
- Node.js 20+
- Defina a variável de ambiente `API_FOOTBALL_KEY` com uma chave válida da API-Football.
- Opcional: `API_CACHE_SECONDS` define o cache em segundos (padrão: 900).
- Execute `npm start`.

## Render
No serviço `esportebet-demo`, configure em Environment:
- `API_FOOTBALL_KEY`: sua chave privada do painel API-Sports.
- `API_CACHE_SECONDS`: use 900 para reduzir consumo no plano gratuito; 60 para atualização mais frequente com quota suficiente.

A chave é usada somente no servidor e nunca enviada ao navegador. Não a coloque no código-fonte nem em commits.

## Limites e conformidade
Esta versão apresenta calendário, status e placares. Não apresenta odds, não aceita apostas, não possui carteira, depósitos ou saques. Funcionalidades relacionadas a odds e apostas permanecem desativadas e dependem de revisão jurídica e autorização aplicável.

## API
- `GET /api/health`: verifica se a chave foi configurada.
- `GET /api/matches?date=AAAA-MM-DD`: partidas filtradas para as competições suportadas.
- O endpoint consulta os jogos do dia em `America/Sao_Paulo` e aplica cache no servidor.
