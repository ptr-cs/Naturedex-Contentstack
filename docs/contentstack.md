# Native Contentstack CMS

This edition uses Astro, React, TypeScript and Contentstack. Astro builds static pages from the reviewed data/content.json snapshot. Visitors need no CMS token, database, PHP service or custom editorial login. Editing happens in Contentstack's own interface.

The checked-in snapshot currently has source "seed". It preserves all 24 species and four existing published field notes, including the authored deer article. A seed build demonstrates the frontend; it is not evidence of a connected Contentstack account. A successful authenticated pull changes the source to "contentstack" and records its sync time.

## Connect an actual stack

1. Create or select a Contentstack stack, its delivery environment and locale.
2. Use the stack's cloud region. The supported identifiers are aws-na, aws-eu, aws-au, azure-na, azure-eu, gcp-na and gcp-eu.
3. Save local configuration in the ignored .env file. Set CONTENTSTACK_API_KEY, CONTENTSTACK_DELIVERY_TOKEN and CONTENTSTACK_ENVIRONMENT. CONTENTSTACK_REGION defaults to aws-na and CONTENTSTACK_LOCALE to en-us. CONTENTSTACK_BRANCH is optional.
4. For the one-time model/entry import only, additionally set CONTENTSTACK_MANAGEMENT_TOKEN. Use a scoped management token with the needed content-type and entry permissions. Do not use any PUBLIC_ environment prefix, put tokens in URLs, commit .env or upload it with the static site.
5. Review the offline proposal:

       npm run cms:import

6. When you intend to create missing native models and entries in that stack, run:

       npm run cms:import -- --apply

The default command performs zero network requests and shows an offline proposal. The apply command reads existing content first, creates missing content types and entries, and leaves existing entries unchanged. It never updates, deletes or publishes content. It imports from data/content.json so the fourth existing field note is retained. A matching existing stable ID is skipped even if its content differs; a slug belonging to another ID blocks the import. An incompatible top-level model blocks rather than being overwritten. This is a bootstrap importer for a fresh compatible stack, not a complete nested-schema migration or schema-diff tool. A partial network failure can leave some new drafts; rerunning reconciles missing records.

The project's own stack (EU region) was set up with these steps: `cms:import -- --apply` created both content types, 24 species and 4 field notes, which were then published from the dashboard.

Two Contentstack behaviours to know about: the field name `region_ids` is reserved, so the species regions field is `habitat_regions`; and list endpoints leave out `count` when a list is empty, which the importer and pull treat as zero.

## Content model

The native schema JSON files are under contentstack/content-types. Species entries contain common/scientific names, group, number, text descriptions, multiple habitat/diet values, activity, measurement endpoints and qualifications, illustrative region associations, primary source URLs, and a supported local sprite path.

Field notes contain a stable ID, slug, title, excerpt, Markdown body, category, author label, original publication date and native references to species entries. Application creation/update timestamps come from Contentstack's native metadata. The importer does not attempt to overwrite those system fields with historical timestamps.

The stable_id field preserves the application's species and article IDs independently of Contentstack's generated UID. References use the modern native reference format: an array of UID/content-type objects, with species as the only allowed target type and multiple references enabled. They are resolved through the UIDs of published species, then normalized to the existing relatedSpeciesIds contract.

The Markdown field supports native authoring, while this frontend intentionally renders its existing small safe subset. Paragraphs and level-two headings are supported; raw HTML is displayed as text. This is not a claim of complete CommonMark or rich-text support.

## Publish, pull and rebuild

Publish the species entries to the selected environment before publishing notes that reference them. In the same environment/locale, publish the field notes you want visitors to read. Then run:

    npm run cms:pull
    npm run build

The pull uses the Content Delivery API and its delivery token, which returns published content. It reads both complete collections with pagination, validates their relationships, and atomically replaces the snapshot only after the entire pull succeeds. Tokens stay in request headers on allowlisted official HTTPS endpoints; redirects are disabled and requests have timeouts.

The reader and build use only the snapshot. Native CMS drafts, saved but unpublished edits, preview tokens and management credentials are excluded. Runtime browser code does not contact Contentstack. The release checks require a genuine Contentstack snapshot; an ordinary local seed build remains available for development.

Creating or editing an entry in Contentstack changes the built site only after publication, another pull, another build and deployment of the resulting artifact. Unpublishing or deleting an entry removes it on the next successful pull/build/deployment; there is no automatic seed fallback or reseeding. If a published article refers to an unpublished or missing species, pulling fails so the last reviewed snapshot remains intact. Resolve the relationship or publication state, then pull again.

An optional publish webhook runs the same pull, validation, tests and build automatically; see [publish to live](publishing.md). There is no custom writing desk or Contentstack Live Preview. Preview integration should remain separate from the public delivery-token path.

## Validation and tests

Snapshot validation rejects drafts, unknown fields, unsafe IDs/slugs, duplicate article/species IDs, duplicate numbers/slugs, unavailable species references, unsupported sprite paths or map regions, non-HTTPS source links, malformed timestamps and negative, incomplete or reversed measurement ranges. Unknown sourced measurements remain null.

Client tests use controlled HTTP doubles; they cover regional configuration, secret handling, pagination completeness, reference resolution, validation failure, atomic replacement, and the management importer's create-only behavior. They do not claim a completed live account import.

## Official references

- [Regional API endpoints](https://www.contentstack.com/docs/administration/api-endpoints): choose endpoints matching the stack.
- [Content Delivery API entries](https://www.contentstack.com/docs/developers/apis/content-delivery-api/entries): delivery tokens retrieve published entries with environment and locale selection.
- [Content Management API](https://www.contentstack.com/docs/developers/apis/content-management-api): management token authentication and native content operations.
- [Content type schemas](https://www.contentstack.com/docs/headless-cms/json-schema-for-creating-a-content-type): text, Markdown, group, number, date and reference field definitions.
- [Native entry management](https://www.contentstack.com/docs/developers/apis/content-management-api/entries): creation, editing and publishing are distinct operations.
