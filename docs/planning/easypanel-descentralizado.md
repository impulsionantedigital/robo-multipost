# Plano — Robô MultiPost descentralizado no Easypanel

**Status:** proposta (2026-10-23) · **Substitui:** o serviço Compose único de [`docs/operations/easypanel.md`](../operations/easypanel.md)

## Objetivo

Cada peça vira um serviço independente no Easypanel:

| Serviço Easypanel | Tipo | Imagem | Domínio |
|---|---|---|---|
| `postgres` | **Postgres nativo** | `pgvector/pgvector:pg17` | — |
| `redis` | **Redis nativo** | padrão do Easypanel | — |
| `temporal` | App (Docker image) | `temporalio/auto-setup:1.28.1` | — |
| `temporal-ui` | App (Docker image) | `temporalio/ui:2.34.0` | opcional, com Basic Auth |
| `postiz` | App (Docker image) | `ghcr.io/impulsionantedigital/robo-multipost:main` | `post.impulsionante.com.br` |

Um único Postgres guarda **três bancos**: `postiz` (app), `temporal` e `temporal_visibility` (Temporal). O Elasticsearch sai: o Temporal passa a usar o próprio Postgres para buscas (visibility SQL).

## Por que isso funciona (verificado no código)

- **pgvector:** a base de conhecimento usa `PgVector` do Mastra (`libraries/nestjs-libraries/src/chat/mastra.store.ts`), que precisa da extensão `vector`. A imagem `pgvector/pgvector:pg17` é o Postgres oficial + a extensão; o Postgres nativo do Easypanel aceita trocar a imagem ([docs](https://easypanel.io/docs/services/postgres)).
- **Temporal sem Elasticsearch:** o app registra só 2 search attributes do tipo Keyword (`organizationId`, `postId` — `temporal/temporal.register.ts`) e consulta `postId="..." AND ExecutionStatus="Running"` (`posts.service.ts`). Visibility SQL no Postgres 12+ suporta isso. Economiza ~0,5–1 GB de RAM.
- **Temporal no mesmo Postgres:** a imagem `auto-setup` cria sozinha os bancos `temporal` e `temporal_visibility` e aplica o schema. O usuário padrão do Postgres do Easypanel é superusuário, então tem permissão.
- **Imagem genérica:** as variáveis do app (`MAIN_URL`, `NEXT_PUBLIC_BACKEND_URL` etc.) são lidas em tempo de execução — a mesma imagem serve para qualquer domínio, sem rebuild para mudar configuração.

## "Atualizar automaticamente sem buildar um monte de imagem"

O código é TypeScript + Next.js: **algum build sempre precisa acontecer** (`pnpm run build` compila frontend, backend e orchestrator). A escolha é **onde** ele roda.

### Opção A — Build no GitHub Actions, deploy no Easypanel (recomendada)

```
push em main → GitHub Actions builda 1 imagem (amd64) → GHCR → webhook → Easypanel baixa e reinicia
```

- Workflow pronto: [`.github/workflows/deploy-easypanel.yml`](../../.github/workflows/deploy-easypanel.yml).
- Só **uma** arquitetura (amd64), contra as duas (amd64 + arm64) + manifest do workflow de release. Sem tags, sem release: todo push em `main` deploya.
- O repo é **público** → GitHub Actions e GHCR são gratuitos e sem limite de minutos.
- A VPS só baixa a imagem pronta: zero risco de o build derrubar Postgres/Temporal por falta de RAM.
- Login no GHCR usa o `GITHUB_TOKEN` automático — **não precisa** criar token pessoal.
- Tempo estimado: 15–25 min por push (o `Dockerfile.dev` copia o repo inteiro antes do `pnpm install`, então o cache ajuda pouco — ver "Melhorias futuras").

### Opção B — Easypanel builda direto do GitHub

App service com fonte GitHub, Dockerfile `Dockerfile.dev`, "Auto Deploy" ligado.

- Mais simples de configurar (sem Actions).
- **Mas** o build roda na VPS: `NODE_OPTIONS=--max-old-space-size=4096` + Next.js → precisa de ~4–6 GB livres por 15–30 min, competindo com Postgres e Temporal. Em VPS de 4–8 GB, risco real de OOM derrubando o banco.
- Só vale com VPS de 16 GB+ ou servidor de build separado.

**Recomendação: Opção A.**

## ⚠️ Riscos que você precisa saber antes de ligar o deploy automático

1. **`prisma db push --accept-data-loss` roda em todo start** (CMD do `Dockerfile.dev` e script `pm2-run`). Se um commit em `main` remover/renomear um campo do `schema.prisma`, os dados daquela coluna são **apagados automaticamente** no próximo deploy. Com deploy automático, `main` vira produção: revise mudanças de schema antes do merge e mantenha backup diário do Postgres.
2. **Ordem de subida:** se o `postiz` subir antes do `temporal` aceitar conexões, a rotina `reconcileRefreshTokensCron` falha (só loga) e fica parada até o próximo restart. Em deploys normais o Temporal já está no ar; após reiniciar a VPS inteira, reinicie o `postiz` por último.
3. **Downtime por deploy:** ~1–2 min (pull + `prisma db push` + pm2 subindo 3 processos).
4. **Branching do projeto:** o `CLAUDE.md` define `main` = desenvolvimento e `release` = produção. Com um único ambiente, o plano usa `main`. Se um dia quiser homologação, troque o gatilho do workflow para `release`.
5. **Workflows herdados:** `build-containers.yml` e `promote-release.yml` publicam em `ghcr.io/maiconramos/...` e vão **falhar** se alguém criar tag `v*` no seu repo. Não atrapalham o deploy; ajustar ou desativar depois.

## Passo a passo (executar na ordem)

### 0. Preparação

- [ ] Gerar segredos (no Mac): `openssl rand -base64 32` (×2: `JWT_SECRET`, `ENCRYPTION_KEY`) e `openssl rand -hex 24` (senhas). **Pode reaproveitar** `JWT_SECRET` e `ENCRYPTION_KEY` da instalação atual.
- [ ] Decidir: instalação limpa (recomendado — a atual só tem a conta admin) ou migrar dados (ver "Migração").
- [ ] Projeto no Easypanel: pode ser o mesmo (`services`) ou um novo, ex. `multipost`. Os hostnames internos ficam `<projeto>_<serviço>` — abaixo uso `multipost_`.

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
  ```

- [ ] **Sem domínio** (porta 7233 só na rede interna).
- [ ] Deploy. No log, esperar `Default namespace default already registered` ou `... successfully registered`.

### 4. Temporal UI (opcional)

- [ ] **+ Service → App**, `temporal-ui`, imagem `temporalio/ui:2.34.0`, env `TEMPORAL_ADDRESS=multipost_temporal:7233`.
- [ ] Domínio (ex. `temporal.impulsionante.com.br`, porta 8080) **com Basic Auth ligado** — o painel não tem login próprio e mostra dados dos posts.

### 5. Primeiro build da imagem (GitHub)

- [ ] Fazer merge desta branch em `main` (ou rodar o workflow "Deploy Easypanel" manualmente em Actions → Run workflow).
- [ ] Esperar o workflow terminar. Ele vai avisar que o webhook não está configurado — esperado nesta etapa.
- [ ] GitHub → perfil da org → **Packages → robo-multipost → Package settings → Change visibility → Public**. (Sem isso, o Easypanel não consegue baixar sem credenciais.)

### 6. App `postiz`

- [ ] **+ Service → App**, `postiz`, fonte **Docker Image** `ghcr.io/impulsionantedigital/robo-multipost:main`.
- [ ] Environment:

  ```
  MAIN_URL=https://post.impulsionante.com.br
  FRONTEND_URL=https://post.impulsionante.com.br
  NEXT_PUBLIC_BACKEND_URL=https://post.impulsionante.com.br/api
  BACKEND_INTERNAL_URL=http://localhost:3000
  JWT_SECRET=
  ENCRYPTION_KEY=
  DATABASE_URL=postgresql://postgres:<senha>@multipost_postgres:5432/postiz
  REDIS_URL=redis://default:<senha>@multipost_redis:6379
  TEMPORAL_ADDRESS=multipost_temporal:7233
  IS_GENERAL=true
  DISABLE_REGISTRATION=false
  STORAGE_PROVIDER=local
  UPLOAD_DIRECTORY=/uploads
  NEXT_PUBLIC_UPLOAD_DIRECTORY=/uploads
  DISABLE_BILLING=true
  DISABLE_MARKETPLACE=true
  AI_CREDITS_MODE=unlimited
  ENABLE_KNOWLEDGE_BASE=true
  API_LIMIT=30
  NX_ADD_PLUGINS=false
  ```

- [ ] **Mounts:** volume `uploads` → `/uploads`; volume `config` → `/config`.
- [ ] **Domains:** `post.impulsionante.com.br`, HTTPS, porta **5000**. (Antes, remover o domínio do serviço Compose antigo.)
- [ ] Deploy. No log, procurar `Backend is running` e ausência de erro em `reconcileRefreshTokensCron`.

### 7. Ligar o deploy automático

- [ ] No serviço `postiz` → **Deployments → Deploy Webhook**: copiar a URL.
- [ ] GitHub → repo → **Settings → Secrets and variables → Actions → New secret**: `EASYPANEL_DEPLOY_WEBHOOK` = a URL.
- [ ] Teste: commit trivial em `main` → acompanhar Actions → ver o Easypanel reimplantar → conferir no rodapé/versão que é o `sha` novo.
- [ ] **Validar que o Easypanel baixa a imagem nova com a mesma tag `:main`.** Se reimplantar a versão antiga, trocar a fonte para usar a tag `sha-<commit>` e atualizar via API do Easypanel (plano B, a pesquisar).

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

Uploads: copiar o conteúdo do volume `services_multi-post_postiz-uploads` para o novo volume `uploads`. Usar o **mesmo `ENCRYPTION_KEY`**. Dados do Temporal (workflows em andamento) não migram — o app recria os workflows recorrentes no boot.

## Recursos estimados

| Serviço | RAM típica |
|---|---|
| postgres | 150–300 MB |
| redis | 10–50 MB |
| temporal | 300–500 MB |
| temporal-ui | 30 MB |
| postiz (3 processos Node + nginx) | 1–1,5 GB |
| **Total** | **~2–2,5 GB** (vs ~3–3,5 GB com Elasticsearch e 2 Postgres) |

## Melhorias futuras

- **Build mais rápido:** reorganizar o `Dockerfile.dev` para copiar `pnpm-lock.yaml` + `pnpm-workspace.yaml` e rodar `pnpm fetch` antes do `COPY . .`. Assim o cache do GitHub reaproveita as dependências e o build cai para ~8–12 min quando só código muda. Atenção: `Dockerfile.dev` vem do upstream — conflito em `sync-upstream`.
- **Ajustar `build-containers.yml` / `promote-release.yml`** para `ghcr.io/${{ github.repository_owner }}` se quiser releases versionadas.
- **Healthcheck** no serviço `postiz` (`/api/health` ou similar) para o Easypanel detectar travamento.
- **Storage externo (R2)** para uploads, permitindo escalar ou mover o app sem copiar volume.

## Decisões pendentes (para você)

1. Instalação limpa ou migrar dados atuais?
2. Nome do projeto no Easypanel (define os hostnames internos)?
3. Temporal UI com domínio público + Basic Auth, ou sem acesso externo?
4. Deploy a cada push em `main` (recomendado com um ambiente) ou só em `release`?
