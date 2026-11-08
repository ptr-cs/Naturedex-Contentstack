# Naturedex · Contentstack

The first Naturedex CMS comparison: **Contentstack + Astro + React + TypeScript**. It reuses Naturedex’s original visual design, 24 animated wildlife sprites, Virginia map, collection tracking, and four previously published field notes.

Astro generates HTML for every route. React supplies filtering, map selection, dialogs, motion controls, and browser-local discoveries. Contentstack owns wildlife entries, blog posts, references, user accounts, roles, drafts, and publishing. There is no application database or custom login service.

## Run locally

Use Node 24 and npm:

```sh
npm ci
npm run dev
```

Open http://localhost:4321. To test the exact static files that AWS will receive:

```sh
npm run build
npm run preview
```

`data/content.json` is the single build input for local development and AWS. It currently contains a **seed snapshot**, preserved from the original project. It is not evidence of an active Contentstack connection. No Contentstack account has been modified, and nothing has been deployed to AWS.

## Connect the CMS

Follow [Contentstack setup](docs/contentstack.md) to create a stack and environment, import the provided structured models and seed entries, and publish them. Keep credentials in a local, ignored `.env` file:

```sh
cp .env.example .env
# Fill in the stack's delivery settings locally.
npm run cms:pull
npm run build
npm run preview
```

`cms:pull` reads published content from the real Content Delivery API and atomically replaces the snapshot. Missing credentials, invalid content, and API failures stop the sync; they do not substitute seed data. All posts and species use the same typed content contract in either environment.

Use `/editor/` to open Contentstack’s native authoring workspace. CMS users create, edit, preview drafts inside the CMS, publish, unpublish, or delete entries there. The public website changes after a successful **sync → build → release**. With [publish to live](docs/publishing.md) set up, a publish, unpublish or delete runs that automatically. The website has no live draft preview.

[Optional Codex/ChatGPT integration](docs/ai-integration.md) describes Contentstack’s MCP options. No integration is connected yet.

## Verify

```sh
npm run verify
```

This runs the production build, unit/coverage checks, Playwright browser and accessibility checks, and a separate Selenium WebDriver suite. See [testing and accessibility](docs/testing.md) for browser requirements, reports, and manual checks that automated tests cannot establish.

## Deploy to AWS

```sh
aws login
npm run deploy:aws            # stack + build + upload + CloudFront invalidation
npm run deploy:aws -- destroy # remove the stack and its bucket
```

The script creates or updates the `naturedex-contentstack` CloudFormation stack (S3 + CloudFront, `us-east-1`), builds with `SITE_URL` set to the distribution's URL, scans the artifact, uploads it, and prints the live URL. Override the stack or region with `NATUREDEX_STACK` / `NATUREDEX_REGION`. A seed snapshot deploys as a preview. After `cms:pull`, the same command also runs the release provenance check. Rerun it after each pull to publish CMS changes.

## System status

`/status/` describes the build that is live: where its content came from and when it was pulled, how many species and field notes are published, unit test totals, the app version from `package.json`, and when it was built. It is generated during each deploy (`deploy:aws` runs the unit tests and records their totals first), so it never contacts GitHub, AWS, or Contentstack from the browser. Like the WordPress edition, it shows counts and yes/no results only. A failed deploy never replaces the live site, so failures appear only in the repository's Actions history.

## Publish to live

Once set up, publishing in Contentstack updates the public site automatically, usually within 2–4 minutes. A webhook starts a GitHub Actions deploy through a small AWS Lambda relay. Drafts are not shown on the public site. See [publish to live](docs/publishing.md) for setup and security notes.

## Prepare an AWS release (manual steps)

```sh
npm run cms:pull
SITE_URL=https://naturedex-contentstack.ptr-cs.com npm run build:release
```

The hostname above is an example subdomain of your existing domain; choose the actual hostname before release. No DNS record has been created. The release guard rejects an untouched seed snapshot and requires a public HTTPS site URL. The output is `dist/`, served identically by the local preview and AWS static hosting. The post-build scan checks for configured token values and unexpected backend/secret files.

[AWS deployment instructions](docs/aws-deployment.md) cover the supplied CloudFormation template, private S3 bucket, CloudFront distribution, optional custom domain, content refreshes, rollback, cleanup, and cost considerations. **Those instructions are preparation only; no AWS resources have been created.** Contentstack is a separate managed service; AWS hosts the frontend.

## Main files

| Path | Purpose |
| --- | --- |
| `src/components/` | Reused accessible React interface and sprite animation |
| `src/pages/` | Static routes, journal pages, sitemap, and RSS |
| `src/lib/content.ts` | Shared runtime validation and snapshot loader |
| `src/lib/contentstack.ts` | Published-content adapter |
| `contentstack/` | Native CMS model definitions |
| `scripts/contentstack/` | Explicit import and published-content sync tools |
| `data/content.json` | Current public build snapshot |
| `public/` | Local art, map, and licensed font |
| `infra/aws.yaml` | Undeployed AWS infrastructure definition |

The original `Naturedex` directory is unchanged. No Drupal, D1, Vinext, or ChatGPT Sites runtime is used by this variation.

## Content and asset sources

The map’s four regions describe illustrative habitat associations rather than sightings or precise distribution ranges. Each animal links its primary references. The Virginia outline retains its source attribution in `public/map/virginia.geojson`. The pixel art and game-inspired interface are original Naturedex assets; the Silkscreen font’s SIL Open Font License is included at `public/fonts/OFL.txt`.
