import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readContentSnapshot } from '../../src/lib/content.ts';
import {
  contentstackRequest, editorUrl, fetchPublishedEntries, getContentstackConfig,
  getManagementConfig, normalizeContentstackEntries, pullContentstack,
  regionEndpoints, type CmsEntry,
} from '../../src/lib/contentstack.ts';
import { importMissingContent, postEntry, readModels, speciesEntry } from '../../scripts/contentstack/import.ts';
import { writeSnapshotAtomically } from '../../scripts/contentstack/pull.ts';

const seed = readContentSnapshot();
const env = {
  CONTENTSTACK_API_KEY: 'test-stack-key', CONTENTSTACK_DELIVERY_TOKEN: 'test-delivery-token',
  CONTENTSTACK_ENVIRONMENT: 'production', CONTENTSTACK_MANAGEMENT_TOKEN: 'test-management-token',
};
const config = getContentstackConfig(env);
const management = getManagementConfig(env);
const cmsSpecies: CmsEntry[] = seed.species.map((item, index) => ({ ...speciesEntry(item), uid: 'species_' + index }));
const uidById = new Map(seed.species.map((item, index) => [item.id, 'species_' + index]));
const cmsPosts = seed.posts.map((item, index) => ({
  ...postEntry(item, uidById), uid: 'post_' + index,
  created_at: item.createdAt, updated_at: item.updatedAt,
}));
const syncedAt = '2026-11-06T12:00:00.000Z';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function mockFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async (input, init) => handler(new URL(String(input)), init || {}));
}
const modelRecords = () => readModels().map((model) => structuredClone(model.content_type));

