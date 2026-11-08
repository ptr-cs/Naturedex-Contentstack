import { validateContentSnapshot, type ContentSnapshot } from './content.ts';

export const regionEndpoints = {
  'aws-na': { delivery: 'https://cdn.contentstack.io', management: 'https://api.contentstack.io', editor: 'https://app.contentstack.com/' },
  'aws-eu': { delivery: 'https://eu-cdn.contentstack.com', management: 'https://eu-api.contentstack.com', editor: 'https://eu-app.contentstack.com/' },
  'aws-au': { delivery: 'https://au-cdn.contentstack.com', management: 'https://au-api.contentstack.com', editor: 'https://au-app.contentstack.com/' },
  'azure-na': { delivery: 'https://azure-na-cdn.contentstack.com', management: 'https://azure-na-api.contentstack.com', editor: 'https://azure-na-app.contentstack.com/' },
  'azure-eu': { delivery: 'https://azure-eu-cdn.contentstack.com', management: 'https://azure-eu-api.contentstack.com', editor: 'https://azure-eu-app.contentstack.com/' },
  'gcp-na': { delivery: 'https://gcp-na-cdn.contentstack.com', management: 'https://gcp-na-api.contentstack.com', editor: 'https://gcp-na-app.contentstack.com/' },
  'gcp-eu': { delivery: 'https://gcp-eu-cdn.contentstack.com', management: 'https://gcp-eu-api.contentstack.com', editor: 'https://gcp-eu-app.contentstack.com/' },
} as const;
export type ContentstackRegion = keyof typeof regionEndpoints;
export type ContentType = 'species' | 'blog_post';
export type CmsEntry = Record<string, unknown>;
type Environment = Record<string, string | undefined>;
export interface BaseConfig { apiKey: string; region: ContentstackRegion; locale: string; branch?: string }
export interface ContentstackConfig extends BaseConfig { deliveryToken: string; environment: string }
export interface ManagementConfig extends BaseConfig { managementToken: string }

/**
 * The "Open Contentstack" link. CONTENTSTACK_EDITOR_URL wins when set; otherwise
 * it follows CONTENTSTACK_REGION, so local and CI builds always agree.
 */
export function editorUrl(env: Environment): string {
  const explicit = env.CONTENTSTACK_EDITOR_URL?.trim();
  if (explicit) {
    const url = new URL(explicit);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('CONTENTSTACK_EDITOR_URL must be an HTTPS URL without credentials.');
    return url.href;
  }
  const region = env.CONTENTSTACK_REGION?.trim() || 'aws-na';
  if (!Object.hasOwn(regionEndpoints, region)) throw new Error('Unsupported CONTENTSTACK_REGION. Use a documented regional identifier.');
  return regionEndpoints[region as ContentstackRegion].editor;
}

function required(env: Environment, key: string): string {
  const value = env[key]?.trim();
  if (!value || /[\r\n]/.test(value)) throw new Error(`Configure ${key} with a nonempty value.`);
  return value;
}

function baseConfig(env: Environment): BaseConfig {
  const region = env.CONTENTSTACK_REGION?.trim() || 'aws-na';
  if (!Object.hasOwn(regionEndpoints, region)) throw new Error('Unsupported CONTENTSTACK_REGION. Use a documented regional identifier.');
  const locale = env.CONTENTSTACK_LOCALE?.trim() || 'en-us';
  if (!/^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(locale)) throw new Error('Invalid CONTENTSTACK_LOCALE.');
  const branch = env.CONTENTSTACK_BRANCH?.trim();
  if (branch && !/^[a-zA-Z0-9_-]{1,128}$/.test(branch)) throw new Error('Invalid CONTENTSTACK_BRANCH.');
  return { apiKey: required(env, 'CONTENTSTACK_API_KEY'), region: region as ContentstackRegion, locale, ...(branch ? { branch } : {}) };
}

export function getContentstackConfig(env: Environment = process.env): ContentstackConfig {
  return { ...baseConfig(env), deliveryToken: required(env, 'CONTENTSTACK_DELIVERY_TOKEN'), environment: required(env, 'CONTENTSTACK_ENVIRONMENT') };
}

export function getManagementConfig(env: Environment = process.env): ManagementConfig {
  return { ...baseConfig(env), managementToken: required(env, 'CONTENTSTACK_MANAGEMENT_TOKEN') };
}

