import { describe, expect, it } from 'vitest';
import { filterSpecies, formatRange, slugify } from '../../src/lib/domain';
import type { Species } from '../../src/lib/types';

const base: Species = {
  id: 'deer',
  dexNumber: 1,
  name: 'White-tailed Deer',
  scientificName: 'Odocoileus virginianus',
  group: 'Mammals',
  sprite: '/sprites/white-tailed-deer.svg',
  description: 'A woodland browser.',
  habitats: ['Woodland'],
  diet: ['Leaves'],
  activity: 'Crepuscular',
  size: { lengthCm: null, weightKg: null, note: '' },
  regionIds: ['valley', 'piedmont'],
  regionNote: 'Illustrative habitat association.',
  sourceURLs: ['https://dwr.virginia.gov/'],
};
const entries: Species[] = [
  base,
  {
    ...base,
    id: 'trout',
    dexNumber: 2,
    name: 'Brook Trout',
    scientificName: 'Salvelinus fontinalis',
    group: 'Fish',
    habitats: ['Cold stream'],
    regionIds: ['mountains'],
  },
  {
    ...base,
    id: 'cardinal',
    dexNumber: 3,
    name: 'Northern Cardinal',
    scientificName: 'Cardinalis cardinalis',
    group: 'Birds',
    habitats: ['Woodland edge'],
    regionIds: ['valley', 'coastal'],
  },
];

describe('field-guide discovery', () => {
  it('finds animals through common names, scientific names, and habitats regardless of case', () => {
    expect(
      filterSpecies(entries, '  BROOK TROUT  ').map((entry) => entry.id),
    ).toEqual(['trout']);
    expect(
      filterSpecies(entries, 'Odocoileus').map((entry) => entry.id),
    ).toEqual(['deer']);
    expect(filterSpecies(entries, 'woodland').map((entry) => entry.id)).toEqual(
      ['deer', 'cardinal'],
    );
  });

  it('combines group, geographic association, and collection membership', () => {
    expect(
      filterSpecies(entries, '', 'Birds', 'valley', true, [
        'deer',
        'cardinal',
      ]).map((entry) => entry.id),
    ).toEqual(['cardinal']);
    expect(filterSpecies(entries, '', 'Fish', 'valley')).toEqual([]);
    expect(filterSpecies(entries, '', 'All', 'all', true, [])).toEqual([]);
  });

  it('returns all animals after filters are cleared and leaves source records untouched', () => {
    const original = JSON.stringify(entries);
    filterSpecies(entries, 'missing', 'Fish', 'coastal');
    expect(filterSpecies(entries).map((entry) => entry.id)).toEqual([
      'deer',
      'trout',
      'cardinal',
    ]);
    expect(JSON.stringify(entries)).toBe(original);
  });

  it('treats whitespace-only searches as cleared and preserves a stable source order', () => {
    expect(filterSpecies(entries, ' \n\t ')).toEqual(entries);
    expect(filterSpecies([...entries].reverse(), 'woodland').map((entry) => entry.id)).toEqual(['cardinal', 'deer']);
    expect(filterSpecies([], 'trout')).toEqual([]);
  });

  it('ignores stale collection IDs and requires every selected filter to match', () => {
    expect(filterSpecies(entries, '', 'All', 'all', true, ['removed-species', 'cardinal', 'cardinal']).map((entry) => entry.id)).toEqual(['cardinal']);
    expect(filterSpecies(entries, 'trout', 'Fish', 'mountains', true, ['trout'])).toHaveLength(1);
    expect(filterSpecies(entries, 'trout', 'Fish', 'coastal', true, ['trout'])).toEqual([]);
    expect(filterSpecies(entries, '', 'Unknown group')).toEqual([]);
    expect(filterSpecies(entries, '', 'All', 'unknown-region')).toEqual([]);
  });
});

describe('editorial identifiers and physical measurements', () => {
  it('normalizes human titles to stable readable slugs', () => {
    expect(slugify('  Café: Frogs & Field Notes!  ')).toBe(
      'cafe-frogs-field-notes',
    );
    expect(slugify('---')).toBe('');
  });

  it('keeps measurement units visible and avoids inventing missing measurements', () => {
    expect(formatRange([10, 20], 'cm')).toBe('10–20 cm');
    expect(formatRange([0.2, 0.4], 'kg')).toBe('0.2–0.4 kg');
    expect(formatRange(null, 'kg')).toBe('See field notes');
  });

  it('produces URL-safe identifiers for punctuation, combining accents, and empty titles', () => {
    expect(slugify('Crème brûlée — by the water')).toBe('creme-brulee-by-the-water');
    expect(slugify('Already-a-slug')).toBe('already-a-slug');
    expect(slugify('E\u0301lodie\'s 2026 observations')).toBe('elodie-s-2026-observations');
    expect(slugify('')).toBe('');
    expect(slugify('🐸 蛙')).toBe('');
  });
});
