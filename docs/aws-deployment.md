# AWS deployment preparation

Naturedex's AWS artifact is the static Astro `dist/` directory. Contentstack remains a separately managed SaaS CMS. A developer pulls published content into `data/content.json`, validates it, and builds the same pages used locally. AWS does not run Contentstack, Drupal, PHP, a database, or an application server for this version.

Nothing here has deployed resources, authenticated to AWS, or changed the existing Site. The commands below are for a later deployment you choose to perform.

## Prepare and review locally

```sh
npm ci
npm run verify
```

Ordinary builds may use the reviewed `source: "seed"` snapshot for development. A release requires Contentstack provenance and an explicit public HTTPS `SITE_URL`; localhost, IP addresses, reserved example/test domains, URL credentials, paths, and query strings are rejected. An intentionally empty published journal is valid.

After configuring the private Contentstack delivery environment described in the CMS documentation:

```sh
npm run cms:pull
# Set SITE_URL to the intended HTTPS domain before the next command.
npm run build:release
```

`build:release` validates snapshot provenance, builds, and scans the output. The scan checks expected directory pages, rejects runtime/private files and symlinks, and looks for actual configured Contentstack credential values without printing them. It complements review; it cannot recognize a secret that was never configured for the scan. Upload only `dist/`, never the source tree or `.env`.

The PR/main-branch workflow runs Node 24, `npm ci`, and `npm run verify`, then scans the artifact and retains test reports. It has no AWS deployment permissions or CMS credentials, performs no CMS pulls/imports, and deploys nothing.

## Template design

`infra/aws.yaml` is JSON-compatible YAML so its structure and references can be tested without a YAML dependency. It prepares:

