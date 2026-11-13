import type { Species } from './types';
export const groups = [
  'Mammals',
  'Birds',
  'Reptiles',
  'Amphibians',
  'Fish',
  'Invertebrates',
] as const;
export const regions = [
  {
    id: 'mountains',
    name: 'Blue Ridge & Appalachians',
    shortName: 'Mountains',
    x: 154,
    y: 291,
    color: '#8aab77',
    description: 'Highland forests, rocky ridges, and cold mountain streams.',
  },
  {
    id: 'valley',
    name: 'Shenandoah Valley',
    shortName: 'Valley',
    x: 277,
    y: 258,
    color: '#c2c778',
    description: 'A patchwork of river valleys, fields, and woodland edges.',
  },
  {
    id: 'piedmont',
    name: 'Virginia Piedmont',
    shortName: 'Piedmont',
    x: 377,
    y: 214,
    color: '#b3ca8c',
    description: 'Rolling hills, mixed forests, ponds, and open meadows.',
  },
  {
    id: 'coastal',
    name: 'Coastal Plain & Chesapeake',
    shortName: 'Coastal plain',
    x: 490,
    y: 231,
    color: '#d6d4a0',
    description: 'Tidal rivers, coastal wetlands, and sandy shorelines.',
  },
] as const;
export function filterSpecies(
  items: Species[],
  search = '',
  group = 'All',
  region = 'all',
  seenOnly = false,
  seen: string[] = [],
) {
  const query = search.trim().toLocaleLowerCase();
  return items.filter(
    (s) =>
      (!query ||
        `${s.name} ${s.scientificName} ${s.habitats.join(' ')}`
          .toLocaleLowerCase()
          .includes(query)) &&
      (group === 'All' || s.group === group) &&
      (region === 'all' || s.regionIds.includes(region)) &&
      (!seenOnly || seen.includes(s.id)),
  );
}
export function formatRange(range: [number, number] | null, unit: string) {
  return range ? `${range[0]}–${range[1]} ${unit}` : 'See field notes';
}
export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
