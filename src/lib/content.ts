import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Post, Species } from './types.ts';

export const supportedSpriteIds = [
  'white-tailed-deer', 'black-bear', 'red-fox', 'river-otter',
  'northern-cardinal', 'bald-eagle', 'great-blue-heron', 'pileated-woodpecker',
  'woodland-box-turtle', 'central-ratsnake', 'five-lined-skink', 'painted-turtle',
  'american-bullfrog', 'spotted-salamander', 'red-spotted-newt', 'spring-peeper',
  'brook-trout', 'largemouth-bass', 'bluegill', 'channel-catfish',
  'monarch', 'tiger-swallowtail', 'green-darner', 'horseshoe-crab',
] as const;
export const supportedRegionIds = ['mountains', 'valley', 'piedmont', 'coastal'] as const;
const spritePaths = new Set(supportedSpriteIds.map((id) => `/sprites/${id}.svg`));
const safeId = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
const slug = z.string().min(1).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = (max: number) => z.string().max(max);
const requiredText = (max: number) => text(max).refine((value) => value.trim().length > 0, 'Text is required');
const isoDate = z.iso.datetime({ offset: true });
const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'References must use HTTPS without URL credentials');
const measurements = z.tuple([z.number().nonnegative(), z.number().nonnegative()])
  .refine(([min, max]) => min <= max, 'Measurement minimum must not exceed maximum').nullable();
const uniqueStrings = (schema: z.ZodType<string>, max = 100) => z.array(schema).max(max)
  .refine((values) => new Set(values).size === values.length, 'Values must be unique');

export const speciesSchema = z.strictObject({
  id: safeId,
  dexNumber: z.number().int().positive().max(99999),
  name: requiredText(180),
  scientificName: requiredText(180),
  group: z.enum(['Mammals', 'Birds', 'Reptiles', 'Amphibians', 'Fish', 'Invertebrates']),
  sprite: z.string().refine((path) => spritePaths.has(path), 'Choose a supported local sprite'),
  description: requiredText(5000),
  habitats: uniqueStrings(requiredText(300)).min(1),
  diet: uniqueStrings(requiredText(300)).min(1),
  activity: requiredText(1000),
  size: z.strictObject({ lengthCm: measurements, weightKg: measurements, note: text(5000) }),
  regionIds: z.array(z.enum(supportedRegionIds)).min(1).max(4)
    .refine((values) => new Set(values).size === values.length, 'Regions must be unique'),
  regionNote: requiredText(5000),
  sourceURLs: uniqueStrings(httpsUrl).min(1),
});

export const postSchema = z.strictObject({
  id: safeId,
  slug,
  title: requiredText(180),
  excerpt: text(1000),
  body: requiredText(100000),
  status: z.literal('published'),
  category: requiredText(80),
  relatedSpeciesIds: uniqueStrings(safeId, 50),
  author: requiredText(180).optional(),
  createdAt: isoDate.optional(),
  updatedAt: isoDate.optional(),
  publishedAt: isoDate.optional(),
});

const snapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.enum(['seed', 'contentstack']),
  syncedAt: isoDate.nullable(),
  species: z.array(speciesSchema).min(1).max(10000),
  posts: z.array(postSchema).max(10000),
}).superRefine((snapshot, context) => {
  if ((snapshot.source === 'seed') !== (snapshot.syncedAt === null)) {
    context.addIssue({ code: 'custom', path: ['syncedAt'], message: 'Seed snapshots use null; Contentstack snapshots require a sync timestamp' });
  }
  for (const [key, values] of [
    ['species IDs', snapshot.species.map((item) => item.id)],
    ['dex numbers', snapshot.species.map((item) => item.dexNumber)],
    ['post IDs', snapshot.posts.map((item) => item.id)],
    ['post slugs', snapshot.posts.map((item) => item.slug)],
  ] as const) {
    if (new Set<string | number>(values).size !== values.length) context.addIssue({ code: 'custom', message: `Duplicate ${key}` });
  }
  const knownSpecies = new Set(snapshot.species.map((item) => item.id));
  snapshot.posts.forEach((post, index) => {
    if (post.relatedSpeciesIds.some((id) => !knownSpecies.has(id))) {
      context.addIssue({ code: 'custom', path: ['posts', index, 'relatedSpeciesIds'], message: 'Article references an unavailable species' });
    }
    if (post.createdAt && post.updatedAt && Date.parse(post.updatedAt) < Date.parse(post.createdAt)) {
      context.addIssue({ code: 'custom', path: ['posts', index, 'updatedAt'], message: 'Updated date precedes creation' });
    }
  });
});

export interface ContentSnapshot {
  schemaVersion: 1;
  source: 'seed' | 'contentstack';
  syncedAt: string | null;
  species: Species[];
  posts: Post[];
}

/** Build-only validation. Never fall back to seed after a failed CMS pull. */
export function validateContentSnapshot(input: unknown): ContentSnapshot {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) {
    // Paths and fixed messages are useful diagnostics; raw CMS values are not
    // echoed into build logs or deployment receipts.
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'snapshot'}: ${issue.message}`);
    throw new Error(`Invalid content snapshot: ${issues.join('; ')}`);
  }
  return parsed.data;
}

export function readContentSnapshot(filePath = resolve(process.cwd(), 'data/content.json')): ContentSnapshot {
  let input: unknown;
  try { input = JSON.parse(readFileSync(filePath, 'utf8')); }
  catch { throw new Error('Cannot read the content snapshot. Run cms:pull or restore the reviewed seed snapshot.'); }
  return validateContentSnapshot(input);
}
