import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// The source art kept in this repository. Published species may have none:
// their sprites live only in Contentstack and are checked by the content pull.
const species = readdirSync(resolve(process.cwd(), 'art/sprites')).filter(file => file.endsWith('.svg')).map(file => {
  const id = file.slice(0, -4);
  const name = /<title[^>]*>Original pixel illustration of (.+?)<\/title>/.exec(readFileSync(resolve(process.cwd(), 'art/sprites', file), 'utf8'))?.[1];
  return { id, name: name ?? '' };
});

function attribute(markup: string, name: string) {
  return new RegExp(`\\b${name}=["']([^"']*)["']`).exec(markup)?.[1];
}

function pixels(markup: string, label: string) {
  const grid = Array<string>(48 * 48).fill('transparent');
  const rectangles = [...markup.matchAll(/<rect\b[^>]*\/?\s*>/g)];
  expect(rectangles.length, `${label} must contain rendered pixels`).toBeGreaterThan(0);
  for (const [rectangle] of rectangles) {
    const x = Number(attribute(rectangle, 'x'));
    const y = Number(attribute(rectangle, 'y'));
    const width = Number(attribute(rectangle, 'width'));
    const height = Number(attribute(rectangle, 'height'));
    const fill = attribute(rectangle, 'fill')?.toLowerCase();
    expect([x, y, width, height].every(Number.isInteger), `${label}: integral pixel rectangles`).toBe(true);
    expect(x, label).toBeGreaterThanOrEqual(0);
    expect(y, label).toBeGreaterThanOrEqual(0);
    expect(width, label).toBeGreaterThan(0);
    expect(height, label).toBeGreaterThan(0);
    expect(x + width, label).toBeLessThanOrEqual(48);
    expect(y + height, label).toBeLessThanOrEqual(48);
    expect(fill, `${label}: explicit local pixel color`).toMatch(/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
    for (let row = y; row < y + height; row++) {
      for (let column = x; column < x + width; column++) grid[row * 48 + column] = fill!;
    }
  }
  return createHash('sha256').update(JSON.stringify(grid)).digest('hex');
}

describe('the repository source art and its animated counterparts', () => {
  it('provides exactly one three-frame animation for every source sprite', () => {
    expect(species.length).toBeGreaterThan(0);
    expect(species.every(entry => entry.name), 'every source sprite has its title').toBe(true);
    const files = readdirSync(resolve(process.cwd(), 'art/sprites/animated')).filter(file => file.endsWith('.svg'));
    expect(files.sort()).toEqual(species.map(entry => `${entry.id}.svg`).sort());
    for (const entry of species) {
      const svg = readFileSync(resolve(process.cwd(), `art/sprites/animated/${entry.id}.svg`), 'utf8');
      const root = /<svg\b[^>]*>/.exec(svg)?.[0] || '';
      expect(attribute(root, 'data-sprite-frames'), entry.id).toBe('3');
      expect(attribute(root, 'data-species'), entry.id).toBe(entry.id);
      expect(attribute(root, 'viewBox'), entry.id).toBe('0 0 48 48');
      expect(svg, entry.id).toContain(entry.name);
      const frames = [...svg.matchAll(/<g\b[^>]*data-frame=["'](\d+)["'][^>]*>([\s\S]*?)<\/g>/g)];
      expect(frames.map(frame => frame[1]), entry.id).toEqual(['0', '1', '2']);
    }
  });

  it('preserves the exact original pixels as frame zero and supplies distinct additional poses', () => {
    for (const entry of species) {
      const original = readFileSync(resolve(process.cwd(), `art/sprites/${entry.id}.svg`), 'utf8');
      const animated = readFileSync(resolve(process.cwd(), `art/sprites/animated/${entry.id}.svg`), 'utf8');
      const frames = [...animated.matchAll(/<g\b[^>]*data-frame=["'](\d+)["'][^>]*>([\s\S]*?)<\/g>/g)];
      const digests = frames.map(frame => pixels(frame[2], `${entry.id} frame ${frame[1]}`));
      expect(digests[0], `${entry.id}: original illustration must remain intact`).toBe(pixels(original, `${entry.id} original`));
      expect(new Set(digests).size, `${entry.id}: three visually distinct pixel poses`).toBe(3);
    }
  });

  it('uses discrete frame animation and ships a reduced-motion fallback in each asset', () => {
    for (const entry of species) {
      const svg = readFileSync(resolve(process.cwd(), `art/sprites/animated/${entry.id}.svg`), 'utf8');
      expect(svg, entry.id).toMatch(/@keyframes\s+[\w-]+/);
      expect(svg, entry.id).toMatch(/steps\(\s*1\s*(?:,\s*(?:start|end))?\)|step-(?:start|end)/);
      expect(svg, entry.id).toMatch(/prefers-reduced-motion\s*:\s*reduce/);
      expect(svg, entry.id).toMatch(/animation\s*:\s*none/);
    }
  });
});
