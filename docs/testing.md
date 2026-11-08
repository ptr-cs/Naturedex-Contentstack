# Testing Naturedex

Run from the project directory with Node 24:

```sh
npm ci
npm run verify
```

`verify` builds the actual static site, runs unit tests with coverage, exercises the generated site with Playwright, then runs a separate Selenium WebDriver suite. Build before running either browser command directly:

```sh
npm run build
npm run test:coverage
npm run test:e2e
npm run test:selenium
```

The tests read the reviewed `data/content.json` snapshot. They do not call Contentstack, use CMS credentials, publish content, or contact AWS. The browser journeys cover the generated production files in `dist`, rather than a development server. Content changes require rebuilding before another browser run.

## What each layer checks

| Layer | Evidence |
| --- | --- |
| Astro/TypeScript | Type checking is part of `npm run build`. |
| Vitest | Combined discovery filters, Unicode-safe slugs, measurement formatting, content relationships and source references, local artwork, Virginia geometry, exact original animation poses, and Contentstack/import/release contracts. |
| Playwright | Search/group/reset, exact map-to-animal correlation, sourced detail views, persistent collection, damaged saved state, journal reading without JavaScript, static loading without an application API, real 404 responses, native authoring handoff, 320/375-pixel layouts, keyboard focus, motion controls, every animation’s computed CSS, and axe scans. |
| Selenium | Real Chrome WebDriver independently exercises catalog/map/search/collection, dialog keyboard containment, reading each article, native authoring handoff, pause/reduced motion, narrow layouts, 404 recovery, and axe scans after interaction. |
| Release checks | The infrastructure and release tests inspect private-origin configuration, route rewriting, true 404 behavior, and credential leakage safeguards. See [AWS deployment](aws-deployment.md). |

Coverage measures the selected application libraries, not generated sprite files or browser interactions. HTML coverage reports show which branches remain untested; a high percentage does not demonstrate accessibility or CMS account permissions.

## Browsers and artifacts

Install Playwright Chromium once if needed:

```sh
npx playwright install chromium
```

Playwright serves the static build at `http://127.0.0.1:4371`; in CI it always starts its own server. Locally it may reuse an existing preview on that port. Its HTML report is in `playwright-report/`; failures retain traces and screenshots in `test-results/playwright/`. Each browser harness owns its own artifact subdirectory, so parallel runs do not clear the other harness’s evidence. Axe results and responsive captures are attached to the report.

Selenium always owns a separate loopback server at port 4372, checks for an occupied port before starting, and shuts it down after the run. Chrome must be installed; Selenium Manager obtains the matching driver, caching it in `.cache/selenium`. The first run may need network access. It uses the installed macOS Chrome when available and otherwise Selenium Manager’s browser discovery. No system installation or CMS login is performed.

`test-results/selenium/` contains JUnit XML, run metadata, actual browser/driver versions, axe JSON, and narrow-screen captures. Failed scenarios also save a screenshot, HTML, current URL, focus/viewport state, and browser console logs. The runner clears only its own previous artifact directory at launch.

Optional Selenium settings:

```sh
SELENIUM_TEST_NAME_PATTERN='keyboard' npm run test:selenium
BROWSER=firefox npm run test:selenium
SELENIUM_REMOTE_URL=http://localhost:4444/wd/hub npm run test:selenium
```

Firefox and Grid are supported configuration options; they are not validated unless their results are explicitly recorded. A Grid browser must be able to reach the loopback preview. Chrome DevTools emulation supplies precise CSS viewport widths and live reduced-motion changes. A browser without that API skips the reduced-motion emulation scenario with an explicit reason; validate that preference on its native platform.

## Accessibility scope

Both browser suites run axe against WCAG 2 A/AA, WCAG 2.1 A/AA, and applicable WCAG 2.2 AA rules. The suites also test keyboard entry, forward/reverse dialog focus wrapping, Escape, opener restoration, OS reduced motion, persistent pause, and reflow at 320 CSS pixels. Article content and links are checked with JavaScript disabled.

Automated checks are regression evidence, not a Section 508 certification. Manual review still needs a keyboard-only walkthrough, visible focus and high-contrast/forced-colors checks, 200% text zoom and 400% page zoom, content accuracy/alternative-text judgment, and screen-reader trials such as VoiceOver with Safari and NVDA with Firefox or Chrome. Test the native Contentstack authoring interface separately with the actual account and assistive technology used by its authors.

## CMS verification boundary

Contentstack schema, mapping, pagination, input rejection, environment handling, and import/delivery behavior are exercised with local fixtures or dry runs. Browser tests verify that `/editor/` hands authors to `https://app.contentstack.com/`; they deliberately do not follow the external link. Creating, updating, publishing, and deleting real Contentstack entries, account permissions, delivery credentials, webhook-triggered rebuilds, and production CDN behavior require an actual configured stack and deployment. Those actions have not been live-verified by this local suite.
