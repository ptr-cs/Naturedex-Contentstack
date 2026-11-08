import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import snapshot from '../../data/content.json';
import { assertContentstackRelease, assertReleaseEnvironment } from '../../scripts/release-check.mjs';
import { scanRelease } from '../../scripts/scan-release.mjs';

const template = JSON.parse(readFileSync(new URL('../../infra/aws.yaml', import.meta.url), 'utf8'));
const resources = template.Resources;
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
function artifact() {
  const directory = mkdtempSync(join(tmpdir(), 'naturedex-release-test-'));
  temporary.push(directory);
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Naturedex</title>');
  return directory;
}

describe('the offline AWS static-hosting contract', () => {
  it('keeps S3 private, encrypted, and separate from a website endpoint', () => {
    const bucket = resources.OriginBucket.Properties;
    expect(Object.values(bucket.PublicAccessBlockConfiguration)).toEqual([true, true, true, true]);
    expect(bucket.OwnershipControls.Rules[0].ObjectOwnership).toBe('BucketOwnerEnforced');
    expect(bucket.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm).toBe('AES256');
    expect(bucket.WebsiteConfiguration).toBeUndefined();
    expect(resources.OriginBucket.DeletionPolicy).toBe('Retain');
  });

  it('grants origin reads only to the intended distribution and always signs requests', () => {
    const policy = resources.OriginBucketPolicy.Properties.PolicyDocument.Statement;
    const allow = policy.filter((statement: { Effect: string }) => statement.Effect === 'Allow');
    expect(allow).toHaveLength(1);
    expect(allow[0].Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
    expect(allow[0].Action).toBe('s3:GetObject');
    expect(allow[0].Condition.StringEquals['AWS:SourceArn']['Fn::Sub']).toContain('distribution/${Distribution}');
    expect(policy.some((statement: { Effect: string; Condition?: { Bool?: Record<string, string> } }) => statement.Effect === 'Deny' && statement.Condition?.Bool?.['aws:SecureTransport'] === 'false')).toBe(true);
    expect(resources.OriginAccessControl.Properties.OriginAccessControlConfig).toMatchObject({ SigningBehavior: 'always', SigningProtocol: 'sigv4', OriginAccessControlOriginType: 's3' });
  });

  it('uses HTTPS, origin access control, and genuine 404 responses rather than a success fallback', () => {
    const distribution = resources.Distribution.Properties.DistributionConfig;
    expect(distribution.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    expect(distribution.DefaultCacheBehavior.AllowedMethods).toEqual(['GET', 'HEAD']);
    expect(distribution.Origins[0].OriginAccessControlId).toEqual({ 'Fn::GetAtt': ['OriginAccessControl', 'Id'] });
    expect(distribution.Origins[0].CustomOriginConfig).toBeUndefined();
    expect(distribution.CustomErrorResponses).toEqual(expect.arrayContaining([
      expect.objectContaining({ ErrorCode: 403, ResponseCode: 404, ResponsePagePath: '/404.html' }),
      expect.objectContaining({ ErrorCode: 404, ResponseCode: 404, ResponsePagePath: '/404.html' }),
    ]));
    expect(distribution.CustomErrorResponses.some((error: { ResponseCode: number }) => error.ResponseCode === 200)).toBe(false);
    const headers = resources.SecurityHeaders.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
    expect(headers.ContentSecurityPolicy.Override).toBe(true);
    expect(headers.ContentSecurityPolicy.ContentSecurityPolicy).toContain("connect-src 'self'");
    expect(headers.ContentTypeOptions.Override).toBe(true);
  });

  it('contains no server/database/NAT resources and keeps custom TLS optional and paired', () => {
    for (const resource of Object.values(resources) as { Type: string }[]) expect(resource.Type).toMatch(/^AWS::(?:S3|CloudFront)::/);
    expect(template.Parameters.DomainName.Default).toBe('');
    expect(template.Parameters.CertificateArn.Default).toBe('');
    expect(template.Parameters.CertificateArn.AllowedPattern).toContain('us-east-1');
    expect(template.Rules.DomainCertificatePair.Assertions).toHaveLength(1);
    expect(resources.Distribution.Properties.DistributionConfig.ViewerCertificate['Fn::If'][0]).toBe('HasCustomDomain');
  });

  it('has no dangling explicit references to undeclared resources or parameters', () => {
    const available = new Set([...Object.keys(resources), ...Object.keys(template.Parameters)]);
    function inspect(value: unknown) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(inspect); return; }
      const object = value as Record<string, unknown>;
      if (typeof object.Ref === 'string' && !object.Ref.startsWith('AWS::')) expect(available.has(object.Ref), object.Ref).toBe(true);
      if (Array.isArray(object['Fn::GetAtt'])) expect(available.has(object['Fn::GetAtt'][0] as string)).toBe(true);
      Object.values(object).forEach(inspect);
    }
    inspect(template);
  });

  it.each([
    ['/', '/index.html'], ['/map', '/map/index.html'], ['/map/', '/map/index.html'],
    ['/journal/a-note', '/journal/a-note/index.html'], ['/journal/a-note/', '/journal/a-note/index.html'],
    ['/not-a-real-page', '/not-a-real-page/index.html'], ['/about/index.html', '/about/index.html'],
    ['/_astro/app.123.js', '/_astro/app.123.js'], ['/sprites/red-fox.svg', '/sprites/red-fox.svg'],
    ['/robots.txt', '/robots.txt'], ['/sitemap.xml', '/sitemap.xml'], ['/404.html', '/404.html'],
  ])('rewrites %s to %s without changing query-string state', (uri, expected) => {
    const handler = runInNewContext(`${resources.DirectoryIndexFunction.Properties.FunctionCode}\nhandler`) as (event: { request: { uri: string; querystring: unknown } }) => { uri: string; querystring: unknown };
    const querystring = { collection: { value: '1' } };
    expect(handler({ request: { uri, querystring } })).toEqual({ uri: expected, querystring });
  });
});