describe('Contentstack configuration and transport boundaries', () => {
  it('uses official regional endpoints and keeps management credentials separate', () => {
    expect(config).toMatchObject({ region: 'aws-na', locale: 'en-us', environment: 'production' });
    expect(config).not.toHaveProperty('managementToken');
    expect(management).not.toHaveProperty('deliveryToken');
    for (const region of Object.keys(regionEndpoints)) {
      expect(getContentstackConfig({ ...env, CONTENTSTACK_REGION: region }).region).toBe(region);
    }
    expect(getContentstackConfig({ ...env, CONTENTSTACK_BRANCH: 'development', CONTENTSTACK_LOCALE: 'en-GB' }).branch).toBe('development');
  });

  it.each([
    { CONTENTSTACK_API_KEY: '' }, { CONTENTSTACK_DELIVERY_TOKEN: '' },
    { CONTENTSTACK_ENVIRONMENT: '' }, { CONTENTSTACK_REGION: 'https://attacker.invalid' },
    { CONTENTSTACK_LOCALE: '../en-us' }, { CONTENTSTACK_BRANCH: 'main\r\nsecret' },
    { CONTENTSTACK_API_KEY: 'bad\r\nheader' },
  ])('rejects invalid delivery configuration without echoing values: %j', (change) => {
    expect(() => getContentstackConfig({ ...env, ...change })).toThrow();
  });

  it('links to the editor for the configured region unless an explicit editor URL is given', () => {
    expect(editorUrl({})).toBe('https://app.contentstack.com/');
    expect(editorUrl({ CONTENTSTACK_REGION: 'aws-eu' })).toBe('https://eu-app.contentstack.com/');
    expect(editorUrl({ CONTENTSTACK_REGION: 'azure-na' })).toBe('https://azure-na-app.contentstack.com/');
    expect(editorUrl({ CONTENTSTACK_REGION: 'aws-eu', CONTENTSTACK_EDITOR_URL: ' ' })).toBe('https://eu-app.contentstack.com/');
    expect(editorUrl({ CONTENTSTACK_REGION: 'aws-eu', CONTENTSTACK_EDITOR_URL: 'https://example.com/stack' })).toBe('https://example.com/stack');
    expect(() => editorUrl({ CONTENTSTACK_EDITOR_URL: 'http://app.contentstack.com/' })).toThrow('HTTPS');
    expect(() => editorUrl({ CONTENTSTACK_EDITOR_URL: 'https://user:pw@app.contentstack.com/' })).toThrow('credentials');
    expect(() => editorUrl({ CONTENTSTACK_REGION: 'mars' })).toThrow('Unsupported');
  });

  it('requires an explicit management token', () => {
    expect(() => getManagementConfig({ CONTENTSTACK_API_KEY: 'test-stack-key' })).toThrow('CONTENTSTACK_MANAGEMENT_TOKEN');
  });

  it.each(['https://attacker.invalid/v3', 'http://cdn.contentstack.io/v3', 'https://user:pass@cdn.contentstack.io/v3'])('rejects endpoint %s before fetch', async (address) => {
    const fetchImpl = mockFetch(() => json({}));
    await expect(contentstackRequest(new URL(address), {}, { fetchImpl })).rejects.toThrow('unofficial');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends tokens in headers, disables redirects, and supplies a timeout signal', async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url.origin).toBe('https://cdn.contentstack.io');
      expect(url.href).not.toContain(env.CONTENTSTACK_DELIVERY_TOKEN);
      expect(init.headers).toMatchObject({ api_key: env.CONTENTSTACK_API_KEY, access_token: env.CONTENTSTACK_DELIVERY_TOKEN });
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return json({ entries: [], count: 0 });
    });
    await fetchPublishedEntries({ ...config, branch: 'development' }, 'species', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('fails closed on network errors without leaking their credential-bearing messages', async () => {
    const fetchImpl = mockFetch(() => { throw new Error(env.CONTENTSTACK_DELIVERY_TOKEN); });
    const failure = await contentstackRequest(new URL('https://cdn.contentstack.io/v3'), {}, { fetchImpl }).catch((error: Error) => error);
    expect(String(failure)).toContain('failed or timed out');
    expect(String(failure)).not.toContain(env.CONTENTSTACK_DELIVERY_TOKEN);
  });

  it('aborts requests that exceed the configured timeout', async () => {
    const fetchImpl = mockFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }));
    await expect(contentstackRequest(new URL('https://cdn.contentstack.io/v3'), {}, { fetchImpl, timeoutMs: 5 })).rejects.toThrow('timed out');
  });

  it.each([401, 403, 429, 500])('reports HTTP %i without reading or logging response credentials', async (status) => {
    const fetchImpl = mockFetch(() => json({ error: env.CONTENTSTACK_MANAGEMENT_TOKEN }, status));
    await expect(contentstackRequest(new URL('https://cdn.contentstack.io/v3'), {}, { fetchImpl })).rejects.toThrow('HTTP ' + status);
  });

  it.each(['not json', '[]', 'null'])('rejects malformed response %s', async (body) => {
    const fetchImpl = mockFetch(() => new Response(body));
    await expect(contentstackRequest(new URL('https://cdn.contentstack.io/v3'), {}, { fetchImpl })).rejects.toThrow();
  });

  it('limits response size', async () => {
    const fetchImpl = mockFetch(() => json({ value: 'x'.repeat(15000001) }));
    await expect(contentstackRequest(new URL('https://cdn.contentstack.io/v3'), {}, { fetchImpl })).rejects.toThrow('size');
  });
});

