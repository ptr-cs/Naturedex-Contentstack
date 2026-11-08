import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { readContentSnapshot, validateContentSnapshot } from '../src/lib/content.ts';

export function assertReleaseEnvironment(environment = process.env) {
  if (!environment.SITE_URL) throw new Error('Set SITE_URL to the intended public HTTPS origin before a release build.');
  let url;
  try { url = new URL(environment.SITE_URL); }
  catch { throw new Error('SITE_URL must be a valid public HTTPS origin.'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const reserved = /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(host) ||
    /(?:^|\.)example\.(?:com|org|net)$/.test(host);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port ||
      isIP(host) !== 0 || reserved || !host.includes('.')) {
    throw new Error('SITE_URL must be a public HTTPS DNS origin without credentials, paths, query strings, custom ports, or placeholder hosts.');
  }
  return url.origin;
}

export function assertContentstackRelease(input) {
  const snapshot = validateContentSnapshot(input);
  if (snapshot.source !== 'contentstack' || !snapshot.syncedAt) {
    throw new Error('Release builds require a validated Contentstack snapshot. Configure delivery credentials and run npm run cms:pull first.');
  }
  return snapshot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const site = assertReleaseEnvironment();
    const snapshot = assertContentstackRelease(readContentSnapshot());
    console.log(`Release provenance checked for ${site}: Contentstack snapshot from ${snapshot.syncedAt}; ${snapshot.species.length} species and ${snapshot.posts.length} published notes.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release provenance validation failed.');
    process.exitCode = 1;
  }
}
