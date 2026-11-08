import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ContentSnapshot } from './content.ts';

/**
 * The /status page describes the build that is live. It is generated during
 * that build, so it changes only when a deploy succeeds. Like the WordPress
 * edition, it shows counts and yes/no results only: no test names, errors,
 * logs, dependency versions, or infrastructure identifiers. The app version
 * comes from package.json.
 */
export interface BuildStatus {
  builtAt: string;
  version: string | null;
  trigger: 'code-push' | 'content-or-manual' | null;
  content: { source: 'seed' | 'contentstack'; syncedAt: string | null; species: number; posts: number };
  tests: { passed: number; failed: number; at: string } | null;
  level: StatusLevel;
}

/** Test results older than this are not attributed to the current build. */
export const TEST_RESULT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const TEST_SUMMARY_PATH = '.cache/status/unit-tests.json';

type Environment = Record<string, string | undefined>;
const count = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null);

/** Reads only the totals from Vitest's JSON report, and only if it is recent. */
export function parseTestSummary(input: unknown, now: Date): BuildStatus['tests'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const report = input as Record<string, unknown>;
  const passed = count(report.numPassedTests);
  const failed = count(report.numFailedTests);
  const started = report.startTime;
  if (passed === null || failed === null || passed + failed === 0) return null;
  if (typeof started !== 'number' || !Number.isFinite(started)) return null;
  const age = now.getTime() - started;
  if (age < -60_000 || age > TEST_RESULT_MAX_AGE_MS) return null;
  return { passed, failed, at: new Date(started).toISOString() };
}

export function readTestSummary(now: Date, path = resolve(process.cwd(), TEST_SUMMARY_PATH)): BuildStatus['tests'] {
  try { return parseTestSummary(JSON.parse(readFileSync(path, 'utf8')), now); }
  catch { return null; }
}

/** Accepts semantic versions only, such as 1.0.0 or 1.2.0-beta.1. */
export function appVersion(value: unknown): string | null {
  return typeof value === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/.test(value) ? value : null;
}

export function readAppVersion(path = resolve(process.cwd(), 'package.json')): string | null {
  try { return appVersion(JSON.parse(readFileSync(path, 'utf8')).version); }
  catch { return null; }
}

export function buildStatus(
  snapshot: ContentSnapshot,
  options: { env?: Environment; now?: Date; tests?: BuildStatus['tests']; version?: string | null } = {},
): BuildStatus {
  const status = collect(snapshot, options);
  return { ...status, level: statusLevel(status) };
}

function collect(
  snapshot: ContentSnapshot,
  options: { env?: Environment; now?: Date; tests?: BuildStatus['tests']; version?: string | null },
): Omit<BuildStatus, 'level'> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const actions = env.GITHUB_ACTIONS === 'true';
  const event = env.GITHUB_EVENT_NAME;
  return {
    builtAt: now.toISOString(),
    version: options.version !== undefined ? appVersion(options.version) : readAppVersion(),
    trigger: !actions ? null : event === 'push' ? 'code-push' : event === 'workflow_dispatch' ? 'content-or-manual' : null,
    content: {
      source: snapshot.source,
      syncedAt: snapshot.syncedAt,
      species: snapshot.species.length,
      posts: snapshot.posts.length,
    },
    tests: options.tests !== undefined ? options.tests : readTestSummary(now),
  };
}

export type StatusLevel = 'healthy' | 'preview' | 'attention';

export function statusLevel(status: Omit<BuildStatus, 'level'>): StatusLevel {
  if (status.tests && status.tests.failed > 0) return 'attention';
  if (status.content.source !== 'contentstack' || !status.tests) return 'preview';
  return 'healthy';
}
