import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { waitForHydration } from './helpers';
import type { Post, Species } from '../../src/lib/types';

const { species, posts } = JSON.parse(readFileSync(new URL('../../data/content.json', import.meta.url), 'utf8')) as {species: Species[]; posts: Post[]};
const published = posts.filter(post => post.status === 'published');
const names = (entries: Species[]) => entries.map(entry => entry.name).sort();

test('catalog search matches scientific names and combines animal filters', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await expect(page.getByRole('heading', { name: 'Meet your wild neighbors.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^View / })).toHaveCount(species.length);
  const bird = species.find(entry => entry.group === 'Birds')!;
  await page.getByLabel('Animal group').selectOption('Birds');
  await expect(page.getByRole('button', { name: /^View / })).toHaveCount(species.filter(entry => entry.group === 'Birds').length);
  await page.getByLabel('Search the field guide').fill(bird.scientificName.toUpperCase());
  await expect(page.getByRole('button', { name: /^View / })).toHaveCount(1);
  await expect(page.getByRole('button', { name: `View ${bird.name}`, exact: true })).toBeVisible();
  await page.getByLabel('Search the field guide').fill('no-real-animal-matches-this');
  await expect(page.getByRole('heading', { name: 'No creatures in this patch.' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByRole('button', { name: /^View / })).toHaveCount(species.length);
  await expect(page.getByLabel('Animal group')).toHaveValue('All');
  await expect(page.getByLabel('Search the field guide')).toHaveValue('');
});

test('map regions select precisely their associated species and clear safely', async ({ page }) => {
  await page.goto('/map/');
  await waitForHydration(page);
  await page.getByRole('button', { name: /Shenandoah Valley/ }).first().click();
  await expect.poll(async () => (await page.getByRole('button', { name: /^View / }).allTextContents()).map(name => name.trim()).sort())
    .toEqual(names(species.filter(entry => entry.regionIds.includes('valley'))));
  await expect(page.getByText(/illustrative/i).first()).toBeVisible();
  await page.getByRole('button', { name: 'Clear region filter', exact: true }).click();
  await expect(page.getByRole('button', { name: /^View / })).toHaveCount(species.length);
});

test('a sourced detail entry remembers discoveries after reload and collection navigation', async ({ page }) => {
  const entry = species[0];
  await page.goto('/');
  await waitForHydration(page);
  await page.getByRole('button', { name: `View ${entry.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: entry.name, exact: true });
  await expect(dialog.getByText(entry.scientificName, { exact: true })).toBeVisible();
  expect(await dialog.locator('a[href^="https:"]').first().getAttribute('href')).toBe(entry.sourceURLs[0]);
  await dialog.getByRole('button', { name: `Mark as seen: ${entry.name}`, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByRole('button', { name: `Unmark ${entry.name} as seen`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'View your discoveries', exact: true }).click();
  await waitForHydration(page);
  await expect(page.getByRole('button', { name: /^View / })).toHaveCount(1);
  await page.getByRole('button', { name: `Unmark ${entry.name} as seen`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No creatures in this patch.' })).toBeVisible();
});

test('corrupt saved collection and motion preferences do not break exploration', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('naturedex.seen.v1', '{broken json');
    localStorage.setItem('naturedex.motion.v1', 'invalid-value');
  });
  await page.goto('/');
  await waitForHydration(page);
  await expect(page.getByRole('button', { name: /^View / })).toHaveCount(species.length);
  await expect(page.getByRole('button', { name: 'Pause sprites', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: `Mark ${species[0].name} as seen`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Unmark ${species[0].name} as seen`, exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('published journal articles are readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4371/journal/');
    for (const post of published) await expect(page.getByRole('link', { name: post.title, exact: true })).toBeVisible();
    await page.getByRole('link', { name: published[0].title, exact: true }).click();
    await expect(page.getByRole('heading', { name: published[0].title, exact: true })).toBeVisible();
    await expect(page.locator('.article-body')).not.toHaveText('');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page).toHaveTitle(new RegExp(published[0].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally { await context.close(); }
});

test('the public site loads journal content without an application API', async ({ page }) => {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/', '/map/', '/journal/', `/journal/${published[0].slug}/`, '/editor/']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await waitForHydration(page);
    await expect(page.getByRole('main')).toBeVisible();
  }
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('unknown routes return HTTP 404 with a useful way back', async ({ page }) => {
  const response = await page.goto('/journal/no-such-field-note/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to the field guide', exact: true })).toBeVisible();
});

test('the writing desk hands authoring to native Contentstack without a custom editor', async ({ page }) => {
  await page.goto('/editor/');
  await waitForHydration(page);
  await expect(page.getByRole('heading', { name: 'Your writing desk.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A home for your field notes.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Contentstack', exact: true })).toHaveAttribute('href', /^https:\/\/(?:[a-z]+(?:-[a-z]+)?-)?app\.contentstack\.com\/$/);
  await expect(page.getByRole('button', { name: 'New post', exact: true })).toHaveCount(0);
  await expect(page.locator('form')).toHaveCount(0);
});

test('mobile pages and controls reflow at 375 and 320 CSS pixels', async ({ page }, testInfo) => {
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 812 });
    for (const path of ['/', '/map/', '/journal/', `/journal/${published[0].slug}/`, '/editor/']) {
      await page.goto(path);
      await waitForHydration(page);
      await expect(page.getByRole('main')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} at ${width}px`).toBe(true);
    }
    await testInfo.attach(`authoring-portal-${width}px`, { body: await page.screenshot(), contentType: 'image/png' });
  }
});
