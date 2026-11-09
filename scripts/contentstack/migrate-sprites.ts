/**
 * Moves species sprites from the repository into the Contentstack asset library.
 *
 *   npm run cms:migrate-sprites                 read-only plan
 *   npm run cms:migrate-sprites -- --apply      add the asset fields, upload, link, publish
 *   npm run cms:migrate-sprites -- --finalize   remove the old text field, require a sprite
 *
 * Run --apply first. Deploy the code that reads the asset fields. Then run
 * --finalize: until then, the old `sprite` text field keeps older deploys working.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentstackRequest, getManagementConfig, regionEndpoints, type CmsEntry, type ManagementConfig } from '../../src/lib/contentstack.ts';
import { ensureSpriteAssets, existingSprites, findSpriteFolder, managementHeaders, pause, publish, spriteFiles } from './assets.ts';

const LEGACY = 'sprite';
const api = (config: ManagementConfig, path: string) => new URL(`/v3/${path}`, regionEndpoints[config.region].management);

function newFields(mandatory: boolean): CmsEntry[] {
  // Same definitions as contentstack/content-types/species.json.
  return [
    { uid: 'sprite_image', display_name: 'Sprite', data_type: 'file', mandatory, multiple: false, unique: false, extensions: ['svg'],
      field_metadata: { description: '48×48 pixel-art SVG from the asset library (the "Naturedex sprites" folder).', rich_text_type: 'standard', image: true } },
    { uid: 'sprite_animation', display_name: 'Animated sprite', data_type: 'file', mandatory: false, multiple: false, unique: false, extensions: ['svg'],
      field_metadata: { description: 'Optional three-pose animated SVG. Shown while motion is on; visitors who prefer reduced motion see the still sprite.', rich_text_type: 'standard', image: true } },
  ];
}

async function contentType(config: ManagementConfig, fetchImpl: typeof fetch): Promise<CmsEntry> {
  const data = await contentstackRequest(api(config, 'content_types/species'), managementHeaders(config), { fetchImpl });
  const type = data.content_type as CmsEntry | undefined;
  if (!type || !Array.isArray(type.schema)) throw new Error('The species content type was not found.');
  return type;
}

async function saveContentType(config: ManagementConfig, type: CmsEntry, schema: CmsEntry[], fetchImpl: typeof fetch): Promise<void> {
  const body = { content_type: { title: type.title, uid: type.uid, description: type.description, options: type.options, schema } };
  await contentstackRequest(api(config, 'content_types/species'), managementHeaders(config), { method: 'PUT', body, fetchImpl });
}

async function speciesEntries(config: ManagementConfig, fetchImpl: typeof fetch): Promise<CmsEntry[]> {
  const entries: CmsEntry[] = [];
  for (let page = 0; page < 50; page++) {
    const url = api(config, 'content_types/species/entries');
    url.search = new URLSearchParams({ locale: config.locale, include_count: 'true', limit: '100', skip: String(entries.length) }).toString();
    const data = await contentstackRequest(url, managementHeaders(config), { fetchImpl });
    const records = Array.isArray(data.entries) ? data.entries as CmsEntry[] : [];
    entries.push(...records);
    const count = typeof data.count === 'number' ? data.count : entries.length;
    if (!records.length || entries.length >= count) return entries;
  }
  throw new Error('Species listing exceeded the project limit.');
}

/** A file field reads back as an asset object (or its UID on some endpoints). */
const assetUid = (value: unknown): string | null =>
  typeof value === 'string' ? value : value && typeof value === 'object' && typeof (value as CmsEntry).uid === 'string' ? (value as CmsEntry).uid as string : null;

function speciesRefs(entries: CmsEntry[]) {
  return entries.map((entry) => {
    if (typeof entry.stable_id !== 'string' || typeof entry.uid !== 'string') throw new Error('A species entry has no stable_id. Fix it in Contentstack first.');
    return { id: entry.stable_id, name: String(entry.title ?? entry.stable_id), uid: entry.uid, entry };
  });
}

export async function plan(config: ManagementConfig, fetchImpl: typeof fetch = fetch) {
  const type = await contentType(config, fetchImpl);
  const fields = (type.schema as CmsEntry[]).map((field) => field.uid);
  const species = speciesRefs(await speciesEntries(config, fetchImpl));
  const folder = await findSpriteFolder(config, fetchImpl);
  const existing = await existingSprites(config, folder, fetchImpl);
  let toUpload = 0;
  for (const { id } of species) {
    const files = spriteFiles(id);
    if (!existing.has(files.still.name)) toUpload++;
    if (files.animated && !existing.has(files.animated.name)) toUpload++;
  }
  return {
    mode: 'plan', species: species.length,
    assetFieldsPresent: fields.includes('sprite_image') && fields.includes('sprite_animation'),
    legacyTextFieldPresent: fields.includes(LEGACY),
    folderExists: folder !== null, assetsToUpload: toUpload,
    entriesToLink: species.filter(({ entry }) => !assetUid(entry.sprite_image)).length,
  };
}

