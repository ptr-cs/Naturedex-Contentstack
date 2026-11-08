import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import seed from '../../data/content.json';
import { validateContentSnapshot } from '../../src/lib/content';
import { appVersion, buildStatus, parseTestSummary, readAppVersion, readTestSummary, TEST_RESULT_MAX_AGE_MS } from '../../src/lib/status';

const now = new Date('2026-11-08T18:00:00.000Z');
// data/content.json may hold seed or pulled content; pin the seed case explicitly.
const snapshot = validateContentSnapshot({ ...seed, source: 'seed', syncedAt: null });
const synced = { ...snapshot, source: 'contentstack' as const, syncedAt: '2026-11-08T17:55:00.000Z' };
const passing = { passed: 120, failed: 0, at: '2026-11-08T17:58:00.000Z' };
const report = (overrides: Record<string, unknown> = {}) => ({ numPassedTests: 120, numFailedTests: 0, startTime: now.getTime() - 60_000, testResults: [{ name: '/secret/path.test.ts', message: 'boom' }], ...overrides });
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('test summary', () => {
  it('keeps only totals and the start time from a recent Vitest report', () => {
    expect(parseTestSummary(report(), now)).toEqual({ passed: 120, failed: 0, at: '2026-11-08T17:59:00.000Z' });
  });

  it('ignores stale, future, empty, or malformed reports instead of attributing them to this build', () => {
    expect(parseTestSummary(report({ startTime: now.getTime() - TEST_RESULT_MAX_AGE_MS - 1 }), now)).toBeNull();
    expect(parseTestSummary(report({ startTime: now.getTime() + 5 * 60_000 }), now)).toBeNull();
    expect(parseTestSummary(report({ numPassedTests: 0, numFailedTests: 0 }), now)).toBeNull();
    expect(parseTestSummary(report({ numFailedTests: -1 }), now)).toBeNull();
    expect(parseTestSummary(report({ numPassedTests: '120' }), now)).toBeNull();
    expect(parseTestSummary(report({ startTime: 'yesterday' }), now)).toBeNull();
    expect(parseTestSummary([], now)).toBeNull();
    expect(parseTestSummary(null, now)).toBeNull();
  });

  it('reads the report file and treats a missing or corrupt file as not run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'naturedex-status-'));
    temporary.push(directory);
    const file = join(directory, 'unit-tests.json');
    expect(readTestSummary(now, file)).toBeNull();
    writeFileSync(file, '{not json');
    expect(readTestSummary(now, file)).toBeNull();
    writeFileSync(file, JSON.stringify(report()));
    expect(readTestSummary(now, file)?.passed).toBe(120);
  });
});

describe('build status', () => {
  it('reports a healthy GitHub Actions deploy of pulled Contentstack content', () => {
    const status = buildStatus(synced, {
      now, tests: passing, version: '1.2.3',
      env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch' },
    });
    expect(status).toEqual({
      builtAt: now.toISOString(), version: '1.2.3', trigger: 'content-or-manual',
      content: { source: 'contentstack', syncedAt: '2026-11-08T17:55:00.000Z', species: 24, posts: snapshot.posts.length },
      tests: passing, level: 'healthy',
    });
  });

  it('labels seed content or missing tests as a preview, and any failed test as needing attention', () => {
    expect(buildStatus(snapshot, { now, tests: passing, env: {}, version: '1.0.0' }).level).toBe('preview');
    expect(buildStatus(synced, { now, tests: null, env: {}, version: '1.0.0' }).level).toBe('preview');
    expect(buildStatus(synced, { now, tests: { ...passing, failed: 1 }, env: {}, version: '1.0.0' }).level).toBe('attention');
  });

  it('names the trigger only for GitHub Actions code pushes and dispatches', () => {
    expect(buildStatus(synced, { now, tests: passing, version: '1.0.0', env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push' } }).trigger).toBe('code-push');
    expect(buildStatus(synced, { now, tests: passing, version: '1.0.0', env: { GITHUB_EVENT_NAME: 'push' } }).trigger).toBeNull();
    expect(buildStatus(synced, { now, tests: passing, version: '1.0.0', env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'schedule' } }).trigger).toBeNull();
  });

  it('reports the package version and rejects anything that is not a semantic version', () => {
    expect(readAppVersion()).toBe(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version);
    expect(buildStatus(synced, { now, tests: passing, env: {} }).version).toBe(readAppVersion());
    expect(appVersion('2.0.0-beta.1')).toBe('2.0.0-beta.1');
    for (const bad of ['', 'v1.0.0', '1.0', '<script>', 1, null]) expect(appVersion(bad)).toBeNull();
    expect(buildStatus(synced, { now, tests: passing, env: {}, version: 'latest' }).version).toBeNull();
  });

  it('exposes counts and times only, never test names or messages', () => {
    const serialized = JSON.stringify(buildStatus(synced, { now, tests: parseTestSummary(report(), now), env: {}, version: '1.0.0' }));
    expect(serialized).not.toMatch(/secret|boom|path\.test/);
  });
});
