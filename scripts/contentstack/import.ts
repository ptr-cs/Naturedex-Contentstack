import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readContentSnapshot, validateContentSnapshot, type ContentSnapshot } from '../../src/lib/content.ts';
import { contentstackRequest, getManagementConfig, regionEndpoints, type CmsEntry, type ManagementConfig } from '../../src/lib/contentstack.ts';

type Model = { content_type: { uid: string; schema: CmsEntry[]; [key: string]: unknown } };
type Collection = 'content_types' | 'entries';

async function list(config: ManagementConfig, path: string, collection: Collection, fetchImpl: typeof fetch): Promise<CmsEntry[]> {
  const entries: CmsEntry[] = [];
  const seen = new Set<string>();
  let count: number | undefined;
  for (let page = 0; page < 101; page++) {
    const url = new URL(`/v3/${path}`, regionEndpoints[config.region].management);
    url.search = new URLSearchParams({ include_count: 'true', locale: config.locale, limit: '100', skip: String(entries.length) }).toString();
    const data = await contentstackRequest(url, managementHeaders(config), { fetchImpl });
    const records = data[collection];
    // Contentstack omits `count` when a list is empty; accept that only on the first page.
    if (page === 0 && data.count === undefined && Array.isArray(records) && records.length === 0) data.count = 0;
    if (!Array.isArray(records) || !Number.isInteger(data.count) || (data.count as number) < 0 || (data.count as number) > 10000) throw new Error('Invalid Contentstack management collection.');
    if (count !== undefined && count !== data.count) throw new Error('Contentstack content changed during import planning. Retry.');
    count = data.count as number;
    for (const item of records as unknown[]) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof (item as CmsEntry).uid !== 'string' || seen.has((item as CmsEntry).uid as string)) throw new Error('Management pagination returned missing or repeated UIDs.');
      seen.add((item as CmsEntry).uid as string); entries.push(item as CmsEntry);
    }
    if (entries.length === count) return entries;
    if (!records.length || entries.length > count) throw new Error('Management pagination was incomplete.');
  }
  throw new Error('Management collection exceeded the project entry limit.');
}

function managementHeaders(config: ManagementConfig): Record<string, string> {
  return { api_key: config.apiKey, authorization: config.managementToken, 'Content-Type': 'application/json', ...(config.branch ? { branch: config.branch } : {}) };
}

export function readModels(): Model[] {
  return ['species', 'blog_post'].map((uid) => JSON.parse(readFileSync(new URL(`../../contentstack/content-types/${uid}.json`, import.meta.url), 'utf8')) as Model);
}

export function speciesEntry(species: ContentSnapshot['species'][number]): CmsEntry {
  return {
    stable_id: species.id, dex_number: species.dexNumber, title: species.name,
    scientific_name: species.scientificName, group: species.group, sprite: species.sprite,
    description: species.description, habitats: species.habitats, diet: species.diet, activity: species.activity,
    size: {
      ...(species.size.lengthCm ? { length_min_cm: species.size.lengthCm[0], length_max_cm: species.size.lengthCm[1] } : {}),
      ...(species.size.weightKg ? { weight_min_kg: species.size.weightKg[0], weight_max_kg: species.size.weightKg[1] } : {}),
      note: species.size.note,
    },
    habitat_regions: species.regionIds, region_note: species.regionNote, source_urls: species.sourceURLs,
  };
}

export function postEntry(post: ContentSnapshot['posts'][number], uidById: Map<string, string>): CmsEntry {
  return {
    stable_id: post.id, slug: post.slug, title: post.title, excerpt: post.excerpt, body: post.body,
    category: post.category, author: post.author || 'Naturedex editors',
    ...(post.publishedAt ? { published_at: post.publishedAt } : {}),
    related_species: post.relatedSpeciesIds.map((id) => {
      const uid = uidById.get(id);
      if (!uid) throw new Error('Cannot import an article without all referenced species entries.');
      return { uid, _content_type_uid: 'species' };
    }),
  };
}

