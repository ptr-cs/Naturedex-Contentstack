import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentstackImageHosts, readContentSnapshot } from '../src/lib/content.ts';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Contentstack puts the stack API key in every asset-library URL
 * (https://eu-images.contentstack.com/v3/assets/<api key>/...). The key only
 * identifies the stack; reading content needs the delivery token. So the API
 * key may appear there and nowhere else. Tokens are never allowed.
 */
function withoutAssetUrls(contents, apiKey) {
  const hosts = contentstackImageHosts.map(escapeRegExp).join('|');
  const key = escapeRegExp(apiKey);
  return contents.replace(new RegExp(`https?:(?:\\\\?/){2}(?:${hosts})(?:\\\\?/)v3(?:\\\\?/)assets(?:\\\\?/)${key}(?=\\\\?/)`, 'g'), '');
}

function artifactFiles(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error(`Release output contains a symlink: ${relative(directory, path)}`);
    if (info.isDirectory()) output.push(...artifactFiles(path));
    else if (info.isFile()) output.push(path);
  }
  return output;
}

/**
 * @param {{ directory?: string, environment?: Record<string, string | undefined>, expectedPaths?: string[] }} [options]
 */
export function scanRelease({ directory = resolve('dist'), environment = process.env, expectedPaths } = {}) {
  if (!existsSync(directory)) throw new Error('No dist/ artifact exists. Build the static frontend first.');
  const required = expectedPaths || [
    'index.html', 'map/index.html', 'journal/index.html', 'about/index.html', 'status/index.html', '404.html',
    ...readContentSnapshot().posts.map((post) => `journal/${post.slug}/index.html`),
  ];
  for (const path of required) {
    if (!existsSync(join(directory, path)) || !lstatSync(join(directory, path)).isFile()) throw new Error(`Release output is missing ${path}.`);
  }
  const credentials = Object.entries(environment)
    .filter(([key, value]) => /^CONTENTSTACK_.*(?:TOKEN|API_KEY|SECRET|PASSWORD|AUTHTOKEN)$/i.test(key) && typeof value === 'string' && value.length >= 8)
    .map(([key, value]) => ({ key, value, needles: [...new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])].map((needle) => Buffer.from(needle)) }));
  const files = artifactFiles(directory);
  for (const file of files) {
    const path = relative(directory, file).replaceAll('\\', '/');
    if (/(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|\.aws|node_modules|server|cms)(?:\/|$)|\.(?:php[0-9]?|phtml|pem|key|sqlite(?:-[^/]*)?|db)$|(?:^|\/)(?:wrangler\.json|\.admin-password|\.local-token)$/.test(path)) {
      throw new Error(`A private or server-only file entered the static release: ${path}`);
    }
    const raw = readFileSync(file);
    for (const { key, value, needles } of credentials) {
      const contents = /API_KEY$/i.test(key) ? Buffer.from(withoutAssetUrls(raw.toString('latin1'), value), 'latin1') : raw;
      if (needles.some((needle) => contents.includes(needle))) throw new Error(`Configured credential ${key} was found in ${path}. The value was not printed.`);
    }
  }
  return { files: files.length, checkedCredentials: credentials.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (existsSync('.env')) process.loadEnvFile('.env');
    const result = scanRelease();
    console.log(`Static release checked: ${result.files} files; no configured Contentstack credentials or server-only files found.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release artifact validation failed.');
    process.exitCode = 1;
  }
}
