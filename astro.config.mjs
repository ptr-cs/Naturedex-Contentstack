import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) loadEnvFile('.env');
const site = process.env.SITE_URL || 'http://localhost:4321';
const url = new URL(site);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('SITE_URL must be an HTTP(S) origin without credentials, paths, or query parameters.');
}

export default defineConfig({
  site: url.origin,
  output: 'static',
  trailingSlash: 'always',
  integrations: [react()],
  server: { host: '127.0.0.1', port: 4321 },
  build: { format: 'directory' },
});
