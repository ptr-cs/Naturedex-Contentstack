import { existsSync, readFileSync } from 'node:fs';
import { contentstackImageHosts } from '../../src/lib/content.ts';
import { contentstackRequest, regionEndpoints, type CmsEntry, type ManagementConfig } from '../../src/lib/contentstack.ts';

/** Asset-library folder that holds every species sprite. */
export const SPRITE_FOLDER = 'Naturedex sprites';
const ART = new URL('../../art/sprites/', import.meta.url);
const MAX_SPRITE_BYTES = 512 * 1024;

export interface SpriteAssets { still: string; animated: string | null }

/**
 * Where a species' sprites can come from, in order of preference: assets the
 * entry already links to, assets of the same name in the sprite folder, art
 * in the repository, then the published copies a content snapshot points to.
 * The repository is optional: a species created in Contentstack has no art here.
 */
export interface SpriteSource {
  id: string;
  name: string;
  linked?: { still: string | null; animated: string | null };
  urls?: { still: string; animated: string | null };
}

const spriteName = (id: string, animated: boolean) => `${id}${animated ? '-animated' : ''}.svg`;

/** Repository art for a species, or null when it only exists in Contentstack. */
export function spriteFiles(id: string): { still: { name: string; path: URL }; animated: { name: string; path: URL } | null } | null {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Invalid species ID for a sprite file.');
  const still = new URL(`${id}.svg`, ART);
  if (!existsSync(still)) return null;
  const animated = new URL(`animated/${id}.svg`, ART);
  return { still: { name: spriteName(id, false), path: still }, animated: existsSync(animated) ? { name: spriteName(id, true), path: animated } : null };
}

/** Copies a published sprite from Contentstack's image CDN (and nowhere else). */
async function download(url: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !(contentstackImageHosts as readonly string[]).includes(parsed.hostname))
    throw new Error(`Refusing to copy a sprite from ${parsed.host}: only Contentstack's image CDN is allowed.`);
  const response = await fetchImpl(parsed, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_SPRITE_BYTES) throw new Error(`${url} is larger than 512 KB.`);
  if (!/<svg\b/.test(new TextDecoder().decode(bytes.subarray(0, 4096)))) throw new Error(`${url} is not an SVG.`);
  return bytes;
}

export function managementHeaders(config: ManagementConfig, json = true): Record<string, string> {
  return {
    api_key: config.apiKey, authorization: config.managementToken,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(config.branch ? { branch: config.branch } : {}),
  };
}

const api = (config: ManagementConfig, path: string) => new URL(`/v3/${path}`, regionEndpoints[config.region].management);

/** Contentstack allows about 10 management requests per second. */
export const pause = (ms = 120) => new Promise((resolve) => setTimeout(resolve, process.env.VITEST ? 0 : ms));

async function listAssets(config: ManagementConfig, query: Record<string, string>, fetchImpl: typeof fetch): Promise<CmsEntry[]> {
  const assets: CmsEntry[] = [];
  for (let page = 0; page < 50; page++) {
    const url = api(config, 'assets');
    url.search = new URLSearchParams({ ...query, include_count: 'true', limit: '100', skip: String(assets.length) }).toString();
    const data = await contentstackRequest(url, managementHeaders(config), { fetchImpl });
    const records = Array.isArray(data.assets) ? data.assets as CmsEntry[] : [];
    assets.push(...records);
    const count = typeof data.count === 'number' ? data.count : assets.length; // omitted on empty lists
    if (!records.length || assets.length >= count) return assets;
  }
  throw new Error('Asset listing exceeded the project limit.');
}

export async function findSpriteFolder(config: ManagementConfig, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const folders = await listAssets(config, { include_folders: 'true', query: JSON.stringify({ is_dir: true, name: SPRITE_FOLDER }) }, fetchImpl);
  const match = folders.filter((folder) => folder.is_dir === true && folder.name === SPRITE_FOLDER);
  if (match.length > 1) throw new Error(`More than one "${SPRITE_FOLDER}" folder exists. Merge them in Contentstack first.`);
  return typeof match[0]?.uid === 'string' ? match[0].uid : null;
}

