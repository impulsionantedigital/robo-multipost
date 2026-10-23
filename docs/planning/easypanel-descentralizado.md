# Plano — Robô MultiPost descentralizado no Easypanel

**Status:** proposta (2026-10-23) · **Substitui:** o serviço Compose único de [`docs/operations/easypanel.md`](../operations/easypanel.md)

## Objetivo

Cada peça vira um serviço independente no Easypanel:

| Serviço Easypanel | Tipo | Fonte | Domínio |
|---|---|---|---|
| `postgres` | **Postgres nativo** | imagem `pgvector/pgvector:pg17` | — |
| `redis` | **Redis nativo** | padrão do Easypanel | — |
| `temporal` | App (Docker image) | `temporalio/auto-setup:1.28.1` | — |
| `temporal-ui` | App (Docker image) | `temporalio/ui:2.34.0` | opcional, com Basic Auth |
| `postiz` | App (**GitHub**) | `impulsionantedigital/robo-multipost`, branch `main`, `Dockerfile.dev` | `post.impulsionante.com.br` |

Um único Postgres guarda **três bancos**: `postiz` (app), `temporal` e `temporal_visibility` (Temporal). O Elasticsearch sai: o Temporal passa a usar o próprio Postgres para buscas (visibility SQL).

O `postiz` é buildado **pelo próprio Easypanel, na VPS**, a partir do código do GitHub. Com "Auto Deploy" ligado, cada push em `main` dispara build + deploy.

## Por que isso funciona (verificado no código)