- An encrypted S3 bucket with every public-access block enabled and bucket-owner enforcement.
- CloudFront Origin Access Control, with signed requests and a bucket policy limited to that distribution. The S3 website endpoint is not used. [AWS OAC documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).
- HTTPS redirection, compression, a short default cache lifetime, and security response headers. The CSP permits inline Astro/React bootstrap scripts and styles while restricting network connections and assets to this origin.
- A viewer-request function mapping `/map` and `/map/` to `/map/index.html`, likewise for journal pages; asset filenames remain unchanged. This follows [AWS's directory-index rewrite pattern](https://github.com/aws-samples/amazon-cloudfront-functions/tree/main/url-rewrite-single-page-apps).
- A real HTTP 404 with `/404.html` for missing S3 keys. It does not return the homepage with a 200 status for unknown pages.

Only S3 and CloudFront resources are declared. The bucket is retained if the stack is deleted; remove that retained bucket separately when you are finished with it to avoid ongoing storage charges.

## Later: create the infrastructure

Use an approved AWS CLI profile and review the target account before executing these commands. No AWS CLI or authentication command was run during preparation. Local structural/security/rewrite tests pass; provider-schema validation and an actual deployment remain unverified because AWS CLI and `cfn-lint` are not installed here. If available, run `cfn-lint infra/aws.yaml` as an additional offline check. AWS's [validation guidance](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-guide.html) distinguishes template syntax checks from fuller resource-property checks.

```sh
NATUREDEX_STACK=naturedex-static
NATUREDEX_REGION=us-east-1
NATUREDEX_CHANGE=naturedex-initial

aws cloudformation validate-template \
  --template-body file://infra/aws.yaml --region "$NATUREDEX_REGION"

aws cloudformation create-change-set \
  --stack-name "$NATUREDEX_STACK" --change-set-name "$NATUREDEX_CHANGE" \
  --change-set-type CREATE --template-body file://infra/aws.yaml \
  --region "$NATUREDEX_REGION"

aws cloudformation wait change-set-create-complete \
  --stack-name "$NATUREDEX_STACK" --change-set-name "$NATUREDEX_CHANGE" \
  --region "$NATUREDEX_REGION"

aws cloudformation describe-change-set \
  --stack-name "$NATUREDEX_STACK" --change-set-name "$NATUREDEX_CHANGE" \
  --region "$NATUREDEX_REGION" --query Changes --output table
```

Review the proposed resources and costs, then execute that specific change set:

```sh
aws cloudformation execute-change-set \
  --stack-name "$NATUREDEX_STACK" --change-set-name "$NATUREDEX_CHANGE" \
  --region "$NATUREDEX_REGION"

aws cloudformation wait stack-create-complete \
  --stack-name "$NATUREDEX_STACK" --region "$NATUREDEX_REGION"

aws cloudformation describe-stacks \
  --stack-name "$NATUREDEX_STACK" --region "$NATUREDEX_REGION" \
  --query 'Stacks[0].Outputs' --output table
```

The default uses CloudFront's HTTPS hostname. For a custom hostname, supply both `DomainName` and `CertificateArn` parameters when creating the change set, then configure its DNS record. The certificate must already be issued, cover the hostname, and reside in `us-east-1`; the template creates neither DNS nor certificates. [AWS certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

## Later: build and upload the actual release

Read the stack outputs instead of guessing a bucket or distribution:

```sh
NATUREDEX_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$NATUREDEX_STACK" --region "$NATUREDEX_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue | [0]" --output text)
NATUREDEX_DISTRIBUTION=$(aws cloudformation describe-stacks \
  --stack-name "$NATUREDEX_STACK" --region "$NATUREDEX_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue | [0]" --output text)
export SITE_URL=$(aws cloudformation describe-stacks \
  --stack-name "$NATUREDEX_STACK" --region "$NATUREDEX_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue | [0]" --output text)

npm run cms:pull
npm run verify
npm run build:release

# Upload new fingerprinted assets before the HTML that refers to them.
aws s3 sync dist/ "s3://$NATUREDEX_BUCKET/" --region "$NATUREDEX_REGION" \
  --exclude '*' --include '_astro/*' \
  --cache-control 'public,max-age=31536000,immutable'
aws s3 sync dist/ "s3://$NATUREDEX_BUCKET/" --region "$NATUREDEX_REGION" \
  --exclude '_astro/*' --delete --cache-control 'public,max-age=300'

NATUREDEX_INVALIDATION=$(aws cloudfront create-invalidation \
  --distribution-id "$NATUREDEX_DISTRIBUTION" --paths '/*' \
  --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed \
  --distribution-id "$NATUREDEX_DISTRIBUTION" --id "$NATUREDEX_INVALIDATION"
```

The second sync deletes obsolete pages in this dedicated bucket, including unpublished articles. Old fingerprinted assets are retained to support cached pages; review them periodically for storage growth. Test the homepage, `/map/`, a published journal permalink, and a nonexistent path over HTTPS. Confirm the nonexistent path returns 404 and direct S3 access is denied. CMS edits appear after another pull/build/upload, not immediately at runtime. Retain a previous reviewed `dist/` artifact if you need a rollback.

## Keeping the budget small

Under $30 per month is a low-traffic design goal, not a quote or spending cap. The principal AWS usage is S3 storage/requests, CloudFront delivery/requests/function invocations, and invalidations. This template chooses `PriceClass_100` by default and adds no server, database, NAT gateway, WAF, or continuous build service. Estimate expected visits × transferred bytes in the [AWS calculator](https://calculator.aws/) and check current [CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) and [S3 pricing](https://aws.amazon.com/s3/pricing/). Credits, free allowances, and CloudFront flat-rate plans are account/plan considerations; the template does not enroll you in a flat-rate plan.

Contentstack is a separate vendor expense. Its [published plans](https://www.contentstack.com/pricing) currently include an individual Free option, but verify eligibility, limits, production use, and your account's trial/renewal terms before treating the CMS as free. Domain registration, DNS, taxes, support, and other account services are separate from this template.

Set actual-cost alerts below and at the $30 target and review billing after initial traffic. AWS Budgets notifications can be delayed and do not create a hard spending cap; charges may exceed an alert before it arrives. [AWS Budgets update and notification behavior](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).
