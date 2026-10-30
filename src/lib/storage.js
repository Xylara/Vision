import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from '../config.js';
import logger from './logger.js';

const { storage } = config;

export const s3 = new S3Client({
  region: storage.region,
  endpoint: storage.endpoint,
  forcePathStyle: storage.forcePathStyle,
  credentials: {
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export function buildObjectKey(extension = 'gif') {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const prefix = storage.keyPrefix ? `${storage.keyPrefix}/` : '';
  return `${prefix}${year}/${month}/${randomUUID()}.${extension}`;
}

function sanitizeMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([name, value]) => [
        name,
        String(value)
          .replace(/[^\x20-\x7E]/g, '')
          .slice(0, 256),
      ]),
  );
}

export async function uploadGif(buffer, { key, metadata = {} } = {}) {
  const objectKey = key ?? buildObjectKey('gif');

  await s3.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: 'image/gif',
      CacheControl: 'public, max-age=31536000, immutable',
      ContentDisposition: 'inline',
      Metadata: sanitizeMetadata(metadata),
    }),
  );

  const publicUrl = storage.publicBaseUrl
    ? `${storage.publicBaseUrl}/${objectKey.split('/').map(encodeURIComponent).join('/')}`
    : null;

  let url = publicUrl;
  let isPublic = true;

  if (!url) {
    url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: storage.bucket, Key: objectKey }),
      { expiresIn: storage.signedUrlTtl },
    );
    isPublic = false;
  }

  logger.info(`uploaded ${objectKey} (${(buffer.length / 1024).toFixed(0)} KiB) to ${storage.provider}`);

  return { key: objectKey, url, isPublic, size: buffer.length, bucket: storage.bucket, provider: storage.provider };
}

export function describeStorage() {
  return `${storage.provider} bucket "${storage.bucket}" at ${storage.endpoint} (${
    storage.publicBaseUrl ? 'public URLs' : `presigned URLs, ${storage.signedUrlTtl}s`
  })`;
}

export default { uploadGif, buildObjectKey, describeStorage, s3 };