export async function apply(config: ManagementConfig, environment: string, fetchImpl: typeof fetch = fetch) {
  // 1. Add the asset fields beside the old text field (not yet required).
  const type = await contentType(config, fetchImpl);
  const schema = type.schema as CmsEntry[];
  let fieldsAdded = false;
  if (!schema.some((field) => field.uid === 'sprite_image')) {
    const at = schema.findIndex((field) => field.uid === LEGACY);
    const next = [...schema];
    next.splice(at >= 0 ? at + 1 : next.length, 0, ...newFields(false));
    await saveContentType(config, type, next, fetchImpl);
    fieldsAdded = true;
  }
  const updatedType = await contentType(config, fetchImpl);
  const fieldUids = (updatedType.schema as CmsEntry[]).map((field) => field.uid as string);

  // 2. Upload whatever is missing from the asset library.
  const species = speciesRefs(await speciesEntries(config, fetchImpl));
  const { assets, uploaded, folderCreated } = await ensureSpriteAssets(config, species, fetchImpl);

  // 3. Link each entry to its assets. The whole entry is sent so no field is lost.
  let linked = 0;
  const toPublish: string[] = [];
  for (const { id, uid, entry } of species) {
    const sprite = assets.get(id)!;
    const current = { still: assetUid(entry.sprite_image), animated: assetUid(entry.sprite_animation) };
    if (current.still !== sprite.still || current.animated !== sprite.animated) {
      const body: CmsEntry = {};
      for (const field of fieldUids) if (entry[field] !== undefined) body[field] = entry[field];
      body.sprite_image = sprite.still;
      body.sprite_animation = sprite.animated;
      const url = api(config, `content_types/species/entries/${uid}`);
      url.searchParams.set('locale', config.locale);
      await contentstackRequest(url, managementHeaders(config), { method: 'PUT', body: { entry: body }, fetchImpl });
      linked++; await pause();
    }
    toPublish.push(uid);
  }

  // 4. Publish the assets, then the entries (each entry publish triggers a deploy webhook;
  //    concurrent deploys collapse into one follow-up run).
  const assetUids = [...assets.values()].flatMap((sprite) => [sprite.still, ...(sprite.animated ? [sprite.animated] : [])]);
  for (const asset of assetUids) { await publish(config, environment, { asset }, fetchImpl); await pause(); }
  for (const entry of toPublish) { await publish(config, environment, { entry, contentType: 'species' }, fetchImpl); await pause(); }

  return { mode: 'applied', fieldsAdded, folderCreated, uploaded, linked, publishedAssets: assetUids.length, publishedEntries: toPublish.length };
}

export async function finalize(config: ManagementConfig, fetchImpl: typeof fetch = fetch) {
  const species = speciesRefs(await speciesEntries(config, fetchImpl));
  const unlinked = species.filter(({ entry }) => !assetUid(entry.sprite_image)).map(({ id }) => id);
  if (unlinked.length) throw new Error(`Run --apply first. Species without a sprite asset: ${unlinked.join(', ')}`);
  const type = await contentType(config, fetchImpl);
  const schema = (type.schema as CmsEntry[])
    .filter((field) => field.uid !== LEGACY)
    .map((field) => (field.uid === 'sprite_image' ? { ...field, mandatory: true } : field));
  await saveContentType(config, type, schema, fetchImpl);
  return { mode: 'finalized', removedField: LEGACY, spriteRequired: true };
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== '--apply' && arg !== '--finalize')) throw new Error('Usage: npm run cms:migrate-sprites [-- --apply | --finalize]');
  const config = getManagementConfig();
  if (args[0] === '--apply') {
    const environment = process.env.CONTENTSTACK_ENVIRONMENT?.trim();
    if (!environment) throw new Error('Configure CONTENTSTACK_ENVIRONMENT to publish to.');
    console.log(JSON.stringify(await apply(config, environment)));
  } else if (args[0] === '--finalize') {
    console.log(JSON.stringify(await finalize(config)));
  } else {
    console.log(JSON.stringify(await plan(config)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Sprite migration failed.');
    process.exitCode = 1;
  });
}
