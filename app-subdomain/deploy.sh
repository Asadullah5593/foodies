#!/usr/bin/env bash
#
# Uploads the deep-link / fallback files to the S3 bucket behind
# app.foodies-pakistan.com with the CORRECT Content-Type headers.
#
# The whole reason this is a script and not a plain `aws s3 sync`:
# the Apple App Site Association file has NO extension, so `aws s3 sync`
# guesses its type as application/octet-stream -> iOS silently ignores it.
# We upload that one file explicitly with --content-type application/json.
#
# Safe to re-run. Run it again any time the mobile team ships new files.
#
# Usage:
#   BUCKET=app-foodies-pakistan-com \
#   DISTRIBUTION_ID=E1XXXXXXXXXX \
#   ./deploy.sh
#
set -euo pipefail

BUCKET="${BUCKET:?Set BUCKET to your S3 bucket name, e.g. app-foodies-pakistan-com}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-}"   # optional; if set, we invalidate the CDN cache
HERE="$(cd "$(dirname "$0")" && pwd)"

echo ">> Uploading static assets (index.html, etc.) to s3://$BUCKET ..."
# Everything EXCEPT the two well-known files (sync guesses their types fine for .html/.json,
# but we handle the well-known dir explicitly below to be 100% sure of Content-Type).
aws s3 sync "$HERE" "s3://$BUCKET" \
  --exclude "deploy.sh" \
  --exclude "DEPLOY_AWS.md" \
  --exclude ".well-known/*" \
  --cache-control "public, max-age=300" \
  --delete

echo ">> Uploading assetlinks.json with Content-Type: application/json ..."
aws s3 cp "$HERE/.well-known/assetlinks.json" \
  "s3://$BUCKET/.well-known/assetlinks.json" \
  --content-type "application/json" \
  --cache-control "public, max-age=300"

echo ">> Uploading apple-app-site-association (extension-less) with Content-Type: application/json ..."
aws s3 cp "$HERE/.well-known/apple-app-site-association" \
  "s3://$BUCKET/.well-known/apple-app-site-association" \
  --content-type "application/json" \
  --cache-control "public, max-age=300"

if [[ -n "$DISTRIBUTION_ID" ]]; then
  echo ">> Invalidating CloudFront cache for $DISTRIBUTION_ID ..."
  aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/index.html" "/.well-known/*" "/" >/dev/null
  echo ">> Invalidation submitted."
else
  echo ">> DISTRIBUTION_ID not set; skipping CloudFront invalidation."
  echo "   (Set it once your distribution exists so updates go live immediately.)"
fi

echo ">> Done."