describe('complete published content pagination', () => {
  it('fetches every page using the selected environment, locale and branch', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ uid: 'entry_' + index }));
    const fetchImpl = mockFetch((url, init) => {
      expect(url.searchParams.get('environment')).toBe('production');
      expect(url.searchParams.get('locale')).toBe('en-us');
      expect(url.searchParams.get('limit')).toBe('100');
      expect(init.headers).toMatchObject({ branch: 'development' });
      return json({ count: 101, entries: url.searchParams.get('skip') === '0' ? first : [{ uid: 'entry_100' }] });
    });
    const entries = await fetchPublishedEntries({ ...config, branch: 'development' }, 'species', fetchImpl);
    expect(entries).toHaveLength(101);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    { entries: [], count: 1 }, { entries: [{ uid: 'x' }], count: 0 },
    { entries: [], count: -1 }, { entries: [], count: 10001 },
    { entries: [], count: 1.5 }, { entries: {} , count: 0 },
    { entries: [{}], count: 1 }, { entries: [null], count: 1 },
    { entries: [{ uid: 'x' }, { uid: 'x' }], count: 2 },
  ])('rejects inconsistent or incomplete pages: %j', async (page) => {
    await expect(fetchPublishedEntries(config, 'species', mockFetch(() => json(page)))).rejects.toThrow();
  });

  it('treats an empty first page without a count as zero, as Contentstack sends it, but not a later page', async () => {
    await expect(fetchPublishedEntries(config, 'species', mockFetch(() => json({ entries: [] })))).resolves.toEqual([]);
    await expect(fetchPublishedEntries(config, 'species', mockFetch(() => json({ entries: [{ uid: 'x' }] })))).rejects.toThrow();
    let page = 0;
    const fetchImpl = mockFetch(() => json(++page === 1 ? { entries: [{ uid: 'x' }], count: 2 } : { entries: [] }));
    await expect(fetchPublishedEntries(config, 'species', fetchImpl)).rejects.toThrow();
  });

  it('rejects a changing total rather than silently assembling different publication states', async () => {
    let page = 0;
    const fetchImpl = mockFetch(() => json(++page === 1 ? { entries: [{ uid: 'x' }], count: 2 } : { entries: [{ uid: 'y' }], count: 3 }));
    await expect(fetchPublishedEntries(config, 'species', fetchImpl)).rejects.toThrow('changed during pagination');
  });
});

