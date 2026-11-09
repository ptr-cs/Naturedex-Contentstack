import { describe, expect, it, vi } from 'vitest';
import { getManagementConfig, type CmsEntry } from '../../src/lib/contentstack.ts';
import { apply, finalize, plan } from '../../scripts/contentstack/migrate-sprites.ts';

const config = getManagementConfig({ CONTENTSTACK_API_KEY: 'k', CONTENTSTACK_MANAGEMENT_TOKEN: 'm', CONTENTSTACK_REGION: 'aws-eu' });
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

/** A small in-memory stack: the species type with the old text field and two entries. */
function stack(entryOverrides: CmsEntry[] = [{}, {}]) {
  const state = {
    schema: [{ uid: 'title', data_type: 'text' }, { uid: 'stable_id', data_type: 'text' }, { uid: 'sprite', data_type: 'text', mandatory: true }, { uid: 'description', data_type: 'text' }] as CmsEntry[],
    entries: [
      { uid: 'e1', stable_id: 'monarch', title: 'Monarch', sprite: '/sprites/monarch.svg', description: 'Orange.', _version: 3, ...entryOverrides[0] },
      { uid: 'e2', stable_id: 'red-fox', title: 'Red Fox', sprite: '/sprites/red-fox.svg', description: 'Red.', _version: 1, ...entryOverrides[1] },
    ] as CmsEntry[],
    folder: null as string | null,
    assets: [] as CmsEntry[],
    calls: [] as { method: string; path: string; body?: CmsEntry }[],
  };
  const fetchImpl = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    const body = init.body instanceof FormData ? undefined : init.body ? JSON.parse(String(init.body)) as CmsEntry : undefined;
    state.calls.push({ method, path: url.pathname, body });
    if (method === 'GET' && url.pathname === '/v3/content_types/species') return json({ content_type: { uid: 'species', title: 'Species', options: {}, schema: state.schema } });
    if (method === 'PUT' && url.pathname === '/v3/content_types/species') { state.schema = (body!.content_type as CmsEntry).schema as CmsEntry[]; return json({}); }
    if (method === 'GET' && url.pathname === '/v3/content_types/species/entries') return json({ entries: state.entries, count: state.entries.length });
    if (method === 'GET' && url.pathname === '/v3/assets') {
      if (url.searchParams.get('include_folders')) return json(state.folder ? { assets: [{ uid: state.folder, is_dir: true, name: 'Naturedex sprites' }], count: 1 } : { assets: [] });
      return json(state.assets.length ? { assets: state.assets, count: state.assets.length } : { assets: [] });
    }
    if (method === 'POST' && url.pathname === '/v3/assets/folders') { state.folder = 'folder1'; return json({ asset: { uid: 'folder1' } }); }
    if (method === 'POST' && url.pathname === '/v3/assets') {
      const file = (init.body as FormData).get('asset[upload]') as File;
      const asset = { uid: 'a_' + file.name, filename: file.name };
      state.assets.push(asset);
      return json({ asset });
    }
    if (method === 'PUT' && url.pathname.startsWith('/v3/content_types/species/entries/')) {
      const uid = url.pathname.split('/').pop();
      Object.assign(state.entries.find((entry) => entry.uid === uid)!, body!.entry);
      return json({ entry: {} });
    }
    if (method === 'POST' && url.pathname.endsWith('/publish')) return json({ notice: 'queued' });
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });
  return { state, fetchImpl };
}

describe('sprite migration', () => {
  it('plans without writing anything', async () => {
    const { state, fetchImpl } = stack();
    expect(await plan(config, fetchImpl)).toEqual({
      mode: 'plan', species: 2, assetFieldsPresent: false, legacyTextFieldPresent: true, folderExists: false, assetsToUpload: 4, entriesToLink: 2,
    });
    expect(state.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('adds optional asset fields, uploads, links every entry without dropping fields, and publishes', async () => {
    const { state, fetchImpl } = stack();
    const result = await apply(config, 'production', fetchImpl);
    expect(result).toEqual({ mode: 'applied', fieldsAdded: true, folderCreated: true, uploaded: 4, linked: 2, publishedAssets: 4, publishedEntries: 2 });
    // New fields sit right after the old one, which stays (older deploys still read it).
    expect(state.schema.map((field) => field.uid)).toEqual(['title', 'stable_id', 'sprite', 'sprite_image', 'sprite_animation', 'description']);
    expect(state.schema.find((field) => field.uid === 'sprite_image')).toMatchObject({ data_type: 'file', mandatory: false, extensions: ['svg'] });
    const update = state.calls.find((call) => call.method === 'PUT' && call.path.endsWith('/entries/e1'))!.body!.entry as CmsEntry;
    expect(update).toEqual({ title: 'Monarch', stable_id: 'monarch', sprite: '/sprites/monarch.svg', description: 'Orange.', sprite_image: 'a_monarch.svg', sprite_animation: 'a_monarch-animated.svg' });
    const publishes = state.calls.filter((call) => call.path.endsWith('/publish'));
    expect(publishes.slice(0, 4).every((call) => call.path.startsWith('/v3/assets/'))).toBe(true);
    expect(publishes.slice(4).map((call) => call.path)).toEqual(['/v3/content_types/species/entries/e1/publish', '/v3/content_types/species/entries/e2/publish']);
    expect(publishes[4].body).toEqual({ entry: { environments: ['production'], locales: ['en-us'] }, locale: 'en-us' });
  });

  it('is safe to rerun: nothing is uploaded or relinked twice', async () => {
    const { state, fetchImpl } = stack();
    await apply(config, 'production', fetchImpl);
    state.calls.length = 0;
    expect(await apply(config, 'production', fetchImpl)).toMatchObject({ fieldsAdded: false, folderCreated: false, uploaded: 0, linked: 0 });
    expect(state.calls.some((call) => call.method === 'PUT' || call.path === '/v3/assets/folders')).toBe(false);
  });

  it('finalizes only when every entry has a sprite, then removes the old field and requires the new one', async () => {
    const unlinked = stack([{ sprite_image: 'a1' }, {}]);
    await expect(finalize(config, unlinked.fetchImpl)).rejects.toThrow('red-fox');
    expect(unlinked.state.calls.some((call) => call.method === 'PUT')).toBe(false);

    const { state, fetchImpl } = stack();
    await apply(config, 'production', fetchImpl);
    await finalize(config, fetchImpl);
    expect(state.schema.map((field) => field.uid)).toEqual(['title', 'stable_id', 'sprite_image', 'sprite_animation', 'description']);
    expect(state.schema.find((field) => field.uid === 'sprite_image')!.mandatory).toBe(true);
  });
});
