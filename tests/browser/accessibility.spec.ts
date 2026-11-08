import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { waitForHydration } from './helpers';

const { species, posts } = JSON.parse(readFileSync(new URL('../../data/content.json', import.meta.url), 'utf8'));
const post = posts.find((entry: {status: string}) => entry.status === 'published');

async function scan(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  await testInfo.attach('axe-results', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  expect(results.violations).toEqual([]);
}

for (const route of ['/', '/map/', '/journal/', `/journal/${post.slug}/`, '/editor/', '/status/', '/missing-page/']) {
  test(`accessibility: ${route} has no detected WCAG violations`, async ({ page }, testInfo) => {
    await page.goto(route);
    await waitForHydration(page);
    await expect(page.getByRole('main')).toBeVisible();
    await scan(page, testInfo);
    await testInfo.attach('page-preview', { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('accessibility: keyboard inspection traps focus, closes on Escape, and restores the opener', async ({ page }, testInfo) => {
  await page.goto('/');
  await waitForHydration(page);
  const trigger = page.getByRole('button', { name: `View ${species[0].name}`, exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: species[0].name, exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  const controls = dialog.locator('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
  await controls.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  await scan(page, testInfo);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('accessibility: empty and region-filtered states remain labeled and recoverable', async ({ page }, testInfo) => {
  await page.goto('/map/');
  await waitForHydration(page);
  await page.getByRole('button', { name: /Shenandoah Valley/ }).first().click();
  await scan(page, testInfo);
  await page.getByLabel('Search the field guide').fill('no-real-animal-matches-this');
  await expect(page.getByRole('heading', { name: 'No creatures in this patch.' })).toBeVisible();
  await scan(page, testInfo);
});
