import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(root, 'test-results/selenium');
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const env = {
  ...process.env,
  SE_CACHE_PATH: process.env.SE_CACHE_PATH || resolve(root, '.cache/selenium'),
  SE_AVOID_STATS: 'true',
  SELENIUM_BASE_URL: 'http://127.0.0.1:4372',
  SELENIUM_ARTIFACTS: directory,
};
let preview;
let tests;
let stopping = false;
function stopPreview() {
  if (stopping) return;
  stopping = true;
  if (preview?.pid) {
    try { process.kill(-preview.pid, 'SIGTERM'); } catch { preview.kill('SIGTERM'); }
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  tests?.kill('SIGTERM');
  stopPreview();
});
try {
  try {
    await fetch(env.SELENIUM_BASE_URL, { signal: AbortSignal.timeout(500) });
    throw new Error('Port 4372 is already occupied; Selenium requires its own built-site preview.');
  } catch (error) {
    if (error.message.includes('already occupied')) throw error;
  }
  preview = spawn(process.execPath, ['scripts/serve.mjs', '--port', '4372'], { cwd: root, env, detached: true, stdio: 'inherit' });
  let exited;
  preview.on('exit', code => { exited = code ?? 1; });
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline && exited === undefined) {
    try { if ((await fetch(env.SELENIUM_BASE_URL, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Owned static preview is starting. */ }
    await new Promise(done => setTimeout(done, 100));
  }
  if (!ready) throw new Error('The built-site Selenium preview did not become ready. Run npm run build first.');
  const manifest = { mode: 'local-static-build', baseURL: env.SELENIUM_BASE_URL,
    browser: env.BROWSER || 'chrome', remote: Boolean(env.SELENIUM_REMOTE_URL), startedAt: new Date().toISOString() };
  writeFileSync(resolve(directory, 'run.json'), JSON.stringify(manifest, null, 2));
  tests = spawn(process.execPath, [
    '--test', '--test-concurrency=1', '--test-reporter=spec', '--test-reporter=junit',
    '--test-reporter-destination=stdout', `--test-reporter-destination=${resolve(directory, 'junit.xml')}`,
    ...(process.env.SELENIUM_TEST_NAME_PATTERN ? ['--test-name-pattern', process.env.SELENIUM_TEST_NAME_PATTERN] : []),
    'tests/selenium/site.test.mjs',
  ], { cwd: root, env, stdio: 'inherit' });
  const code = await new Promise((done, reject) => { tests.on('error', reject); tests.on('exit', code => done(code ?? 1)); });
  writeFileSync(resolve(directory, 'run.json'), JSON.stringify({ ...manifest, finishedAt: new Date().toISOString(), exitCode: Number(code) }, null, 2));
  process.exitCode = Number(code);
} finally {
  stopPreview();
  if (preview && preview.exitCode === null) await new Promise(done => {
    preview.once('exit', done);
    setTimeout(() => {
      try { process.kill(-preview.pid, 'SIGKILL'); } catch { /* Already exited. */ }
      done();
    }, 5_000).unref();
  });
}
