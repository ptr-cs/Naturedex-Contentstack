import { existsSync, readFileSync } from 'node:fs';
import { contentstackRequest, regionEndpoints, type CmsEntry, type ManagementConfig } from '../../src/lib/contentstack.ts';

/** Asset-library folder that holds every species sprite. */
export const SPRITE_FOLDER = 'Naturedex sprites';
const ART = new URL('../../art/sprites/', import.meta.url);
const MAX_SPRITE_BYTES = 512 * 1024;

export interface SpriteAssets { still: string; animated: string | null }

/** Uploaded file names: `<species-id>.svg` and `<species-id>-animated.svg`. */
export function spriteFiles(id: string): { still: { name: string; path: URL }; animated: { name: string; path: URL } | null } {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Invalid species ID for a sprite file.');
  const still = new URL(`${id}.svg`, ART);
  if (!existsSync(still)) throw new Error(`No sprite art at art/sprites/${id}.svg.`);
  const animated = new URL(`animated/${id}.svg`, ART);
  return { still: { name: `${id}.svg`, path: still }, animated: existsSync(animated) ? { name: `${id}-animated.svg`, path: animated } : null };
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

async function upload(config: ManagementConfig, folder: string, name: string, path: URL, title: string, fetchImpl: typeof fetch): Promise<string> {
  const bytes = readFileSync(path);
  if (bytes.length > MAX_SPRITE_BYTES) throw new Error(`${name} is larger than 512 KB.`);
  const form = new FormData();
  form.append('asset[upload]', new Blob([bytes], { type: 'image/svg+xml' }), name);
  form.append('asset[parent_uid]', folder);
  form.append('asset[title]', title);
  const data = await contentstackRequest(api(config, 'assets'), managementHeaders(config, false), { method: 'POST', body: form, fetchImpl });
  const uid = (data.asset as CmsEntry | undefined)?.uid;
  if (typeof uid !== 'string') throw new Error(`Contentstack did not return an asset UID for ${name}.`);
  return uid;
}

/**
 * Finds or uploads the still and animated sprite for each species. Never
 * replaces or deletes an existing asset; matching is by file name.
 */
export async function ensureSpriteAssets(
  config: ManagementConfig, species: { id: string; name: string }[], fetchImpl: typeof fetch = fetch,
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
  for (const { id, name } of species) {
    const files = spriteFiles(id);
    let still = existing.get(files.still.name);
    if (!still) { still = await upload(config, folder, files.still.name, files.still.path, name, fetchImpl); uploaded++; await pause(); }
    let animated: string | null = null;
    if (files.animated) {
      animated = existing.get(files.animated.name) ?? null;
      if (!animated) { animated = await upload(config, folder, files.animated.name, files.animated.path, `${name} (animated)`, fetchImpl); uploaded++; await pause(); }
    }
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
