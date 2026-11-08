#!/usr/bin/env bash
# One-command AWS deploy for the static Naturedex site (S3 + CloudFront).
#
#   npm run deploy:aws            create/update the stack, build, upload, invalidate
#   npm run deploy:aws -- content build, upload, invalidate (stack must exist; used by CI)
#   npm run deploy:aws -- destroy delete the stack and its (retained) bucket
#
# Seed snapshots deploy as a labeled preview; a pulled Contentstack snapshot
# additionally passes the release provenance check.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${NATUREDEX_STACK:-naturedex-contentstack}"
REGION="${NATUREDEX_REGION:-us-east-1}"
export AWS_PAGER=""

if ! aws sts get-caller-identity --query Account --output text >/dev/null 2>&1; then
  echo "AWS credentials are missing or expired. Run: aws login" >&2
  exit 1
fi
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}

if [[ "${1:-}" == "destroy" ]]; then
  BUCKET=$(output BucketName)
  echo "Deleting stack $STACK and bucket $BUCKET in account $ACCOUNT ($REGION)."
  aws cloudformation delete-stack --stack-name "$STACK" --region "$REGION"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$REGION"
  # The template retains the bucket on stack deletion; remove it explicitly.
  aws s3 rm "s3://$BUCKET" --recursive --region "$REGION" >/dev/null
  aws s3api delete-bucket --bucket "$BUCKET" --region "$REGION"
  echo "Removed."
  exit 0
fi

if [[ "${1:-}" == "content" ]]; then
  # CI path: the deploy role can upload and invalidate, not change infrastructure.
  echo "Uploading to existing stack $STACK in account $ACCOUNT ($REGION)…"
elif [[ -n "${1:-}" ]]; then
  echo "Usage: npm run deploy:aws [-- content|destroy]" >&2
  exit 1
else
  echo "Deploying stack $STACK to account $ACCOUNT ($REGION)…"
  aws cloudformation deploy --stack-name "$STACK" --region "$REGION" \
    --template-file infra/aws.yaml --no-fail-on-empty-changeset \
    --tags Project=naturedex-contentstack
fi

BUCKET=$(output BucketName)
DISTRIBUTION=$(output DistributionId)
export SITE_URL=$(output SiteUrl)

SOURCE=$(node -p "require('./data/content.json').source")
if [[ "$SOURCE" == "contentstack" ]]; then
  node --env-file-if-exists=.env scripts/release-check.mjs
else
  echo "Note: data/content.json is the seed snapshot; deploying it as a preview."
fi

# Unit test totals feed the /status page; a failure stops the deploy here.
npm run test:status
npm run build
node scripts/scan-release.mjs

# Fingerprinted assets first (long cache), then pages (short cache, prune old).
aws s3 sync dist/ "s3://$BUCKET/" --region "$REGION" \
  --exclude '*' --include '_astro/*' \
  --cache-control 'public,max-age=31536000,immutable'
aws s3 sync dist/ "s3://$BUCKET/" --region "$REGION" \
  --exclude '_astro/*' --delete --cache-control 'public,max-age=300'

INVALIDATION=$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" \
  --paths '/*' --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION" --id "$INVALIDATION"

echo "Live at $SITE_URL ($SOURCE content)"
