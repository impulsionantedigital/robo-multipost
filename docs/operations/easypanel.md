# Instalação no Easypanel

Guia para subir o Robô MultiPost numa VPS com [Easypanel](https://easypanel.io), usando o arquivo [`docker-compose.easypanel.yaml`](../../docker-compose.easypanel.yaml).

## Requisitos

- VPS com **4 GB de RAM** ou mais e Easypanel instalado
- Subdomínio com registro **A** apontando para o IP da VPS

## O que sobe

| Serviço | Função |
|---|---|
| `postiz` | App (backend + frontend + orchestrator), porta interna 5000 |
| `postiz-postgres` | PostgreSQL 17 com pgvector (base de conhecimento da IA) |
| `postiz-redis` | Redis 7 |
| `temporal` + `temporal-postgresql` + `temporal-elasticsearch` | Motor de agendamentos |
| `temporal-ui` | Painel do Temporal (opcional, sem domínio por padrão) |

Diferenças para o `docker-compose.yaml`: sem `container_name` e sem `ports` (o Easypanel cuida do domínio), segredos via variáveis, volumes nomeados para todos os bancos, Temporal usando o dynamicconfig embutido na imagem e sem os containers de debug (`spotlight`, `temporal-admin-tools`).

## Passo a passo

1. **Create Project** no Easypanel.
2. **+ Service → Compose**, origem inline, e cole o conteúdo de `docker-compose.easypanel.yaml`.
3. Na aba **Environment**:

   ```
   DOMAIN=post.seudominio.com.br
   JWT_SECRET=
   ENCRYPTION_KEY=
   POSTGRES_PASSWORD=
   TEMPORAL_DB_PASSWORD=
   DISABLE_REGISTRATION=false
   APP_VERSION=0.5.6
   ```

   - `JWT_SECRET` e `ENCRYPTION_KEY`: `openssl rand -base64 32`
   - Senhas de banco: `openssl rand -hex 24` (sem caracteres especiais, pois entram na `DATABASE_URL`)
   - `DOMAIN` sem `https://` e sem barra final
   - Guarde o `ENCRYPTION_KEY`: trocá-lo invalida as credenciais criptografadas no banco

4. **Deploy**.
5. Aba **Domains**: host = seu domínio, HTTPS ligado, serviço `postiz`, porta `5000`.
6. **Deploy novamente** — no tipo Compose, o Easypanel só conecta o serviço à rede do proxy durante o deploy. Sem isso aparece "Service is not reachable".
7. Acesse o domínio, crie a conta admin e depois defina `DISABLE_REGISTRATION=true` + deploy.

Variáveis opcionais (`OPENAI_API_KEY`, `RESEND_API_KEY`, `FACEBOOK_APP_ID`, etc.) também vão na aba Environment. Credenciais das redes podem ser cadastradas pela interface em Configurações → Credenciais.

## Atualizar

Altere `APP_VERSION` e faça deploy. Os dados ficam nos volumes.

## Problemas comuns

| Sintoma | Causa | Correção |
|---|---|---|
| `dependency temporal-postgresql failed to start ... unhealthy` | `TEMPORAL_DB_PASSWORD` vazia/errada, ou primeira inicialização lenta | Confira a variável; se o banco foi criado com senha errada, apague o volume `temporal-postgres-data` (vazio na primeira instalação) e faça deploy |
| "Service is not reachable" | Domínio adicionado depois do deploy | Faça deploy de novo |
| Erro em `reconcileRefreshTokensCron` no log do app | App subiu antes do Temporal aceitar conexões | Reinicie o container `postiz` |
| Aviso "Memory overcommit" no Redis | Configuração do host | Na VPS: `echo 'vm.overcommit_memory = 1' >> /etc/sysctl.conf && sysctl vm.overcommit_memory=1` |

## Backup

Faça backup dos volumes `postiz-postgres-data` e `postiz-uploads` (backup de volume do Easypanel ou `pg_dump` agendado).