/** Existing sprite assets in the folder, by file name. */
export async function existingSprites(config: ManagementConfig, folder: string | null, fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  if (!folder) return new Map();
  const assets = await listAssets(config, { folder }, fetchImpl);
  const byName = new Map<string, string>();
  for (const asset of assets) {
    if (asset.is_dir || typeof asset.filename !== 'string' || typeof asset.uid !== 'string') continue;
    if (byName.has(asset.filename)) throw new Error(`Two assets named ${asset.filename} are in "${SPRITE_FOLDER}". Delete one in Contentstack first.`);
    byName.set(asset.filename, asset.uid);
  }
  return byName;
}

async function upload(config: ManagementConfig, folder: string, name: string, bytes: Uint8Array, title: string, fetchImpl: typeof fetch): Promise<string> {
  if (bytes.length > MAX_SPRITE_BYTES) throw new Error(`${name} is larger than 512 KB.`);
  const form = new FormData();
  form.append('asset[upload]', new Blob([new Uint8Array(bytes)], { type: 'image/svg+xml' }), name);
  form.append('asset[parent_uid]', folder);
  form.append('asset[title]', title);
  const data = await contentstackRequest(api(config, 'assets'), managementHeaders(config, false), { method: 'POST', body: form, fetchImpl });
  const uid = (data.asset as CmsEntry | undefined)?.uid;
  if (typeof uid !== 'string') throw new Error(`Contentstack did not return an asset UID for ${name}.`);
  return uid;
}

/**
 * Finds or uploads the still and animated sprite for each species (see
 * SpriteSource for the order). Never replaces or deletes an existing asset.
 */
export async function ensureSpriteAssets(
  config: ManagementConfig, species: SpriteSource[], fetchImpl: typeof fetch = fetch,
): Promise<{ assets: Map<string, SpriteAssets>; uploaded: number; folderCreated: boolean }> {
  let folder = await findSpriteFolder(config, fetchImpl);
  let folderCreated = false;
  if (!folder) {
    const data = await contentstackRequest(api(config, 'assets/folders'), managementHeaders(config), { method: 'POST', body: { asset: { name: SPRITE_FOLDER } }, fetchImpl });
    const uid = (data.asset as CmsEntry | undefined)?.uid;
    if (typeof uid !== 'string') throw new Error('Contentstack did not return the new folder UID.');
    folder = uid; folderCreated = true;
  }
  const existing = await existingSprites(config, folder, fetchImpl);
  const assets = new Map<string, SpriteAssets>();
  let uploaded = 0;
  for (const { id, name, linked, urls } of species) {
    if (linked?.still) { assets.set(id, { still: linked.still, animated: linked.animated }); continue; }
    const files = spriteFiles(id);
    const source = (animated: boolean): (() => Promise<Uint8Array>) | null => {
      const file = animated ? files?.animated : files?.still;
      if (file) return async () => readFileSync(file.path);
      const url = files ? null : animated ? urls?.animated : urls?.still;
      return url ? () => download(url, fetchImpl) : null;
    };
    let still = existing.get(spriteName(id, false));
    if (!still) {
      const bytes = source(false);
      if (!bytes) throw new Error(`No sprite for ${id}: nothing in art/sprites/, the "${SPRITE_FOLDER}" folder or a published asset to copy.`);
      still = await upload(config, folder, spriteName(id, false), await bytes(), name, fetchImpl); uploaded++; await pause();
    }
    let animated = existing.get(spriteName(id, true)) ?? null;
    const animatedBytes = animated ? null : source(true);
    if (animatedBytes) { animated = await upload(config, folder, spriteName(id, true), await animatedBytes(), `${name} (animated)`, fetchImpl); uploaded++; await pause(); }
    assets.set(id, { still, animated });
  }
  return { assets, uploaded, folderCreated };
}

export async function publish(
  config: ManagementConfig, environment: string, target: { asset: string } | { entry: string; contentType: string }, fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const scope = { environments: [environment], locales: [config.locale] };
  if ('asset' in target) {
    await contentstackRequest(api(config, `assets/${target.asset}/publish`), managementHeaders(config), { method: 'POST', body: { asset: scope }, fetchImpl });
  } else {
    await contentstackRequest(api(config, `content_types/${target.contentType}/entries/${target.entry}/publish`), managementHeaders(config), { method: 'POST', body: { entry: scope, locale: config.locale }, fetchImpl });
  }
}
