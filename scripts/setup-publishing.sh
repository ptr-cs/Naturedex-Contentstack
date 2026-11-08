#!/usr/bin/env bash
# One-time setup for publish-to-live (docs/publishing.md):
#   npm run setup:publishing -- OWNER/REPO
#
# Needs: the site stack (npm run deploy:aws), an existing GitHub repository,
# `aws login`, and `gh auth login`. Rerunning is safe; it keeps the existing
# GitHub token and webhook password unless GITHUB_RELAY_TOKEN is set.
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_PAGER=""

REPO="${1:-}"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Usage: npm run setup:publishing -- OWNER/REPO" >&2; exit 1; }
SITE_STACK="${NATUREDEX_STACK:-naturedex-contentstack}"
STACK="${SITE_STACK}-publishing"
REGION="${NATUREDEX_REGION:-us-east-1}"

aws sts get-caller-identity >/dev/null 2>&1 || { echo "AWS credentials are missing or expired. Run: aws login" >&2; exit 1; }
gh repo view "$REPO" >/dev/null || { echo "GitHub repository $REPO was not found. Create and push it first." >&2; exit 1; }

site_output() {
  aws cloudformation describe-stacks --stack-name "$SITE_STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}
BUCKET=$(site_output BucketName) || { echo "Site stack $SITE_STACK not found. Run npm run deploy:aws first." >&2; exit 1; }
DISTRIBUTION=$(site_output DistributionId)

# An account can hold only one GitHub OIDC provider; reuse it if present
# (for example, the one Naturedex-WordPress created).
PROVIDER=$(aws iam list-open-id-connect-providers \
  --query "OpenIDConnectProviderList[?ends_with(Arn, '/token.actions.githubusercontent.com')].Arn | [0]" --output text)
[[ "$PROVIDER" == "None" ]] && PROVIDER=""

# Newer repositories may use immutable OIDC subjects such as owner@1/name@2.
OIDC_REPO=$(gh api "repos/$REPO/actions/oidc/customization/sub" --jq '.sub_claim_prefix // empty' 2>/dev/null || true)
OIDC_REPO="${OIDC_REPO#repo:}"

OVERRIDES=(Repository="$REPO" OidcRepository="$OIDC_REPO" ExistingOidcProviderArn="$PROVIDER"
  SiteStackName="$SITE_STACK" BucketName="$BUCKET" DistributionId="$DISTRIBUTION")

NEW_PASSWORD=""
if ! aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" >/dev/null 2>&1; then
  NEW_PASSWORD=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)
  OVERRIDES+=(WebhookPassword="$NEW_PASSWORD")
  if [[ -z "${GITHUB_RELAY_TOKEN:-}" ]]; then
    echo "Create a fine-grained GitHub token: only $REPO, permission Actions: Read and write."
    read -rsp "Paste it (input hidden): " GITHUB_RELAY_TOKEN; echo
  fi
fi
[[ -n "${GITHUB_RELAY_TOKEN:-}" ]] && OVERRIDES+=(GitHubToken="$GITHUB_RELAY_TOKEN")

echo "Deploying $STACK…"
aws cloudformation deploy --stack-name "$STACK" --region "$REGION" \
  --template-file infra/publish.yaml --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset --tags Project=naturedex-contentstack \
  --parameter-overrides "${OVERRIDES[@]}"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}
ROLE=$(output DeployRoleArn)
WEBHOOK=$(output WebhookUrl)

echo "Configuring GitHub environment 'production' (main only)…"
gh api -X PUT "repos/$REPO/environments/production" --input - >/dev/null <<'JSON'
{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
JSON
gh api -X POST "repos/$REPO/environments/production/deployment-branch-policies" \
  -f name=main -f type=branch >/dev/null 2>&1 || true # already present on reruns

if [[ -f .env ]]; then set -a; source .env; set +a; fi
gh variable set AWS_DEPLOY_ROLE_ARN --repo "$REPO" --env production --body "$ROLE"
gh variable set AWS_REGION --repo "$REPO" --env production --body "$REGION"
gh variable set NATUREDEX_STACK --repo "$REPO" --env production --body "$SITE_STACK"
for name in CONTENTSTACK_ENVIRONMENT CONTENTSTACK_REGION CONTENTSTACK_LOCALE CONTENTSTACK_BRANCH; do
  [[ -n "${!name:-}" ]] && gh variable set "$name" --repo "$REPO" --env production --body "${!name}"
done
MISSING=()
for name in CONTENTSTACK_API_KEY CONTENTSTACK_DELIVERY_TOKEN; do
  if [[ -n "${!name:-}" ]]; then printf %s "${!name}" | gh secret set "$name" --repo "$REPO" --env production
  else MISSING+=("$name"); fi
done

echo
echo "Done. In Contentstack: Settings → Webhooks → + New Webhook"
echo "  URL:       $WEBHOOK"
echo "  Auth:      Basic Auth, username: contentstack"
if [[ -n "$NEW_PASSWORD" ]]; then
  echo "  Password:  $NEW_PASSWORD"
  echo "             (shown once; rerunning setup keeps it)"
else
  echo "  Password:  unchanged from the first setup"
fi
echo "  Triggers:  entries published, unpublished and deleted in your delivery environment"
if (( ${#MISSING[@]} )); then
  echo
  echo "Not yet in GitHub (fill .env and rerun, or use gh secret set --env production): ${MISSING[*]}"
fi
