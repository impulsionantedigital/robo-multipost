import type { ObjectCannedACL } from '@aws-sdk/client-s3';

// Configuracao do storage S3-compativel (STORAGE_PROVIDER=cloudflare).
// Sem STORAGE_S3_ENDPOINT, aponta para o Cloudflare R2 como sempre fez.
// Com ele, aceita AWS S3, MinIO, Backblaze B2, Wasabi etc.
export interface S3CompatOptions {
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  // undefined = nao envia ACL no upload (buckets AWS com ACL desativada).
  acl: ObjectCannedACL | undefined;
}

type StorageEnv = Record<string, string | undefined>;

const CANNED_ACLS: readonly string[] = [
  'private',
  'public-read',
  'public-read-write',
  'authenticated-read',
  'aws-exec-read',
  'bucket-owner-read',
  'bucket-owner-full-control',
];

export function r2Endpoint(accountId: string | undefined): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function resolveEndpoint(env: StorageEnv): string {
  const custom = env.STORAGE_S3_ENDPOINT?.trim();
  if (!custom) {
    return r2Endpoint(env.CLOUDFLARE_ACCOUNT_ID);
  }
  if (!/^https?:\/\/[^/\s]+/i.test(custom)) {
    throw new Error(
      `STORAGE_S3_ENDPOINT invalido: "${custom}". Use uma URL completa, ex.: https://s3.us-east-1.amazonaws.com`
    );
  }
  return custom.replace(/\/+$/, '');
}

function resolveAcl(env: StorageEnv): ObjectCannedACL | undefined {
  const acl = env.STORAGE_S3_ACL?.trim();
  if (!acl) {
    return 'public-read';
  }
  if (acl === 'none') {
    return undefined;
  }
  if (!CANNED_ACLS.includes(acl)) {
    throw new Error(
      `STORAGE_S3_ACL invalido: "${acl}". Use "none" ou uma ACL canned (${CANNED_ACLS.join(', ')}).`
    );
  }
  return acl as ObjectCannedACL;
}

export function resolveS3CompatOptions(
  env: StorageEnv = process.env
): S3CompatOptions {
  return {
    endpoint: resolveEndpoint(env),
    region: env.CLOUDFLARE_REGION?.trim() || 'auto',
    forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE?.trim() === 'true',
    acl: resolveAcl(env),
  };
}
