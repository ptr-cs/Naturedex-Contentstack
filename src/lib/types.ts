export type AnimalGroup =
  'Mammals' | 'Birds' | 'Reptiles' | 'Amphibians' | 'Fish' | 'Invertebrates';
export interface Species {
  id: string;
  dexNumber: number;
  name: string;
  scientificName: string;
  group: AnimalGroup;
  sprite: string;
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
