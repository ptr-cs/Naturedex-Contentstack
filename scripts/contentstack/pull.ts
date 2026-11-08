import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateContentSnapshot, type ContentSnapshot } from '../../src/lib/content.ts';
import { getContentstackConfig, pullContentstack } from '../../src/lib/contentstack.ts';

export async function writeSnapshotAtomically(snapshot: ContentSnapshot, filePath: string): Promise<void> {
  const validated = validateContentSnapshot(snapshot);
  const destination = resolve(filePath);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
}

export async function main(): Promise<void> {
  if (process.argv.length > 2) throw new Error('cms:pull does not accept arguments. Configure Contentstack through the private environment.');
  const snapshot = await pullContentstack(getContentstackConfig());
  await writeSnapshotAtomically(snapshot, resolve(process.cwd(), 'data/content.json'));
  console.log(JSON.stringify({ source: snapshot.source, syncedAt: snapshot.syncedAt, species: snapshot.species.length, publishedPosts: snapshot.posts.length, output: 'data/content.json' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Contentstack pull failed.');
    process.exitCode = 1;
  });
}
