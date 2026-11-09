import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Builder, By, Key, logging, error } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import firefox from 'selenium-webdriver/firefox.js';
import { Select } from 'selenium-webdriver/lib/select.js';
import axe from 'axe-core';

export { assert, By, Key };
export const base = process.env.SELENIUM_BASE_URL || 'http://127.0.0.1:4372';
export const artifacts = resolve(process.env.SELENIUM_ARTIFACTS || 'test-results/selenium');
const timeout = Number(process.env.SELENIUM_WAIT_MS || 15_000);
export const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function createDriver() {
  const browser = process.env.BROWSER || 'chrome';
  if (!['chrome', 'firefox'].includes(browser)) throw new Error('BROWSER must be chrome or firefox.');
  const preferences = new logging.Preferences();
  preferences.setLevel(logging.Type.BROWSER, logging.Level.ALL);
  const builder = new Builder().forBrowser(browser).setLoggingPrefs(preferences);
  if (process.env.SELENIUM_REMOTE_URL) builder.usingServer(process.env.SELENIUM_REMOTE_URL);
  if (browser === 'chrome') {
    const options = new chrome.Options().addArguments('--headless=new', '--window-size=1440,1000', '--disable-dev-shm-usage');
    const binary = process.env.SELENIUM_CHROME_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!process.env.SELENIUM_REMOTE_URL && existsSync(binary)) options.setChromeBinaryPath(binary);
    builder.setChromeOptions(options);
  } else builder.setFirefoxOptions(new firefox.Options().addArguments('-headless'));
  const driver = await builder.build();
  await driver.manage().setTimeouts({ implicit: 0, pageLoad: 45_000, script: 30_000 });
  const capabilities = await driver.getCapabilities();
  mkdirSync(artifacts, { recursive: true });
  appendFileSync(resolve(artifacts, 'browsers.ndjson'), JSON.stringify({
    browser: capabilities.get('browserName'), version: capabilities.get('browserVersion'),
    platform: capabilities.get('platformName'),
    driverVersion: capabilities.get('chrome')?.chromedriverVersion?.split(' ')[0] || null,
    at: new Date().toISOString(),
  }) + '\n');
  return driver;
}

