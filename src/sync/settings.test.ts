import { describe, expect, it } from 'vitest';
import type { S3Settings, WebdavSettings } from '../core/types';
import { validateBackend } from './settings';

function webdav(overrides: Partial<WebdavSettings> = {}): WebdavSettings {
  return {
    backend: 'webdav',
    endpoint: 'https://dav.example.com',
    username: 'user',
    password: 'pass',
    path: '/xnotes/notes.json',
    ...overrides,
  };
}

function s3(overrides: Partial<S3Settings> = {}): S3Settings {
  return {
    backend: 's3',
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'notes',
    prefix: 'xnotes/',
    accessKey: 'ak',
    secretKey: 'sk',
    pathStyle: false,
    forceHeadFallback: false,
    ...overrides,
  };
}

describe('endpoint validation', () => {
  it('rejects malformed URLs', () => {
    const result = validateBackend(webdav({ endpoint: 'not a url' }));
    expect(result.ok).toBe(false);
    expect(result.errors['endpoint']).toBeDefined();
  });

  it('rejects non-http schemes', () => {
    const result = validateBackend(webdav({ endpoint: 'ftp://dav.example.com' }));
    expect(result.ok).toBe(false);
    expect(result.errors['endpoint']).toBeDefined();
  });

  it('rejects plain http endpoints', () => {
    const result = validateBackend(webdav({ endpoint: 'http://192.168.1.10:5244' }));
    expect(result.ok).toBe(false);
    expect(result.errors['endpoint']).toBeDefined();
    expect(result.errors['endpoint']).toMatch(/HTTPS/i);
  });

  it('accepts https without warnings', () => {
    const result = validateBackend(webdav());
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('required fields', () => {
  it('webdav requires username and password', () => {
    const result = validateBackend(webdav({ username: '', password: '' }));
    expect(result.ok).toBe(false);
    expect(result.errors['username']).toBeDefined();
    expect(result.errors['password']).toBeDefined();
  });

  it('s3 requires region, bucket, prefix and keys', () => {
    const result = validateBackend(
      s3({ region: '', bucket: '', prefix: '', accessKey: '', secretKey: '' }),
    );
    expect(result.ok).toBe(false);
    for (const field of ['region', 'bucket', 'prefix', 'accessKey', 'secretKey']) {
      expect(result.errors[field]).toBeDefined();
    }
  });

  it('accepts a complete s3 config', () => {
    expect(validateBackend(s3()).ok).toBe(true);
  });
});
