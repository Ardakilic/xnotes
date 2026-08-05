import { AwsClient } from 'aws4fetch';
import type { S3Settings } from '../core/types';

export function createAwsClient(settings: S3Settings): AwsClient {
  return new AwsClient({
    accessKeyId: settings.accessKey,
    secretAccessKey: settings.secretKey,
    service: 's3',
    region: settings.region,
    // ponytail: aws4fetch defaults to 10 retries on 5xx — that would re-send a
    // 501 NotImplemented and stall the HEAD-compare fallback detection
    retries: 0,
  });
}

export function objectKey(prefix: string): string {
  let p = prefix.replace(/^\/+/, '');
  if (p !== '' && !p.endsWith('/')) p += '/';
  return `${p}notes.json`;
}

function bucketBase(settings: S3Settings): string {
  const endpoint = settings.endpoint.replace(/\/+$/, '');
  if (settings.pathStyle) return `${endpoint}/${settings.bucket}`;
  const url = new URL(endpoint);
  return `${url.protocol}//${settings.bucket}.${url.host}`;
}

export function buildBucketUrl(settings: S3Settings): string {
  return bucketBase(settings);
}

export function buildObjectUrl(settings: S3Settings): string {
  return `${bucketBase(settings)}/${objectKey(settings.prefix)}`;
}
