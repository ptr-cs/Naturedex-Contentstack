import { test } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assert, By, Key, artifacts, base, capture, createDriver, field, fill, go,
  media, motionState, ready, role, scan, select, seenState, viewport, visibleSpecies, wait,
} from './helpers.mjs';

assert.equal(new URL(base).hostname, '127.0.0.1', 'UI tests must only target the owned loopback preview.');
const species = JSON.parse(readFileSync(new URL('../../data/content.json', import.meta.url), 'utf8')).species;
const first = species[0];
const posts = JSON.parse(readFileSync(new URL('../../data/content.json', import.meta.url), 'utf8')).posts.filter(post => post.status === 'published');
function scenario(name, body) {
  test(name, { timeout: 90_000 }, async context => {
    let driver;
    try {
      driver = await createDriver();
      await go(driver);
      await body(driver, context);
    } catch (exception) {
      if (driver) await capture(driver, name);
      throw exception;
    } finally { if (driver) await driver.quit(); }
  });
}
scenario('the catalog exposes all animals, physical facts, and primary references', async driver => {
  await role(driver, 'heading', 'Meet your wild neighbors.');
  assert.equal((await visibleSpecies(driver)).length, species.length);
  await (await role(driver, 'button', `View ${first.name}`)).click();
  const dialog = await role(driver, 'dialog', first.name);
  assert.ok((await dialog.getText()).includes(first.scientificName));
  const statistics = await Promise.all((await dialog.findElements(By.css('dt'))).map(element => element.getText()));
  for (const label of ['ACTIVE HOURS', 'DIET', 'LENGTH', 'WEIGHT', 'HABITAT']) assert.ok(statistics.includes(label));
  const links = await dialog.findElements(By.css('a[href^="https://"]'));
  assert.ok(links.length > 0);
  assert.ok(first.sourceURLs.includes(await links[0].getAttribute('href')));
});

scenario('search, group filtering, empty results, and reset remain consistent', async driver => {
  const birds = species.filter(entry => entry.group === 'Birds');
  await select(driver, 'Animal group', 'Birds');
  await wait(driver, async () => (await visibleSpecies(driver)).length === birds.length, 'Bird filter should finish');
  assert.deepEqual((await visibleSpecies(driver)).sort(), birds.map(entry => entry.name).sort());
  await fill(driver, 'Search the field guide', birds[0].scientificName.toUpperCase());
  await wait(driver, async () => (await visibleSpecies(driver)).length === 1, 'Scientific-name search should narrow the guide');
  assert.equal((await visibleSpecies(driver))[0], birds[0].name);
  await fill(driver, 'Search the field guide', 'no-real-animal-matches-this');
  await role(driver, 'heading', 'No creatures in this patch.');
  assert.equal((await visibleSpecies(driver)).length, 0);
  await (await role(driver, 'button', 'Reset filters')).click();
  await wait(driver, async () => (await visibleSpecies(driver)).length === species.length, 'Reset should restore the complete guide');
  await select(driver, 'Sort entries', 'name');
  await wait(driver, async () => {
    const names = await visibleSpecies(driver);
    return names.join('|') === [...names].sort((a, b) => a.localeCompare(b)).join('|');
  }, 'Alphabetical sorting should update the list');
});

scenario('a selected map region correlates with the list and can be cleared', async driver => {
  await go(driver, '/map');
  await (await role(driver, 'button', /Shenandoah Valley/)).click();
  const expected = species.filter(entry => entry.regionIds.includes('valley')).map(entry => entry.name);
  await wait(driver, async () => (await visibleSpecies(driver)).length === expected.length, 'Regional filtering should finish');
  assert.deepEqual((await visibleSpecies(driver)).sort(), expected.sort());
  await scan(driver, 'selected map region');
  await (await role(driver, 'button', 'Clear region filter')).click();
  await wait(driver, async () => (await visibleSpecies(driver)).length === species.length, 'Clearing the map selection should restore all entries');
  assert.ok((await driver.findElement(By.css('.map-caption')).getText()).includes('illustrative'));
});

scenario('a discovered animal persists across reloads and collection navigation', async driver => {
  await (await role(driver, 'button', `Mark ${first.name} as seen`)).click();
  await seenState(driver, first.name, true);
  await driver.navigate().refresh();
  await ready(driver);
  await seenState(driver, first.name, true);
  await (await role(driver, 'link', 'View your discoveries')).click();
  await ready(driver);
  await wait(driver, async () => (await visibleSpecies(driver)).length === 1, 'The personal collection should contain one animal');
  assert.deepEqual(await visibleSpecies(driver), [first.name]);
  await (await role(driver, 'button', `Unmark ${first.name} as seen`)).click();
  await role(driver, 'heading', 'No creatures in this patch.');
});

