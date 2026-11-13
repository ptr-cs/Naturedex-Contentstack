export type AnimalGroup =
  'Mammals' | 'Birds' | 'Reptiles' | 'Amphibians' | 'Fish' | 'Invertebrates';
export interface Species {
  id: string;
  dexNumber: number;
  name: string;
  scientificName: string;
  group: AnimalGroup;
  /** Still sprite, served from the Contentstack asset library. */
  sprite: string;
  /** Optional three-pose animation of the same sprite. */
  spriteAnimated: string | null;
  description: string;
  habitats: string[];
  diet: string[];
  activity: string;
  size: {
    lengthCm: [number, number] | null;
    weightKg: [number, number] | null;
    note: string;
  };
  regionIds: string[];
  regionNote: string;
  sourceURLs: string[];
}
export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  status: 'draft' | 'published';
  category: string;
  relatedSpeciesIds: string[];
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
}
/** Site-wide copy, edited in Contentstack's single Site settings entry. */
export interface SiteCopy {
  /** Line breaks are kept: each line renders on its own line. */
  tagline: string;
  footerMotto: string;
  metaDescription: string;
}
/** Copy for one fixed page, matched to the page by `id` (for example `about`). */
export interface PageCopy {
  id: string;
  eyebrow: string;
  title: string;
  intro: string;
  /** Markdown subset: paragraphs and level-two headings. */
  body: string;
  link: { label: string; url: string } | null;
}
