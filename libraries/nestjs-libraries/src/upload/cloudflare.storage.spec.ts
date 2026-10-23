// storage.helpers puxa file-type (ESM-only) que quebra ts-jest; nao e usado no
// removeFile.
jest.mock('./storage.helpers', () => ({ loadFromUrlOrDataUrl: jest.fn() }));

const mockSend = jest.fn();
const mockClientConfig = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class S3ClientMock {
    middlewareStack = { add: jest.fn() };
    send = mockSend;
    constructor(config: any) {
      mockClientConfig(config);
    }
  },
  PutObjectCommand: class PutObjectCommandMock {
    constructor(public input: any) {}
  },
  HeadBucketCommand: class HeadBucketCommandMock {
    constructor(public input: any) {}
  },
  DeleteObjectCommand: class DeleteObjectCommandMock {
    readonly type = 'DeleteObject';
    constructor(public input: any) {}
  },
}));

import { CloudflareStorage } from './cloudflare.storage';

const buildStorage = () =>
  new CloudflareStorage(
    'account',
    'key',
    'secret',
    'auto',
    'meu-bucket',
    'https://cdn.exemplo.com'
  );

describe('CloudflareStorage com storage S3-compativel', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    mockClientConfig.mockReset();
  });

  it('usa endpoint, regiao e path-style das opcoes S3', () => {
    new CloudflareStorage(
      'account',
      'key',
      'secret',
      'sa-east-1',
      'meu-bucket',
      'https://cdn.exemplo.com',
      {
        endpoint: 'http://minio:9000',
        region: 'sa-east-1',
        forcePathStyle: true,
        acl: undefined,
      }
    );

    expect(mockClientConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://minio:9000',
        region: 'sa-east-1',
        forcePathStyle: true,
      })
    );
  });

  it('mantem o endpoint do R2 quando nao recebe opcoes S3', () => {
    buildStorage();

    expect(mockClientConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://account.r2.cloudflarestorage.com',
        region: 'auto',
      })
    );
  });

  it('envia ACL public-read no upload por padrao', async () => {
    await buildStorage().uploadFile({
      mimetype: 'image/png',
      buffer: Buffer.from('x'),
      size: 1,
    } as Express.Multer.File);

    expect(mockSend.mock.calls[0][0].input.ACL).toBe('public-read');
  });

  it('nao envia ACL no upload quando a opcao acl e undefined', async () => {
    const storage = new CloudflareStorage(
      'account',
      'key',
      'secret',
      'us-east-1',
      'meu-bucket',
      'https://cdn.exemplo.com',
      {
        endpoint: 'https://s3.us-east-1.amazonaws.com',
        region: 'us-east-1',
        forcePathStyle: false,
        acl: undefined,
      }
    );

    await storage.uploadFile({
      mimetype: 'image/png',
      buffer: Buffer.from('x'),
      size: 1,
    } as Express.Multer.File);

    expect(mockSend.mock.calls[0][0].input).not.toHaveProperty('ACL');
  });
});

describe('CloudflareStorage.removeFile', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
  });

  it('apaga o objeto derivando a Key da URL publica do bucket', async () => {
    await buildStorage().removeFile('https://cdn.exemplo.com/abc123.png');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toEqual({
      Bucket: 'meu-bucket',
      Key: 'abc123.png',
    });
  });

  it('ignora query string ao derivar a Key', async () => {
    await buildStorage().removeFile('https://cdn.exemplo.com/abc123.png?v=2');

    expect(mockSend.mock.calls[0][0].input.Key).toBe('abc123.png');
  });

  it('nao apaga nada quando a URL nao pertence ao bucket', async () => {
    await buildStorage().removeFile('https://cdn.terceiro.com/abc123.png');

    expect(mockSend).not.toHaveBeenCalled();
  });
});