describe('explicit public release origin and Contentstack provenance', () => {
  it('accepts an intended public HTTPS origin without requiring DNS/network access', () => {
    expect(assertReleaseEnvironment({ SITE_URL: 'https://naturedex.real-domain.dev/' })).toBe('https://naturedex.real-domain.dev');
    expect(assertReleaseEnvironment({ SITE_URL: 'https://d1234567890.cloudfront.net' })).toBe('https://d1234567890.cloudfront.net');
  });

  it.each([undefined, '', 'invalid URL', 'http://naturedex.real-domain.dev', 'https://localhost', 'https://127.0.0.1', 'https://192.168.1.1', 'https://[::1]', 'https://guide.example', 'https://example.com', 'https://naturedex.example.org', 'https://preview.test', 'https://owner:password@naturedex.real-domain.dev', 'https://naturedex.real-domain.dev/path', 'https://naturedex.real-domain.dev?token=1', 'https://naturedex.real-domain.dev#part', 'https://naturedex.real-domain.dev:8443'])('rejects unsuitable release origin %j', (SITE_URL) => {
    expect(() => assertReleaseEnvironment({ SITE_URL })).toThrow('SITE_URL');
  });

  it('rejects reviewed seed data as release provenance and permits a validated empty published journal', () => {
    expect(() => assertContentstackRelease({ ...snapshot, source: 'seed', syncedAt: null })).toThrow('Contentstack snapshot');
    const live = { ...snapshot, source: 'contentstack', syncedAt: '2026-11-06T12:00:00.000Z' };
    expect(assertContentstackRelease(live).source).toBe('contentstack');
    expect(assertContentstackRelease({ ...live, posts: [] }).posts).toEqual([]);
    expect(() => assertContentstackRelease({ ...live, syncedAt: null })).toThrow();
    expect(() => assertContentstackRelease({ ...live, syncedAt: 'not-a-date' })).toThrow();
  });
});

describe('credential-aware static artifact checks', () => {
  it('accepts public CMS terminology without falsely treating generic words as secrets', () => {
    const directory = artifact();
    writeFileSync(join(directory, 'app.js'), 'console.log("Contentstack delivery token is configured only during builds");');
    expect(scanRelease({ directory, expectedPaths: ['index.html'], environment: {} }).files).toBe(2);
  });

  it.each(['raw', 'encoded'])('rejects an actual configured credential in %s form without printing it', (format) => {
    const directory = artifact();
    const token = 'test-only/delivery+credential?0123456789';
    writeFileSync(join(directory, 'app.js'), format === 'encoded' ? encodeURIComponent(token) : token);
    let failure: unknown;
    try { scanRelease({ directory, expectedPaths: ['index.html'], environment: { CONTENTSTACK_DELIVERY_TOKEN: token } }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('CONTENTSTACK_DELIVERY_TOKEN');
    expect((failure as Error).message).not.toContain(token);
  });

  it.each(['.env', 'settings.php', 'authoring.sqlite', 'cms/private.txt', 'server/entry.mjs'])('rejects private/runtime artifact %s', (file) => {
    const directory = artifact();
    const target = join(directory, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, 'not public output');
    expect(() => scanRelease({ directory, expectedPaths: ['index.html'], environment: {} })).toThrow('private or server-only');
  });

  it('rejects missing route output and filesystem links rather than following private paths', () => {
    const directory = artifact();
    expect(() => scanRelease({ directory, expectedPaths: ['map/index.html'], environment: {} })).toThrow('missing map/index.html');
    symlinkSync(join(directory, 'index.html'), join(directory, 'linked.html'));
    expect(() => scanRelease({ directory, expectedPaths: ['index.html'], environment: {} })).toThrow('symlink');
  });
});