scenario('keyboard entry inspection traps dialog focus and restores the opener', async driver => {
  const trigger = await role(driver, 'button', `View ${first.name}`);
  await trigger.sendKeys(Key.ENTER);
  const dialog = await role(driver, 'dialog', first.name);
  assert.equal(await driver.executeScript('return arguments[0].contains(document.activeElement)', dialog), true);
  await driver.actions().keyDown(Key.SHIFT).sendKeys(Key.TAB).keyUp(Key.SHIFT).perform();
  assert.equal(await driver.executeScript('return arguments[0].contains(document.activeElement)', dialog), true, 'Reverse tab order should stay inside the dialog');
  await driver.actions().sendKeys(Key.TAB).perform();
  assert.equal(await driver.executeScript('return arguments[0].contains(document.activeElement)', dialog), true, 'Tab should wrap from the final control');
  for (let step = 0; step < 8; step++) {
    await driver.actions().sendKeys(Key.TAB).perform();
    const focus = await driver.executeScript('return {inside:arguments[0].contains(document.activeElement), documentFocused:document.hasFocus(), active:document.activeElement.outerHTML.slice(0,300)}', dialog);
    assert.equal(focus.inside, true, `Tab ${step + 1}: ${JSON.stringify(focus)}`);
  }
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await wait(driver, () => driver.executeScript('return document.activeElement === arguments[0]', trigger), 'Closing the dialog should restore its opener');
});

scenario('the sprite pause control applies everywhere and persists across navigation', async driver => {
  await motionState(driver, true);
  await (await role(driver, 'button', 'Pause sprites')).click();
  await motionState(driver, false);
  assert.equal(await driver.executeScript("return localStorage.getItem('naturedex.motion.v1')"), 'paused');
  await go(driver, '/journal');
  await role(driver, 'button', 'Animate sprites');
  await motionState(driver, false);
  await driver.navigate().refresh();
  await ready(driver);
  await motionState(driver, false);
  await (await role(driver, 'button', 'Animate sprites')).click();
  await motionState(driver, true);
});

scenario('system reduced motion overrides animation and preserves a deliberate pause', async (driver, context) => {
  if (!await media(driver, true)) { context.skip('This browser/Grid does not expose the Chrome emulation command; validate reduced motion on its native platform.'); return; }
  const reduced = await role(driver, 'button', 'Reduced motion');
  assert.equal(await reduced.isEnabled(), false);
  await motionState(driver, false);
  await media(driver, false);
  await role(driver, 'button', 'Pause sprites');
  await motionState(driver, true);
  await (await role(driver, 'button', 'Pause sprites')).click();
  await media(driver, true);
  await role(driver, 'button', 'Reduced motion');
  await media(driver, false);
  await role(driver, 'button', 'Animate sprites');
  await motionState(driver, false);
});

scenario('mobile catalog and authoring portal reflow at 375 and 320 CSS pixels', async driver => {
  for (const width of [375, 320]) {
    await viewport(driver, width);
    for (const path of ['/', '/map', '/journal', '/editor']) {
      await go(driver, path);
      assert.equal(await driver.executeScript('return document.documentElement.scrollWidth <= window.innerWidth + 1'), true, `Overflow on ${path} at ${width}px`);
      await role(driver, 'button', 'Pause sprites');
    }
  }
  mkdirSync(resolve(artifacts, 'previews'), { recursive: true });
  writeFileSync(resolve(artifacts, 'previews', 'editor-320.png'), await driver.takeScreenshot(), 'base64');
});

scenario('axe scans public routes and an open animal detail', async driver => {
  for (const path of ['/', '/map/', '/journal/', `/journal/${posts[0].slug}/`, '/editor/', '/missing-page/']) { await go(driver, path); await scan(driver, `public ${path}`); }
  await go(driver);
  await (await role(driver, 'button', `View ${first.name}`)).click();
  await role(driver, 'dialog', first.name);
  await scan(driver, 'animal detail');
});

scenario('the journal opens every published field note and keeps its reading structure', async driver => {
  for (const post of posts) {
    await go(driver, '/journal/');
    await (await role(driver, 'link', post.title)).click();
    await ready(driver);
    await role(driver, 'heading', post.title);
    assert.ok((await driver.findElement(By.css('.article-body')).getText()).trim().length > 0);
    assert.equal((await driver.findElements(By.css('link[rel="canonical"]'))).length, 1);
    assert.ok((await driver.getTitle()).includes(post.title));
  }
});

scenario('the authoring portal links to native Contentstack without local editing or authentication', async driver => {
  await go(driver, '/editor/');
  await role(driver, 'heading', 'Your writing desk.');
  await role(driver, 'heading', 'A home for your field notes.');
  // The host follows the build's CONTENTSTACK_REGION (app., eu-app., azure-na-app., ...).
  assert.match(await (await role(driver, 'link', 'Open Contentstack')).getAttribute('href'), /^https:\/\/(?:[a-z]+(?:-[a-z]+)?-)?app\.contentstack\.com\/$/);
  assert.equal((await driver.findElements(By.css('form,input[type="password"]'))).length, 0);
});

scenario('a missing article returns a real 404 and provides navigation back to the guide', async driver => {
  const response = await fetch(`${base}/journal/no-such-field-note/`);
  assert.equal(response.status, 404);
  await go(driver, '/journal/no-such-field-note/');
  await (await role(driver, 'link', 'Return to the field guide')).click();
  await ready(driver);
  await role(driver, 'heading', 'Meet your wild neighbors.');
});