function indexStableIds(entries: CmsEntry[]): Map<string, CmsEntry> {
  const result = new Map<string, CmsEntry>();
  for (const entry of entries) {
    if (typeof entry.stable_id !== 'string' || result.has(entry.stable_id)) throw new Error('Existing CMS entries require unique stable_id values. Resolve them before import.');
    result.set(entry.stable_id, entry);
  }
  return result;
}

/** Creates missing content only. It never updates, deletes or publishes. */
export async function importMissingContent(snapshotInput: ContentSnapshot, config: ManagementConfig, fetchImpl: typeof fetch = fetch) {
  const snapshot = validateContentSnapshot(snapshotInput);
  const models = readModels();
  const existingModels = await list(config, 'content_types', 'content_types', fetchImpl);
  for (const model of models) {
    const existing = existingModels.find((item) => item.uid === model.content_type.uid);
    if (existing) {
      if (!Array.isArray(existing.schema) || model.content_type.schema.some((field) => !(existing.schema as CmsEntry[]).some((candidate) => candidate.uid === field.uid && candidate.data_type === field.data_type))) {
        throw new Error('An existing content type has an incompatible schema. Review it in Contentstack; this importer will not overwrite it.');
      }
    }
  }
  let createdModels = 0;
  for (const model of models) {
    if (existingModels.some((item) => item.uid === model.content_type.uid)) continue;
    await contentstackRequest(new URL('/v3/content_types', regionEndpoints[config.region].management), managementHeaders(config), { method: 'POST', body: model, fetchImpl });
    createdModels++;
  }
  const [existingSpecies, existingPosts] = await Promise.all([
    list(config, 'content_types/species/entries', 'entries', fetchImpl),
    list(config, 'content_types/blog_post/entries', 'entries', fetchImpl),
  ]);
  const speciesById = indexStableIds(existingSpecies);
  const postsById = indexStableIds(existingPosts);
  for (const post of snapshot.posts) {
    if (existingPosts.some((entry) => entry.slug === post.slug && entry.stable_id !== post.id)) throw new Error('A seed slug belongs to another existing entry. Resolve the conflict in Contentstack.');
  }
  const uidById = new Map([...speciesById].map(([id, entry]) => [id, entry.uid as string]));
  async function create(type: string, entry: CmsEntry): Promise<CmsEntry> {
    const url = new URL(`/v3/content_types/${type}/entries`, regionEndpoints[config.region].management);
    url.searchParams.set('locale', config.locale);
    const response = await contentstackRequest(url, managementHeaders(config), { method: 'POST', body: { entry }, fetchImpl });
    if (!response.entry || typeof response.entry !== 'object' || Array.isArray(response.entry) || typeof (response.entry as CmsEntry).uid !== 'string') throw new Error('Contentstack did not return the created entry UID. Rerun to reconcile existing entries.');
    return response.entry as CmsEntry;
  }
  let createdSpecies = 0; let createdPosts = 0;
  for (const species of snapshot.species) {
    if (speciesById.has(species.id)) continue;
    const created = await create('species', speciesEntry(species));
    uidById.set(species.id, created.uid as string); createdSpecies++;
  }
  for (const post of snapshot.posts) {
    if (postsById.has(post.id)) continue;
    await create('blog_post', postEntry(post, uidById)); createdPosts++;
  }
  return { mode: 'applied', createdModels, createdSpecies, createdPosts, skippedSpecies: snapshot.species.length - createdSpecies, skippedPosts: snapshot.posts.length - createdPosts, published: 0 };
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--apply')) throw new Error('Usage: npm run cms:import [-- --apply]');
  const snapshot = readContentSnapshot();
  if (!args.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', source: 'data/content.json', proposedModels: readModels().map((model) => model.content_type.uid), proposedSpecies: snapshot.species.length, proposedPosts: snapshot.posts.length, remoteStateChecked: false, remoteRequests: 0, note: 'Offline proposal only. --apply creates missing content; existing content stays unchanged and nothing is published.' }));
    return;
  }
  console.log(JSON.stringify(await importMissingContent(snapshot, getManagementConfig())));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Contentstack import failed.');
    process.exitCode = 1;
  });
}