- **pgvector:** a base de conhecimento usa `PgVector` do Mastra (`libraries/nestjs-libraries/src/chat/mastra.store.ts`), que precisa da extensão `vector`. A imagem `pgvector/pgvector:pg17` é o Postgres oficial + a extensão; o Postgres nativo do Easypanel aceita trocar a imagem ([docs](https://easypanel.io/docs/services/postgres)).
- **Temporal sem Elasticsearch:** o app registra 2 search attributes do tipo **Text** (`organizationId`, `postId` — `temporal/temporal.register.ts`, valor `1` = `INDEXED_VALUE_TYPE_TEXT`) e consulta `postId="..." AND ExecutionStatus="Running"` (`posts.service.ts`). Visibility SQL no Postgres 12+ suporta isso, **mas aceita no máximo 3 atributos Text por namespace**. A imagem `auto-setup` cria por padrão atributos de teste, dois deles Text (`CustomStringField`, `CustomTextField`) — sem `SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES=true` o backend trava no boot com `cannot have more than 3 search attribute of type Text`. Economiza ~0,5–1 GB de RAM.
- **Temporal no mesmo Postgres:** a imagem `auto-setup` cria sozinha os bancos `temporal` e `temporal_visibility` e aplica o schema. O usuário padrão do Postgres do Easypanel é superusuário, então tem permissão. `DB=postgres12` é o nome do driver (Postgres 12 ou mais novo), não a versão do servidor.
- **Configuração em runtime:** as variáveis do app (`MAIN_URL`, `NEXT_PUBLIC_BACKEND_URL` etc.) são lidas na execução — mudar variável não exige rebuild, só restart.

## Build na VPS — o que esperar

- `Dockerfile.dev` roda `pnpm install` + `pnpm run build` com `NODE_OPTIONS=--max-old-space-size=4096` (frontend Next.js + backend + orchestrator).
- **Pico de RAM do build: ~4–6 GB**, somado ao que já está rodando (~2 GB). **Tempo: ~15–30 min** por push, com CPU alta (o app fica mais lento durante o build).
- O `Dockerfile.dev` copia o repo inteiro antes do `pnpm install`, então quase todo push refaz a instalação de dependências.
- Enquanto o build roda, a versão anterior continua no ar; a troca só acontece no fim (downtime ~1–2 min: `prisma db push` + pm2 subindo 3 processos).
- **Swap é obrigatório** para não correr risco de o kernel matar o Postgres/Temporal por falta de memória (passo 0).

## ⚠️ Riscos que você precisa saber antes de ligar o deploy automático

1. **`prisma db push --accept-data-loss` roda em todo start** (CMD do `Dockerfile.dev` e script `pm2-run`). O projeto não usa migrations versionadas. Se um commit em `main` remover/renomear um campo do `schema.prisma`, os dados daquela coluna são **apagados automaticamente** no próximo deploy. Com deploy automático, `main` vira produção: revise mudanças de schema antes do merge e mantenha backup diário do Postgres. (Melhoria proposta: remover `--accept-data-loss` — ver "Melhorias futuras".)
2. **OOM durante o build:** sem swap, um build pode derrubar o banco. Com swap, o pior caso é o build ficar lento.
3. **Ordem de subida:** se o `postiz` subir antes do `temporal` aceitar conexões, a rotina `reconcileRefreshTokensCron` falha (só loga) e fica parada até o próximo restart. Após reiniciar a VPS inteira, reinicie o `postiz` por último.
4. **Branching do projeto:** o `CLAUDE.md` define `main` = desenvolvimento e `release` = produção. Com um único ambiente, o plano usa `main`. Para ter homologação depois, aponte o serviço para `release`.
5. **Workflows herdados:** `build-containers.yml` e `promote-release.yml` publicam em `ghcr.io/maiconramos/...` e vão **falhar** se alguém criar tag `v*` no seu repo. Não afetam o Easypanel; ajustar ou desativar depois.

## Passo a passo (executar na ordem)

### 0. Preparação

- [ ] **Swap na VPS** (terminal SSH; 8 GB é uma boa margem):

  ```bash
  fallocate -l 8G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' >> /etc/sysctl.conf && sysctl vm.swappiness=10
  free -h   # conferir a linha "Swap"
  ```

- [ ] Gerar segredos (no Mac): `openssl rand -base64 32` (×2: `JWT_SECRET`, `ENCRYPTION_KEY`) e `openssl rand -hex 24` (senhas). **Pode reaproveitar** `JWT_SECRET` e `ENCRYPTION_KEY` da instalação atual.
- [ ] Decidir: instalação limpa (recomendado — a atual só tem a conta admin) ou migrar dados (ver "Migração").
- [ ] Projeto no Easypanel: os hostnames internos ficam `<projeto>_<serviço>` (ex.: projeto `multipost` + serviço `postgres` = `multipost_postgres`). O valor exato aparece como "Internal Host" na tela de cada serviço.

### 1. Postgres nativo

- [ ] **+ Service → Postgres**, nome `postgres`.
- [ ] Database `postiz`, user `postgres` (ou o padrão), senha `openssl rand -hex 24`.
- [ ] **Docker Image:** `pgvector/pgvector:pg17`.
- [ ] Deploy. Anotar a "Internal Connection URL" (ex.: `postgres://postgres:SENHA@multipost_postgres:5432/postiz`).
- [ ] Ativar backup do Easypanel (diário) para esse serviço.

### 2. Redis nativo

- [ ] **+ Service → Redis**, nome `redis`. Senha gerada pelo Easypanel.
- [ ] Anotar a "Internal Connection URL" (ex.: `redis://default:SENHA@multipost_redis:6379`).
- [ ] (VPS) `echo 'vm.overcommit_memory = 1' >> /etc/sysctl.conf && sysctl vm.overcommit_memory=1`.

### 3. Temporal

- [ ] **+ Service → App**, nome `temporal`, fonte **Docker Image** `temporalio/auto-setup:1.28.1`.
- [ ] Environment:

  ```
  DB=postgres12
  DB_PORT=5432
  POSTGRES_SEEDS=multipost_postgres
  POSTGRES_USER=postgres
  POSTGRES_PWD=<senha do Postgres>
  DBNAME=temporal
  VISIBILITY_DBNAME=temporal_visibility
  ENABLE_ES=false
  DEFAULT_NAMESPACE=default
  DYNAMIC_CONFIG_FILE_PATH=config/dynamicconfig/docker.yaml
  SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES=true
  ```

  `SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES=true` é **obrigatório** sem Elasticsearch (ver "Por que isso funciona"). Se o Temporal já subiu sem ela, remova os atributos de teste:

  ```bash
  temporal operator search-attribute remove --address <projeto>_temporal:7233 --namespace default --name CustomStringField --yes
  temporal operator search-attribute remove --address <projeto>_temporal:7233 --namespace default --name CustomTextField --yes
  ```

- [ ] **Sem domínio** (porta 7233 só na rede interna).
- [ ] Deploy. No log, esperar `Default namespace default already registered` ou `... successfully registered`.

### 4. Temporal UI (opcional)

- [ ] **+ Service → App**, `temporal-ui`, imagem `temporalio/ui:2.34.0`, env `TEMPORAL_ADDRESS=multipost_temporal:7233`.
- [ ] Domínio (ex. `temporal.impulsionante.com.br`, porta 8080) **com Basic Auth ligado** — o painel não tem login próprio e mostra dados dos posts.

### 5. Conectar o GitHub ao Easypanel

- [ ] GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained token**: acesso só ao repo `impulsionantedigital/robo-multipost`, permissões **Contents: Read** e **Webhooks: Read and write** (o Easypanel cria o webhook do Auto Deploy).
- [ ] Easypanel → **Settings → GitHub**: colar o token.

### 6. App `postiz` (build do GitHub)

- [ ] **+ Service → App**, nome `postiz`.
- [ ] **Source → GitHub**: owner `impulsionantedigital`, repo `robo-multipost`, branch `main`, build path `/`.
- [ ] **Build → Dockerfile**, arquivo `Dockerfile.dev`.
- [ ] Environment:

  ```
  MAIN_URL=https://post.impulsionante.com.br
  FRONTEND_URL=https://post.impulsionante.com.br
  NEXT_PUBLIC_BACKEND_URL=https://post.impulsionante.com.br/api
  BACKEND_INTERNAL_URL=http://localhost:3000
  PORT=3000
  JWT_SECRET=
  ENCRYPTION_KEY=
  DATABASE_URL=postgresql://postgres:<senha>@multipost_postgres:5432/postiz
  REDIS_URL=redis://default:<senha>@multipost_redis:6379
  TEMPORAL_ADDRESS=multipost_temporal:7233
  IS_GENERAL=true
  DISABLE_REGISTRATION=false
  STORAGE_PROVIDER=cloudflare
  STORAGE_S3_ENDPOINT=https://s3.sa-east-1.amazonaws.com
  STORAGE_S3_ACL=none
  CLOUDFLARE_REGION=sa-east-1
  CLOUDFLARE_ACCESS_KEY=
  CLOUDFLARE_SECRET_ACCESS_KEY=
  CLOUDFLARE_BUCKETNAME=
  CLOUDFLARE_BUCKET_URL=https://<bucket>.s3.sa-east-1.amazonaws.com
  DISABLE_BILLING=true
  DISABLE_MARKETPLACE=true
  AI_CREDITS_MODE=unlimited
  ENABLE_KNOWLEDGE_BASE=true
  API_LIMIT=30
  NX_ADD_PLUGINS=false
  ```

  `PORT=3000` é **obrigatório**: o Easypanel injeta `PORT=80` em serviços App e o backend usa `process.env.PORT` (`apps/backend/src/main.ts`); sem isso ele escuta na 80, o nginx interno procura na 3000 e `/api/` responde 502.

- [ ] **Mounts:** nenhum. As mídias ficam no bucket S3 (bucket policy de leitura pública + CORS liberando `PUT` do domínio — ver `docs/operations/storage-s3.md`). O app não usa `/config`. **Pré-requisito:** a `main` precisa conter o suporte a `STORAGE_S3_ENDPOINT` (branch `feat/s3-compatible-storage`); sem ele, os uploads falham.
- [ ] **Domains:** `post.impulsionante.com.br`, HTTPS, porta **5000**. (Antes, remover o domínio do serviço Compose antigo.)
- [ ] **Deploy** (primeiro build: ~15–30 min). Acompanhar o log do build; se parar com `Killed` ou `JavaScript heap out of memory`, falta memória → conferir swap.
- [ ] No log do app, procurar `Backend is running` e ausência de erro em `reconcileRefreshTokensCron`.
- [ ] Se `/api/` responder 502 e o backend não logar `Backend is running`: rode no console do app `pm2 logs backend --lines 60 --nostream | grep -v RouterExplorer | tail -40`. Erros comuns: host errado em `TEMPORAL_ADDRESS`/`REDIS_URL` (os hosts usam o nome do **projeto**: `<projeto>_temporal`), Redis sem senha na URL, ou o limite de atributos Text do Temporal. Depois de corrigir, `pm2 restart backend` — processo travado não reinicia sozinho.

### 7. Ligar o Auto Deploy

- [ ] Serviço `postiz` → **Source → Auto Deploy: on**. O Easypanel cria o webhook no repo.
- [ ] Teste: commit trivial em `main` → ver o build começar sozinho no Easypanel → app atualizado no fim.

### 8. Desligar a stack antiga

- [ ] Com o novo `postiz` validado (login, conectar um canal, agendar um post de teste), **parar** o serviço Compose `multi-post`.
- [ ] Depois de alguns dias sem problemas, apagar o serviço e seus volumes.

## Migração (só se quiser manter os dados atuais)

```bash
# na VPS
docker exec $(docker ps -qf name=multi-post-postiz-postgres) pg_dump -U postiz -Fc postiz > postiz.dump
docker cp postiz.dump $(docker ps -qf name=multipost_postgres):/tmp/
docker exec $(docker ps -qf name=multipost_postgres) pg_restore -U postgres -d postiz --no-owner /tmp/postiz.dump
```

Uploads: copiar o conteúdo do volume `services_multi-post_postiz-uploads` para o bucket S3 mantendo os nomes (ex.: `aws s3 sync <pasta-do-volume> s3://<bucket>/`) e trocar, no banco, o prefixo antigo (`https://<domínio>/uploads`) pelo `CLOUDFLARE_BUCKET_URL` nas colunas `Media.path`, `Media.thumbnail`, `Post.image`, `Integration.picture` e `Profile.avatarUrl`. Fazer isso **antes** de desligar o serviço antigo. Usar o **mesmo `ENCRYPTION_KEY`**. Dados do Temporal (workflows em andamento) não migram — o app recria os workflows recorrentes no boot.

## Recursos estimados

| Serviço | RAM típica |
|---|---|
| postgres | 150–300 MB |
| redis | 10–50 MB |
| temporal | 300–500 MB |
| temporal-ui | 30 MB |
| postiz (3 processos Node + nginx) | 1–1,5 GB |
| **Total em operação** | **~2–2,5 GB** |
| **Pico durante build** | **+4–6 GB** (RAM + swap) |

## Melhorias futuras

- **Remover `--accept-data-loss`** do script `prisma-db-push`: mudanças aditivas continuam automáticas e mudanças destrutivas passam a falhar em vez de apagar dados.
- **Build mais rápido:** reorganizar o `Dockerfile.dev` para copiar `pnpm-lock.yaml` + `pnpm-workspace.yaml` e rodar `pnpm fetch` antes do `COPY . .`, aproveitando o cache de camadas do Docker na VPS. Atenção: `Dockerfile.dev` vem do upstream — conflito em `sync-upstream`.
- **Migrar o build para o GitHub Actions** (imagem pronta no GHCR + Deploy Webhook) se a VPS sofrer nos builds.
- **Healthcheck** no serviço `postiz` para o Easypanel detectar travamento.

## Decisões pendentes (para você)

1. Instalação limpa ou migrar dados atuais?
2. Nome do projeto no Easypanel (define os hostnames internos)?
3. Temporal UI com domínio público + Basic Auth, ou sem acesso externo?
4. Deploy a cada push em `main` (recomendado com um ambiente) ou só em `release`?
