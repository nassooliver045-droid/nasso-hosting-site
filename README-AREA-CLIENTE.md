# Nasso Hosting — Área do cliente

## Arquitetura
- Site público: serviço estático existente no Render.
- Portal: `/area.html` no mesmo site.
- API: serviço Node/Express separado.
- Banco: PostgreSQL.
- Painel: integração server-side com Pterodactyl Client API.

## Variáveis secretas da API
- `DATABASE_URL`: fornecida pelo PostgreSQL do Render.
- `JWT_SECRET`: segredo longo e aleatório.
- `ADMIN_EMAIL` e `ADMIN_PASSWORD`: criam o primeiro administrador na primeira inicialização.
- `PTERODACTYL_URL`: URL base do painel, sem barra final.
- `PTERODACTYL_CLIENT_API_KEY`: chave Client API guardada somente no backend.
- `FRONTEND_URL`: URL do site público.

Nunca coloque chaves Pterodactyl, JWT ou senhas no HTML/JavaScript do navegador.

## Integração Pterodactyl
O backend envia comandos para `POST /api/client/servers/{identifier}/power`. A chave Client API configurada deve ter acesso aos servidores cadastrados. O identificador salvo em cada hospedagem é validado no banco junto ao ID do cliente autenticado; o navegador não pode escolher livremente o servidor.

## Primeiro administrador
Ao iniciar, a API cria o administrador informado em `ADMIN_EMAIL` e `ADMIN_PASSWORD`, se o e-mail ainda não existir. Defina uma senha forte no painel do Render. O cadastro público sempre cria usuários comuns.

## Banco gratuito
O PostgreSQL gratuito do Render é temporário e expira após o período anunciado pela plataforma (30 dias na condição atual desta configuração). Use apenas para testes; antes de receber dados reais de clientes, migre para um banco persistente e faça backup.

## Rotas principais
- `POST /api/auth/register`, `POST /api/auth/login`
- `GET /api/me`, `GET /api/hostings`, `GET /api/payments`
- `GET/POST /api/tickets`
- `POST /api/hostings/:id/power`
- `/api/admin/*` para administração (role admin)
