import type { BackendSettings, S3Settings, WebdavSettings } from '../core/types';

export interface ValidationResult {
  ok: boolean;
  /** Field-level messages; key '' = general. */
  errors: Record<string, string>;
  warnings: string[];
}

export function parseEndpointUrl(endpoint: string): URL | null {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function validateEndpoint(
  endpoint: string,
  errors: Record<string, string>,
  warnings: string[],
): boolean {
  if (endpoint.trim() === '') {
    errors['endpoint'] = 'Endpoint is required';
    return false;
  }
  const url = parseEndpointUrl(endpoint);
  if (url === null) {
    errors['endpoint'] = 'Endpoint must be a well-formed http:// or https:// URL';
    return false;
  }
  if (url.protocol === 'http:') {
    warnings.push('Unencrypted connection — credentials and notes travel in plain text');
  }
  return true;
}

function validateWebdav(settings: WebdavSettings, result: ValidationResult): void {
  if (!validateEndpoint(settings.endpoint, result.errors, result.warnings)) return;
  if (settings.username === '') result.errors['username'] = 'Username is required';
  if (settings.password === '') result.errors['password'] = 'Password is required';
}

function validateS3(settings: S3Settings, result: ValidationResult): void {
  if (!validateEndpoint(settings.endpoint, result.errors, result.warnings)) return;
  if (settings.region.trim() === '') result.errors['region'] = 'Region is required';
  if (settings.bucket.trim() === '') result.errors['bucket'] = 'Bucket is required';
  if (settings.prefix.trim() === '') result.errors['prefix'] = 'Key prefix is required';
  if (settings.accessKey === '') result.errors['accessKey'] = 'Access key is required';
  if (settings.secretKey === '') result.errors['secretKey'] = 'Secret key is required';
}

export function validateBackend(settings: BackendSettings): ValidationResult {
  const result: ValidationResult = { ok: true, errors: {}, warnings: [] };
  if (settings.backend === 'webdav') validateWebdav(settings, result);
  else validateS3(settings, result);
  result.ok = Object.keys(result.errors).length === 0;
  return result;
}
