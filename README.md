# Naturedex · Contentstack

The first Naturedex CMS comparison: **Contentstack + Astro + React + TypeScript**. It reuses Naturedex’s original visual design, 24 animated wildlife sprites, Virginia map, collection tracking, and four previously published field notes.

Astro generates HTML for every route. React supplies filtering, map selection, dialogs, motion controls, and browser-local discoveries. Contentstack owns wildlife entries, blog posts, references, user accounts, roles, drafts, and publishing. There is no application database or custom login service.

**Live:** https://d2bo5f1eb7smry.cloudfront.net ([status](https://d2bo5f1eb7smry.cloudfront.net/status/))

Publishing an entry in Contentstack rebuilds and redeploys the site automatically, usually within 2–4 minutes:

```
Contentstack publish ─▶ webhook ─▶ AWS Lambda relay ─▶ GitHub Actions ─▶ S3 + CloudFront
```

See [architecture](docs/architecture.md) for diagrams of every part, the publish sequence and where each credential lives.

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

`data/content.json` is the single build input for local development and AWS. It holds the content last pulled from Contentstack (`"source": "contentstack"`). Run `npm run cms:pull` to refresh it. The original seed data was imported into Contentstack and is no longer used directly.

## Connect the CMS

The project uses a Contentstack stack in the **EU region** (`CONTENTSTACK_REGION=aws-eu`, editor at https://eu-app.contentstack.com). To connect your own stack, follow [Contentstack setup](docs/contentstack.md). Keep credentials in a local, ignored `.env` file:

```sh
cp .env.example .env
# Fill in the API key, delivery token, environment and region.
npm run cms:import             # offline dry run: lists what would be created
npm run cms:import -- --apply  # creates missing content types and entries (needs a management token)
# Publish the entries in Contentstack (species first, then field notes).
npm run cms:pull
npm run preview
```

`cms:import --apply` only creates what is missing. It never updates, deletes or publishes. The management token is only needed for this step and stays in `.env`.

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

The script creates or updates the `naturedex-contentstack` CloudFormation stack (S3 + CloudFront, `us-east-1`), runs the unit tests, builds with `SITE_URL` set to the distribution's URL, scans the artifact, uploads it, and prints the live URL. Override the stack or region with `NATUREDEX_STACK` / `NATUREDEX_REGION`. A Contentstack snapshot also has to pass the release provenance check; a seed snapshot deploys as a labelled preview.

Day to day you don't need this command: content publishes and pushes to `main` deploy through GitHub Actions. Run it from your machine only to change the infrastructure in `infra/aws.yaml`.

## System status

`/status/` describes the build that is live: where its content came from and when it was pulled, how many species and field notes are published, unit test totals, the app version from `package.json`, and when it was built. It is generated during each deploy (`deploy:aws` runs the unit tests and records their totals first), so it never contacts GitHub, AWS, or Contentstack from the browser. Like the WordPress edition, it shows counts and yes/no results only. A failed deploy never replaces the live site, so failures appear only in the repository's Actions history.

## Publish to live

Publishing, unpublishing or deleting an entry in Contentstack updates the public site automatically, usually within 2–4 minutes. A Contentstack webhook calls a small AWS Lambda relay, which starts the GitHub Actions **Deploy** workflow. Pushes to `main` deploy the same way, and you can start a run by hand from the Actions tab.

Only published content appears on the site. Saving a draft does nothing; seeing drafts before publishing would need Contentstack Live Preview, which this setup does not include. See [publish to live](docs/publishing.md) for setup, security notes and cost.

## Custom domain (not set up)

The site is served from its CloudFront address. To use your own hostname, for example `naturedex-contentstack.ptr-cs.com`, see [AWS deployment](docs/aws-deployment.md) for the certificate and DNS steps, then build with that `SITE_URL`:

```sh
SITE_URL=https://naturedex-contentstack.ptr-cs.com npm run build:release
```

The release guard rejects a seed snapshot and requires a public HTTPS site URL. The post-build scan checks for configured token values and unexpected backend or secret files.

## Main files

| Path | Purpose |
| --- | --- |
| `src/components/` | Reused accessible React interface and sprite animation |
| `src/pages/` | Static routes, journal pages, sitemap, and RSS |
| `src/lib/content.ts` | Shared runtime validation and snapshot loader |
| `src/lib/contentstack.ts` | Published-content adapter |
| `src/lib/status.ts` | Build-time data for `/status/` |
| `contentstack/` | Native CMS model definitions |
| `scripts/contentstack/` | Explicit import and published-content sync tools |
| `data/content.json` | Current public build snapshot |
| `public/` | Local art, map, and licensed font |
| `infra/aws.yaml` | Site hosting: S3 + CloudFront |
| `infra/publish.yaml` | Webhook relay and GitHub deploy role (generated from `infra/publish-relay.js`) |
| `scripts/deploy-aws.sh` | Test, build, scan, upload and invalidate |
| `scripts/setup-publishing.sh` | One-time publish-to-live setup |
| `.github/workflows/deploy.yml` | Deploy on publish, push to `main` or manual run |
| `docs/architecture.md` | Diagrams and credential map |

The original `Naturedex` directory is unchanged. No Drupal, D1, Vinext, or ChatGPT Sites runtime is used by this variation.

## Content and asset sources

The map’s four regions describe illustrative habitat associations rather than sightings or precise distribution ranges. Each animal links its primary references. The Virginia outline retains its source attribution in `public/map/virginia.geojson`. The pixel art and game-inspired interface are original Naturedex assets; the Silkscreen font’s SIL Open Font License is included at `public/fonts/OFL.txt`.
