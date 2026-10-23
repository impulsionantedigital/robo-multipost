# Storage S3-compatível (AWS S3, MinIO, Backblaze B2, Wasabi)

O Robô MultiPost guarda mídias (uploads, avatares de canais, imagens geradas por IA) em um de dois providers, escolhidos por `STORAGE_PROVIDER`:

| `STORAGE_PROVIDER` | Onde os arquivos ficam |
|---|---|
| `local` (padrão) | Disco do servidor (`UPLOAD_DIRECTORY`) |
| `cloudflare` | Bucket S3-compatível — Cloudflare R2 por padrão, ou qualquer outro serviço via `STORAGE_S3_ENDPOINT` |

O nome `cloudflare` foi mantido por compatibilidade com o upstream (Postiz) e com o frontend. Para usar AWS S3 ou outro serviço, continue com `STORAGE_PROVIDER=cloudflare` e defina `STORAGE_S3_ENDPOINT`.

## Variáveis

| Variável | Obrigatória | Descrição |
|---|---|---|
| `CLOUDFLARE_ACCESS_KEY` | sim | Access key do bucket |
| `CLOUDFLARE_SECRET_ACCESS_KEY` | sim | Secret key do bucket |
| `CLOUDFLARE_BUCKETNAME` | sim | Nome do bucket |
| `CLOUDFLARE_BUCKET_URL` | sim | URL **pública** onde os arquivos ficam acessíveis (sem barra final). É o prefixo gravado no banco e usado pelas redes sociais para baixar a mídia |
| `CLOUDFLARE_REGION` | não | Região. Padrão `auto` (R2). Na AWS, use a região real do bucket (ex.: `sa-east-1`) — a assinatura falha com região errada |
| `CLOUDFLARE_ACCOUNT_ID` | só no R2 | Monta o endpoint do R2. Ignorado quando `STORAGE_S3_ENDPOINT` está definido |
| `STORAGE_S3_ENDPOINT` | não | Endpoint do serviço S3-compatível. Vazio = Cloudflare R2 |
| `STORAGE_S3_FORCE_PATH_STYLE` | não | Exatamente `true` (minúsculo) para endereçar o bucket no caminho (`endpoint/bucket/arquivo`). Necessário no MinIO |
| `STORAGE_S3_ACL` | não | ACL enviada no upload feito pelo servidor. Padrão `public-read` (comportamento histórico). Use `none` para não enviar ACL. **Não** se aplica aos uploads grandes feitos direto pelo navegador (multipart), que nunca enviaram ACL — por isso a leitura pública deve vir de uma *bucket policy*, não da ACL |

Valores inválidos em `STORAGE_S3_ENDPOINT` ou `STORAGE_S3_ACL` fazem o storage falhar ao iniciar com mensagem explícita, e a aba **Configurações → Status → Saúde da infra** mostra o erro.

## AWS S3

```env
STORAGE_PROVIDER=cloudflare
STORAGE_S3_ENDPOINT=https://s3.sa-east-1.amazonaws.com
CLOUDFLARE_REGION=sa-east-1
CLOUDFLARE_ACCESS_KEY=AKIA...
CLOUDFLARE_SECRET_ACCESS_KEY=...
CLOUDFLARE_BUCKETNAME=meu-bucket
CLOUDFLARE_BUCKET_URL=https://meu-bucket.s3.sa-east-1.amazonaws.com
STORAGE_S3_ACL=none
```

1. **ACL:** buckets criados desde abril/2023 vêm com ACL desativada (*Object Ownership: Bucket owner enforced*) e **recusam** uploads que enviam `public-read` (`AccessControlListNotSupported`). Por isso `STORAGE_S3_ACL=none`.
2. **Leitura pública:** como não há ACL por objeto, libere leitura com uma *bucket policy* (e desative o "Block Public Access" para policies):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": "*",
       "Action": "s3:GetObject",
       "Resource": "arn:aws:s3:::meu-bucket/*"
     }]
   }
   ```
   Alternativa: bucket privado atrás de um CloudFront com OAC — nesse caso `CLOUDFLARE_BUCKET_URL` é a URL do CloudFront.
3. **Permissões IAM** da chave: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` (usado pelo `HeadBucket` da sonda de saúde) e as de multipart (`s3:ListMultipartUploadParts`, `s3:AbortMultipartUpload`).

## MinIO

```env
STORAGE_PROVIDER=cloudflare
STORAGE_S3_ENDPOINT=https://minio.seudominio.com
STORAGE_S3_FORCE_PATH_STYLE=true
CLOUDFLARE_REGION=us-east-1
CLOUDFLARE_BUCKETNAME=multipost
CLOUDFLARE_BUCKET_URL=https://minio.seudominio.com/multipost
```

Torne o bucket público para leitura (`mc anonymous set download minio/multipost`). O endpoint precisa ser acessível **pelo navegador** dos usuários (ver CORS abaixo), não só pelo backend — `http://minio:9000` interno não serve para o upload pelo navegador.

## CORS (obrigatório em qualquer provider)

Uploads grandes vão **direto do navegador para o bucket**, por URLs assinadas (multipart via Uppy). O bucket precisa aceitar `PUT` vindo do frontend e expor o `ETag`:

```json
[{
  "AllowedOrigins": ["https://app.seudominio.com"],
  "AllowedMethods": ["GET", "PUT"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

## Migração de storage

Trocar de provider **não move arquivos**. Mídias antigas continuam apontando para a URL antiga gravada no banco (`Media.path`). Copie os objetos para o novo bucket mantendo os nomes e, se a URL pública mudar, atualize os registros antes de desligar o storage antigo.