/** Credentials stay in headers; redirects and arbitrary hosts are forbidden. */
export async function contentstackRequest(
  url: URL,
  headers: Record<string, string>,
  options: { fetchImpl?: typeof fetch; method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {},
): Promise<CmsEntry> {
  const allowed = new Set<string>(Object.values(regionEndpoints).flatMap((region) => [region.delivery, region.management]));
  if (!allowed.has(url.origin) || url.username || url.password) throw new Error('Refusing an unofficial Contentstack endpoint.');
  let response: Response;
  try {
    response = await (options.fetchImpl || fetch)(url, {
      method: options.method || 'GET', headers: { Accept: 'application/json', ...headers },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    });
  } catch { throw new Error('Contentstack request failed or timed out. The existing snapshot was retained.'); }
  if (!response.ok) throw new Error(`Contentstack request returned HTTP ${response.status}. The existing snapshot was retained.`);
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > 15000000) throw new Error('Contentstack response exceeded the allowed size.');
  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch { throw new Error('Contentstack returned invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Contentstack returned an invalid response object.');
  return parsed as CmsEntry;
}

export async function fetchPublishedEntries(config: ContentstackConfig, type: ContentType, fetchImpl: typeof fetch = fetch): Promise<CmsEntry[]> {
  const entries: CmsEntry[] = [];
  const seen = new Set<string>();
  let count: number | undefined;
  for (let page = 0; page < 101; page++) {
    const url = new URL(`/v3/content_types/${type}/entries`, regionEndpoints[config.region].delivery);
    url.search = new URLSearchParams({ environment: config.environment, locale: config.locale, include_count: 'true', limit: '100', skip: String(entries.length), asc: 'uid' }).toString();
    const result = await contentstackRequest(url, { api_key: config.apiKey, access_token: config.deliveryToken, ...(config.branch ? { branch: config.branch } : {}) }, { fetchImpl });
    // Contentstack omits `count` when a list is empty; accept that only on the first page.
    if (page === 0 && result.count === undefined && Array.isArray(result.entries) && result.entries.length === 0) result.count = 0;
    if (!Array.isArray(result.entries) || !Number.isInteger(result.count) || (result.count as number) < 0 || (result.count as number) > 10000) {
      throw new Error('Contentstack returned an invalid entries page or count.');
    }
    if (count !== undefined && result.count !== count) throw new Error('Content changed during pagination; retry the complete pull.');
    count = result.count as number;
    for (const entry of result.entries as unknown[]) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof (entry as CmsEntry).uid !== 'string') throw new Error('Contentstack returned an entry without its UID.');
      const uid = (entry as CmsEntry).uid as string;
      if (seen.has(uid)) throw new Error('Contentstack pagination repeated an entry; retry the complete pull.');
      seen.add(uid);
      entries.push(entry as CmsEntry);
    }
    if (entries.length === count) return entries;
    if (!result.entries.length || entries.length > count) throw new Error('Contentstack pagination was incomplete.');
  }
  throw new Error('Contentstack pagination exceeded the project entry limit.');
}

function range(group: CmsEntry, min: string, max: string): [unknown, unknown] | null {
  const low = group[min]; const high = group[max];
  if ((low === undefined || low === null) && (high === undefined || high === null)) return null;
  return [low, high]; // Validation rejects incomplete, negative and reversed pairs.
}

export function normalizeContentstackEntries(speciesEntries: CmsEntry[], postEntries: CmsEntry[], syncedAt = new Date().toISOString()): ContentSnapshot {
  const species = speciesEntries.map((entry) => {
    const size = entry.size && typeof entry.size === 'object' && !Array.isArray(entry.size) ? entry.size as CmsEntry : {};
    return {
      id: entry.stable_id, dexNumber: entry.dex_number, name: entry.title,
      scientificName: entry.scientific_name, group: entry.group, sprite: entry.sprite,
      description: entry.description, habitats: entry.habitats, diet: entry.diet,
      activity: entry.activity,
      size: { lengthCm: range(size, 'length_min_cm', 'length_max_cm'), weightKg: range(size, 'weight_min_kg', 'weight_max_kg'), note: size.note ?? '' },
      regionIds: entry.habitat_regions, regionNote: entry.region_note, sourceURLs: entry.source_urls,
    };
  });
  const idByUid = new Map(speciesEntries.map((entry) => [entry.uid, entry.stable_id]));
  if (idByUid.size !== speciesEntries.length || speciesEntries.some((entry) => typeof entry.uid !== 'string')) throw new Error('Species entries need unique Contentstack UIDs.');
  const posts = postEntries.map((entry) => {
    const references = entry.related_species ?? [];
    if (!Array.isArray(references)) throw new Error('Article species references must be an array.');
    const relatedSpeciesIds = references.map((reference: unknown) => {
      if (!reference || typeof reference !== 'object' || Array.isArray(reference)) throw new Error('Article contains an invalid species reference.');
      const ref = reference as CmsEntry;
      if (ref._content_type_uid !== undefined && ref._content_type_uid !== 'species') throw new Error('Article references the wrong content type.');
      const id = idByUid.get(ref.uid);
      if (typeof id !== 'string') throw new Error('Article references an unpublished or missing species. Publish the species first.');
      return id;
    });
    return {
      id: entry.stable_id, slug: entry.slug, title: entry.title, excerpt: entry.excerpt ?? '', body: entry.body,
      status: 'published', category: entry.category || 'Field notes', relatedSpeciesIds,
      ...(entry.author ? { author: entry.author } : {}),
      ...(entry.created_at ? { createdAt: entry.created_at } : {}),
      ...(entry.updated_at ? { updatedAt: entry.updated_at } : {}),
      ...(entry.published_at ? { publishedAt: entry.published_at } : {}),
    };
  });
  const snapshot = validateContentSnapshot({ schemaVersion: 1, source: 'contentstack', syncedAt, species, posts });
  snapshot.species.sort((a, b) => a.dexNumber - b.dexNumber);
  snapshot.posts.sort((a, b) => (b.publishedAt || b.createdAt || '').localeCompare(a.publishedAt || a.createdAt || '') || a.slug.localeCompare(b.slug));
  return snapshot;
}

export async function pullContentstack(config: ContentstackConfig, fetchImpl: typeof fetch = fetch): Promise<ContentSnapshot> {
  // Fetches are read-only and independent; validation happens before any file
  // replacement. CDA delivery tokens retrieve published entries only.
  const [species, posts] = await Promise.all([
    fetchPublishedEntries(config, 'species', fetchImpl),
    fetchPublishedEntries(config, 'blog_post', fetchImpl),
  ]);
  return normalizeContentstackEntries(species, posts);
}
