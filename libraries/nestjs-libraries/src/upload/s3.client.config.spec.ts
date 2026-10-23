import { resolveS3CompatOptions } from './s3.client.config';

describe('resolveS3CompatOptions', () => {
  it('usa o endpoint do Cloudflare R2 quando STORAGE_S3_ENDPOINT nao esta definido', () => {
    const options = resolveS3CompatOptions({ CLOUDFLARE_ACCOUNT_ID: 'conta123' });

    expect(options.endpoint).toBe('https://conta123.r2.cloudflarestorage.com');
    expect(options.region).toBe('auto');
    expect(options.forcePathStyle).toBe(false);
    expect(options.acl).toBe('public-read');
  });

  it('usa STORAGE_S3_ENDPOINT quando definido, sem barra final', () => {
    const options = resolveS3CompatOptions({
      CLOUDFLARE_ACCOUNT_ID: 'conta123',
      STORAGE_S3_ENDPOINT: 'https://s3.us-east-1.amazonaws.com/',
    });

    expect(options.endpoint).toBe('https://s3.us-east-1.amazonaws.com');
  });

  it('ignora STORAGE_S3_ENDPOINT vazio ou so com espacos', () => {
    const options = resolveS3CompatOptions({
      CLOUDFLARE_ACCOUNT_ID: 'conta123',
      STORAGE_S3_ENDPOINT: '   ',
    });

    expect(options.endpoint).toBe('https://conta123.r2.cloudflarestorage.com');
  });

  it('rejeita STORAGE_S3_ENDPOINT que nao seja URL http(s)', () => {
    expect(() =>
      resolveS3CompatOptions({ STORAGE_S3_ENDPOINT: 's3.amazonaws.com' })
    ).toThrow('STORAGE_S3_ENDPOINT');
  });

  it('usa CLOUDFLARE_REGION quando definido', () => {
    const options = resolveS3CompatOptions({ CLOUDFLARE_REGION: 'sa-east-1' });

    expect(options.region).toBe('sa-east-1');
  });

  it('ativa path-style somente com STORAGE_S3_FORCE_PATH_STYLE=true', () => {
    expect(
      resolveS3CompatOptions({ STORAGE_S3_FORCE_PATH_STYLE: 'true' })
        .forcePathStyle
    ).toBe(true);
    expect(
      resolveS3CompatOptions({ STORAGE_S3_FORCE_PATH_STYLE: 'false' })
        .forcePathStyle
    ).toBe(false);
  });

  it('omite a ACL com STORAGE_S3_ACL=none', () => {
    expect(resolveS3CompatOptions({ STORAGE_S3_ACL: 'none' }).acl).toBeUndefined();
  });

  it('aceita outra ACL canned valida', () => {
    expect(
      resolveS3CompatOptions({ STORAGE_S3_ACL: 'bucket-owner-full-control' }).acl
    ).toBe('bucket-owner-full-control');
  });

  it('rejeita ACL desconhecida', () => {
    expect(() => resolveS3CompatOptions({ STORAGE_S3_ACL: 'publica' })).toThrow(
      'STORAGE_S3_ACL'
    );
  });
});
