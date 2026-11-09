import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const species = JSON.parse(
  readFileSync(new URL('../../data/content.json', import.meta.url), 'utf8'),
).species as Array<{
  id: string;
  dexNumber: number;
  name: string;
  scientificName: string;
  group: string;
  sprite: string;
  spriteAnimated: string | null;
  regionIds: string[];
  regionNote: string;
  sourceURLs: string[];
  size: {
    lengthCm: [number, number] | null;
    weightKg: [number, number] | null;
    note: string;
  };
}>;

describe('the Virginia field-guide content contract', () => {
  it('provides distinct, source-backed entries spanning all six animal groups', () => {
    expect(species.length).toBeGreaterThanOrEqual(24);
    expect(new Set(species.map((entry) => entry.id)).size).toBe(species.length);
    expect(new Set(species.map((entry) => entry.dexNumber)).size).toBe(
      species.length,
    );
    expect(new Set(species.map((entry) => entry.group))).toEqual(
      new Set([
        'Mammals',
        'Birds',
        'Reptiles',
        'Amphibians',
        'Fish',
        'Invertebrates',
      ]),
    );
    for (const entry of species) {
      expect(entry.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(entry.name.trim()).not.toBe('');
      expect(entry.scientificName.trim()).not.toBe('');
      expect(entry.sourceURLs.length).toBeGreaterThan(0);
      for (const source of entry.sourceURLs)
        expect(new URL(source).protocol).toBe('https:');
    }
  });

  it('serves sprites from the asset library, keeps their source art, and distinguishes regional guidance from observations', () => {
    const regions = new Set(['mountains', 'valley', 'piedmont', 'coastal']);
    for (const entry of species) {
      expect(new URL(entry.sprite).pathname).toMatch(/^\/v3\/assets\/.+\.svg$/);
      expect(entry.spriteAnimated === null || new URL(entry.spriteAnimated).pathname.endsWith('-animated.svg')).toBe(true);
      expect(existsSync(resolve(process.cwd(), `art/sprites/${entry.id}.svg`))).toBe(true);
      expect(entry.regionIds.length).toBeGreaterThan(0);
      for (const region of entry.regionIds)
        expect(regions.has(region)).toBe(true);
      expect(entry.regionNote.toLowerCase()).toContain('illustrative');
      expect(entry.regionNote.toLowerCase()).toContain('not');
    }
  });

  it('keeps available physical measurements ordered and positive', () => {
    for (const entry of species) {
      for (const range of [entry.size.lengthCm, entry.size.weightKg]) {
        if (range === null) continue;
        expect(range).toHaveLength(2);
        expect(range[0]).toBeGreaterThan(0);
        expect(range[1]).toBeGreaterThanOrEqual(range[0]);
      }
    }
  });
});


describe('journal publication integrity', () => {
  it('links published articles to existing animals and uses unique safe routes', () => {
    const snapshot = JSON.parse(readFileSync(new URL('../../data/content.json', import.meta.url), 'utf8'));
    const posts = snapshot.posts;
    expect(posts.length).toBeGreaterThan(0);
    expect(new Set(posts.map((post: {id: string}) => post.id)).size).toBe(posts.length);
    expect(new Set(posts.map((post: {slug: string}) => post.slug)).size).toBe(posts.length);
    for (const post of posts) {
      expect(post.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(post.title.trim()).not.toBe('');
      expect(post.body.trim()).not.toBe('');
      expect(['published', 'draft']).toContain(post.status);
      for (const id of post.relatedSpeciesIds) expect(species.some(entry => entry.id === id)).toBe(true);
    }
    expect(posts.some((post: {status: string}) => post.status === 'published')).toBe(true);
  });

  it('ships a real Virginia polygon and keeps every map region addressable', () => {
    const geo = JSON.parse(readFileSync(new URL('../../public/map/virginia.geojson', import.meta.url), 'utf8'));
    expect(geo.type).toBe('Feature');
    const geometry = geo.geometry;
    expect(['Polygon', 'MultiPolygon']).toContain(geometry.type);
    const coordinates: number[][] = [];
    function collect(value: unknown): void {
      if (!Array.isArray(value)) return;
      if (typeof value[0] === 'number') coordinates.push(value as number[]);
      else value.forEach(collect);
    }
    collect(geometry.coordinates);
    expect(coordinates.length).toBeGreaterThan(50);
    expect(coordinates.every(([lon, lat]) => lon > -84 && lon < -75 && lat > 36 && lat < 40)).toBe(true);
    for (const region of ['mountains', 'valley', 'piedmont', 'coastal']) expect(species.some(entry => entry.regionIds.includes(region))).toBe(true);
  });
});