const transient = exception => exception instanceof error.NoSuchElementError || exception instanceof error.StaleElementReferenceError;
export async function wait(driver, condition, description) {
  return driver.wait(async () => {
    try { return await condition(); }
    catch (exception) { if (transient(exception)) return false; throw exception; }
  }, timeout, description, 100);
}
export async function role(driver, kind, name, scope = driver) {
  const selectors = {
    button: 'button,[role="button"]', link: 'a[href],[role="link"]',
    heading: 'h1,h2,h3,h4,h5,h6,[role="heading"]', dialog: 'dialog,[role="dialog"]',
    alert: '[role="alert"]', status: '[role="status"]',
  };
  return wait(driver, async () => {
    for (const element of await scope.findElements(By.css(selectors[kind] || `[role="${kind}"]`))) {
      if (!await element.isDisplayed()) continue;
      const accessible = await element.getAccessibleName() || (['alert', 'status'].includes(kind) ? await element.getText() : '');
      if (typeof name === 'string' ? accessible === name : name.test(accessible)) return element;
    }
    return false;
  }, `${kind} named ${String(name)} should be available`);
}
export async function field(driver, name) {
  return wait(driver, async () => {
    for (const element of await driver.findElements(By.css('input,textarea,select'))) {
      if (await element.isDisplayed() && await element.getAccessibleName() === name) return element;
    }
    return false;
  }, `Field ${name} should be available`);
}
export async function fill(driver, name, value) {
  const element = await field(driver, name);
  const platform = String((await driver.getCapabilities()).get('platformName')).toLowerCase();
  await element.sendKeys(Key.chord(platform.includes('mac') ? Key.COMMAND : Key.CONTROL, 'a'), Key.BACK_SPACE);
  if (value) await element.sendKeys(value);
}
export async function select(driver, name, value) {
  const control = new Select(await field(driver, name));
  for (const option of await control.getOptions()) {
    if (await option.getAttribute('value') === value) {
      await control.selectByVisibleText(await option.getText());
      return;
    }
  }
  throw new Error(`No option ${value} exists in ${name}`);
}
export async function ready(driver) {
  await wait(driver, async () => {
    for (const button of await driver.findElements(By.css('button.sprite-motion-toggle'))) {
      if (!await button.isDisplayed()) continue;
      return await button.isEnabled() || await button.getText() === 'Reduced motion';
    }
    return false;
  }, 'The visible motion control should indicate that client hydration is complete');
}
export async function go(driver, path = '/') {
  await driver.get(new URL(path, base).href);
  await ready(driver);
}
export async function visibleSpecies(driver) {
  return driver.executeScript(() => [...document.querySelectorAll('button[aria-label^="View "]')]
    .filter(element => element.getClientRects().length).map(element => element.getAttribute('aria-label').slice(5)));
}
export async function seenState(driver, name, value) {
  await wait(driver, async () => (await role(driver, 'button', new RegExp(`(?:Mark|Unmark) ${name} as seen`)))
    .getAttribute('aria-pressed').then(state => state === String(value)), 'The collection state should update');
}
export async function motionState(driver, enabled) {
  await wait(driver, () => driver.executeScript(value => {
    const images = [...document.querySelectorAll('img[data-sprite]')];
    return images.length > 0 && images.every(image => image.dataset.animated === String(value)
      && image.getAttribute('src').endsWith(value ? '-animated.svg' : '.svg')
      && (value || !image.getAttribute('src').endsWith('-animated.svg')));
  }, enabled), `All animal images should use ${enabled ? 'animated' : 'static'} assets`);
}
export async function media(driver, reduced) {
  if (typeof driver.sendDevToolsCommand !== 'function') return false;
  await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
  });
  return true;
}
export async function viewport(driver, width, height = 812) {
  if (typeof driver.sendDevToolsCommand === 'function') {
    await driver.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  } else await driver.manage().window().setRect({ width, height });
  assert.equal(await driver.executeScript('return window.innerWidth'), width, 'The browser must provide the requested CSS viewport');
}
export async function scan(driver, label) {
  await driver.executeScript(axe.source);
  const result = await driver.executeAsyncScript(done => {
    window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
      .then(results => done(results)).catch(exception => done({ error: exception.message }));
  });
  mkdirSync(resolve(artifacts, 'axe'), { recursive: true });
  writeFileSync(resolve(artifacts, 'axe', `${slug(label)}.json`), JSON.stringify(result, null, 2));
  assert.ok(!result.error, result.error);
  assert.deepEqual(result.violations.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.map(node => node.target) })), [], `axe findings in ${label}`);
}
export async function capture(driver, name) {
  const directory = resolve(artifacts, 'failures', slug(name));
  mkdirSync(directory, { recursive: true });
  const attempts = await Promise.allSettled([
    driver.takeScreenshot().then(png => writeFileSync(resolve(directory, 'screen.png'), png, 'base64')),
    driver.getPageSource().then(html => writeFileSync(resolve(directory, 'page.html'), html)),
    driver.getCurrentUrl().then(url => writeFileSync(resolve(directory, 'url.txt'), url)),
    driver.manage().logs().get(logging.Type.BROWSER).then(logs => writeFileSync(resolve(directory, 'browser.json'), JSON.stringify(logs, null, 2))),
    driver.executeScript(() => ({ activeElement: document.activeElement?.outerHTML.slice(0, 1200),
      viewport: { width: innerWidth, height: innerHeight }, width: document.documentElement.scrollWidth }))
      .then(state => writeFileSync(resolve(directory, 'state.json'), JSON.stringify(state, null, 2))),
  ]);
  for (const result of attempts) if (result.status === 'rejected') console.error('Artifact capture:', result.reason?.message);
}
