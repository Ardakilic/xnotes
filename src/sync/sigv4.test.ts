import { AwsClient } from 'aws4fetch';
import { describe, expect, it } from 'vitest';
import type { S3Settings } from '../core/types';
import { buildBucketUrl, buildObjectUrl, createAwsClient, objectKey } from './sigv4';

const settings: S3Settings = {
  backend: 's3',
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'mybucket',
  prefix: 'xnotes/',
  accessKey: 'AKIDEXAMPLE',
  secretKey: 'secret',
  pathStyle: false,
  forceHeadFallback: false,
};

describe('createAwsClient', () => {
  it('carries credentials, service, and region', () => {
    const client = createAwsClient(settings);
    expect(client).toBeInstanceOf(AwsClient);
    expect(client.accessKeyId).toBe('AKIDEXAMPLE');
    expect(client.secretAccessKey).toBe('secret');
    expect(client.service).toBe('s3');
    expect(client.region).toBe('us-east-1');
    expect(client.retries).toBe(0);
  });
});

describe('url building', () => {
  it('builds virtual-host urls', () => {
    expect(buildBucketUrl(settings)).toBe('https://mybucket.s3.example.com');
    expect(buildObjectUrl(settings)).toBe('https://mybucket.s3.example.com/xnotes/notes.json');
  });

  it('builds path-style urls', () => {
    const s = { ...settings, pathStyle: true };
    expect(buildBucketUrl(s)).toBe('https://s3.example.com/mybucket');
    expect(buildObjectUrl(s)).toBe('https://s3.example.com/mybucket/xnotes/notes.json');
  });

  it('keeps ports and strips trailing slashes', () => {
    const s = { ...settings, endpoint: 'https://localhost:9000/', pathStyle: true };
    expect(buildObjectUrl(s)).toBe('https://localhost:9000/mybucket/xnotes/notes.json');
    const v = { ...settings, endpoint: 'https://localhost:9000/' };
    expect(buildBucketUrl(v)).toBe('https://mybucket.localhost:9000');
  });
});

describe('objectKey', () => {
  it.each([
    ['xnotes/', 'xnotes/notes.json'],
    ['xnotes', 'xnotes/notes.json'],
    ['/xnotes/', 'xnotes/notes.json'],
    ['/xnotes', 'xnotes/notes.json'],
    ['', 'notes.json'],
    ['/', 'notes.json'],
  ])('normalizes %j to %j', (prefix, expected) => {
    expect(objectKey(prefix)).toBe(expected);
  });
});

describe('sigv4 signing', () => {
  it('matches the AWS official documentation example', async () => {
    const client = new AwsClient({
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      service: 'iam',
      region: 'us-east-1',
    });
    const request = await client.sign(
      'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      {
        method: 'GET',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
        aws: { datetime: '20150830T123600Z', allHeaders: true },
      },
    );
    expect(request.headers.get('authorization')).toBe(
      'AWS4-HMAC-SHA256 ' +
        'Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-date, ' +
        'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });
});