describe('native field normalization and references', () => {
  it('round trips all original species and all four current published posts', () => {
    const result = normalizeContentstackEntries(cmsSpecies, cmsPosts, syncedAt);
    expect(result.source).toBe('contentstack');
    expect(result.syncedAt).toBe(syncedAt);
    expect(result.species).toEqual(seed.species);
    expect(result.posts).toHaveLength(4);
    for (const post of seed.posts) expect(result.posts.find((candidate) => candidate.id === post.id)).toEqual(post);
    expect(result.posts.some((post) => post.slug === 'test-post-about-deer')).toBe(true);
  });

  it('retains unknown measurement ranges as null and accepts explicitly sourced zero endpoints', () => {
    const entry = structuredClone(cmsSpecies[0]);
    entry.size = { length_min_cm: 0, length_max_cm: 1 };
    const result = normalizeContentstackEntries([entry], [], syncedAt);
    expect(result.species[0].size).toEqual({ lengthCm: [0, 1], weightKg: null, note: '' });
  });

  it.each([
    { length_min_cm: 1 }, { length_min_cm: -1, length_max_cm: 2 },
    { length_min_cm: 2, length_max_cm: 1 }, { weight_min_kg: '1', weight_max_kg: 2 },
  ])('rejects malformed measurement pairs: %j', (size) => {
    expect(() => normalizeContentstackEntries([{ ...cmsSpecies[0], size }], [], syncedAt)).toThrow();
  });

  it.each([
    [{ uid: 'unpublished_species', _content_type_uid: 'species' }],
    [{ uid: cmsSpecies[0].uid, _content_type_uid: 'other_type' }],
    [null], ['species_0'], {},
  ])('rejects missing, unpublished or invalid species references: %j', (related_species) => {
    expect(() => normalizeContentstackEntries(cmsSpecies, [{ ...cmsPosts[0], related_species }], syncedAt)).toThrow();
  });

  it('rejects duplicate native species UIDs', () => {
    expect(() => normalizeContentstackEntries([cmsSpecies[0], cmsSpecies[0]], [], syncedAt)).toThrow('unique');
  });

  it('uses native timestamps and permits an article without optional labels/dates/references', () => {
    const result = normalizeContentstackEntries(cmsSpecies, [{
      stable_id: 'standalone', slug: 'standalone', title: 'Standalone', body: 'A field note.',
    }], syncedAt);
    expect(result.posts[0]).toMatchObject({ category: 'Field notes', excerpt: '', relatedSpeciesIds: [], status: 'published' });
    expect(result.posts[0]).not.toHaveProperty('author');
    expect(result.posts[0]).not.toHaveProperty('publishedAt');
  });

  it('combines the two published collections without fetching any management endpoint', async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.origin).toBe(regionEndpoints['aws-na'].delivery);
      const entries = url.pathname.includes('/species/') ? cmsSpecies : cmsPosts;
      return json({ entries, count: entries.length });
    });
    const result = await pullContentstack(config, fetchImpl);
    expect(result.posts).toHaveLength(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('atomic snapshots and safe native import', () => {
  it('preserves the last snapshot on validation failure and replaces it only with fully valid content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'naturedex-snapshot-test-'));
    const file = join(directory, 'content.json');
    try {
      await writeFile(file, 'previous reviewed snapshot');
      await expect(writeSnapshotAtomically({ ...seed, source: 'contentstack', syncedAt: null }, file)).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe('previous reviewed snapshot');
      const result = normalizeContentstackEntries(cmsSpecies, cmsPosts, syncedAt);
      await writeSnapshotAtomically(result, file);
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(result);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('skips existing CMS entries even when editors changed their content, issuing no writes', async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(init.method).toBe('GET');
      if (url.pathname === '/v3/content_types') return json({ content_types: modelRecords(), count: 2 });
      const entries = url.pathname.includes('/species/') ? cmsSpecies : cmsPosts.map((post) => ({ ...post, body: 'An authored edit that must survive.' }));
      return json({ entries, count: entries.length });
    });
    const result = await importMissingContent(seed, management, fetchImpl);
    expect(result).toMatchObject({ createdModels: 0, createdSpecies: 0, createdPosts: 0, skippedPosts: 4, published: 0 });
  });

  it('creates missing models and entries with native references, never updating or publishing', async () => {
    let created = 0;
    const writes: { path: string; body: CmsEntry }[] = [];
    const fetchImpl = mockFetch((url, init) => {
      expect(init.headers).toMatchObject({ authorization: env.CONTENTSTACK_MANAGEMENT_TOKEN });
      // A fresh stack: Contentstack omits `count` on empty lists.
      if (init.method === 'GET') return json(url.pathname === '/v3/content_types' ? { content_types: [] } : { entries: [] });
      expect(init.method).toBe('POST');
      expect(url.pathname).not.toContain('publish');
      const body = JSON.parse(String(init.body)) as CmsEntry;
      writes.push({ path: url.pathname, body });
      return url.pathname === '/v3/content_types' ? json(body) : json({ entry: { ...(body.entry as CmsEntry), uid: 'created_' + (++created) } });
    });
    const result = await importMissingContent(seed, management, fetchImpl);
    expect(result).toMatchObject({ createdModels: 2, createdSpecies: 24, createdPosts: 4, published: 0 });
    expect(writes).toHaveLength(30);
    const postWrite = writes.find((write) => write.path.includes('/blog_post/entries'))!;
    const entry = postWrite.body.entry as CmsEntry;
    expect(entry.related_species).toEqual(seed.posts[0].relatedSpeciesIds.map((id) => ({ uid: 'created_' + (seed.species.findIndex((species) => species.id === id) + 1), _content_type_uid: 'species' })));
    expect(entry).not.toHaveProperty('created_at');
    expect(entry).not.toHaveProperty('updated_at');
  });

  it('refuses to overwrite an incompatible model before any writes', async () => {
    const fetchImpl = mockFetch(() => json({ content_types: [{ uid: 'species', schema: [] }], count: 1 }));
    await expect(importMissingContent(seed, management, fetchImpl)).rejects.toThrow('incompatible');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('blocks an existing slug owned by another stable ID', async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(init.method).toBe('GET');
      if (url.pathname === '/v3/content_types') return json({ content_types: modelRecords(), count: 2 });
      const entries = url.pathname.includes('/species/') ? cmsSpecies : [{ ...cmsPosts[0], stable_id: 'different-entry' }];
      return json({ entries, count: entries.length });
    });
    await expect(importMissingContent(seed, management, fetchImpl)).rejects.toThrow('slug');
  });

  it('refuses a reference when no corresponding native species entry exists', () => {
    expect(() => postEntry(seed.posts[0], new Map())).toThrow('referenced species');
  });

  it('omits absent publication dates and supplies a default historical author label for imports', () => {
    expect(postEntry({ ...seed.posts[0], author: undefined, publishedAt: undefined, relatedSpeciesIds: [] }, new Map())).toMatchObject({ author: 'Naturedex editors', related_species: [] });
  });
});
